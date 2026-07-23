import type { SkeletonSnapshot, VisionLandmark } from './vision-types';

export interface ReferenceVideoManifest {
  schemaVersion: 'reference-video-manifest-v1';
  danceId: string;
  title: string;
  primaryReferenceId: string;
  references: Array<{
    referenceId: string;
    videoUrl: string;
    mirrored: boolean;
  }>;
  extraction: {
    sampleFps: number;
    targetMotionDurationMs: number;
    minimumMotionDurationMs: number;
    maximumMotionDurationMs: number;
  };
}

export interface MotionTemplateFrame {
  timestampMs: number;
  pose: VisionLandmark[];
  leftHand?: VisionLandmark[];
  rightHand?: VisionLandmark[];
}

export interface MotionTemplatePack {
  schemaVersion: 'motion-template-pack-v1';
  danceId: string;
  motionId: string;
  motionName: string;
  instruction: string;
  acceptSpeech: string;
  hintSpeech: string;
  retrySpeech: string;
  expectedDurationMs: number;
  requiredParts: Array<'pose' | 'left_hand' | 'right_hand'>;
  evaluationPolicy: {
    acceptThreshold: number;
    acceptWithHintThreshold: number;
    minimumCompletionProgress: number;
    minimumObservationMs: number;
  };
  templates: Array<{
    templateId: string;
    sourceVideoId: string;
    mirrored: boolean;
    frames: MotionTemplateFrame[];
  }>;
}

export interface TeachingLessonPlan {
  schemaVersion: 'teaching-lesson-plan-v1';
  danceId: string;
  title: string;
  referenceVideoId: string;
  previewStartMs: number;
  previewEndMs: number;
  policy: {
    maxRetriesPerMotion: number;
    allowVoiceSkip: boolean;
    autoAdvanceAfterMaxRetries: boolean;
  };
  motions: Array<{
    motionId: string;
    instruction: string;
    demoStartMs: number;
    demoEndMs: number;
    demoPlaybackRate: number;
  }>;
}

export interface ReferenceDanceDataset {
  schemaVersion: 'reference-dance-dataset-v1';
  danceId: string;
  title: string;
  referenceVideoUrl: string;
  generatedAt: string;
  sourceVideoCount: number;
  lesson: TeachingLessonPlan;
  templatePacks: MotionTemplatePack[];
  extraction: {
    engine: 'mediapipe-holistic-landmarker';
    sampleFps: number;
    detectedFrameCount: number;
    motionCount: number;
    handCoverage: number;
  };
}

export interface ExtractedReference {
  referenceId: string;
  videoUrl: string;
  mirrored: boolean;
  durationMs: number;
  frames: SkeletonSnapshot[];
}

export interface DatasetBuildProgress {
  stage: 'loading-model' | 'extracting' | 'building-templates' | 'completed';
  completedVideos: number;
  totalVideos: number;
  message: string;
}
