import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type {
  ManagedPromptExecutionInput,
  ManagedPromptExecutionResult,
  TeachingPromptId,
} from '../contracts/prompt-management.types';
import type { VlmProvider } from '../providers/vlm-provider.interface';
import { VLM_PROVIDER } from '../providers/vlm-provider.token';
import { PromptCatalogService } from './prompt-catalog.service';

const REQUIRED_OUTPUT_FIELDS: Record<TeachingPromptId, string[]> = {
  'reference-dance-analysis': ['danceId', 'units'],
  'adaptive-motion-coaching': ['speech', 'focusPart', 'strategy'],
  'lesson-session-summary': ['summary', 'strength', 'nextFocus'],
};

const FORBIDDEN_CONTROL_FIELDS = new Set([
  'decision',
  'shouldAdvance',
  'shouldPause',
  'controlSuggestion',
  'seekToMotionId',
]);

@Injectable()
export class ManagedPromptExecutorService {
  constructor(
    @Inject(VLM_PROVIDER) private readonly provider: VlmProvider,
    private readonly promptCatalog: PromptCatalogService,
  ) {}

  async execute(
    input: ManagedPromptExecutionInput,
  ): Promise<ManagedPromptExecutionResult> {
    const startedAt = Date.now();
    if (input.schemaVersion !== 'managed-prompt-execution-v1') {
      throw new BadRequestException({
        success: false,
        code: 'INVALID_MANAGED_PROMPT_INPUT',
        message: 'schemaVersion 必须为 managed-prompt-execution-v1。',
      });
    }
    if (
      !input.payload ||
      typeof input.payload !== 'object' ||
      Array.isArray(input.payload)
    ) {
      throw new BadRequestException({
        success: false,
        code: 'INVALID_MANAGED_PROMPT_PAYLOAD',
        message: 'Prompt payload 必须为对象。',
      });
    }
    if (!this.provider.configured) {
      throw new BadGatewayException({
        success: false,
        code: 'VLM_PROVIDER_NOT_CONFIGURED',
        message: '云端 VLM 尚未配置；本地实时教学不受影响。',
      });
    }

    const prompt = this.promptCatalog.render(input.promptId, input.payload);
    const result = await this.provider.executeManagedPrompt(prompt);
    this.validateOutput(input.promptId, result.data);
    return {
      schemaVersion: 'managed-prompt-result-v1',
      promptId: prompt.promptId,
      version: prompt.version,
      data: result.data,
      provider: this.provider.name,
      model: result.model,
      latencyMs: Date.now() - startedAt,
    };
  }

  private validateOutput(
    promptId: TeachingPromptId,
    data: Record<string, unknown>,
  ): void {
    const missingFields = REQUIRED_OUTPUT_FIELDS[promptId].filter(
      (field) => !(field in data),
    );
    const forbiddenFields = this.findForbiddenFields(data);
    if (missingFields.length > 0 || forbiddenFields.length > 0) {
      throw new BadGatewayException({
        success: false,
        code: 'INVALID_MANAGED_PROMPT_OUTPUT',
        message: '云端 VLM 输出未通过结构化护栏。',
        missingFields,
        forbiddenFields,
      });
    }
  }

  private findForbiddenFields(value: unknown, path = ''): string[] {
    if (Array.isArray(value)) {
      return value.flatMap((item, index) =>
        this.findForbiddenFields(item, `${path}[${index}]`),
      );
    }
    if (!value || typeof value !== 'object') {
      return [];
    }

    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, child]) => {
        const currentPath = path ? `${path}.${key}` : key;
        const ownMatch = FORBIDDEN_CONTROL_FIELDS.has(key) ? [currentPath] : [];
        return [...ownMatch, ...this.findForbiddenFields(child, currentPath)];
      },
    );
  }
}
