export type VoiceControlStatus =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'completed'
  | 'error';

export type SimpleVoiceCommandIntent =
  | 'PAUSE'
  | 'RESUME'
  | 'READY'
  | 'SLOW_DOWN'
  | 'SPEED_UP'
  | 'SET_PLAYBACK_RATE'
  | 'REWIND'
  | 'FAST_FORWARD'
  | 'RESTART'
  | 'PREVIOUS_ACTION'
  | 'REPEAT_ACTION'
  | 'NEXT_ACTION'
  | 'RESTART_LESSON'
  | 'START_RECORDING'
  | 'STOP_RECORDING';

export interface VoiceCommandParameters {
  seconds?: number;
  playbackRate?: number;
}

export interface VoiceCommandResult {
  accepted: boolean;
  command: {
    transcript: string;
    normalizedTranscript: string;
    intent: SimpleVoiceCommandIntent | null;
    confidence: number;
    parameters: VoiceCommandParameters;
  };
  label: string | null;
  responseText: string;
  executionStatus: 'not-dispatched';
}

export interface InterpretVoiceCommandResponse {
  success: true;
  code: 'VOICE_COMMAND_RECOGNIZED' | 'VOICE_COMMAND_NOT_RECOGNIZED';
  message: string;
  data: VoiceCommandResult;
}
