import { Injectable, Logger } from '@nestjs/common';
import { SIMPLE_VOICE_COMMAND_INTENTS } from './contracts/voice-command.types';
import type {
  SimpleVoiceCommandIntent,
  VoiceCommandParameters,
  VoiceCommandResponse,
} from './contracts/voice-command.types';
import {
  KIMI_VOICE_ROUTER_PROMPT_VERSION,
  KIMI_VOICE_ROUTER_SYSTEM_PROMPT,
} from './prompts/kimi-voice-router.prompt';
import { nearestPlaybackRateStep } from './voice-command-keywords';

interface KimiChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

@Injectable()
export class KimiVoiceCommandRouterService {
  private readonly logger = new Logger(KimiVoiceCommandRouterService.name);
  private readonly apiKey = process.env.KIMI_API_KEY ?? '';
  private readonly apiUrl =
    process.env.KIMI_API_URL ?? 'https://api.moonshot.cn/v1/chat/completions';
  private readonly model = process.env.KIMI_MODEL ?? 'kimi-k2.6';
  private readonly timeoutMs = positiveInteger(
    process.env.KIMI_VOICE_TIMEOUT_MS,
    12000,
  );

  get configured(): boolean {
    return Boolean(this.apiKey && this.apiUrl && this.model);
  }

  async interpret(
    transcript: string,
    normalizedTranscript: string,
  ): Promise<VoiceCommandResponse | null> {
    if (!this.configured) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          thinking: { type: 'disabled' },
          max_tokens: 300,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: KIMI_VOICE_ROUTER_SYSTEM_PROMPT },
            {
              role: 'user',
              content: JSON.stringify({
                promptVersion: KIMI_VOICE_ROUTER_PROMPT_VERSION,
                transcript,
              }),
            },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        this.logger.warn(`Kimi voice routing returned HTTP ${response.status}`);
        return null;
      }

      const payload = (await response.json()) as KimiChatResponse;
      const content = payload.choices?.[0]?.message?.content;
      if (!content) return null;
      return this.toVoiceResponse(
        transcript,
        normalizedTranscript,
        JSON.parse(stripJsonFence(content)) as Record<string, unknown>,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Kimi voice routing failed; local controls remain available: ${errorName(error)}`,
      );
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private toVoiceResponse(
    transcript: string,
    normalizedTranscript: string,
    data: Record<string, unknown>,
  ): VoiceCommandResponse | null {
    const confidence = boundedNumber(data.confidence, 0, 1) ?? 0;
    const responseText =
      typeof data.responseText === 'string' && data.responseText.trim()
        ? data.responseText.trim().slice(0, 160)
        : '我在陪着你，按自己的节奏来就好。';

    if (data.intent === null) {
      if (confidence < 0.65) return null;
      return {
        success: true,
        code: 'VOICE_COMMAND_NOT_RECOGNIZED',
        message: 'Kimi 已生成 Lumi 陪伴回应。',
        data: {
          accepted: false,
          command: {
            transcript,
            normalizedTranscript,
            intent: null,
            confidence,
            parameters: {},
          },
          label: 'Lumi 陪伴回应',
          responseText,
          executionStatus: 'not-dispatched',
        },
      };
    }

    const intent = this.parseIntent(data.intent);
    if (!intent || confidence < 0.65) return null;

    const parameters: VoiceCommandParameters = {};
    const seconds = boundedNumber(data.seconds, 0.5, 30);
    if (seconds !== undefined) parameters.seconds = seconds;
    const playbackRate = boundedNumber(data.playbackRate, 0.25, 2);
    if (playbackRate !== undefined) parameters.playbackRate = nearestPlaybackRateStep(playbackRate);
    return {
      success: true,
      code: 'VOICE_COMMAND_RECOGNIZED',
      message: 'Kimi 已理解自然语言指令。',
      data: {
        accepted: true,
        command: {
          transcript,
          normalizedTranscript,
          intent,
          confidence,
          parameters,
        },
        label:
          intent === 'COACH_QUESTION'
            ? 'AI 教练答疑'
            : '自然语言教学指令',
        responseText,
        executionStatus: 'not-dispatched',
      },
    };
  }

  private parseIntent(value: unknown): SimpleVoiceCommandIntent | null {
    return typeof value === 'string' &&
      (SIMPLE_VOICE_COMMAND_INTENTS as readonly string[]).includes(value)
      ? (value as SimpleVoiceCommandIntent)
      : null;
  }
}

function stripJsonFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
}

function boundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : undefined;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown-error';
}
