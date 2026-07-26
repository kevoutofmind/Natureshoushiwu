import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  EnvHttpProxyAgent,
  fetch as undiciFetch,
  type Dispatcher,
} from 'undici';

interface WhisperTranscriptionResponse {
  text?: string;
  model?: string;
}

const DEFAULT_WHISPER_PROMPT =
  '这是一款名为 Lumi 的中文手势舞教学助手。常用词和口令包括：Lumi，准备，第一拍，第二拍，收势，显示骨架，关闭骨架，暂停，继续，慢一点，快一点，上一个动作，下一个动作，再来一遍，从头开始，开始评估，回到主界面，重新练习。';

export interface WhisperAudioFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

@Injectable()
export class WhisperTranscriptionService {
  private readonly logger = new Logger(WhisperTranscriptionService.name);
  private readonly provider =
    process.env.VOICE_TRANSCRIPTION_PROVIDER?.trim().toLowerCase() ?? 'local';
  private readonly apiKey = process.env.OPENAI_API_KEY ?? '';
  private readonly apiUrl =
    process.env.OPENAI_AUDIO_TRANSCRIPTION_URL ??
    'https://api.openai.com/v1/audio/transcriptions';
  private readonly model =
    process.env.OPENAI_TRANSCRIPTION_MODEL ?? 'whisper-1';
  private readonly language =
    process.env.OPENAI_TRANSCRIPTION_LANGUAGE ?? 'zh';
  private readonly prompt =
    process.env.OPENAI_TRANSCRIPTION_PROMPT?.trim() ??
    DEFAULT_WHISPER_PROMPT;
  private readonly timeoutMs = positiveInteger(
    process.env.OPENAI_TRANSCRIPTION_TIMEOUT_MS,
    30000,
  );
  private readonly localUrl =
    process.env.LOCAL_WHISPER_URL ?? 'http://127.0.0.1:8765/transcribe';
  private readonly localTimeoutMs = positiveInteger(
    process.env.LOCAL_WHISPER_TIMEOUT_MS,
    60000,
  );
  private readonly dispatcher = createProxyDispatcher();

  get configured(): boolean {
    if (this.provider === 'local') return Boolean(this.localUrl);
    return Boolean(this.apiKey && this.apiUrl && this.model);
  }

  async transcribe(file: WhisperAudioFile): Promise<{
    text: string;
    model: string;
  }> {
    if (this.provider === 'local') {
      return this.transcribeLocally(file);
    }
    if (this.provider !== 'openai') {
      throw new ServiceUnavailableException({
        code: 'VOICE_TRANSCRIPTION_PROVIDER_INVALID',
        message: `不支持的语音识别提供者：${this.provider}。`,
      });
    }
    if (!this.configured) {
      throw new ServiceUnavailableException({
        code: 'WHISPER_NOT_CONFIGURED',
        message: 'Whisper API 尚未配置，请设置 OPENAI_API_KEY。',
      });
    }

    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(file.buffer)], {
        type: file.mimetype || 'audio/webm',
      }),
      file.originalname || 'voice-command.webm',
    );
    form.append('model', this.model);
    form.append('language', this.language);
    if (this.prompt) form.append('prompt', this.prompt);
    form.append('response_format', 'json');
    form.append('temperature', '0');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const requestInit: RequestInit = {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: form,
        signal: controller.signal,
      };
      const response =
        process.env.NODE_ENV === 'test'
          ? await globalThis.fetch(this.apiUrl, requestInit)
          : await undiciFetch(this.apiUrl, {
              ...(requestInit as unknown as NonNullable<
                Parameters<typeof undiciFetch>[1]
              >),
              dispatcher: this.dispatcher,
            });

      if (!response.ok) {
        const responseBody = (await response.text()).slice(0, 500);
        this.logger.warn(
          `Whisper transcription returned HTTP ${response.status}: ${responseBody}`,
        );
        throw new BadGatewayException({
          code: 'WHISPER_UPSTREAM_ERROR',
          message: `Whisper 转写服务返回错误（${response.status}）。`,
        });
      }

      const payload = (await response.json()) as WhisperTranscriptionResponse;
      return {
        text: payload.text?.trim() ?? '',
        model: this.model,
      };
    } catch (error: unknown) {
      if (
        error instanceof BadGatewayException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      const timedOut =
        error instanceof DOMException && error.name === 'AbortError';
      this.logger.warn(
        `Whisper transcription failed: ${
          error instanceof Error ? error.message : 'unknown-error'
        }`,
      );
      throw new BadGatewayException({
        code: timedOut ? 'WHISPER_TIMEOUT' : 'WHISPER_REQUEST_FAILED',
        message: timedOut
          ? 'Whisper 转写超时，请稍后重试。'
          : 'Whisper 转写请求失败，请稍后重试。',
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async transcribeLocally(file: WhisperAudioFile): Promise<{
    text: string;
    model: string;
  }> {
    const form = createAudioForm(file);
    form.append('language', this.language);
    if (this.prompt) {
      form.append('initial_prompt', this.prompt);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.localTimeoutMs);
    try {
      const response = await globalThis.fetch(this.localUrl, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        const responseBody = (await response.text()).slice(0, 500);
        this.logger.warn(
          `Local Whisper returned HTTP ${response.status}: ${responseBody}`,
        );
        throw new BadGatewayException({
          code: 'LOCAL_WHISPER_UPSTREAM_ERROR',
          message: `本地 Whisper 服务返回错误（${response.status}）。`,
        });
      }

      const payload = (await response.json()) as WhisperTranscriptionResponse;
      return {
        text: payload.text?.trim() ?? '',
        model: payload.model?.trim() || 'local-whisper',
      };
    } catch (error: unknown) {
      if (error instanceof BadGatewayException) throw error;
      const timedOut =
        error instanceof DOMException && error.name === 'AbortError';
      this.logger.warn(
        `Local Whisper transcription failed: ${
          error instanceof Error ? error.message : 'unknown-error'
        }`,
      );
      throw new BadGatewayException({
        code: timedOut
          ? 'LOCAL_WHISPER_TIMEOUT'
          : 'LOCAL_WHISPER_UNAVAILABLE',
        message: timedOut
          ? '本地 Whisper 转写超时，请稍后重试。'
          : '本地 Whisper 尚未启动，请运行 voice-control/local-whisper/start.ps1。',
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function createAudioForm(file: WhisperAudioFile): FormData {
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(file.buffer)], {
      type: file.mimetype || 'audio/webm',
    }),
    file.originalname || 'voice-command.webm',
  );
  return form;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createProxyDispatcher(): Dispatcher | undefined {
  const explicitProxy = process.env.OPENAI_PROXY_URL?.trim();
  if (explicitProxy) {
    return new EnvHttpProxyAgent({
      httpProxy: explicitProxy,
      httpsProxy: explicitProxy,
    });
  }
  return hasProxyEnvironment() ? new EnvHttpProxyAgent() : undefined;
}

function hasProxyEnvironment(): boolean {
  return Boolean(
    process.env.HTTPS_PROXY ??
      process.env.https_proxy ??
      process.env.HTTP_PROXY ??
      process.env.http_proxy ??
      process.env.ALL_PROXY ??
      process.env.all_proxy,
  );
}
