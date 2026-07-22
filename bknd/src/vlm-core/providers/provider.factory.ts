import { MockVlmProvider } from './mock-vlm.provider';
import { OpenAiCompatibleVlmProvider } from './openai-compatible-vlm.provider';
import type { VlmProvider } from './vlm-provider.interface';

export function createVlmProvider(
  environment: NodeJS.ProcessEnv = process.env,
): VlmProvider {
  const provider = environment.VLM_PROVIDER?.toLowerCase() ?? 'mock';

  if (provider === 'mock') {
    return new MockVlmProvider();
  }

  if (provider !== 'openai-compatible') {
    throw new Error(
      `Unsupported VLM_PROVIDER "${provider}". Use "mock" or "openai-compatible".`,
    );
  }

  return new OpenAiCompatibleVlmProvider({
    apiUrl: environment.VLM_API_URL ?? '',
    apiKey: environment.VLM_API_KEY ?? '',
    model: environment.VLM_MODEL ?? '',
    timeoutMs: positiveInteger(environment.VLM_TIMEOUT_MS, 4000),
    maximumRetries: nonNegativeInteger(environment.VLM_MAX_RETRIES, 1),
    temperature: boundedNumber(environment.VLM_TEMPERATURE, 0.1, 0, 1),
    jsonMode: environment.VLM_JSON_MODE !== 'false',
  });
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function boundedNumber(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(minimum, parsed))
    : fallback;
}
