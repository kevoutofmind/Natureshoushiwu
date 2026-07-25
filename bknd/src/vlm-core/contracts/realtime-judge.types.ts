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

/**
 * A semantic pose anchor inside one motion unit. The matcher compares a short
 * trajectory window around this progress point instead of relying only on
 * uniformly sampled frames from the whole clip.
 */
export interface MotionKeyframeDefinition {
  keyframeId: string;
  label: string;
  /** Relative position in the motion unit, from 0 to 1. */
  progress: number;
  /** Radius of the local trajectory window, expressed as unit progress. */
  windowProgress?: number;
  /** Relative contribution when several keyframes are combined. */
  weight?: number;
  /** Parts that must agree around this specific semantic pose. */
  requiredParts?: RequiredSkeletonPart[];
  /**
   * Template-specific aligned positions. Offline annotation can transfer the
   * semantic anchor to clips with different lead-in or ending durations.
   */
  templateProgress?: Record<string, number>;
}

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
  /** Additional weight assigned to annotated keyframe trajectories. */
  keyframeTrajectoryWeight?: number;
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
  keyframes?: MotionKeyframeDefinition[];
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
  | 'ACTION_NOT_OBSERVED'
  | 'CONFIRMATION_RETRY'
  | 'LOW_VISIBILITY'
  | 'INSUFFICIENT_OBSERVATION';

export interface RealtimeScoreBreakdown {
  overall: number;
  pose?: number;
  leftHand?: number;
  rightHand?: number;
  trajectory?: number;
  keyframeTrajectory?: number;
  actionCoverage?: number;
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
  weakestPart?: RequiredSkeletonPart | 'trajectory' | 'keyframe_trajectory';
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
