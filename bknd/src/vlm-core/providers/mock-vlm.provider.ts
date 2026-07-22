import type { RenderedManagedPrompt } from '../contracts/prompt-management.types';
import type { VlmComparisonInput } from '../contracts/vision.types';
import type { VlmRuleCandidate } from '../rules/rule.types';
import type {
  VlmManagedPromptResult,
  VlmProvider,
  VlmProviderResult,
} from './vlm-provider.interface';

export class MockVlmProvider implements VlmProvider {
  readonly name = 'mock';
  readonly configured = true;

  async analyzeComparison(
    _input: VlmComparisonInput,
    candidates: VlmRuleCandidate[],
  ): Promise<VlmProviderResult> {
    return Promise.resolve({
      summary:
        candidates.length > 0
          ? '检测到一个需要优先调整的动作细节。'
          : '动作与参考示范基本一致。',
      corrections: candidates.map((candidate) => ({
        issueCode: candidate.issueCode,
        bodyPart: candidate.bodyPart,
        severity: candidate.severity,
        instruction: candidate.instruction,
        confidence: candidate.confidence,
      })),
      abstained: false,
      model: 'mock-v0',
    });
  }

  executeManagedPrompt(
    prompt: RenderedManagedPrompt,
  ): Promise<VlmManagedPromptResult> {
    const data =
      prompt.promptId === 'adaptive-motion-coaching'
        ? {
            speech: '先放慢一点，只看最需要调整的那只手。',
            focusPart: 'unknown',
            strategy: 'SLOWER',
          }
        : prompt.promptId === 'lesson-session-summary'
          ? {
              summary: '课程已经完成。',
              strength: '能够跟随完整教学流程。',
              nextFocus: '继续巩固尝试次数较多的动作。',
            }
          : {
              danceId: 'mock-dance',
              units: [
                {
                  motionId: 'motion-001',
                  startMs: 0,
                  endMs: 3000,
                  instruction: '完成第一个教学动作。',
                  requiredParts: ['pose', 'left_hand', 'right_hand'],
                  hintSpeech: '动作基本完成，我们继续。',
                  retrySpeech: '放慢速度再做一次。',
                },
              ],
            };
    return Promise.resolve({ data, model: 'mock-v0' });
  }
}
