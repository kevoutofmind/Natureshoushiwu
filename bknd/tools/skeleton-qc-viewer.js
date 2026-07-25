const POSE_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 7],
  [0, 4],
  [4, 5],
  [5, 6],
  [6, 8],
  [9, 10],
  [11, 12],
  [11, 13],
  [13, 15],
  [15, 17],
  [15, 19],
  [15, 21],
  [17, 19],
  [12, 14],
  [14, 16],
  [16, 18],
  [16, 20],
  [16, 22],
  [18, 20],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [27, 29],
  [29, 31],
  [27, 31],
  [24, 26],
  [26, 28],
  [28, 30],
  [30, 32],
  [28, 32],
];
const HAND_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];
const UPPER_BODY_INDICES = [11, 12, 13, 14, 15, 16, 23, 24];
const POSE_MIRROR_PAIRS = [
  [1, 4],
  [2, 5],
  [3, 6],
  [7, 8],
  [9, 10],
  [11, 12],
  [13, 14],
  [15, 16],
  [17, 18],
  [19, 20],
  [21, 22],
  [23, 24],
  [25, 26],
  [27, 28],
  [29, 30],
  [31, 32],
];
const SAMPLE_FPS = 10;
const COMPARISON_FRAMES = 16;
// MediaPipe's monocular Z estimate varies noticeably between otherwise
// identical decoding runs. Keep depth as a weak cue while making the stable
// image-plane motion and joint layout the primary similarity signal.
const DEPTH_WEIGHT = 0.15;
const POSITIVE_BASELINE_SCORE = 0.82;

const elements = {
  dataset: document.querySelector('#datasetSelect'),
  reference: document.querySelector('#referenceSelect'),
  file: document.querySelector('#videoFile'),
  mirrorInput: document.querySelector('#mirrorInput'),
  analyze: document.querySelector('#analyzeButton'),
  status: document.querySelector('#status'),
  progress: document.querySelector('#progress'),
  progressFill: document.querySelector('#progressFill'),
  referenceVideo: document.querySelector('#referenceVideo'),
  referenceCanvas: document.querySelector('#referenceCanvas'),
  referenceInfo: document.querySelector('#referenceInfo'),
  caseVideo: document.querySelector('#caseVideo'),
  caseCanvas: document.querySelector('#caseCanvas'),
  caseStack: document.querySelector('#caseStack'),
  caseInfo: document.querySelector('#caseInfo'),
  caseWarning: document.querySelector('#caseWarning'),
  overall: document.querySelector('#overallScore'),
  pose: document.querySelector('#poseScore'),
  left: document.querySelector('#leftScore'),
  right: document.querySelector('#rightScore'),
  trajectory: document.querySelector('#trajectoryScore'),
  coverage: document.querySelector('#coverageScore'),
  best: document.querySelector('#bestTemplate'),
  decision: document.querySelector('#decisionText'),
  note: document.querySelector('#evaluationNote'),
};

let catalog = [];
let dataset;
let selectedReference;
let positiveSimilarityBaseline;
let importedUrl;
let caseFrames = [];
let landmarkerPromise;
let lastDetectorTimestampMs = -1;
let renderHandle;

const query = new URLSearchParams(location.search);
const requestedDataset = query.get('dataset');
const requestedVideo = query.get('video');

init().catch(showFatal);

async function init() {
  const response = await fetch('/api/datasets', { cache: 'no-store' });
  if (!response.ok)
    throw new Error(`数据目录读取失败：HTTP ${response.status}`);
  const result = await response.json();
  catalog = result.datasets.filter((item) => item.videos?.length);
  if (!catalog.length) throw new Error('没有找到可用的骨架 JSON。');

  elements.dataset.innerHTML = catalog
    .map(
      (item, index) =>
        `<option value="${index}">${escapeHtml(item.title)}（${item.videos.length} 个范本）</option>`,
    )
    .join('');
  const requestedIndex = catalog.findIndex(
    (item) =>
      item.datasetId === requestedDataset ||
      item.file === requestedDataset ||
      item.title === requestedDataset,
  );
  if (requestedIndex >= 0) elements.dataset.value = String(requestedIndex);

  elements.dataset.addEventListener('change', loadDataset);
  elements.reference.addEventListener('change', loadReference);
  elements.file.addEventListener('change', importVideo);
  elements.analyze.addEventListener('click', analyzeImportedVideo);
  elements.mirrorInput.addEventListener('change', updateInputMirror);
  for (const video of [elements.referenceVideo, elements.caseVideo]) {
    video.addEventListener('play', scheduleRender);
    video.addEventListener('seeked', render);
    video.addEventListener('timeupdate', render);
  }
  window.addEventListener('beforeunload', () => {
    if (importedUrl) URL.revokeObjectURL(importedUrl);
  });

  await loadDataset();
  scheduleRender();
}

async function loadDataset() {
  const metadata = catalog[Number(elements.dataset.value)];
  setStatus(`正在加载 ${metadata.title}……`);
  const response = await fetch(`/data/${encodeURIComponent(metadata.file)}`, {
    cache: 'no-store',
  });
  if (!response.ok)
    throw new Error(`骨架 JSON 加载失败：HTTP ${response.status}`);
  dataset = await response.json();
  const videoPaths = new Map(
    metadata.videos.map((video) => [video.sourceFile, video.videoPath]),
  );
  dataset.videos = dataset.videos.map((video) => ({
    ...video,
    videoPath: videoPaths.get(video.sourceFile) ?? video.sourceFile,
  }));
  positiveSimilarityBaseline = positiveOnlyBaseline(dataset.videos);
  elements.reference.innerHTML = dataset.videos
    .map(
      (video, index) =>
        `<option value="${index}">${escapeHtml(video.sourceFile)} · ${video.detectedFrameCount ?? video.frames.length} 帧</option>`,
    )
    .join('');
  const requestedIndex = dataset.videos.findIndex(
    (video) => video.sourceFile === requestedVideo,
  );
  if (requestedIndex >= 0) elements.reference.value = String(requestedIndex);
  await loadReference();
  clearEvaluation();
  setStatus(
    `已加载 ${dataset.title}：${dataset.videos.length} 个参考范本，实时视频将作为判例。`,
  );
}

async function loadReference() {
  selectedReference = dataset.videos[Number(elements.reference.value)];
  if (!selectedReference) return;
  elements.referenceVideo.pause();
  const referenceVideoPath =
    selectedReference.videoPath ?? selectedReference.sourceFile;
  elements.referenceVideo.src = `/video/${encodeURIComponent(referenceVideoPath)}`;
  elements.referenceVideo.load();
  await waitForVideo(elements.referenceVideo);
  elements.referenceInfo.textContent = `${selectedReference.sourceFile} · ${selectedReference.frames.length} 帧`;
  render();
}

async function importVideo() {
  const file = elements.file.files?.[0];
  if (!file) return;
  if (importedUrl) URL.revokeObjectURL(importedUrl);
  importedUrl = URL.createObjectURL(file);
  caseFrames = [];
  clearEvaluation();
  elements.caseVideo.pause();
  elements.caseVideo.src = importedUrl;
  elements.caseVideo.load();
  await waitForVideo(elements.caseVideo);
  elements.caseInfo.textContent = `${file.name} · ${formatDuration(elements.caseVideo.duration)}`;
  elements.analyze.disabled = false;
  elements.caseWarning.textContent = '尚未提取骨架';
  setStatus(`已导入 ${file.name}，点击“提取并评估”。`);
  updateInputMirror();
  render();
}

async function analyzeImportedVideo() {
  const file = elements.file.files?.[0];
  if (!file) return;
  elements.analyze.disabled = true;
  elements.progress.classList.add('active');
  elements.progressFill.style.width = '0%';
  elements.caseWarning.textContent = '';
  clearEvaluation();

  try {
    setStatus('正在加载本地 MediaPipe 模型……');
    const landmarker = await getLandmarker();
    elements.caseVideo.pause();
    const extraction = await extractFrames(
      elements.caseVideo,
      landmarker,
      SAMPLE_FPS,
      (progressValue) => {
        elements.progressFill.style.width = `${progressValue}%`;
        setStatus(`正在提取判例骨架：${progressValue}%`);
      },
    );
    caseFrames = extraction.frames;
    elements.caseVideo.currentTime = 0;
    const evaluation = evaluateAgainstReferences(
      caseFrames,
      dataset.videos,
      elements.mirrorInput.checked,
    );
    showEvaluation(evaluation, extraction);
    setStatus(
      `评估完成：${file.name}，匹配 ${dataset.datasetId} 的 ${dataset.videos.length} 个范本。`,
    );
    elements.progressFill.style.width = '100%';
  } catch (error) {
    elements.caseWarning.textContent = String(error?.message || error);
    setStatus('评估失败。');
  } finally {
    elements.analyze.disabled = false;
    window.setTimeout(() => elements.progress.classList.remove('active'), 800);
    render();
  }
}

async function getLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FilesetResolver, HolisticLandmarker } =
        await import('/vision_bundle.mjs');
      const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
      // Reference datasets are extracted with the CPU delegate. Keep the
      // evaluator on the same delegate so the same source video produces
      // comparable landmark coordinates, especially hand and depth values.
      return await HolisticLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: '/mediapipe/models/holistic_landmarker.task',
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        minPoseDetectionConfidence: 0.45,
        minPosePresenceConfidence: 0.45,
        minHandLandmarksConfidence: 0.4,
      });
    })();
  }
  return await landmarkerPromise;
}

async function extractFrames(video, detector, fps, onProgress) {
  if (
    !video.videoWidth ||
    !video.videoHeight ||
    !Number.isFinite(video.duration)
  ) {
    throw new Error('导入视频尚未准备完成。');
  }
  const durationMs = Math.round(video.duration * 1000);
  const intervalMs = Math.round(1000 / fps);
  const sampledFrameCount = Math.ceil(durationMs / intervalMs);
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('无法创建视频分析画布。');

  const frames = [];
  let leftFrames = 0;
  let rightFrames = 0;
  const detectorStartTimestampMs = lastDetectorTimestampMs + 1;
  for (
    let timestampMs = 0;
    timestampMs < durationMs;
    timestampMs += intervalMs
  ) {
    await seekVideo(video, timestampMs / 1000);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const detectorTimestampMs = detectorStartTimestampMs + timestampMs;
    const detection = detector.detectForVideo(canvas, detectorTimestampMs);
    lastDetectorTimestampMs = detectorTimestampMs;
    const pose = detection.poseLandmarks?.[0];
    if (pose?.length === 33) {
      const leftHand = copyLandmarks(detection.leftHandLandmarks?.[0]);
      const rightHand = copyLandmarks(detection.rightHandLandmarks?.[0]);
      if (leftHand.length === 21) leftFrames += 1;
      if (rightHand.length === 21) rightFrames += 1;
      frames.push({
        timestampMs,
        pose: copyLandmarks(pose),
        ...(leftHand.length === 21 ? { leftHand } : {}),
        ...(rightHand.length === 21 ? { rightHand } : {}),
      });
    }
    if (frames.length % 2 === 0) {
      onProgress(Math.min(99, Math.round((timestampMs / durationMs) * 100)));
      await yieldToBrowser();
    }
  }
  if (frames.length < 5) {
    throw new Error('有效 Pose 骨架不足 5 帧，无法评估。');
  }
  return {
    frames,
    sampledFrameCount,
    poseCoverage: frames.length / sampledFrameCount,
    leftCoverage: leftFrames / sampledFrameCount,
    rightCoverage: rightFrames / sampledFrameCount,
  };
}

function evaluateAgainstReferences(frames, references, mirrored) {
  const practiceFrames = mirrored ? frames.map(mirrorFrame) : frames;
  const rawScores = references
    .map((reference) => ({
      sourceFile: reference.sourceFile,
      ...compareSequence(reference.frames, practiceFrames),
    }))
    .sort((left, right) => right.overall - left.overall);
  const scores = rawScores.map((score) => ({
    ...score,
    rawOverall: score.overall,
    overall: calibratePositiveScore(score.overall),
  }));
  const best = scores[0];
  const topThree = scores.slice(0, 3);
  return {
    ...best,
    stableScore: average(topThree.map((item) => item.overall)),
    allScores: scores,
  };
}

function positiveOnlyBaseline(references) {
  if (references.length < 2) return undefined;
  const leaveOneOutScores = references
    .map((reference, referenceIndex) =>
      Math.max(
        ...references
          .filter((_, candidateIndex) => candidateIndex !== referenceIndex)
          .map(
            (candidate) =>
              compareSequence(reference.frames, candidate.frames).overall,
          )
          .filter(Number.isFinite),
      ),
    )
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!leaveOneOutScores.length) return undefined;
  const middle = Math.floor(leaveOneOutScores.length / 2);
  return leaveOneOutScores.length % 2
    ? leaveOneOutScores[middle]
    : (leaveOneOutScores[middle - 1] + leaveOneOutScores[middle]) / 2;
}

function calibratePositiveScore(score) {
  const baseline = positiveSimilarityBaseline;
  if (
    !Number.isFinite(score) ||
    !Number.isFinite(baseline) ||
    baseline <= 0 ||
    baseline >= 1
  ) {
    return score;
  }
  if (score < baseline) {
    return (score / baseline) * POSITIVE_BASELINE_SCORE;
  }
  return (
    POSITIVE_BASELINE_SCORE +
    ((score - baseline) / (1 - baseline)) * (1 - POSITIVE_BASELINE_SCORE)
  );
}

function compareSequence(referenceFrames, practiceFrames) {
  const count = Math.max(
    2,
    Math.min(COMPARISON_FRAMES, referenceFrames.length, practiceFrames.length),
  );
  const reference = sampleFrames(referenceFrames, count);
  const practice = sampleFrames(practiceFrames, count);
  const pose = sequenceSimilarity(reference, practice, normalizedPose, 0.55);
  const leftHand = sequenceSimilarity(
    reference,
    practice,
    (frame) => normalizedHand(frame.leftHand),
    0.48,
  );
  const rightHand = sequenceSimilarity(
    reference,
    practice,
    (frame) => normalizedHand(frame.rightHand),
    0.48,
  );
  const trajectory = trajectorySimilarity(reference, practice);
  const components = [
    [pose, 0.5],
    [leftHand, 0.2],
    [rightHand, 0.2],
    [trajectory, 0.1],
  ].filter(([score]) => Number.isFinite(score));
  const weight = components.reduce(
    (total, [, componentWeight]) => total + componentWeight,
    0,
  );
  const overall =
    weight === 0
      ? 0
      : components.reduce(
          (total, [score, componentWeight]) => total + score * componentWeight,
          0,
        ) / weight;
  return { overall, pose, leftHand, rightHand, trajectory };
}

function sequenceSimilarity(referenceFrames, practiceFrames, normalize, scale) {
  const reference = referenceFrames.map(normalize).filter(Boolean);
  const practice = practiceFrames.map(normalize).filter(Boolean);
  if (!reference.length || !practice.length) return undefined;
  const rows = reference.length + 1;
  const columns = practice.length + 1;
  const costs = Array.from({ length: rows }, () =>
    Array(columns).fill(Number.POSITIVE_INFINITY),
  );
  const lengths = Array.from({ length: rows }, () => Array(columns).fill(0));
  costs[0][0] = 0;
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const predecessors = [
        [costs[row - 1][column], lengths[row - 1][column]],
        [costs[row][column - 1], lengths[row][column - 1]],
        [costs[row - 1][column - 1], lengths[row - 1][column - 1]],
      ].sort((left, right) => left[0] - right[0]);
      costs[row][column] =
        predecessors[0][0] +
        pointSetDistance(reference[row - 1], practice[column - 1]);
      lengths[row][column] = predecessors[0][1] + 1;
    }
  }
  const pathLength = lengths.at(-1).at(-1);
  if (!pathLength) return undefined;
  return Math.exp(-(costs.at(-1).at(-1) / pathLength) / scale);
}

function trajectorySimilarity(referenceFrames, practiceFrames) {
  const reference = wristTrajectory(referenceFrames);
  const practice = wristTrajectory(practiceFrames);
  if (!reference || !practice) return undefined;
  return Math.exp(-pointSetDistance(reference, practice) / 0.8);
}

function wristTrajectory(frames) {
  const poses = frames.map(normalizedPose).filter(Boolean);
  if (poses.length < 2) return undefined;
  const first = poses[0];
  return poses.flatMap((pose) => [
    subtract(pose[4], first[4]),
    subtract(pose[5], first[5]),
  ]);
}

function normalizedPose(frame) {
  const leftShoulder = frame.pose?.[11];
  const rightShoulder = frame.pose?.[12];
  if (!leftShoulder || !rightShoulder) return undefined;
  const scale = distance(leftShoulder, rightShoulder);
  if (scale < 0.01) return undefined;
  const center = {
    x: (leftShoulder.x + rightShoulder.x) / 2,
    y: (leftShoulder.y + rightShoulder.y) / 2,
    z: ((leftShoulder.z ?? 0) + (rightShoulder.z ?? 0)) / 2,
  };
  return UPPER_BODY_INDICES.map((index) => {
    const point = frame.pose[index] ?? center;
    return {
      x: (point.x - center.x) / scale,
      y: (point.y - center.y) / scale,
      z: ((point.z ?? 0) - center.z) / scale,
    };
  });
}

function normalizedHand(points) {
  if (!points || points.length < 21) return undefined;
  const wrist = points[0];
  const palmPoints = [5, 9, 13, 17].map((index) => points[index]);
  const palmCenter = {
    x: average(palmPoints.map((point) => point.x)),
    y: average(palmPoints.map((point) => point.y)),
    z: average(palmPoints.map((point) => point.z ?? 0)),
  };
  const scale = Math.sqrt(
    average(
      palmPoints.map(
        (point) => (point.x - wrist.x) ** 2 + (point.y - wrist.y) ** 2,
      ),
    ),
  );
  if (scale < 0.005) return undefined;
  const angle = Math.atan2(palmCenter.y - wrist.y, palmCenter.x - wrist.x);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return points.slice(0, 21).map((point) => {
    const x = (point.x - wrist.x) / scale;
    const y = (point.y - wrist.y) / scale;
    return {
      x: x * cosine + y * sine,
      y: -x * sine + y * cosine,
      z: ((point.z ?? 0) - (wrist.z ?? 0)) / scale,
    };
  });
}

function mirrorFrame(frame) {
  const pose = frame.pose.map(flipPoint);
  for (const [left, right] of POSE_MIRROR_PAIRS) {
    [pose[left], pose[right]] = [pose[right], pose[left]];
  }
  return {
    timestampMs: frame.timestampMs,
    pose,
    leftHand: frame.rightHand?.map(flipPoint),
    rightHand: frame.leftHand?.map(flipPoint),
  };
}

function sampleFrames(frames, count) {
  return Array.from({ length: count }, (_, index) => {
    const position =
      count === 1 ? 0 : (index * (frames.length - 1)) / (count - 1);
    return frames[Math.round(position)];
  });
}

function showEvaluation(evaluation, extraction) {
  setPercent(elements.overall, evaluation.overall);
  setPercent(elements.pose, evaluation.pose);
  setPercent(elements.left, evaluation.leftHand);
  setPercent(elements.right, evaluation.rightHand);
  setPercent(elements.trajectory, evaluation.trajectory);
  elements.coverage.textContent = `${percent(extraction.poseCoverage)} / L ${percent(
    extraction.leftCoverage,
  )} / R ${percent(extraction.rightCoverage)}`;
  elements.best.textContent = evaluation.sourceFile;

  const handsVisible =
    extraction.leftCoverage >= 0.45 && extraction.rightCoverage >= 0.45;
  if (!handsVisible) {
    elements.decision.textContent = '手部覆盖不足，当前分数只能作为参考。';
    elements.caseWarning.textContent = '请确保双手完整出现在画面中';
  } else if (evaluation.overall >= 0.55) {
    elements.decision.textContent = '动作与同类范本高度相似。';
  } else if (evaluation.overall >= 0.35) {
    elements.decision.textContent = '动作接近范本，但仍需要检查关键手势。';
  } else {
    elements.decision.textContent = '动作与当前类别范本差异较大。';
  }
  elements.note.textContent = `Top 3 稳定分为 ${percent(
    evaluation.stableScore,
  )}。该结果是骨架相似度，不是大规模测试集统计准确率。`;
  elements.caseInfo.textContent = `${caseFrames.length} 个有效骨架帧 · 最接近 ${evaluation.sourceFile}`;
}

function render() {
  drawVideoSkeleton(
    elements.referenceVideo,
    elements.referenceCanvas,
    selectedReference?.frames,
  );
  drawVideoSkeleton(elements.caseVideo, elements.caseCanvas, caseFrames);
}

function drawVideoSkeleton(video, canvas, frames) {
  const context = canvas.getContext('2d');
  if (!context || !video.videoWidth || !video.videoHeight) return;
  if (
    canvas.width !== video.videoWidth ||
    canvas.height !== video.videoHeight
  ) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  const frame = nearestFrame(frames, video.currentTime * 1000);
  if (!frame) return;
  const scale = Math.max(0.65, Math.min(canvas.width, canvas.height) / 720);
  drawLandmarks(context, frame.pose, POSE_CONNECTIONS, '#25f4ee', scale, true);
  drawLandmarks(
    context,
    frame.leftHand,
    HAND_CONNECTIONS,
    '#fe2c55',
    scale,
    false,
  );
  drawLandmarks(
    context,
    frame.rightHand,
    HAND_CONNECTIONS,
    '#ffd166',
    scale,
    false,
  );
}

function drawLandmarks(
  context,
  points,
  connections,
  color,
  scale,
  useVisibility,
) {
  if (!points?.length) return;
  const visible = (point) =>
    point &&
    (!useVisibility || point.visibility == null || point.visibility >= 0.25);
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 4 * scale;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const [start, end] of connections) {
    const a = points[start];
    const b = points[end];
    if (!visible(a) || !visible(b)) continue;
    context.beginPath();
    context.moveTo(a.x * context.canvas.width, a.y * context.canvas.height);
    context.lineTo(b.x * context.canvas.width, b.y * context.canvas.height);
    context.stroke();
  }
  for (const point of points) {
    if (!visible(point)) continue;
    context.beginPath();
    context.arc(
      point.x * context.canvas.width,
      point.y * context.canvas.height,
      5 * scale,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
}

function scheduleRender() {
  cancelAnimationFrame(renderHandle);
  const tick = () => {
    render();
    renderHandle = requestAnimationFrame(tick);
  };
  renderHandle = requestAnimationFrame(tick);
}

function updateInputMirror() {
  elements.caseStack.classList.toggle('mirrored', elements.mirrorInput.checked);
  render();
}

function clearEvaluation() {
  for (const element of [
    elements.overall,
    elements.pose,
    elements.left,
    elements.right,
    elements.trajectory,
    elements.coverage,
    elements.best,
  ]) {
    element.textContent = '—';
  }
  elements.decision.textContent = '尚未评估。';
  elements.note.textContent =
    '“动作相似度”是当前视频与同类范本的骨架匹配分，不是模型在大规模测试集上的统计准确率。';
}

function nearestFrame(frames, timestampMs) {
  if (!frames?.length) return null;
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (frames[middle].timestampMs < timestampMs) low = middle + 1;
    else high = middle;
  }
  const after = frames[low];
  const before = frames[Math.max(0, low - 1)];
  return Math.abs(after.timestampMs - timestampMs) <
    Math.abs(before.timestampMs - timestampMs)
    ? after
    : before;
}

function copyLandmarks(points) {
  return (points ?? []).map((point) => ({
    x: round(point.x, 6),
    y: round(point.y, 6),
    z: round(point.z ?? 0, 6),
    ...(Number.isFinite(point.visibility)
      ? { visibility: round(point.visibility, 6) }
      : {}),
  }));
}

function pointSetDistance(left, right) {
  const count = Math.min(left.length, right.length);
  if (!count) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    total += distance(left[index], right[index]);
  }
  return total / count;
}

function distance(left, right) {
  const depthDelta = ((left.z ?? 0) - (right.z ?? 0)) * DEPTH_WEIGHT;
  return Math.sqrt(
    (left.x - right.x) ** 2 + (left.y - right.y) ** 2 + depthDelta ** 2,
  );
}

function subtract(left, right) {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

function flipPoint(point) {
  return { ...point, x: 1 - point.x };
}

function average(values) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

function percent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
}

function setPercent(element, value) {
  element.textContent = percent(value);
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '未知时长';
  return `${seconds.toFixed(1)} 秒`;
}

function setStatus(message) {
  elements.status.textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function waitForVideo(video) {
  return new Promise((resolvePromise, rejectPromise) => {
    if (
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      video.videoWidth
    ) {
      resolvePromise();
      return;
    }
    const timeout = window.setTimeout(
      () => rejectPromise(new Error('视频加载超时。')),
      30_000,
    );
    const ready = () => {
      window.clearTimeout(timeout);
      cleanup();
      resolvePromise();
    };
    const failed = () => {
      window.clearTimeout(timeout);
      cleanup();
      rejectPromise(new Error('浏览器无法解码该视频。'));
    };
    const cleanup = () => {
      video.removeEventListener('loadeddata', ready);
      video.removeEventListener('error', failed);
    };
    video.addEventListener('loadeddata', ready);
    video.addEventListener('error', failed);
  });
}

function seekVideo(video, seconds) {
  return new Promise((resolvePromise, rejectPromise) => {
    if (Math.abs(video.currentTime - seconds) < 0.002) {
      resolvePromise();
      return;
    }
    const timeout = window.setTimeout(
      () => rejectPromise(new Error(`视频定位超时：${seconds.toFixed(2)} 秒`)),
      10_000,
    );
    const done = () => {
      window.clearTimeout(timeout);
      video.removeEventListener('seeked', done);
      resolvePromise();
    };
    video.addEventListener('seeked', done, { once: true });
    video.currentTime = Math.min(seconds, Math.max(0, video.duration - 0.001));
  });
}

function yieldToBrowser() {
  return new Promise((resolvePromise) =>
    window.requestAnimationFrame(() => resolvePromise()),
  );
}

function showFatal(error) {
  setStatus('页面初始化失败。');
  elements.caseWarning.textContent = String(error?.message || error);
}
