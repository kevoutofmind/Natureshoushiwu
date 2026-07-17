export type VoiceControlStatus =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'completed'
  | 'error';

export interface VoiceCommandResult {
  transcript: string;
  intent: string;
  confidence?: number;
}
