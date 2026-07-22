import type {
  VlmAbstainReason,
  VlmIssueCode,
  VlmSeverity,
} from '../contracts/issue-code.types';
import type { RenderedManagedPrompt } from '../contracts/prompt-management.types';
import type { VlmComparisonInput } from '../contracts/vision.types';
import type { VlmRuleCandidate } from '../rules/rule.types';

export interface VlmProviderCorrection {
  issueCode: VlmIssueCode;
  bodyPart?: string;
  severity: VlmSeverity;
  instruction: string;
  confidence: number;
}

export interface VlmProviderResult {
  summary: string;
  corrections: VlmProviderCorrection[];
  abstained: boolean;
  abstainReason?: VlmAbstainReason;
  model: string;
}

export interface VlmManagedPromptResult {
  data: Record<string, unknown>;
  model: string;
}

export interface VlmProvider {
  readonly name: string;
  readonly configured: boolean;

  analyzeComparison(
    input: VlmComparisonInput,
    candidates: VlmRuleCandidate[],
  ): Promise<VlmProviderResult>;

  executeManagedPrompt(
    prompt: RenderedManagedPrompt,
  ): Promise<VlmManagedPromptResult>;
}
