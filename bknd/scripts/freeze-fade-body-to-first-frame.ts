import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

interface Landmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

interface Frame {
  timestampMs: number;
  pose: Landmark[];
  leftHand?: Landmark[];
  rightHand?: Landmark[];
}

interface FadeDataset {
  schemaVersion: string;
  datasetId: string;
  generatedAt?: string;
  processing?: Record<string, unknown>;
  videos: Array<{
    videoId: string;
    sequence: number;
    frames: Frame[];
  }>;
}

const dataRoot = resolve(process.cwd(), 'data');
const targetFile = join(dataRoot, 'fade.json');
const backupRoot = join(dataRoot, '.backups');

function hashHands(dataset: FadeDataset) {
  const payload = dataset.videos.map((video) =>
    video.frames.map((frame) => ({
      leftHand: frame.leftHand,
      rightHand: frame.rightHand,
    })),
  );
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function main() {
  if (dirname(targetFile) !== dataRoot) {
    throw new Error(`Refusing to write outside data root: ${targetFile}`);
  }

  const raw = await readFile(targetFile, 'utf8');
  const dataset = JSON.parse(raw) as FadeDataset;
  if (
    dataset.schemaVersion !== 'skeleton-video-dataset-v1' ||
    dataset.datasetId !== 'fade' ||
    !Array.isArray(dataset.videos) ||
    dataset.videos.length !== 10
  ) {
    throw new Error('fade.json schema or 10-video class boundary is invalid.');
  }

  const handsBefore = hashHands(dataset);
  let changedFrames = 0;
  for (const video of dataset.videos) {
    const firstPose = video.frames[0]?.pose;
    if (!firstPose || firstPose.length !== 33) {
      throw new Error(`${video.videoId} has no complete first-frame pose.`);
    }
    for (const frame of video.frames) {
      frame.pose = firstPose.map((point) => ({ ...point }));
      changedFrames += 1;
    }
  }
  const handsAfter = hashHands(dataset);
  if (handsBefore !== handsAfter) {
    throw new Error('Hand landmarks changed unexpectedly; refusing to save.');
  }

  const modifiedAt = new Date().toISOString();
  dataset.generatedAt = modifiedAt;
  dataset.processing = {
    ...dataset.processing,
    bodyNormalization: {
      mode: 'per-video-first-frame-pose',
      appliedAt: modifiedAt,
      affectedVideoCount: dataset.videos.length,
      affectedFrameCount: changedFrames,
      handLandmarksPreserved: true,
      scoringProfile: 'hands-position-temporal',
    },
  };

  await mkdir(backupRoot, { recursive: true });
  const timestamp = modifiedAt.replace(/[:.]/g, '-');
  const backupFile = join(
    backupRoot,
    `fade-before-body-freeze-${timestamp}.json`,
  );
  await copyFile(targetFile, backupFile);
  await writeFile(targetFile, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');

  console.log(
    JSON.stringify(
      {
        targetFile,
        backupFile,
        videoCount: dataset.videos.length,
        changedFrames,
        handHash: handsAfter,
      },
      null,
      2,
    ),
  );
}

void main();
