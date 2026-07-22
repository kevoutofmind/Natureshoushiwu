import type {
  VlmAbstainReason,
  VlmIssueCode,
  VlmSeverity,
} from './issue-code.types';

/**
 * 旧版帧级入口，保留用于向后兼容。
 * 新的教学链路应使用 VlmComparisonInput。
 */
export interface VlmFrameInput {
  referenceFrameUrl?: string;
  practiceFrameUrl: string;
  actionLabel?: string;
  timestampMs?: number;
}

export interface VlmCorrectionEvidence {
  metric: string;
  referenceValue?: number;
  practiceValue?: number;
  delta?: number;
  reliability?: number;
}

export interface VlmCorrection {
  issueCode: VlmIssueCode;
  bodyPart?: string;
  severity: VlmSeverity;
  instruction: string;
  evidence: VlmCorrectionEvidence[];
  confidence: number;
  source: 'geometry' | 'vlm' | 'fused';
}

export interface VlmAnalysisMetadata {
  provider: string;
  model: string;
  promptVersion: string;
  ruleVersion: string;
  latencyMs: number;
  degraded: boolean;
}

export interface VlmAnalysisResult {
  schemaVersion: 'vlm-output-v0';
  sampleId: string;
  summary: string;
  corrections: VlmCorrection[];
  abstained: boolean;
  abstainReason?: VlmAbstainReason;
  metadata: VlmAnalysisMetadata;
}
