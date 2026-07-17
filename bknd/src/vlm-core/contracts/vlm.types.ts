export interface VlmFrameInput {
  referenceFrameUrl?: string;
  practiceFrameUrl: string;
  actionLabel?: string;
  timestampMs?: number;
}

export interface VlmCorrection {
  bodyPart?: string;
  instruction: string;
  confidence?: number;
}

export interface VlmAnalysisResult {
  summary: string;
  corrections: VlmCorrection[];
}
