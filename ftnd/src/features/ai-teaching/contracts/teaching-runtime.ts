import type { SkeletonSnapshot } from '@/features/video-stage/vision-types';

export type TeachingVoiceCommand =
  | 'PAUSE'
  | 'RESUME'
  | 'READY'
  | 'PREVIOUS_ACTION'
  | 'REPEAT_ACTION'
  | 'NEXT_ACTION'
  | 'RESTART_LESSON';

export type TeachingAgentTool =
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
  tool: TeachingAgentTool;
  arguments: Record<string, unknown>;
  requiresAck: boolean;
  blocking: boolean;
}

export interface RealtimeJudgeFeedback {
  decision: 'ACCEPT' | 'ACCEPT_HINT' | 'RETRY' | 'KEEP_WATCHING' | 'NOT_VISIBLE';
  shouldAdvance: boolean;
  shouldPause: boolean;
  speech: string;
  confidence: number;
  scores: { overall: number; visibility: number };
}

export interface TeachingAgentSession {
  sessionId: string;
  danceId: string;
  phase:
    | 'PREVIEW'
    | 'MOTION_DEMO'
    | 'PRACTICE'
    | 'FULL_CHALLENGE'
    | 'PAUSED'
    | 'COMPLETED';
  currentMotionIndex: number;
  currentMotionId: string;
  attemptIndex: number;
  version: number;
  completedMotions: Array<{
    motionId: string;
    outcome: 'PASSED' | 'PASSED_WITH_HINT' | 'ASSISTED' | 'SKIPPED';
    attempts: number;
    finalScore?: number;
  }>;
  latestJudgeResult?: RealtimeJudgeFeedback;
}

export interface TeachingAgentTurnResult {
  schemaVersion: 'teaching-agent-turn-v1';
  session: TeachingAgentSession;
  commands: TeachingAgentCommand[];
  idempotentReplay: boolean;
}

export interface PracticeObservation {
  mirrored: boolean;
  progress: number;
  frames: SkeletonSnapshot[];
}

export type TeachingAgentEventInput =
  | { type: 'PREVIEW_FINISHED' }
  | { type: 'MOTION_DEMO_FINISHED' }
  | {
      type: 'REALTIME_OBSERVATION';
      sampleId: string;
      observation: PracticeObservation;
    }
  | { type: 'VOICE_COMMAND'; command: TeachingVoiceCommand }
  | { type: 'FULL_CHALLENGE_FINISHED' };

export interface TeachingRuntimeStatus {
  state:
    | 'idle'
    | 'preparing-dataset'
    | 'ready'
    | 'preview'
    | 'demo'
    | 'practice'
    | 'challenge'
    | 'paused'
    | 'completed'
    | 'error';
  message: string;
}
