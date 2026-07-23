import type {
  PracticeSkeletonObservation,
  RealtimeJudgeResult,
} from './realtime-judge.types';

export type TeachingAgentPhase =
  | 'PREVIEW'
  | 'MOTION_DEMO'
  | 'PRACTICE'
  | 'FULL_CHALLENGE'
  | 'PAUSED'
  | 'COMPLETED';

export interface TeachingMotionPlan {
  motionId: string;
  instruction: string;
  demoStartMs: number;
  demoEndMs: number;
  demoPlaybackRate?: number;
}

export interface TeachingLessonPolicy {
  maxRetriesPerMotion?: number;
  allowVoiceSkip?: boolean;
  autoAdvanceAfterMaxRetries?: boolean;
}

/**
 * Produced offline from the five preset dances. It intentionally stores
 * semantic unit data rather than model-generated free-form plans at runtime.
 */
export interface TeachingLessonPlan {
  schemaVersion: 'teaching-lesson-plan-v1';
  danceId: string;
  title: string;
  referenceVideoId: string;
  previewStartMs: number;
  previewEndMs: number;
  policy?: TeachingLessonPolicy;
  motions: TeachingMotionPlan[];
}

export interface TeachingAgentStartInput {
  schemaVersion: 'teaching-agent-start-v1';
  sessionId: string;
  danceId: string;
}

export type TeachingVoiceCommand =
  | 'PAUSE'
  | 'RESUME'
  | 'READY'
  | 'PREVIOUS_ACTION'
  | 'REPEAT_ACTION'
  | 'NEXT_ACTION'
  | 'RESTART_LESSON';

interface TeachingAgentEventBase {
  schemaVersion: 'teaching-agent-event-v1';
  sessionId: string;
  eventId: string;
  expectedVersion?: number;
}

export type TeachingAgentEvent =
  | (TeachingAgentEventBase & { type: 'PREVIEW_FINISHED' })
  | (TeachingAgentEventBase & { type: 'MOTION_DEMO_FINISHED' })
  | (TeachingAgentEventBase & {
      type: 'REALTIME_OBSERVATION';
      sampleId: string;
      observation: PracticeSkeletonObservation;
    })
  | (TeachingAgentEventBase & {
      type: 'VOICE_COMMAND';
      command: TeachingVoiceCommand;
    })
  | (TeachingAgentEventBase & { type: 'FULL_CHALLENGE_FINISHED' })
  | (TeachingAgentEventBase & {
      type: 'CLOUD_COACHING_READY';
      motionId: string;
      speech: string;
    });

export type TeachingAgentToolName =
  | 'PLAY_FULL_PREVIEW'
  | 'PLAY_MOTION_DEMO'
  | 'PAUSE_PLAYBACK'
  | 'RESUME_PLAYBACK'
  | 'START_REALTIME_EVALUATION'
  | 'STOP_REALTIME_EVALUATION'
  | 'START_FULL_CHALLENGE'
  | 'SPEAK'
  | 'SHOW_HINT'
  | 'REQUEST_CLOUD_COACHING'
  | 'REQUEST_CLOUD_SUMMARY'
  | 'SESSION_COMPLETED';

export interface TeachingAgentCommand {
  commandId: string;
  tool: TeachingAgentToolName;
  arguments: Record<string, unknown>;
  /**
   * Commands are effects for the H5 layer. `requiresAck` means the H5 should
   * later send the corresponding FINISHED event.
   */
  requiresAck: boolean;
  blocking: boolean;
}

export interface TeachingMotionProgress {
  motionId: string;
  outcome: 'PASSED' | 'PASSED_WITH_HINT' | 'ASSISTED' | 'SKIPPED';
  attempts: number;
  finalScore?: number;
}

export interface TeachingAgentSession {
  schemaVersion: 'teaching-agent-session-v1';
  sessionId: string;
  danceId: string;
  phase: TeachingAgentPhase;
  resumePhase?: Exclude<TeachingAgentPhase, 'PAUSED' | 'COMPLETED'>;
  currentMotionIndex: number;
  currentMotionId: string;
  attemptIndex: number;
  retryCount: number;
  version: number;
  completedMotions: TeachingMotionProgress[];
  latestJudgeResult?: RealtimeJudgeResult;
  pendingCloudCoachingForMotionId?: string;
  startedAt: string;
  updatedAt: string;
}

export interface TeachingAgentTrace {
  runId: string;
  eventId: string;
  fromPhase?: TeachingAgentPhase;
  toPhase: TeachingAgentPhase;
  selectedTools: TeachingAgentToolName[];
  policy: 'deterministic-teaching-workflow-v1';
  cloudBlocking: false;
  latencyMs: number;
}

export interface TeachingAgentTurnResult {
  schemaVersion: 'teaching-agent-turn-v1';
  session: TeachingAgentSession;
  commands: TeachingAgentCommand[];
  trace: TeachingAgentTrace;
  idempotentReplay: boolean;
}

export interface TeachingLessonRegistrationResult {
  schemaVersion: 'teaching-lesson-registration-v1';
  danceId: string;
  motionCount: number;
  replaced: boolean;
}
