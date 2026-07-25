"use client";

import type {
  DatasetBuildProgress,
  MotionTemplateFrame,
  MotionTemplatePack,
  ReferenceDanceDataset,
} from "./reference-dataset.types";
import type { VisionLandmark } from "./vision-types";

interface PreparedFrame {
  timestampMs: number;
  pose: VisionLandmark[];
  leftHand?: VisionLandmark[];
  rightHand?: VisionLandmark[];
}

interface PreparedVideo {
  videoId: string;
  sequence: number;
  durationMs: number;
  frames: PreparedFrame[];
}

interface PreparedDataset {
  schemaVersion: "skeleton-video-dataset-v1";
  datasetId: string;
  title: string;
  extraction?: { sampleFps?: number };
  videos: PreparedVideo[];
}

const DANCE_DATASET_IDS: Record<string, string> = {
  "dance-001": "cat",
  "dance-002": "cloud",
  "dance-003": "fade",
  "dance-004": "fight",
  "dance-005": "indo",
  "dance-006": "no",
};

const MOTION_LANDMARKS = [11, 12, 13, 14, 15, 16, 23, 24] as const;

/**
 * Converts the already extracted 10-video class dataset into live matcher
 * packs. Manual corrections saved by the editor apply on the next lesson run.
 */
export async function buildPreparedReferenceDataset(
  danceId: string,
  onProgress?: (progress: DatasetBuildProgress) => void,
): Promise<ReferenceDanceDataset> {
  const datasetId = DANCE_DATASET_IDS[danceId];
  if (!datasetId) throw new Error(`舞蹈 ${danceId} 没有对应的骨架类别。`);

  onProgress?.({
    stage: "building-templates",
    completedVideos: 0,
    totalVideos: 10,
    message: `正在读取 ${datasetId} 类别的 10 个骨架素材…`,
  });
  const response = await fetch(
    `/api/skeleton-editor/datasets/${encodeURIComponent(datasetId)}`,
    { cache: "no-store" },
  );
  const raw = (await response.json()) as PreparedDataset & { error?: string };
  if (!response.ok) {
    throw new Error(raw.error ?? `读取 ${datasetId} 骨架数据失败。`);
  }
  if (
    raw.schemaVersion !== "skeleton-video-dataset-v1" ||
    raw.videos.length !== 10
  ) {
    throw new Error(`${datasetId} 必须包含且只包含本类别的 10 个素材。`);
  }

  const dataset = assemblePreparedDataset(danceId, raw);
  onProgress?.({
    stage: "completed",
    completedVideos: 10,
    totalVideos: 10,
    message: "主示例和同类泛化模板已就绪。",
  });
  return dataset;
}

function assemblePreparedDataset(
  danceId: string,
  raw: PreparedDataset,
): ReferenceDanceDataset {
  const primary =
    raw.videos.find((video) => video.sequence === 1) ?? raw.videos[0];
  if (!primary?.frames.length) {
    throw new Error(`${raw.datasetId} 的主示例没有骨架帧。`);
  }
  const boundaries = deriveMotionBoundaries(primary);
  const templatePacks: MotionTemplatePack[] = boundaries
    .slice(0, -1)
    .map((startMs, index) => {
      const endMs = boundaries[index + 1];
      const templates = raw.videos
        .map((video) =>
          createTemplate(
            video,
            startMs,
            endMs,
            primary.durationMs,
            video.videoId === primary.videoId,
          ),
        )
        .filter((template) => template.frames.length >= 5);
      const handsPositionOnly = raw.datasetId === "fade";
      const requiredParts: MotionTemplatePack["requiredParts"] =
        handsPositionOnly ? ["left_hand", "right_hand"] : ["pose"];
      if (!handsPositionOnly && handCoverage(templates, "leftHand") >= 0.5) {
        requiredParts.push("left_hand");
      }
      if (!handsPositionOnly && handCoverage(templates, "rightHand") >= 0.5) {
        requiredParts.push("right_hand");
      }

      return {
        schemaVersion: "motion-template-pack-v1" as const,
        danceId,
        motionId: `motion-${String(index + 1).padStart(2, "0")}`,
        motionName: `动作 ${index + 1}`,
        instruction: `跟随示例完成第 ${index + 1} 段动作，重点保持动作先后顺序和节奏。`,
        acceptSpeech: "很好，动作和节奏都对上了。",
        hintSpeech: "动作顺序正确，再让节奏贴近示例一点。",
        retrySpeech: "动作和时间点还没有对齐，跟着示例节奏再做一次。",
        expectedDurationMs: Math.max(500, endMs - startMs),
        requiredParts,
        evaluationPolicy: {
          acceptThreshold: 0.55,
          acceptWithHintThreshold: 0.44,
          minimumCompletionProgress: 0.72,
          minimumObservationMs: 650,
          primaryTemplateWeight: 0.7,
          generalizationTemplateCount: 3,
          scoringProfile: handsPositionOnly
            ? "hands-position-temporal"
            : "balanced",
        },
        templates,
      };
    });

  const totalFrames = raw.videos.reduce(
    (sum, video) => sum + video.frames.length,
    0,
  );
  const visibleHands = raw.videos.reduce(
    (sum, video) =>
      sum +
      video.frames.reduce(
        (frameSum, frame) =>
          frameSum +
          Number((frame.leftHand?.length ?? 0) >= 21) +
          Number((frame.rightHand?.length ?? 0) >= 21),
        0,
      ),
    0,
  );

  return {
    schemaVersion: "reference-dance-dataset-v1",
    danceId,
    title: raw.title || raw.datasetId,
    referenceVideoUrl: `/dances/${danceId}/reference.mp4`,
    generatedAt: new Date().toISOString(),
    sourceVideoCount: raw.videos.length,
    lesson: {
      schemaVersion: "teaching-lesson-plan-v1",
      danceId,
      title: raw.title || raw.datasetId,
      referenceVideoId: primary.videoId,
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
        demoPlaybackRate: 0.75,
      })),
    },
    templatePacks,
    extraction: {
      engine: "mediapipe-holistic-landmarker",
      sampleFps: raw.extraction?.sampleFps ?? 10,
      detectedFrameCount: totalFrames,
      motionCount: templatePacks.length,
      handCoverage:
        totalFrames === 0
          ? 0
          : Number((visibleHands / (totalFrames * 2)).toFixed(3)),
    },
  };
}

function createTemplate(
  video: PreparedVideo,
  primaryStartMs: number,
  primaryEndMs: number,
  primaryDurationMs: number,
  isPrimary: boolean,
) {
  const startMs = (primaryStartMs / primaryDurationMs) * video.durationMs;
  const endMs = (primaryEndMs / primaryDurationMs) * video.durationMs;
  const candidates = video.frames.filter(
    (frame) => frame.timestampMs >= startMs && frame.timestampMs <= endMs,
  );
  const selected = resample(candidates, 24);
  const firstTimestamp = selected[0]?.timestampMs ?? startMs;
  const frames: MotionTemplateFrame[] = selected.map((frame) => ({
    timestampMs: Math.max(0, Math.round(frame.timestampMs - firstTimestamp)),
    pose: frame.pose,
    ...((frame.leftHand?.length ?? 0) >= 21
      ? { leftHand: frame.leftHand }
      : {}),
    ...((frame.rightHand?.length ?? 0) >= 21
      ? { rightHand: frame.rightHand }
      : {}),
  }));
  return {
    templateId: `${video.videoId}-${Math.round(primaryStartMs)}-${Math.round(primaryEndMs)}`,
    sourceVideoId: video.videoId,
    mirrored: false,
    referenceRole: isPrimary
      ? ("primary" as const)
      : ("generalization" as const),
    frames,
  };
}

function deriveMotionBoundaries(video: PreparedVideo): number[] {
  const minimumCount = Math.max(1, Math.ceil(video.durationMs / 4200));
  const maximumCount = Math.max(
    minimumCount,
    Math.floor(video.durationMs / 1800),
  );
  const motionCount = Math.max(
    minimumCount,
    Math.min(maximumCount, Math.round(video.durationMs / 2800)),
  );
  const boundaries = [0];
  for (let index = 1; index < motionCount; index += 1) {
    const targetMs = (video.durationMs * index) / motionCount;
    const candidates = video.frames
      .map((frame, frameIndex) => ({
        timestampMs: frame.timestampMs,
        energy: motionEnergy(video.frames, frameIndex),
      }))
      .filter(
        (candidate) =>
          candidate.timestampMs >= targetMs - 500 &&
          candidate.timestampMs <= targetMs + 500,
      )
      .sort((left, right) => left.energy - right.energy);
    boundaries.push(Math.round(candidates[0]?.timestampMs ?? targetMs));
  }
  boundaries.push(video.durationMs);
  return boundaries;
}

function motionEnergy(frames: PreparedFrame[], index: number) {
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
  return (
    MOTION_LANDMARKS.reduce((sum, landmarkIndex) => {
      const a = current[landmarkIndex];
      const b = previous[landmarkIndex];
      return sum + (a && b ? Math.hypot(a.x - b.x, a.y - b.y) / scale : 1);
    }, 0) / MOTION_LANDMARKS.length
  );
}

function handCoverage(
  templates: Array<{ frames: MotionTemplateFrame[] }>,
  hand: "leftHand" | "rightHand",
) {
  const frames = templates.flatMap((template) => template.frames);
  return frames.length === 0
    ? 0
    : frames.filter((frame) => (frame[hand]?.length ?? 0) >= 21).length /
        frames.length;
}

function resample<T>(items: T[], maximum: number): T[] {
  if (items.length <= maximum) return items;
  return Array.from(
    { length: maximum },
    (_, index) =>
      items[Math.round((index / (maximum - 1)) * (items.length - 1))],
  );
}
