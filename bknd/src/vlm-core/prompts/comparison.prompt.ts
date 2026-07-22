import type { VlmComparisonInput } from '../contracts/vision.types';
import type { VlmRuleCandidate } from '../rules/rule.types';

export function buildComparisonPrompt(
  input: VlmComparisonInput,
  candidates: VlmRuleCandidate[],
): string {
  const safeInput = {
    actionId: input.actionId,
    motionId: input.motionId,
    actionName: input.context?.actionName,
    motionName: input.context?.motionName,
    referenceInstruction: input.context?.referenceInstruction,
    completion: input.completion,
    quality: input.quality,
    measurements: input.measurements,
    geometryCandidates: candidates.map((candidate) => ({
      issueCode: candidate.issueCode,
      bodyPart: candidate.bodyPart,
      severity: candidate.severity,
      confidence: candidate.confidence,
      evidence: candidate.evidence,
    })),
  };

  return [
    '请比较参考动作和用户动作。',
    '参考图片在前，用户练习图片在后。',
    '只能从 geometryCandidates 中选择 issueCode；如果图片不支持候选错误，请降低置信度或拒绝判断。',
    '教学指令面向零基础用户，一次只强调最重要的动作调整。',
    JSON.stringify(safeInput),
  ].join('\n');
}
