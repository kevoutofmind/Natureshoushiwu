import type { InterpretVoiceCommandResponse } from './types';

export const VOICE_CONTROL_API_BASE_PATH = '/voice';

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

export async function interpretVoiceCommand(
  transcript: string,
): Promise<InterpretVoiceCommandResponse> {
  const response = await fetch(
    `${apiBaseUrl}${VOICE_CONTROL_API_BASE_PATH}/commands/interpret`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript }),
    },
  );

  if (!response.ok) {
    throw new Error('语音指令解析服务暂时不可用。');
  }

  return (await response.json()) as InterpretVoiceCommandResponse;
}
