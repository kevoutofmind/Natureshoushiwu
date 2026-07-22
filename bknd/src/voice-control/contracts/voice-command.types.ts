export const SIMPLE_VOICE_COMMAND_INTENTS = [
  'PAUSE',
  'RESUME',
  'SLOW_DOWN',
  'SPEED_UP',
  'SET_PLAYBACK_RATE',
  'REWIND',
  'FAST_FORWARD',
  'RESTART',
  'START_RECORDING',
  'STOP_RECORDING',
] as const;

export type SimpleVoiceCommandIntent =
  (typeof SIMPLE_VOICE_COMMAND_INTENTS)[number];

export interface VoiceCommandParameters {
  seconds?: number;
  playbackRate?: number;
}

export interface VoiceCommand {
  transcript: string;
  normalizedTranscript: string;
  intent: SimpleVoiceCommandIntent | null;
  confidence: number;
  parameters: VoiceCommandParameters;
}

export interface VoiceCommandResponse {
  success: true;
  code: 'VOICE_COMMAND_RECOGNIZED' | 'VOICE_COMMAND_NOT_RECOGNIZED';
  message: string;
  data: {
    accepted: boolean;
    command: VoiceCommand;
    label: string | null;
    responseText: string;
    executionStatus: 'not-dispatched';
  };
}
