import type { InterpretVoiceCommandResponse } from './types';

export const VOICE_CONTROL_API_BASE_PATH = '/voice';

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

export async function interpretVoiceCommand(
  transcript: string,
): Promise<InterpretVoiceCommandResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(
      `${apiBaseUrl}${VOICE_CONTROL_API_BASE_PATH}/commands/interpret`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error(`语音指令解析服务返回错误（${response.status}）。`);
    }

    return (await response.json()) as InterpretVoiceCommandResponse;
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === 'AbortError') {
      throw new Error('Lumi 响应超时，请确认后端和 Kimi 服务可用。');
    }
    throw reason;
  } finally {
    clearTimeout(timeout);
  }
}
