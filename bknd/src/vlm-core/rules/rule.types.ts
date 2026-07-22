import type { VlmIssueCode, VlmSeverity } from '../contracts/issue-code.types';
import type { VlmCorrectionEvidence } from '../contracts/vlm.types';

export interface VlmRuleCandidate {
  issueCode: VlmIssueCode;
  bodyPart?: string;
  severity: VlmSeverity;
  instruction: string;
  evidence: VlmCorrectionEvidence[];
  confidence: number;
  autoPauseEligible: boolean;
}

export interface VlmRuleEvaluation {
  candidates: VlmRuleCandidate[];
  abstained: boolean;
  abstainReason?: 'INSUFFICIENT_VISIBILITY' | 'FRAME_ALIGNMENT_UNCERTAIN';
}
