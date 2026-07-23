import type {
  VlmAbstainReason,
  VlmIssueCode,
  VlmSeverity,
} from '../contracts/issue-code.types';
import {
  VLM_ABSTAIN_REASONS,
  VLM_ISSUE_CODES,
} from '../contracts/issue-code.types';
import type { RenderedManagedPrompt } from '../contracts/prompt-management.types';
import type { VlmComparisonInput } from '../contracts/vision.types';
import { buildComparisonPrompt } from '../prompts/comparison.prompt';
import { VLM_SYSTEM_PROMPT } from '../prompts/system.prompt';
import type { VlmRuleCandidate } from '../rules/rule.types';
import type {
  VlmManagedPromptResult,
  VlmProvider,
  VlmProviderCorrection,
  VlmProviderResult,
} from './vlm-provider.interface';

interface OpenAiCompatibleProviderOptions {
  apiUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maximumRetries: number;
  temperature: number;
  jsonMode: boolean;
  thinkingMode?: 'enabled' | 'disabled';
  omitTemperature: boolean;
}

interface CompatibleResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

export class OpenAiCompatibleVlmProvider implements VlmProvider {
  readonly name = 'openai-compatible';
  readonly configured: boolean;

  constructor(private readonly options: OpenAiCompatibleProviderOptions) {
    this.configured = Boolean(
      options.apiUrl && options.apiKey && options.model,
    );
  }

  async analyzeComparison(
    input: VlmComparisonInput,
    candidates: VlmRuleCandidate[],
  ): Promise<VlmProviderResult> {
    if (!this.configured) {
      throw new Error(
        'VLM provider is not configured. Set VLM_API_URL, VLM_API_KEY and VLM_MODEL.',
      );
    }

    const selectedReference =
      input.references.find(
        (reference) => reference.referenceId === input.selectedReferenceId,
      ) ?? input.references[0];

    const content: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text: buildComparisonPrompt(input, candidates),
      },
      ...selectedReference.frameUrls.slice(0, 3).map((url) => ({
        type: 'image_url',
        image_url: { url },
      })),
      ...input.practice.frameUrls.slice(0, 3).map((url) => ({
        type: 'image_url',
        image_url: { url },
      })),
    ];

    const body: Record<string, unknown> = {
      model: this.options.model,
      messages: [
        { role: 'system', content: VLM_SYSTEM_PROMPT },
        { role: 'user', content },
      ],
    };

    this.applyProviderOptions(body, this.options.temperature);

    if (this.options.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const response = await this.requestWithRetry(body);
    const rawContent = response.choices?.[0]?.message?.content;
    const text = this.extractText(rawContent);
    return this.parseResult(text, candidates);
  }

  async executeManagedPrompt(
    prompt: RenderedManagedPrompt,
  ): Promise<VlmManagedPromptResult> {
    if (!this.configured) {
      throw new Error(
        'VLM provider is not configured. Set VLM_API_URL, VLM_API_KEY and VLM_MODEL.',
      );
    }

    const body: Record<string, unknown> = {
      model: this.options.model,
      max_tokens: prompt.modelPolicy.maxOutputTokens,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    };
    this.applyProviderOptions(body, prompt.modelPolicy.temperature);
    if (this.options.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const response = await this.requestWithRetry(
      body,
      prompt.modelPolicy.timeoutMs,
    );
    const text = this.extractText(response.choices?.[0]?.message?.content);
    const normalized = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    const data = JSON.parse(normalized) as Record<string, unknown>;
    return { data, model: this.options.model };
  }

  private async requestWithRetry(
    body: Record<string, unknown>,
    timeoutMs = this.options.timeoutMs,
  ): Promise<CompatibleResponse> {
    let lastError: unknown;

    for (
      let attempt = 0;
      attempt <= this.options.maximumRetries;
      attempt += 1
    ) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(this.options.apiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          const retryable = response.status === 429 || response.status >= 500;
          if (!retryable || attempt === this.options.maximumRetries) {
            throw new Error(
              `VLM API failed with ${response.status}: ${errorText.slice(0, 300)}`,
            );
          }
          lastError = new Error(`VLM API retryable error ${response.status}`);
        } else {
          return (await response.json()) as CompatibleResponse;
        }
      } catch (error) {
        lastError = error;
        if (attempt === this.options.maximumRetries) {
          break;
        }
      } finally {
        clearTimeout(timeout);
      }

      await this.delay(150 * (attempt + 1));
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Unknown VLM provider failure.');
  }

  private applyProviderOptions(
    body: Record<string, unknown>,
    temperature: number,
  ): void {
    if (!this.options.omitTemperature) body.temperature = temperature;
    if (this.options.thinkingMode) {
      body.thinking = { type: this.options.thinkingMode };
    }
  }

  private extractText(
    content?: string | Array<{ type?: string; text?: string }>,
  ): string {
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .filter((part) => part.type === 'text' || part.text)
        .map((part) => part.text ?? '')
        .join('');
    }
    throw new Error('VLM response did not contain text content.');
  }

  private parseResult(
    text: string,
    candidates: VlmRuleCandidate[],
  ): VlmProviderResult {
    const normalized = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    const allowedCandidates = new Set(
      candidates.map((candidate) => candidate.issueCode),
    );

    const corrections = Array.isArray(parsed.corrections)
      ? parsed.corrections
          .map((value) => this.parseCorrection(value, allowedCandidates))
          .filter(
            (value): value is VlmProviderCorrection => value !== undefined,
          )
          .slice(0, 3)
      : [];

    const abstained = parsed.abstained === true;
    const abstainReason = this.isAbstainReason(parsed.abstainReason)
      ? parsed.abstainReason
      : undefined;

    return {
      summary:
        typeof parsed.summary === 'string'
          ? parsed.summary.slice(0, 300)
          : corrections.length > 0
            ? '检测到需要调整的动作细节。'
            : '未发现有充分证据支持的动作错误。',
      corrections,
      abstained,
      abstainReason,
      model: this.options.model,
    };
  }

  private parseCorrection(
    value: unknown,
    allowedCandidates: Set<VlmIssueCode>,
  ): VlmProviderCorrection | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const correction = value as Record<string, unknown>;
    if (
      !this.isIssueCode(correction.issueCode) ||
      !allowedCandidates.has(correction.issueCode) ||
      typeof correction.instruction !== 'string'
    ) {
      return undefined;
    }

    const severity = this.isSeverity(correction.severity)
      ? correction.severity
      : 'medium';
    const confidence =
      typeof correction.confidence === 'number'
        ? Math.min(1, Math.max(0, correction.confidence))
        : 0.7;

    return {
      issueCode: correction.issueCode,
      bodyPart:
        typeof correction.bodyPart === 'string'
          ? correction.bodyPart
          : undefined,
      severity,
      instruction: correction.instruction.slice(0, 180),
      confidence,
    };
  }

  private isIssueCode(value: unknown): value is VlmIssueCode {
    return (
      typeof value === 'string' &&
      (VLM_ISSUE_CODES as readonly string[]).includes(value)
    );
  }

  private isAbstainReason(value: unknown): value is VlmAbstainReason {
    return (
      typeof value === 'string' &&
      (VLM_ABSTAIN_REASONS as readonly string[]).includes(value)
    );
  }

  private isSeverity(value: unknown): value is VlmSeverity {
    return value === 'low' || value === 'medium' || value === 'high';
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
