import type { MotionTemplatePack } from './realtime-judge.types';
import type { TeachingLessonPlan } from './teaching-agent.types';

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

export interface ReferenceDatasetRegistrationResult {
  schemaVersion: 'reference-dance-dataset-registration-v1';
  danceId: string;
  motionCount: number;
  referenceCount: number;
  persisted: boolean;
}

export interface ReferenceDatasetSummary {
  danceId: string;
  title: string;
  motionCount: number;
  sourceVideoCount: number;
  generatedAt: string;
}
