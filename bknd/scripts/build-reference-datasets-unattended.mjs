import { closeSync, createWriteStream, existsSync, openSync } from 'node:fs';
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptFile = fileURLToPath(import.meta.url);
const backendRoot = resolve(dirname(scriptFile), '..');
const repositoryRoot = resolve(backendRoot, '..');
const defaultInputRoot = join(backendRoot, 'data');
const defaultOutputRoot = join(repositoryRoot, 'data', 'dances');
const runtimeRoot = join(
  repositoryRoot,
  '.runtime-logs',
  'reference-dataset-build',
);
const stateFile = join(runtimeRoot, 'state.json');
const checkpointFile = join(runtimeRoot, 'checkpoint.json');
const lockFile = join(runtimeRoot, 'run.lock');
const stopFile = join(runtimeRoot, 'stop.request');
const logFile = join(runtimeRoot, 'build.log');

const args = parseArgs(process.argv.slice(2));

if (args.worker) {
  await runWorker(args);
} else if (args.help) {
  printHelp();
} else if (args.status) {
  await printStatus();
} else if (args.stop) {
  await requestStop();
} else if (args.background) {
  await startBackground(args);
} else {
  await runCoordinator(args);
}

async function startBackground(options) {
  await mkdir(runtimeRoot, { recursive: true });
  const currentState = await readJson(stateFile, null);
  if (currentState?.status === 'running' && processExists(currentState.pid)) {
    throw new Error(
      `Reference build is already running with PID ${currentState.pid}.`,
    );
  }

  const forwarded = process.argv
    .slice(2)
    .filter((argument) => argument !== '--background');
  const outputFd = openSync(logFile, 'a');
  const child = spawn(process.execPath, [scriptFile, '--run', ...forwarded], {
    cwd: repositoryRoot,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', outputFd, outputFd],
  });
  child.unref();
  closeSync(outputFd);

  console.log(`Background reference build started. PID=${child.pid}`);
  console.log(`Log: ${logFile}`);
  console.log(`Status: node "${scriptFile}" --status`);
  console.log(`Safe stop: node "${scriptFile}" --stop`);
}

async function printStatus() {
  const state = await readJson(stateFile, null);
  if (!state) {
    console.log('No reference dataset build has been started.');
    return;
  }

  console.log(JSON.stringify(state, null, 2));
  if (existsSync(logFile)) {
    const lines = (await readFile(logFile, 'utf8'))
      .split(/\r?\n/)
      .filter(Boolean);
    if (lines.length > 0) {
      console.log('\nRecent log:');
      for (const line of lines.slice(-20)) console.log(line);
    }
  }
}

async function requestStop() {
  await mkdir(runtimeRoot, { recursive: true });
  const state = await readJson(stateFile, null);
  if (!state || state.status !== 'running' || !processExists(state.pid)) {
    console.log('No active reference dataset build was found.');
    return;
  }

  await writeJsonAtomic(stopFile, {
    requestedAt: new Date().toISOString(),
    requestedByPid: process.pid,
    targetPid: state.pid,
  });
  console.log(
    `Safe stop requested for PID ${state.pid}. It will stop after the current dataset or timeout.`,
  );
}

async function runCoordinator(options) {
  await mkdir(runtimeRoot, { recursive: true });
  const releaseLock = await acquireLock();
  const inputRoot = resolve(options.input ?? defaultInputRoot);
  const outputRoot = resolve(options.output ?? defaultOutputRoot);
  const timeoutMs = positiveInteger(options.timeoutMs, 120_000);
  const idleTimeoutMs = positiveInteger(options.idleTimeoutMs, 30_000);
  const retries = nonNegativeInteger(options.retries, 2);
  const groups = new Set(
    String(options.groups ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const checkpoint = await readJson(checkpointFile, { completed: {} });
  const startedAt = new Date().toISOString();
  const summary = {
    status: 'running',
    pid: process.pid,
    startedAt,
    updatedAt: startedAt,
    inputRoot,
    outputRoot,
    current: null,
    total: 0,
    completed: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };

  try {
    await rm(stopFile, { force: true });
    await updateState(summary);
    log(
      `START pid=${process.pid} input=${inputRoot} output=${outputRoot} timeoutMs=${timeoutMs} idleTimeoutMs=${idleTimeoutMs}`,
    );

    const files = await discoverInputFiles(inputRoot, groups);
    summary.total = files.length;
    await updateState(summary);
    if (files.length === 0) {
      throw new Error(
        `No skeleton-video-dataset-v1 JSON files found below ${inputRoot}.`,
      );
    }

    for (let index = 0; index < files.length; index += 1) {
      if (await stopRequested()) {
        summary.status = 'stopped';
        log('STOP requested-by-user');
        break;
      }

      const inputFile = files[index];
      const fingerprint = await fileFingerprint(inputFile);
      const datasetId = await readDatasetId(inputFile);
      const outputFile = join(
        outputRoot,
        datasetId,
        'processed',
        'dataset.json',
      );
      summary.current = {
        index: index + 1,
        datasetId,
        inputFile,
        outputFile,
        attempt: 0,
        stage: 'pending',
      };
      await updateState(summary);

      if (
        !options.force &&
        checkpoint.completed?.[inputFile]?.fingerprint === fingerprint &&
        (await validExistingOutput(outputFile, datasetId))
      ) {
        summary.skipped += 1;
        summary.current.stage = 'skipped-checkpoint';
        log(
          `SKIP ${index + 1}/${files.length} dataset=${datasetId} reason=checkpoint-hit`,
        );
        await updateState(summary);
        continue;
      }

      let completed = false;
      let lastError = 'unknown failure';
      for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
        if (await stopRequested()) break;
        summary.current.attempt = attempt;
        summary.current.stage = 'worker-starting';
        await updateState(summary);
        log(
          `ATTEMPT ${attempt}/${retries + 1} dataset=${datasetId} file=${basename(inputFile)}`,
        );

        try {
          const result = await runDatasetWorker({
            inputFile,
            outputRoot,
            timeoutMs,
            idleTimeoutMs,
            handCoverageThreshold: numeric(options.handCoverageThreshold, 0.45),
            expectedVideos: positiveInteger(options.expectedVideos, 10),
            force: Boolean(options.force),
            onProgress: async (progress) => {
              summary.current.stage = progress.stage ?? 'working';
              summary.current.progress = progress.progress ?? null;
              summary.current.detail = progress.detail ?? null;
              await updateState(summary);
            },
          });
          checkpoint.completed ??= {};
          checkpoint.completed[inputFile] = {
            fingerprint,
            datasetId,
            outputFile: result.outputFile,
            completedAt: new Date().toISOString(),
            sourceVideoCount: result.sourceVideoCount,
            frameCount: result.frameCount,
            handCoverage: result.handCoverage,
          };
          await writeJsonAtomic(checkpointFile, checkpoint);
          summary.completed += 1;
          summary.current.stage = 'completed';
          summary.current.progress = 100;
          await updateState(summary);
          log(
            `DONE ${index + 1}/${files.length} dataset=${datasetId} templates=${result.sourceVideoCount} frames=${result.frameCount} handCoverage=${result.handCoverage.toFixed(4)}`,
          );
          completed = true;
          break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          summary.current.stage = 'retry-wait';
          summary.current.detail = lastError;
          await updateState(summary);
          log(
            `RETRY dataset=${datasetId} attempt=${attempt} reason=${singleLine(lastError)}`,
          );
        }
      }

      if (!completed) {
        summary.failed += 1;
        summary.failures.push({
          datasetId,
          inputFile,
          reason: lastError,
        });
        summary.current.stage = 'failed';
        await updateState(summary);
        log(`GAVE_UP dataset=${datasetId} reason=${singleLine(lastError)}`);
      }
    }

    if (
      summary.status === 'running' &&
      summary.failed === 0 &&
      options.calibrate
    ) {
      summary.current = {
        index: files.length,
        datasetId: null,
        inputFile: null,
        outputFile: null,
        attempt: 1,
        stage: 'calibrating',
      };
      summary.calibration = { status: 'running' };
      await updateState(summary);
      log(`CALIBRATION_START apply=${Boolean(options.applyCalibration)}`);
      try {
        const calibration = await runCalibration({
          outputRoot,
          apply: Boolean(options.applyCalibration),
          timeoutMs: positiveInteger(options.calibrationTimeoutMs, 300_000),
        });
        summary.calibration = {
          status: 'completed',
          ...calibration,
        };
        log('CALIBRATION_DONE');
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        summary.calibration = {
          status: 'needs-review',
          reason,
        };
        summary.status = 'needs-review';
        process.exitCode = 2;
        log(`CALIBRATION_NEEDS_REVIEW reason=${singleLine(reason)}`);
      }
      await updateState(summary);
    }

    if (summary.status === 'running') {
      summary.status =
        summary.failed > 0 ? 'completed-with-errors' : 'completed';
    }
    if (summary.failed > 0) process.exitCode = 1;
  } catch (error) {
    summary.status = 'failed';
    summary.failures.push({
      datasetId: summary.current?.datasetId ?? null,
      reason: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
    log(
      `FATAL reason=${singleLine(error instanceof Error ? error.stack : String(error))}`,
    );
  } finally {
    summary.current = null;
    summary.updatedAt = new Date().toISOString();
    summary.finishedAt = new Date().toISOString();
    await updateState(summary);
    await rm(stopFile, { force: true });
    await releaseLock();
    log(
      `FINISH status=${summary.status} completed=${summary.completed} skipped=${summary.skipped} failed=${summary.failed}`,
    );
  }
}

async function runCalibration({ outputRoot, apply, timeoutMs }) {
  const tsNodeEntry = join(
    backendRoot,
    'node_modules',
    'ts-node',
    'dist',
    'bin.js',
  );
  const calibrationScript = join(
    backendRoot,
    'scripts',
    'calibrate-reference-datasets.ts',
  );
  if (!existsSync(tsNodeEntry)) {
    throw new Error(
      `Calibration requires backend dependencies. Run npm.cmd ci in ${backendRoot} first.`,
    );
  }
  const childArgs = [tsNodeEntry, calibrationScript, '--data-root', outputRoot];
  if (apply) childArgs.push('--apply');

  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, childArgs, {
      cwd: backendRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      rejectPromise(new Error(`calibration timeout after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
        log(`CALIBRATION ${line}`);
      }
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
      for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
        log(`CALIBRATION_ERROR ${line}`);
      }
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectPromise(new Error(`calibration launch failed: ${error.message}`));
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise({
          applied: apply,
          exitCode: code,
        });
      } else {
        rejectPromise(
          new Error(
            `calibration exited with code ${code}: ${singleLine(output)}`,
          ),
        );
      }
    });
  });
}

async function runDatasetWorker({
  inputFile,
  outputRoot,
  timeoutMs,
  idleTimeoutMs,
  handCoverageThreshold,
  expectedVideos,
  force,
  onProgress,
}) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const workerArgs = [
      scriptFile,
      '--worker',
      '--input-file',
      inputFile,
      '--output',
      outputRoot,
      '--hand-coverage-threshold',
      String(handCoverageThreshold),
      '--expected-videos',
      String(expectedVideos),
    ];
    if (force) workerArgs.push('--force');

    const child = spawn(process.execPath, workerArgs, {
      cwd: repositoryRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdoutBuffer = '';
    let stderr = '';
    let settled = false;
    let idleTimer;

    const totalTimer = setTimeout(() => {
      fail(`worker total timeout after ${timeoutMs} ms`);
    }, timeoutMs);

    function resetIdleTimer() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        fail(`worker heartbeat timeout after ${idleTimeoutMs} ms`);
      }, idleTimeoutMs);
    }

    function cleanup() {
      clearTimeout(totalTimer);
      clearTimeout(idleTimer);
    }

    function fail(message) {
      if (settled) return;
      settled = true;
      cleanup();
      child.kill();
      rejectPromise(new Error(message));
    }

    function handleLine(line) {
      if (!line) return;
      resetIdleTimer();
      if (line.startsWith('PROGRESS ')) {
        const progress = JSON.parse(line.slice('PROGRESS '.length));
        Promise.resolve(onProgress(progress)).catch(() => undefined);
      } else if (line.startsWith('RESULT ')) {
        const result = JSON.parse(line.slice('RESULT '.length));
        if (settled) return;
        settled = true;
        cleanup();
        resolvePromise(result);
      } else {
        log(`WORKER ${line}`);
      }
    }

    resetIdleTimer();
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) handleLine(line.trim());
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      resetIdleTimer();
    });
    child.on('error', (error) =>
      fail(`worker launch failed: ${error.message}`),
    );
    child.on('exit', (code) => {
      if (stdoutBuffer.trim()) handleLine(stdoutBuffer.trim());
      if (settled) return;
      fail(
        `worker exited before RESULT, code=${code}, stderr=${singleLine(stderr)}`,
      );
    });
  });
}

async function runWorker(options) {
  const inputFile = resolve(required(options.inputFile, '--input-file'));
  const outputRoot = resolve(options.output ?? defaultOutputRoot);
  const handCoverageThreshold = numeric(options.handCoverageThreshold, 0.45);
  const expectedVideos = positiveInteger(options.expectedVideos, 10);

  progress('reading', 5, basename(inputFile));
  const rawText = await readFile(inputFile, 'utf8');
  progress('parsing', 12, `${rawText.length} bytes`);
  const source = JSON.parse(rawText);
  validateSourceDataset(source, inputFile, expectedVideos);

  const datasetId = safeId(source.datasetId);
  const sourceVideos = [...source.videos].sort(
    (left, right) =>
      numeric(left.sequence, 0) - numeric(right.sequence, 0) ||
      String(left.sourceFile).localeCompare(String(right.sourceFile)),
  );
  const templates = [];
  const durations = [];
  let totalFrames = 0;
  let poseFrames = 0;
  let leftHandFrames = 0;
  let rightHandFrames = 0;

  for (let index = 0; index < sourceVideos.length; index += 1) {
    const video = sourceVideos[index];
    const frames = cleanFrames(video.frames, video.sourceFile);
    const firstTimestamp = frames[0].timestampMs;
    for (const frame of frames) {
      frame.timestampMs -= firstTimestamp;
      totalFrames += 1;
      poseFrames += Number(frame.pose.length === 33);
      leftHandFrames += Number(frame.leftHand?.length === 21);
      rightHandFrames += Number(frame.rightHand?.length === 21);
    }

    const duration =
      frames.at(-1).timestampMs +
      Math.round(1000 / numeric(source.extraction?.sampleFps, 10));
    durations.push(duration);
    templates.push({
      templateId: `${datasetId}-template-${String(index + 1).padStart(2, '0')}`,
      sourceVideoId: String(
        video.videoId ?? basename(video.sourceFile, '.mp4'),
      ),
      mirrored: Boolean(source.extraction?.mirrored),
      frames,
    });
    progress(
      'building-templates',
      15 + Math.round(((index + 1) / sourceVideos.length) * 55),
      `${index + 1}/${sourceVideos.length} ${video.sourceFile}`,
    );
  }

  const excludedReferenceTemplateIds =
    datasetId === 'cat' ? ['cat-template-01'] : [];
  const referenceTemplates = templates.filter(
    (template) => !excludedReferenceTemplateIds.includes(template.templateId),
  );
  const leftCoverage = totalFrames === 0 ? 0 : leftHandFrames / totalFrames;
  const rightCoverage = totalFrames === 0 ? 0 : rightHandFrames / totalFrames;
  const handCoverage =
    totalFrames === 0
      ? 0
      : (leftHandFrames + rightHandFrames) / (totalFrames * 2);
  const requiredParts = ['pose'];
  if (datasetId !== 'cat') {
    if (leftCoverage >= handCoverageThreshold) requiredParts.push('left_hand');
    if (rightCoverage >= handCoverageThreshold)
      requiredParts.push('right_hand');
  }
  const expectedDurationMs = median(
    referenceTemplates.map(
      (template) =>
        template.frames.at(-1).timestampMs -
        template.frames[0].timestampMs +
        Math.round(1000 / numeric(source.extraction?.sampleFps, 10)),
    ),
  );
  const representative =
    datasetId === 'cat'
      ? (sourceVideos.find((video) =>
          String(video.sourceFile).includes('(4)'),
        ) ?? sourceVideos[0])
      : sourceVideos[0];
  const referenceDurationMs =
    cleanFrames(representative.frames, representative.sourceFile).at(-1)
      .timestampMs -
    cleanFrames(representative.frames, representative.sourceFile)[0]
      .timestampMs +
    Math.round(1000 / numeric(source.extraction?.sampleFps, 10));
  const motionId = `${datasetId}-main`;
  const title = String(source.title || datasetId).trim();
  const generatedAt = new Date().toISOString();
  const rawKeyframes =
    datasetId === 'cat'
      ? [
          {
            keyframeId: 'cat-paws-ready',
            label: '双手进入猫爪准备位置',
            progress: 0.17,
            windowProgress: 0.045,
            weight: 0.8,
            requiredParts: ['pose'],
          },
          {
            keyframeId: 'cat-paws-open',
            label: '双手猫爪向外展开',
            progress: 0.28,
            windowProgress: 0.045,
            weight: 1,
            requiredParts: ['pose'],
          },
          {
            keyframeId: 'cat-paws-cross',
            label: '双手交替交叉',
            progress: 0.39,
            windowProgress: 0.045,
            weight: 1,
            requiredParts: ['pose'],
          },
          {
            keyframeId: 'cat-paws-up',
            label: '双手上举形成猫耳姿势',
            progress: 0.5,
            windowProgress: 0.045,
            weight: 1.2,
            requiredParts: ['pose'],
          },
          {
            keyframeId: 'cat-fists-shoulder',
            label: '双拳回到肩部两侧',
            progress: 0.61,
            windowProgress: 0.045,
            weight: 1,
            requiredParts: ['pose'],
          },
          {
            keyframeId: 'cat-fists-forward',
            label: '双拳向前完成节拍',
            progress: 0.72,
            windowProgress: 0.045,
            weight: 1.2,
            requiredParts: ['pose'],
          },
          {
            keyframeId: 'cat-hands-face',
            label: '双手靠近面部完成手势',
            progress: 0.83,
            windowProgress: 0.045,
            weight: 1,
            requiredParts: ['pose'],
          },
          {
            keyframeId: 'cat-paws-finish',
            label: '双手猫爪收尾',
            progress: 0.94,
            windowProgress: 0.04,
            weight: 0.8,
            requiredParts: ['pose'],
          },
        ]
      : undefined;
  const keyframes = rawKeyframes
    ? alignKeyframesToTemplates(
        referenceTemplates,
        rawKeyframes,
        'cat-template-04',
      )
    : undefined;

  const dataset = {
    schemaVersion: 'reference-dance-dataset-v1',
    danceId: datasetId,
    title: `${title} 动作教学`,
    referenceVideoUrl: `/training-videos/${encodeURIComponent(datasetId)}/${encodeURIComponent(
      String(representative.sourceFile),
    )}`,
    generatedAt,
    sourceVideoCount: referenceTemplates.length,
    lesson: {
      schemaVersion: 'teaching-lesson-plan-v1',
      danceId: datasetId,
      title: `${title} 动作教学`,
      referenceVideoId: String(representative.videoId),
      previewStartMs: 0,
      previewEndMs: referenceDurationMs,
      policy: {
        maxRetriesPerMotion: 3,
        allowVoiceSkip: true,
        autoAdvanceAfterMaxRetries: false,
      },
      motions: [
        {
          motionId,
          instruction: `跟随示范完成 ${title} 动作`,
          semantic: {
            label: title,
            steps: ['进入准备姿势', '完成主要动作', '保持结束姿势'],
          },
          demoStartMs: 0,
          demoEndMs: referenceDurationMs,
          demoPlaybackRate: 1,
        },
      ],
    },
    templatePacks: [
      {
        schemaVersion: 'motion-template-pack-v1',
        danceId: datasetId,
        motionId,
        motionName: title,
        instruction: `跟随示范完成 ${title} 动作`,
        acceptSpeech: '动作正确，做得很好。',
        hintSpeech: '动作基本正确，请注意手部和身体位置。',
        retrySpeech: '动作差异较大，请跟随示范再试一次。',
        expectedDurationMs,
        requiredParts,
        ...(keyframes ? { keyframes } : {}),
        evaluationPolicy: {
          acceptThreshold: keyframes ? 0.49 : 0.78,
          acceptWithHintThreshold: keyframes ? 0.37 : 0.55,
          minimumCompletionProgress: keyframes ? 0.95 : 0.82,
          minimumObservationMs: 650,
          ...(keyframes ? { keyframeTrajectoryWeight: 0.7 } : {}),
        },
        templates: referenceTemplates,
      },
    ],
    extraction: {
      engine: 'mediapipe-holistic-landmarker',
      sampleFps: numeric(source.extraction?.sampleFps, 10),
      detectedFrameCount: totalFrames,
      motionCount: 1,
      handCoverage: round(handCoverage, 6),
    },
    buildMetadata: {
      schemaVersion: 'reference-dataset-build-metadata-v1',
      sourceDatasetId: source.datasetId,
      sourceSchemaVersion: source.schemaVersion,
      sourceGeneratedAt: source.generatedAt ?? null,
      coordinateSystem:
        source.extraction?.coordinateSystem ?? 'normalized-image-v1',
      poseCoverage: round(totalFrames === 0 ? 0 : poseFrames / totalFrames, 6),
      leftHandCoverage: round(leftCoverage, 6),
      rightHandCoverage: round(rightCoverage, 6),
      requiredHandCoverageThreshold: handCoverageThreshold,
      originalDataPreserved: true,
      excludedReferenceTemplateIds,
      keyframeExperiment:
        datasetId === 'cat'
          ? {
              canonicalTemplateId: 'cat-template-04',
              keyframeCount: keyframes.length,
              requiredParts,
              keyframeTrajectoryWeight: 0.7,
              reason:
                'cat-template-01 contains a scene cut and persistent hand occlusion from a large prop',
            }
          : undefined,
    },
  };

  progress('validating-output', 78, datasetId);
  validateReferenceDataset(dataset, referenceTemplates.length);
  const outputFile = join(outputRoot, datasetId, 'processed', 'dataset.json');
  await mkdir(dirname(outputFile), { recursive: true });
  progress('writing-output', 90, outputFile);
  await writeJsonAtomic(outputFile, dataset, false);
  progress('verifying-output', 96, outputFile);
  const written = JSON.parse(await readFile(outputFile, 'utf8'));
  validateReferenceDataset(written, referenceTemplates.length);
  progress('completed', 100, outputFile);
  console.log(
    `RESULT ${JSON.stringify({
      datasetId,
      outputFile,
      sourceVideoCount: referenceTemplates.length,
      frameCount: totalFrames,
      handCoverage,
      requiredParts,
    })}`,
  );
}

function validateSourceDataset(source, filename, expectedVideos) {
  if (source?.schemaVersion !== 'skeleton-video-dataset-v1') {
    throw new Error(
      `${filename}: schemaVersion must be skeleton-video-dataset-v1`,
    );
  }
  safeId(source.datasetId);
  if (!Array.isArray(source.videos)) {
    throw new Error(`${filename}: videos must be an array`);
  }
  const skippedSourceFiles = Array.isArray(source.skippedSourceFiles)
    ? source.skippedSourceFiles
    : [];
  if (source.videos.length + skippedSourceFiles.length !== expectedVideos) {
    throw new Error(
      `${filename}: expected ${expectedVideos} source slots, found ${source.videos.length} videos and ${skippedSourceFiles.length} skipped`,
    );
  }
  if (
    Number.isInteger(source.sourceVideoCount) &&
    source.sourceVideoCount !== source.videos.length
  ) {
    throw new Error(
      `${filename}: sourceVideoCount=${source.sourceVideoCount} but videos.length=${source.videos.length}`,
    );
  }
  if (source.processing?.status && source.processing.status !== 'complete') {
    throw new Error(
      `${filename}: processing.status=${source.processing.status}, expected complete`,
    );
  }
  const seen = new Set();
  for (const video of source.videos) {
    const identity = String(video.videoId ?? video.sourceFile ?? '');
    if (!identity) throw new Error(`${filename}: video is missing identity`);
    if (seen.has(identity)) {
      throw new Error(`${filename}: duplicate video identity ${identity}`);
    }
    seen.add(identity);
    if (!Array.isArray(video.frames) || video.frames.length < 5) {
      throw new Error(`${filename}: ${identity} has fewer than 5 frames`);
    }
  }
}

function cleanFrames(sourceFrames, sourceFile) {
  const frames = [];
  let previousTimestamp = -1;
  for (let index = 0; index < sourceFrames.length; index += 1) {
    const sourceFrame = sourceFrames[index];
    const timestampMs = numeric(sourceFrame.timestampMs, Number.NaN);
    if (!Number.isFinite(timestampMs) || timestampMs <= previousTimestamp) {
      throw new Error(
        `${sourceFile}: frame ${index} has non-increasing timestamp ${sourceFrame.timestampMs}`,
      );
    }
    const pose = cleanLandmarks(
      sourceFrame.pose,
      33,
      sourceFile,
      index,
      'pose',
    );
    const leftHand = cleanOptionalHand(
      sourceFrame.leftHand,
      sourceFile,
      index,
      'leftHand',
    );
    const rightHand = cleanOptionalHand(
      sourceFrame.rightHand,
      sourceFile,
      index,
      'rightHand',
    );
    const frame = { timestampMs, pose };
    if (leftHand) frame.leftHand = leftHand;
    if (rightHand) frame.rightHand = rightHand;
    frames.push(frame);
    previousTimestamp = timestampMs;
  }
  if (frames.length < 5) {
    throw new Error(`${sourceFile}: fewer than 5 valid frames`);
  }
  return frames;
}

function cleanOptionalHand(value, sourceFile, frameIndex, field) {
  if (value == null || (Array.isArray(value) && value.length === 0)) {
    return undefined;
  }
  return cleanLandmarks(value, 21, sourceFile, frameIndex, field);
}

function cleanLandmarks(value, expectedLength, sourceFile, frameIndex, field) {
  if (!Array.isArray(value) || value.length !== expectedLength) {
    throw new Error(
      `${sourceFile}: frame ${frameIndex} ${field} expected ${expectedLength} landmarks, found ${Array.isArray(value) ? value.length : 'non-array'}`,
    );
  }
  return value.map((landmark, landmarkIndex) => {
    const x = numeric(landmark?.x, Number.NaN);
    const y = numeric(landmark?.y, Number.NaN);
    const z = numeric(landmark?.z, 0);
    if (![x, y, z].every(Number.isFinite)) {
      throw new Error(
        `${sourceFile}: frame ${frameIndex} ${field}[${landmarkIndex}] contains non-finite coordinates`,
      );
    }
    const cleaned = { x, y, z };
    if (Number.isFinite(Number(landmark?.visibility))) {
      cleaned.visibility = Number(landmark.visibility);
    }
    return cleaned;
  });
}

function validateReferenceDataset(dataset, expectedVideos) {
  if (dataset?.schemaVersion !== 'reference-dance-dataset-v1') {
    throw new Error('output schemaVersion must be reference-dance-dataset-v1');
  }
  safeId(dataset.danceId);
  if (!dataset.title?.trim() || !dataset.referenceVideoUrl?.trim()) {
    throw new Error('output title and referenceVideoUrl are required');
  }
  if (dataset.sourceVideoCount !== expectedVideos) {
    throw new Error(
      `output sourceVideoCount expected ${expectedVideos}, found ${dataset.sourceVideoCount}`,
    );
  }
  if (dataset.lesson?.danceId !== dataset.danceId) {
    throw new Error('output lesson.danceId must match danceId');
  }
  if (
    !Array.isArray(dataset.templatePacks) ||
    dataset.templatePacks.length !== 1
  ) {
    throw new Error('output must contain exactly one motion template pack');
  }
  const pack = dataset.templatePacks[0];
  if (pack.danceId !== dataset.danceId) {
    throw new Error('output template pack danceId must match dataset danceId');
  }
  if (
    !dataset.lesson.motions.some((motion) => motion.motionId === pack.motionId)
  ) {
    throw new Error('output lesson is missing template pack motionId');
  }
  if (pack.templates.length !== expectedVideos) {
    throw new Error(
      `output expected ${expectedVideos} templates, found ${pack.templates.length}`,
    );
  }
  for (const template of pack.templates) {
    if (!Array.isArray(template.frames) || template.frames.length < 5) {
      throw new Error(`${template.templateId} has fewer than 5 frames`);
    }
    let previous = -1;
    for (const frame of template.frames) {
      if (frame.timestampMs <= previous) {
        throw new Error(`${template.templateId} timestamps do not increase`);
      }
      if (frame.pose.length !== 33) {
        throw new Error(`${template.templateId} contains invalid pose`);
      }
      if (![0, 21].includes(frame.leftHand?.length ?? 0)) {
        throw new Error(`${template.templateId} contains invalid left hand`);
      }
      if (![0, 21].includes(frame.rightHand?.length ?? 0)) {
        throw new Error(`${template.templateId} contains invalid right hand`);
      }
      previous = frame.timestampMs;
    }
  }
}

async function discoverInputFiles(inputRoot, groups) {
  const entries = await readdir(inputRoot, { withFileTypes: true });
  const candidates = entries
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'),
    )
    .map((entry) => join(inputRoot, entry.name))
    .sort();
  const files = [];
  for (const file of candidates) {
    try {
      const datasetId = await readDatasetId(file);
      if (groups.size === 0 || groups.has(datasetId)) files.push(file);
    } catch {
      // Non-skeleton JSON files are deliberately ignored during discovery.
    }
  }
  return files;
}

async function readDatasetId(file) {
  const parsed = JSON.parse(await readFile(file, 'utf8'));
  if (parsed?.schemaVersion !== 'skeleton-video-dataset-v1') {
    throw new Error(`${file} is not a skeleton video dataset`);
  }
  return safeId(parsed.datasetId);
}

async function validExistingOutput(file, expectedDanceId) {
  try {
    const dataset = JSON.parse(await readFile(file, 'utf8'));
    return (
      dataset.schemaVersion === 'reference-dance-dataset-v1' &&
      dataset.danceId === expectedDanceId &&
      Array.isArray(dataset.templatePacks) &&
      dataset.templatePacks.length > 0
    );
  } catch {
    return false;
  }
}

async function acquireLock() {
  try {
    const handle = await open(lockFile, 'wx');
    await handle.writeFile(
      JSON.stringify({
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
        scriptFile,
      }),
    );
    await handle.close();
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const state = await readJson(stateFile, null);
    if (state?.status === 'running' && processExists(state.pid)) {
      throw new Error(
        `Reference build is already running with PID ${state.pid}`,
      );
    }
    await rm(lockFile, { force: true });
    return await acquireLock();
  }
  return async () => {
    await rm(lockFile, { force: true });
  };
}

async function updateState(state) {
  state.updatedAt = new Date().toISOString();
  await writeJsonAtomic(stateFile, state);
}

async function stopRequested() {
  return existsSync(stopFile);
}

async function fileFingerprint(file) {
  const details = await stat(file);
  return `${details.size}:${details.mtimeMs}`;
}

function alignKeyframesToTemplates(templates, keyframes, canonicalTemplateId) {
  const canonical = templates.find(
    (template) => template.templateId === canonicalTemplateId,
  );
  if (!canonical) {
    throw new Error(
      `Canonical keyframe template ${canonicalTemplateId} was not found`,
    );
  }
  const alignments = new Map(
    templates.map((template) => [
      template.templateId,
      template.templateId === canonicalTemplateId
        ? undefined
        : keyframeDtwAlignment(canonical.frames, template.frames),
    ]),
  );
  return keyframes.map((keyframe) => {
    const canonicalIndex = Math.round(
      keyframe.progress * (canonical.frames.length - 1),
    );
    const templateProgress = Object.fromEntries(
      templates.map((template) => {
        const alignment = alignments.get(template.templateId);
        if (!alignment) {
          return [template.templateId, keyframe.progress];
        }
        const mapped = alignment
          .map(([canonicalFrame, templateFrame]) => ({
            distance: Math.abs(canonicalFrame - canonicalIndex),
            templateFrame,
          }))
          .sort(
            (left, right) =>
              left.distance - right.distance ||
              left.templateFrame - right.templateFrame,
          );
        const closestDistance = mapped[0]?.distance ?? 0;
        const closest = mapped.filter(
          (item) => item.distance === closestDistance,
        );
        const mappedFrame = Math.round(
          closest.reduce((sum, item) => sum + item.templateFrame, 0) /
            closest.length,
        );
        return [
          template.templateId,
          round(mappedFrame / Math.max(1, template.frames.length - 1), 6),
        ];
      }),
    );
    return {
      ...keyframe,
      templateProgress,
    };
  });
}

function keyframeDtwAlignment(canonicalFrames, templateFrames) {
  const canonical = canonicalFrames.map(keyframeNormalizedPoseVector);
  const template = templateFrames.map(keyframeNormalizedPoseVector);
  const costs = Array.from({ length: canonical.length + 1 }, () =>
    Array(template.length + 1).fill(Number.POSITIVE_INFINITY),
  );
  const previous = Array.from({ length: canonical.length + 1 }, () =>
    Array(template.length + 1).fill(2),
  );
  costs[0][0] = 0;
  for (let row = 1; row <= canonical.length; row += 1) {
    for (let column = 1; column <= template.length; column += 1) {
      const choices = [
        costs[row - 1][column],
        costs[row][column - 1],
        costs[row - 1][column - 1],
      ];
      const direction = choices.indexOf(Math.min(...choices));
      costs[row][column] =
        choices[direction] +
        keyframeVectorDistance(canonical[row - 1], template[column - 1]);
      previous[row][column] = direction;
    }
  }
  const path = [];
  let row = canonical.length;
  let column = template.length;
  while (row > 0 && column > 0) {
    path.push([row - 1, column - 1]);
    const direction = previous[row][column];
    if (direction === 0) {
      row -= 1;
    } else if (direction === 1) {
      column -= 1;
    } else {
      row -= 1;
      column -= 1;
    }
  }
  return path.reverse();
}

function keyframeNormalizedPoseVector(frame) {
  const indices = [11, 12, 13, 14, 15, 16, 23, 24];
  const leftShoulder = frame.pose[11];
  const rightShoulder = frame.pose[12];
  const centerX = (leftShoulder.x + rightShoulder.x) / 2;
  const centerY = (leftShoulder.y + rightShoulder.y) / 2;
  const centerZ = ((leftShoulder.z ?? 0) + (rightShoulder.z ?? 0)) / 2;
  const scale = Math.max(
    0.01,
    Math.hypot(
      leftShoulder.x - rightShoulder.x,
      leftShoulder.y - rightShoulder.y,
      (leftShoulder.z ?? 0) - (rightShoulder.z ?? 0),
    ),
  );
  return indices.flatMap((index) => {
    const point = frame.pose[index];
    return [
      (point.x - centerX) / scale,
      (point.y - centerY) / scale,
      ((point.z ?? 0) - centerZ) / scale,
    ];
  });
}

function keyframeVectorDistance(left, right) {
  return Math.sqrt(
    left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0) /
      left.length,
  );
}

async function writeJsonAtomic(file, value, pretty = true) {
  await mkdir(dirname(file), { recursive: true });
  const temporaryFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(
    temporaryFile,
    `${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`,
    'utf8',
  );
  try {
    await rename(temporaryFile, file);
  } catch (error) {
    await rm(temporaryFile, { force: true });
    throw error;
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    return fallback;
  }
}

function progress(stage, progressValue, detail) {
  console.log(
    `PROGRESS ${JSON.stringify({
      stage,
      progress: progressValue,
      detail,
      at: new Date().toISOString(),
    })}`,
  );
}

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function parseArgs(argv) {
  const parsed = {
    worker: false,
    help: false,
    background: false,
    calibrate: false,
    applyCalibration: false,
    status: false,
    stop: false,
    run: false,
    force: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) continue;
    const key = argument
      .slice(2)
      .replace(/-([a-z])/g, (_, character) => character.toUpperCase());
    if (
      [
        'worker',
        'help',
        'background',
        'calibrate',
        'applyCalibration',
        'status',
        'stop',
        'run',
        'force',
      ].includes(key)
    ) {
      parsed[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}`);
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function printHelp() {
  console.log(`Build reference-dance-dataset-v1 files from skeleton datasets.

Usage:
  node scripts/build-reference-datasets-unattended.mjs [options]

Modes:
  --background                  Start a detached build and write progress logs.
  --status                      Show progress and the latest log lines.
  --stop                        Request a safe stop; no process is force-killed.

Build options:
  --input <directory>           Input root (default: bknd/data).
  --output <directory>          Output root (default: data/dances).
  --groups <a,b,c>              Build only selected dataset IDs.
  --expected-videos <number>    Required videos per dataset (default: 10).
  --hand-coverage-threshold <n> Require a hand when coverage reaches n (default: 0.45).
  --timeout-ms <number>         Maximum worker runtime (default: 120000).
  --idle-timeout-ms <number>    Maximum silence from a worker (default: 30000).
  --retries <number>            Retries after a worker failure (default: 2).
  --force                       Ignore valid checkpoints and rebuild outputs.
  --calibrate                   Run cross-action calibration after conversion.
  --apply-calibration           Apply thresholds only when safety targets pass.
  --calibration-timeout-ms <n>  Maximum calibration runtime (default: 300000).
  --help                        Show this help.

Safety:
  Each dataset runs in an isolated child process. Outputs use temporary files
  followed by atomic rename. Completed inputs are checkpointed and a failed
  dataset does not prevent the remaining datasets from being attempted.`);
}

function safeId(value) {
  const id = String(value ?? '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) {
    throw new Error(`Unsupported dataset id: ${id || '<empty>'}`);
  }
  return id;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

function numeric(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function singleLine(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

function required(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function processExists(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 4) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}
