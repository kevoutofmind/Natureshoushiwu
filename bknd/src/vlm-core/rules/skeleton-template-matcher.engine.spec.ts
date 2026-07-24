import {
  createRealtimeJudgeFixture,
  createTemplatePackFixture,
} from '../fixtures/realtime.fixtures';
import { SkeletonTemplateMatcherEngine } from './skeleton-template-matcher.engine';

describe('SkeletonTemplateMatcherEngine', () => {
  const engine = new SkeletonTemplateMatcherEngine();
  const pack = createTemplatePackFixture();

  it('accepts a completed observation matching a correct reference', () => {
    const result = engine.evaluate(pack, createRealtimeJudgeFixture('correct'));

    expect(result.decision).toBe('ACCEPT');
    expect(result.shouldAdvance).toBe(true);
    expect(result.metadata.cloudCalled).toBe(false);
    expect(result.scores.overall).toBeGreaterThanOrEqual(0.78);
  });

  it('keeps watching before the semantic motion unit is complete', () => {
    const result = engine.evaluate(
      pack,
      createRealtimeJudgeFixture('correct', 0.5),
    );

    expect(result.decision).toBe('KEEP_WATCHING');
    expect(result.shouldAdvance).toBe(false);
    expect(result.shouldPause).toBe(false);
  });

  it('does not call an unclear observation an action error', () => {
    const result = engine.evaluate(
      pack,
      createRealtimeJudgeFixture('not-visible'),
    );

    expect(result.decision).toBe('NOT_VISIBLE');
    expect(result.reason).toBe('LOW_VISIBILITY');
    expect(result.shouldPause).toBe(false);
  });

  it('treats complete MediaPipe hand landmarks as visible when their visibility field is zero', () => {
    const input = createRealtimeJudgeFixture('correct');
    for (const frame of input.observation.frames) {
      for (const landmark of [
        ...(frame.leftHand ?? []),
        ...(frame.rightHand ?? []),
      ]) {
        landmark.visibility = 0;
      }
    }

    const result = engine.evaluate(pack, input);

    expect(result.decision).toBe('ACCEPT');
    expect(result.scores.visibility).toBeGreaterThanOrEqual(0.99);
  });

  it('retries a completed observation that differs strongly from references', () => {
    const result = engine.evaluate(
      pack,
      createRealtimeJudgeFixture('incorrect'),
    );

    expect(result.decision).toBe('RETRY');
    expect(result.shouldAdvance).toBe(false);
    expect(result.shouldPause).toBe(true);
  });
});
