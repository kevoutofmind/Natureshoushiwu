import type { VlmAnalysisResult, VlmCorrection } from './vlm.types';

export type TeachingDecisionCode =
  | 'ACCEPT'
  | 'ACCEPT_HINT'
  | 'KEEP_WATCHING'
  | 'NOT_VISIBLE'
  | 'RETRY_CURRENT'
  | 'PROCEED_NEXT'
  | 'ADJUST_CAMERA'
  | 'SHOW_SLOW_DEMO'
  | 'START_FULL_CHALLENGE';

export interface TeachingControlSuggestion {
  pause?: boolean;
  seekToMotionId?: string;
  playbackRate?: number;
}

export interface TeachingDecision {
  schemaVersion: 'teaching-decision-v0';
  sessionId: string;
  sampleId: string;
  actionId: string;
  motionId: string;
  decision: TeachingDecisionCode;
  speech: string;
  focusCorrection?: VlmCorrection;
  controlSuggestion?: TeachingControlSuggestion;
  confidence: number;
  analysis: VlmAnalysisResult;
}

export interface VlmHealthStatus {
  status: 'ready';
  realtimeMode: 'local-skeleton-template';
  cloudRequiredForRealtime: false;
  registeredMotionPacks: number;
  provider: string;
  cloudEnhancementConfigured: boolean;
  schemaVersion: 'vision-output-v0';
  realtimeSchemaVersion: 'realtime-judge-v1';
  promptVersion: string;
  ruleVersion: string;
  templateMatcherVersion: string;
}
