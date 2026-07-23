"use client";

import {
  FilesetResolver,
  HolisticLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import type {
  DatasetBuildProgress,
  ExtractedReference,
  MotionTemplateFrame,
  ReferenceDanceDataset,
  ReferenceVideoManifest,
} from "./reference-dataset.types";
import type { SkeletonSnapshot, VisionLandmark } from "./vision-types";

const WASM_ROOT =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/1/holistic_landmarker.task";
const UPPER_BODY_LANDMARKS = [11, 12, 13, 14, 15, 16, 23, 24] as const;

export async function loadReferenceManifest(
  danceId: string,
): Promise<ReferenceVideoManifest> {
  const response = await fetch(
    `/dances/${encodeURIComponent(danceId)}/manifest.json`,
    {
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error(`没有找到舞蹈 ${danceId} 的参考视频清单。`);
  }
  return (await response.json()) as ReferenceVideoManifest;
}

export async function buildReferenceDataset(
  manifest: ReferenceVideoManifest,
  onProgress?: (progress: DatasetBuildProgress) => void,
): Promise<ReferenceDanceDataset> {
  onProgress?.({
    stage: "loading-model",
    completedVideos: 0,
    totalVideos: manifest.references.length,
    message: "正在在线加载 MediaPipe Holistic 模型…",
  });

  const fileset = await FilesetResolver.forVisionTasks(WASM_ROOT);
  let landmarker: HolisticLandmarker;
  try {
    landmarker = await createLandmarker(fileset, "GPU");
  } catch {
    landmarker = await createLandmarker(fileset, "CPU");
  }

  const extracted: ExtractedReference[] = [];
  let inferenceTimestamp = 0;
  try {
    for (let index = 0; index < manifest.references.length; index += 1) {
      const reference = manifest.references[index];
      onProgress?.({
        stage: "extracting",
        completedVideos: index,
        totalVideos: manifest.references.length,
        message: `正在提取参考视频 ${index + 1}/${manifest.references.length} 的骨骼和双手节点…`,
      });
      const result = await extractReference(
        reference,
        manifest.extraction.sampleFps,
        landmarker,
        inferenceTimestamp,
      );
      inferenceTimestamp += result.durationMs + 1000;
      extracted.push(result);
      onProgress?.({
        stage: "extracting",
        completedVideos: index + 1,
        totalVideos: manifest.references.length,
        message: `已完成 ${index + 1}/${manifest.references.length} 个参考视频。`,
      });
    }
  } finally {
    landmarker.close();
  }

  onProgress?.({
    stage: "building-templates",
    completedVideos: extracted.length,
    totalVideos: manifest.references.length,
    message: "正在寻找动作边界并生成多参考模板…",
  });
  const dataset = assembleDataset(manifest, extracted);
  onProgress?.({
    stage: "completed",
    completedVideos: extracted.length,
    totalVideos: manifest.references.length,
    message: `已生成 ${dataset.templatePacks.length} 个动作单元。`,
  });
  return dataset;
}

async function createLandmarker(
  fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
  delegate: "GPU" | "CPU",
): Promise<HolisticLandmarker> {
  return HolisticLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    minPoseDetectionConfidence: 0.45,
    minPosePresenceConfidence: 0.45,
    minHandLandmarksConfidence: 0.4,
  });
}

async function extractReference(
  reference: ReferenceVideoManifest["references"][number],
  sampleFps: number,
  landmarker: HolisticLandmarker,
  timestampOffset: number,
): Promise<ExtractedReference> {
  const video = await loadVideo(reference.videoUrl);
  const durationMs = Math.round(video.duration * 1000);
  const sampleIntervalMs = Math.max(80, Math.round(1000 / sampleFps));
  const frames: SkeletonSnapshot[] = [];

  for (let videoMs = 0; videoMs <= durationMs; videoMs += sampleIntervalMs) {
    await seekVideo(video, Math.min(video.duration, videoMs / 1000));
    const result = landmarker.detectForVideo(video, timestampOffset + videoMs);
    const pose = result.poseLandmarks[0];
    if (!pose?.length) continue;
    frames.push({
      timestampMs: videoMs,
      pose: copyLandmarks(pose),
      leftHand: copyLandmarks(result.leftHandLandmarks[0]),
      rightHand: copyLandmarks(result.rightHandLandmarks[0]),
    });
  }

  video.removeAttribute("src");
  video.load();
  if (frames.length < 5) {
    throw new Error(`参考视频 ${reference.referenceId} 没有提取到足够骨骼帧。`);
  }
  return { ...reference, durationMs, frames };
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => resolve(video);
    video.onerror = () => reject(new Error(`无法读取参考视频：${url}`));
    video.src = url;
    video.load();
  });
}

function seekVideo(video: HTMLVideoElement, seconds: number): Promise<void> {
  if (Math.abs(video.currentTime - seconds) < 0.005) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("参考视频定位帧超时。")),
      5000,
    );
    video.onseeked = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    video.currentTime = seconds;
  });
}

function copyLandmarks(
  landmarks: NormalizedLandmark[] | undefined,
): VisionLandmark[] {
  return (landmarks ?? []).map(({ x, y, z, visibility }) => ({
    x,
    y,
    z,
    visibility,
  }));
}

function assembleDataset(
  manifest: ReferenceVideoManifest,
  references: ExtractedReference[],
): ReferenceDanceDataset {
  const primary =
    references.find(
      (reference) => reference.referenceId === manifest.primaryReferenceId,
    ) ?? references[0];
  const boundaries = deriveMotionBoundaries(
    primary.frames,
    primary.durationMs,
    manifest.extraction,
  );
  const handCoverage = calculateHandCoverage(references);
  const templatePacks = boundaries.slice(0, -1).map((startMs, index) => {
    const endMs = boundaries[index + 1];
    const motionId = `motion-${String(index + 1).padStart(2, "0")}`;
    const templates = references
      .map((reference) =>
        createMotionTemplate(reference, startMs, endMs, primary.durationMs),
      )
      .filter((template) => template.frames.length >= 5);
    if (templates.length === 0) {
      throw new Error(`动作单元 ${motionId} 没有可用的参考模板。`);
    }
    const leftCoverage = handCoverageForTemplates(templates, "leftHand");
    const rightCoverage = handCoverageForTemplates(templates, "rightHand");
    const requiredParts: Array<"pose" | "left_hand" | "right_hand"> = ["pose"];
    if (leftCoverage >= 0.55) requiredParts.push("left_hand");
    if (rightCoverage >= 0.55) requiredParts.push("right_hand");

    return {
      schemaVersion: "motion-template-pack-v1" as const,
      danceId: manifest.danceId,
      motionId,
      motionName: `动作 ${index + 1}`,
      instruction: `这是第 ${index + 1} 个动作。先只看手臂移动的路线，不用急着跟；看清以后，再按你舒服的节奏完整做一遍。`,
      acceptSpeech: "做得很好，这个动作已经有感觉了。",
      hintSpeech: "整体方向是对的，再留意一下手臂高度和手势形状。",
      retrySpeech: "没关系，我们放慢一点，只抓住一个关键点再试一次。",
      expectedDurationMs: Math.max(500, endMs - startMs),
      requiredParts,
      evaluationPolicy: {
        acceptThreshold: 0.72,
        acceptWithHintThreshold: 0.56,
        minimumCompletionProgress: 0.62,
        minimumObservationMs: 650,
      },
      templates,
    };
  });

  const primaryManifest = manifest.references.find(
    (reference) => reference.referenceId === primary.referenceId,
  );
  return {
    schemaVersion: "reference-dance-dataset-v1",
    danceId: manifest.danceId,
    title: manifest.title,
    referenceVideoUrl: primaryManifest?.videoUrl ?? primary.videoUrl,
    generatedAt: new Date().toISOString(),
    sourceVideoCount: references.length,
    lesson: {
      schemaVersion: "teaching-lesson-plan-v1",
      danceId: manifest.danceId,
      title: manifest.title,
      referenceVideoId: primary.referenceId,
      previewStartMs: 0,
      previewEndMs: primary.durationMs,
      policy: {
        maxRetriesPerMotion: 2,
        allowVoiceSkip: true,
        autoAdvanceAfterMaxRetries: true,
      },
      motions: templatePacks.map((pack, index) => ({
        motionId: pack.motionId,
        instruction: pack.instruction,
        demoStartMs: boundaries[index],
        demoEndMs: boundaries[index + 1],
        demoPlaybackRate: 0.7,
      })),
    },
    templatePacks,
    extraction: {
      engine: "mediapipe-holistic-landmarker",
      sampleFps: manifest.extraction.sampleFps,
      detectedFrameCount: references.reduce(
        (total, reference) => total + reference.frames.length,
        0,
      ),
      motionCount: templatePacks.length,
      handCoverage,
    },
  };
}

function deriveMotionBoundaries(
  frames: SkeletonSnapshot[],
  durationMs: number,
  policy: ReferenceVideoManifest["extraction"],
): number[] {
  const minimumCount = Math.max(
    1,
    Math.ceil(durationMs / policy.maximumMotionDurationMs),
  );
  const maximumCount = Math.max(
    minimumCount,
    Math.floor(durationMs / policy.minimumMotionDurationMs),
  );
  const idealCount = Math.round(durationMs / policy.targetMotionDurationMs);
  const motionCount = Math.max(
    minimumCount,
    Math.min(maximumCount, Math.max(1, idealCount)),
  );
  const boundaries = [0];

  for (let index = 1; index < motionCount; index += 1) {
    const targetMs = (durationMs * index) / motionCount;
    const searchRadius = Math.min(650, durationMs / motionCount / 3);
    const candidates = frames
      .map((frame, frameIndex) => ({
        timestampMs: frame.timestampMs,
        energy: motionEnergy(frames, frameIndex),
      }))
      .filter(
        (candidate) =>
          candidate.timestampMs >= targetMs - searchRadius &&
          candidate.timestampMs <= targetMs + searchRadius,
      )
      .sort((left, right) => left.energy - right.energy);
    boundaries.push(Math.round(candidates[0]?.timestampMs ?? targetMs));
  }
  boundaries.push(durationMs);
  return boundaries;
}

function motionEnergy(frames: SkeletonSnapshot[], index: number): number {
  if (index === 0) return Number.POSITIVE_INFINITY;
  const current = frames[index].pose;
  const previous = frames[index - 1].pose;
  const leftShoulder = current[11];
  const rightShoulder = current[12];
  const scale =
    leftShoulder && rightShoulder
      ? Math.max(
          0.0001,
          Math.hypot(
            leftShoulder.x - rightShoulder.x,
            leftShoulder.y - rightShoulder.y,
          ),
        )
      : 1;
  const distances = UPPER_BODY_LANDMARKS.map((landmarkIndex) => {
    const a = current[landmarkIndex];
    const b = previous[landmarkIndex];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) / scale : 1;
  });
  return distances.reduce((sum, value) => sum + value, 0) / distances.length;
}

function createMotionTemplate(
  reference: ExtractedReference,
  primaryStartMs: number,
  primaryEndMs: number,
  primaryDurationMs: number,
) {
  const startMs = (primaryStartMs / primaryDurationMs) * reference.durationMs;
  const endMs = (primaryEndMs / primaryDurationMs) * reference.durationMs;
  const candidates = reference.frames.filter(
    (frame) => frame.timestampMs >= startMs && frame.timestampMs <= endMs,
  );
  const selected = resample(candidates, 24);
  const firstTimestamp = selected[0]?.timestampMs ?? startMs;
  const frames: MotionTemplateFrame[] = selected.map((frame) => ({
    timestampMs: Math.max(0, Math.round(frame.timestampMs - firstTimestamp)),
    pose: frame.pose,
    ...(frame.leftHand.length >= 21 ? { leftHand: frame.leftHand } : {}),
    ...(frame.rightHand.length >= 21 ? { rightHand: frame.rightHand } : {}),
  }));
  return {
    templateId: `${reference.referenceId}-${Math.round(primaryStartMs)}-${Math.round(primaryEndMs)}`,
    sourceVideoId: reference.referenceId,
    mirrored: reference.mirrored,
    frames,
  };
}

function resample<T>(items: T[], maximum: number): T[] {
  if (items.length <= maximum) return items;
  return Array.from(
    { length: maximum },
    (_, index) =>
      items[Math.round((index / (maximum - 1)) * (items.length - 1))],
  );
}

function calculateHandCoverage(references: ExtractedReference[]): number {
  const frames = references.flatMap((reference) => reference.frames);
  if (frames.length === 0) return 0;
  const visibleHands = frames.reduce(
    (count, frame) =>
      count +
      Number(frame.leftHand.length >= 21) +
      Number(frame.rightHand.length >= 21),
    0,
  );
  return Number((visibleHands / (frames.length * 2)).toFixed(3));
}

function handCoverageForTemplates(
  templates: Array<{ frames: MotionTemplateFrame[] }>,
  hand: "leftHand" | "rightHand",
): number {
  const frames = templates.flatMap((template) => template.frames);
  if (frames.length === 0) return 0;
  return (
    frames.filter((frame) => (frame[hand]?.length ?? 0) >= 21).length /
    frames.length
  );
}
