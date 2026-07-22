import {
  createCorrectComparisonFixture,
  createElbowErrorFixture,
  createLowVisibilityFixture,
  createPartialAttemptFixture,
} from './fixtures/comparison.fixtures';
import {
  createRealtimeJudgeFixture,
  createTemplatePackFixture,
} from './fixtures/realtime.fixtures';
import { MockVlmProvider } from './providers/mock-vlm.provider';
import type {
  VlmManagedPromptResult,
  VlmProvider,
  VlmProviderResult,
} from './providers/vlm-provider.interface';
import { GeometryRuleEngine } from './rules/geometry-rule.engine';
import { SkeletonTemplateMatcherEngine } from './rules/skeleton-template-matcher.engine';
import { MotionTemplateRegistry } from './templates/motion-template.registry';
import { ComparisonInputValidator } from './validation/comparison-input.validator';
import { RealtimeJudgeValidator } from './validation/realtime-judge.validator';
import { VlmCoreService } from './vlm-core.service';

describe('VlmCoreService', () => {
  function createService(provider: VlmProvider = new MockVlmProvider()) {
    return new VlmCoreService(
      provider,
      new GeometryRuleEngine(),
      new ComparisonInputValidator(),
      new SkeletonTemplateMatcherEngine(),
      new MotionTemplateRegistry(),
      new RealtimeJudgeValidator(),
    );
  }

  it('registers references and makes a local realtime decision', () => {
    const service = createService();
    const registration = service.registerMotionTemplate(
      createTemplatePackFixture(),
    );
    const result = service.judgeRealtime(createRealtimeJudgeFixture('correct'));

    expect(registration.referenceCount).toBe(2);
    expect(result.decision).toBe('ACCEPT');
    expect(result.metadata.cloudCalled).toBe(false);
  });

  it('accepts a correct legacy measurement input without cloud reasoning', () => {
    const result = createService().analyzeComparison(
      createCorrectComparisonFixture(),
    );

    expect(result.decision).toBe('ACCEPT');
    expect(result.analysis.corrections).toHaveLength(0);
    expect(result.analysis.metadata.provider).toBe('local');
    expect(result.analysis.metadata.promptVersion).toBe('not-called');
  });

  it('retries only a high-confidence legacy error', () => {
    const result = createService().analyzeComparison(createElbowErrorFixture());

    expect(result.decision).toBe('RETRY_CURRENT');
    expect(result.controlSuggestion).toMatchObject({
      pause: true,
      seekToMotionId: 'motion-03',
      playbackRate: 0.7,
    });
  });

  it('reports low visibility without treating it as an error', () => {
    const result = createService().analyzeComparison(
      createLowVisibilityFixture(),
    );

    expect(result.decision).toBe('NOT_VISIBLE');
    expect(result.analysis.abstained).toBe(true);
    expect(result.controlSuggestion?.pause).toBe(false);
  });

  it('retries an interrupted legacy attempt', () => {
    const result = createService().analyzeComparison(
      createPartialAttemptFixture(),
    );

    expect(result.decision).toBe('RETRY_CURRENT');
    expect(result.focusCorrection?.issueCode).toBe('PARTIAL_ATTEMPT');
  });

  it('never calls the cloud provider on the realtime measurement path', () => {
    class ThrowIfCalledProvider implements VlmProvider {
      readonly name = 'must-not-be-called';
      readonly configured = true;

      analyzeComparison(): Promise<VlmProviderResult> {
        throw new Error('cloud provider was called by realtime path');
      }

      executeManagedPrompt(): Promise<VlmManagedPromptResult> {
        throw new Error('managed cloud provider was called by realtime path');
      }
    }

    const result = createService(new ThrowIfCalledProvider()).analyzeComparison(
      createElbowErrorFixture(),
    );

    expect(result.decision).toBe('RETRY_CURRENT');
    expect(result.analysis.metadata.provider).toBe('local');
  });
});
