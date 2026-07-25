import {
  BadRequestException,
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

interface TtsSpeechRequest {
  model: string;
  input: string;
  voice: string;
  response_format: string;
  speed: number;
}

interface LumiSpeechAudio {
  buffer: Buffer;
  contentType: string;
}

@Injectable()
export class LumiVoiceService {
  private readonly ttsBaseUrl =
    process.env.COSYVOICE_BASE_URL ??
    process.env.LUMI_TTS_BASE_URL ??
    process.env.CHAT_TTS_BASE_URL ??
    'http://127.0.0.1:9967';

  private readonly model =
    process.env.COSYVOICE_MODEL ??
    process.env.CHAT_TTS_MODEL ??
    'CosyVoice-300M-SFT';
  private readonly voice =
    process.env.COSYVOICE_VOICE ?? process.env.CHAT_TTS_VOICE ?? '中文女';
  private readonly timeoutMs = Number(
    process.env.COSYVOICE_TIMEOUT_MS ??
      process.env.CHAT_TTS_TIMEOUT_MS ??
      120000,
  );
  private readonly provider =
    process.env.LUMI_TTS_PROVIDER?.trim().toLowerCase() || 'cosyvoice';

  async synthesize(text: string, voice?: string): Promise<LumiSpeechAudio> {
    const normalizedText = typeof text === 'string' ? text.trim() : '';
    if (!normalizedText || normalizedText.length > 220) {
      throw new BadRequestException({
        success: false,
        code: 'INVALID_LUMI_TTS_TEXT',
        message: 'Lumi TTS text must be between 1 and 220 characters.',
      });
    }

    if (this.provider === 'browser') {
      throw new ServiceUnavailableException({
        success: false,
        code: 'LUMI_TTS_DISABLED',
        message: 'Lumi TTS is configured to use the browser fallback.',
      });
    }

    const requestBody: TtsSpeechRequest = {
      model: this.model,
      input: normalizedText,
      voice: voice?.trim() || this.voice,
      response_format: 'wav',
      speed: 0.95,
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(
        `${this.ttsBaseUrl.replace(/\/$/, '')}/v1/audio/speech`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new BadGatewayException({
          success: false,
          code: 'LUMI_TTS_REQUEST_FAILED',
          message: `${this.provider} returned HTTP ${response.status}.`,
        });
      }

      const contentType =
        response.headers.get('content-type') ?? 'audio/mpeg';
      if (!contentType.toLowerCase().startsWith('audio/')) {
        throw new BadGatewayException({
          success: false,
          code: 'LUMI_TTS_INVALID_RESPONSE',
          message: `${this.provider} did not return audio.`,
        });
      }

      return {
        buffer: Buffer.from(await response.arrayBuffer()),
        contentType,
      };
    } catch (error: unknown) {
      if (error instanceof BadGatewayException) throw error;
      throw new ServiceUnavailableException({
        success: false,
        code: 'LUMI_TTS_UNAVAILABLE',
        message:
          error instanceof Error
            ? error.message
            : `${this.provider} service is unavailable.`,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
