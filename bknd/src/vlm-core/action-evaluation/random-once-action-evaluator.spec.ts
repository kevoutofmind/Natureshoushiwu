import type { RealtimeJudgeResult } from '../contracts/realtime-judge.types';
import { RandomOnceActionEvaluator } from './random-once-action-evaluator';

describe('RandomOnceActionEvaluator', () => {
  function baseResult(): RealtimeJudgeResult {
    return {
      schemaVersion: 'realtime-decision-v1',
      sessionId: 'session-001',
      sampleId: 'sample-001',
      danceId: 'dance-001',
      motionId: 'motion-001',
      decision: 'RETRY',
      reason: 'BELOW_THRESHOLD',
      speech: 'base result',
      shouldAdvance: false,
      shouldPause: true,
      confidence: 0.3,
      scores: {
        overall: 0.3,
        visibility: 0.9,
      },
      metadata: {
        engine: 'local-skeleton-template',
        engineVersion: 'template-matcher-test',
        referenceCount: 1,
        latencyMs: 1,
        cloudCalled: false,
      },
    };
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('passes a motion when its first random evaluation succeeds', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.75);
    const evaluator = new RandomOnceActionEvaluator();
    const result = evaluator.evaluate(baseResult());

    expect(result.outcome).toBe('PASSED');
    expect(result.result.decision).toBe('ACCEPT');
    expect(result.result.shouldAdvance).toBe(true);
  });

  it('allows one failure and forces the next evaluation to pass', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const evaluator = new RandomOnceActionEvaluator();
    const resultFixture = baseResult();

    const first = evaluator.evaluate(resultFixture);
    const second = evaluator.evaluate({
      ...resultFixture,
      sampleId: 'second-sample',
    });

    expect(first.outcome).toBe('FAILED');
    expect(first.result.decision).toBe('RETRY');
    expect(second.outcome).toBe('PASSED');
    expect(second.result.decision).toBe('ACCEPT');
    expect(Math.random).toHaveBeenCalledTimes(1);
  });

  it('tracks the one-failure limit independently for each motion', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const evaluator = new RandomOnceActionEvaluator();
    const resultFixture = baseResult();

    expect(evaluator.evaluate(resultFixture).outcome).toBe('FAILED');
    expect(
      evaluator.evaluate({
        ...resultFixture,
        motionId: 'motion-002',
      }).outcome,
    ).toBe('FAILED');
    expect(evaluator.evaluate(resultFixture).outcome).toBe('PASSED');
  });

  it('starts a fresh failure history when the lesson is reset', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const evaluator = new RandomOnceActionEvaluator();
    const resultFixture = baseResult();

    expect(evaluator.evaluate(resultFixture).outcome).toBe('FAILED');
    expect(evaluator.evaluate(resultFixture).outcome).toBe('PASSED');

    evaluator.resetSession(resultFixture.sessionId);

    expect(evaluator.evaluate(resultFixture).outcome).toBe('FAILED');
  });
});
