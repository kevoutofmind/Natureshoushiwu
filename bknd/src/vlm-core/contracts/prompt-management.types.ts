export type TeachingPromptId =
  | 'reference-dance-analysis'
  | 'adaptive-motion-coaching'
  | 'lesson-session-summary';

export interface PromptModelPolicy {
  temperature: number;
  timeoutMs: number;
  maxOutputTokens: number;
}

export interface ManagedPromptDefinition {
  promptId: TeachingPromptId;
  version: string;
  purpose: string;
  system: string;
  outputSchema: Record<string, unknown>;
  modelPolicy: PromptModelPolicy;
  guardrails: string[];
}

export interface PromptReference {
  promptId: TeachingPromptId;
  version: string;
}

export interface RenderedManagedPrompt extends PromptReference {
  system: string;
  user: string;
  outputSchema: Record<string, unknown>;
  modelPolicy: PromptModelPolicy;
}

export interface PromptCatalogItem extends PromptReference {
  purpose: string;
  modelPolicy: PromptModelPolicy;
}

export interface ManagedPromptExecutionInput {
  schemaVersion: 'managed-prompt-execution-v1';
  promptId: TeachingPromptId;
  payload: Record<string, unknown>;
}

export interface ManagedPromptExecutionResult extends PromptReference {
  schemaVersion: 'managed-prompt-result-v1';
  data: Record<string, unknown>;
  provider: string;
  model: string;
  latencyMs: number;
}
