import type { VlmAnalysisResult, VlmFrameInput } from '../contracts/vlm.types';

export interface VlmProvider {
  analyzeFrame(input: VlmFrameInput): Promise<VlmAnalysisResult>;
}
