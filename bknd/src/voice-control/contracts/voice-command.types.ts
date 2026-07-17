export interface VoiceCommand {
  transcript: string;
  intent?: string;
  confidence?: number;
}

export interface VoiceCommandResponse {
  accepted: boolean;
  action?: string;
}
