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

  it('gives the web-visible primary example more influence than generalization templates', () => {
    const correctObservation = createRealtimeJudgeFixture('correct');
    const incorrectFrames =
      createRealtimeJudgeFixture('incorrect').observation.frames;
    const primaryHeavy = createTemplatePackFixture();
    primaryHeavy.templates[0].referenceRole = 'primary';
    primaryHeavy.templates[1].referenceRole = 'generalization';
    primaryHeavy.templates[1].frames = incorrectFrames;
    primaryHeavy.evaluationPolicy = {
      ...primaryHeavy.evaluationPolicy,
      primaryTemplateWeight: 0.8,
      generalizationTemplateCount: 1,
    };
    const datasetHeavy = structuredClone(primaryHeavy);
    if (datasetHeavy.evaluationPolicy) {
      datasetHeavy.evaluationPolicy.primaryTemplateWeight = 0.2;
    }

    const primaryResult = engine.evaluate(primaryHeavy, correctObservation);
    const datasetResult = engine.evaluate(datasetHeavy, correctObservation);

    expect(primaryResult.bestTemplateId).toBe('reference-person-a');
    expect(primaryResult.scores.overall).toBeGreaterThan(
      datasetResult.scores.overall,
    );
  });

  it('uses a matching same-class performer as support without letting it replace a mismatched primary', () => {
    const weightedPack = createTemplatePackFixture();
    weightedPack.templates[0].referenceRole = 'primary';
    weightedPack.templates[0].frames =
      createRealtimeJudgeFixture('incorrect').observation.frames;
    weightedPack.templates[1].referenceRole = 'generalization';
    weightedPack.evaluationPolicy = {
      ...weightedPack.evaluationPolicy,
      primaryTemplateWeight: 0.7,
      generalizationTemplateCount: 1,
    };

    const result = engine.evaluate(
      weightedPack,
      createRealtimeJudgeFixture('correct'),
    );

    expect(result.bestTemplateId).toBe('reference-person-b');
    expect(result.scores.overall).toBeLessThan(0.9);
  });

  it('ignores body pose changes in the fade hand-position profile', () => {
    const handsOnlyPack = createTemplatePackFixture();
    handsOnlyPack.templates = [handsOnlyPack.templates[0]];
    handsOnlyPack.templates[0].referenceRole = 'primary';
    handsOnlyPack.requiredParts = ['left_hand', 'right_hand'];
    handsOnlyPack.evaluationPolicy = {
      ...handsOnlyPack.evaluationPolicy,
      scoringProfile: 'hands-position-temporal',
    };
    const input = createRealtimeJudgeFixture('correct');
    for (const frame of input.observation.frames) {
      frame.pose.forEach((landmark, index) => {
        if (index === 11 || index === 12) return;
        landmark.x += 0.2;
        landmark.y -= 0.15;
      });
    }

    const result = engine.evaluate(handsOnlyPack, input);

    expect(result.decision).toBe('ACCEPT');
    expect(result.scores.pose).toBeUndefined();
    expect(result.scores.overall).toBeGreaterThanOrEqual(0.9);
  });

  it('penalizes correct hand positions performed at the wrong time', () => {
    const handsOnlyPack = createTemplatePackFixture();
    handsOnlyPack.templates = [handsOnlyPack.templates[0]];
    handsOnlyPack.templates[0].referenceRole = 'primary';
    handsOnlyPack.requiredParts = ['left_hand', 'right_hand'];
    handsOnlyPack.evaluationPolicy = {
      ...handsOnlyPack.evaluationPolicy,
      scoringProfile: 'hands-position-temporal',
    };
    const input = createRealtimeJudgeFixture('correct');
    handsOnlyPack.templates[0].frames.forEach((frame, index, frames) => {
      const offset = (index / (frames.length - 1)) * 0.25;
      for (const point of [
        ...(frame.leftHand ?? []),
        ...(frame.rightHand ?? []),
      ]) {
        point.x += offset;
      }
    });
    input.observation.frames.forEach((frame, index, frames) => {
      const offset = (1 - index / (frames.length - 1)) * 0.25;
      for (const point of [
        ...(frame.leftHand ?? []),
        ...(frame.rightHand ?? []),
      ]) {
        point.x += offset;
      }
    });

    const result = engine.evaluate(handsOnlyPack, input);

    expect(result.scores.trajectory).toBeLessThan(0.7);
    expect(result.decision).not.toBe('ACCEPT');
  });
});
