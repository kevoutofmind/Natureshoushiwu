import type { InterpretVoiceCommandResponse } from './types';

export const VOICE_CONTROL_API_BASE_PATH = '/voice';

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

interface VoiceTranscriptionResponse {
  success: boolean;
  code: string;
  message: string;
  data: {
    text: string;
    model: string;
  };
}

export async function transcribeVoiceAudio(
  audio: Blob,
): Promise<VoiceTranscriptionResponse['data']> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  const formData = new FormData();
  formData.append('file', audio, `voice-command.${audioExtension(audio.type)}`);

  try {
    const response = await fetch(
      `${apiBaseUrl}${VOICE_CONTROL_API_BASE_PATH}/transcriptions`,
      {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      },
    );
    const payload = (await response.json().catch(() => null)) as
      | VoiceTranscriptionResponse
      | null;

    if (!response.ok || !payload?.success) {
      throw new Error(
        payload?.message ??
          `Whisper 语音识别服务返回错误（${response.status}）。`,
      );
    }

    return payload.data;
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === 'AbortError') {
      throw new Error('Whisper 语音识别超时，请检查后端和 OpenAI API。');
    }
    throw reason;
  } finally {
    clearTimeout(timeout);
  }
}

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

function audioExtension(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('wav')) return 'wav';
  return 'webm';
}
