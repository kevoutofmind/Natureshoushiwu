export interface SkeletonLandmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

export interface SkeletonFrame {
  timestampMs: number;
  /**
   * MediaPipe Pose compatible landmark order. The matcher currently uses
   * shoulders, elbows, wrists and hips.
   */
  pose: SkeletonLandmark[];
  /** MediaPipe Hand compatible 21-landmark order. */
  leftHand?: SkeletonLandmark[];
  /** MediaPipe Hand compatible 21-landmark order. */
  rightHand?: SkeletonLandmark[];
}

export type RequiredSkeletonPart = 'pose' | 'left_hand' | 'right_hand';

export interface MotionReferenceTemplate {
  templateId: string;
  sourceVideoId: string;
  mirrored: boolean;
  frames: SkeletonFrame[];
}

export interface RealtimeEvaluationPolicy {
  /** Score at or above this value passes without a correction. */
  acceptThreshold?: number;
  /** Score at or above this value passes with a gentle hint. */
  acceptWithHintThreshold?: number;
  /** Do not make a final decision before this unit progress. */
  minimumCompletionProgress?: number;
  /** Minimum observed skeleton duration used for a stable decision. */
  minimumObservationMs?: number;
}

/**
 * Generated offline for one semantic motion unit. A dance can contain any
 * number of units and each unit can contain multiple correct performers.
 */
export interface MotionTemplatePack {
  schemaVersion: 'motion-template-pack-v1';
  danceId: string;
  motionId: string;
  motionName?: string;
  instruction: string;
  acceptSpeech?: string;
  hintSpeech?: string;
  retrySpeech?: string;
  expectedDurationMs: number;
  requiredParts?: RequiredSkeletonPart[];
  evaluationPolicy?: RealtimeEvaluationPolicy;
  templates: MotionReferenceTemplate[];
}

export interface PracticeSkeletonObservation {
  mirrored: boolean;
  /** Current progress of the semantic motion unit, from 0 to 1. */
  progress: number;
  frames: SkeletonFrame[];
}

export interface RealtimeJudgeInput {
  schemaVersion: 'realtime-judge-v1';
  sessionId: string;
  sampleId: string;
  danceId: string;
  motionId: string;
  attemptIndex?: number;
  observation: PracticeSkeletonObservation;
}

export type RealtimeDecisionCode =
  'ACCEPT' | 'ACCEPT_HINT' | 'RETRY' | 'KEEP_WATCHING' | 'NOT_VISIBLE';

export type RealtimeDecisionReason =
  | 'MATCHED'
  | 'CLOSE_ENOUGH'
  | 'BELOW_THRESHOLD'
  | 'LOW_VISIBILITY'
  | 'INSUFFICIENT_OBSERVATION';

export interface RealtimeScoreBreakdown {
  overall: number;
  pose?: number;
  leftHand?: number;
  rightHand?: number;
  trajectory?: number;
  visibility: number;
}

export interface RealtimeJudgeResult {
  schemaVersion: 'realtime-decision-v1';
  sessionId: string;
  sampleId: string;
  danceId: string;
  motionId: string;
  decision: RealtimeDecisionCode;
  reason: RealtimeDecisionReason;
  speech: string;
  shouldAdvance: boolean;
  shouldPause: boolean;
  confidence: number;
  bestTemplateId?: string;
  weakestPart?: RequiredSkeletonPart | 'trajectory';
  scores: RealtimeScoreBreakdown;
  metadata: {
    engine: 'local-skeleton-template';
    engineVersion: string;
    referenceCount: number;
    latencyMs: number;
    cloudCalled: false;
  };
}

export interface TemplateRegistrationResult {
  schemaVersion: 'template-registration-v1';
  danceId: string;
  motionId: string;
  referenceCount: number;
  replaced: boolean;
}
