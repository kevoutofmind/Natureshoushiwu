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

  it('accepts an approximate action when the movement appears in its time window', () => {
    const input = createRealtimeJudgeFixture('correct');
    const firstLeftWrist = input.observation.frames[0].pose[15];
    const firstRightWrist = input.observation.frames[0].pose[16];
    for (const frame of input.observation.frames) {
      frame.pose[15] = {
        ...frame.pose[15],
        x: firstLeftWrist.x + (frame.pose[15].x - firstLeftWrist.x) * 0.6,
      };
      frame.pose[16] = {
        ...frame.pose[16],
        x: firstRightWrist.x + (frame.pose[16].x - firstRightWrist.x) * 0.6,
      };
    }

    const result = engine.evaluate(pack, input);

    expect(result.decision).toBe('ACCEPT');
    expect(result.scores.actionCoverage).toBe(1);
  });

  it('rejects a stage when the expected movement never happens', () => {
    const input = createRealtimeJudgeFixture('correct');
    const restingPose = input.observation.frames[0].pose.map((point) => ({
      ...point,
    }));
    for (const frame of input.observation.frames) {
      frame.pose = restingPose.map((point) => ({ ...point }));
    }

    const result = engine.evaluate(pack, input);

    expect(result.decision).toBe('RETRY');
    expect(result.reason).toBe('ACTION_NOT_OBSERVED');
    expect(result.scores.actionCoverage).toBe(0);
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

  it('keeps body-led matches high when only hand shapes differ', () => {
    const input = createRealtimeJudgeFixture('correct');
    for (const frame of input.observation.frames) {
      frame.leftHand = distortHand(frame.leftHand);
      frame.rightHand = distortHand(frame.rightHand);
    }

    const result = engine.evaluate(pack, input);

    expect(result.decision).toBe('ACCEPT');
    expect(result.scores.overall).toBeGreaterThanOrEqual(0.78);
    expect(result.scores.pose ?? 0).toBeGreaterThan(
      result.scores.leftHand ?? 1,
    );
  });

  it('stays stable when isolated pose landmarks jitter slightly', () => {
    const baseline = engine.evaluate(
      pack,
      createRealtimeJudgeFixture('correct'),
    );
    const input = createRealtimeJudgeFixture('correct');
    for (const [index, frame] of input.observation.frames.entries()) {
      frame.pose[13] = {
        ...frame.pose[13],
        x: frame.pose[13].x + (index % 2 === 0 ? 0.025 : -0.025),
        y: frame.pose[13].y + (index % 3 === 0 ? 0.02 : -0.01),
      };
    }

    const result = engine.evaluate(pack, input);

    expect(result.decision).toBe('ACCEPT');
    expect(result.scores.pose ?? 0).toBeGreaterThanOrEqual(
      (baseline.scores.pose ?? 0) - 0.05,
    );
  });

  it('penalizes coarse body placement mismatches', () => {
    const baseline = engine.evaluate(
      pack,
      createRealtimeJudgeFixture('correct'),
    );
    const input = createRealtimeJudgeFixture('correct');
    for (const frame of input.observation.frames) {
      frame.pose = frame.pose.map((landmark) => ({
        ...landmark,
        x: landmark.x + 0.3,
        y: landmark.y + 0.15,
      }));
      frame.leftHand = frame.leftHand?.map((landmark) => ({
        ...landmark,
        x: landmark.x + 0.3,
        y: landmark.y + 0.15,
      }));
      frame.rightHand = frame.rightHand?.map((landmark) => ({
        ...landmark,
        x: landmark.x + 0.3,
        y: landmark.y + 0.15,
      }));
    }

    const result = engine.evaluate(pack, input);

    expect(result.scores.pose ?? 1).toBeLessThan(
      (baseline.scores.pose ?? 0) - 0.15,
    );
    expect(result.scores.overall).toBeLessThan(baseline.scores.overall - 0.08);
  });

  it('penalizes bilateral hand-height mismatches as an overall pose error', () => {
    const baseline = engine.evaluate(
      pack,
      createRealtimeJudgeFixture('correct'),
    );
    const input = createRealtimeJudgeFixture('correct');
    for (const frame of input.observation.frames) {
      frame.pose[15] = {
        ...frame.pose[15],
        y: frame.pose[15].y - 0.25,
      };
      frame.pose[16] = {
        ...frame.pose[16],
        y: frame.pose[16].y - 0.25,
      };
      frame.leftHand = frame.leftHand?.map((landmark) => ({
        ...landmark,
        y: landmark.y - 0.25,
      }));
      frame.rightHand = frame.rightHand?.map((landmark) => ({
        ...landmark,
        y: landmark.y - 0.25,
      }));
    }

    const result = engine.evaluate(pack, input);

    expect(result.scores.pose ?? 1).toBeLessThan(
      (baseline.scores.pose ?? 0) - 0.25,
    );
    expect(result.scores.overall).toBeLessThan(baseline.scores.overall - 0.1);
  });

  it('uses the face-to-hand relationship in the overall pose score', () => {
    const baseline = engine.evaluate(
      pack,
      createRealtimeJudgeFixture('correct'),
    );
    const input = createRealtimeJudgeFixture('correct');
    for (const frame of input.observation.frames) {
      for (const index of [0, 7, 8]) {
        frame.pose[index] = {
          ...frame.pose[index],
          x: frame.pose[index].x + 0.2,
          y: frame.pose[index].y + 0.15,
        };
      }
    }

    const result = engine.evaluate(pack, input);

    expect(result.scores.pose ?? 1).toBeLessThan(
      (baseline.scores.pose ?? 0) - 0.15,
    );
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

  it('scores annotated keyframe trajectories and separates an incorrect path', () => {
    const keyframePack = {
      ...pack,
      keyframes: [
        {
          keyframeId: 'open-start',
          label: '双手开始展开',
          progress: 0.3,
          windowProgress: 0.15,
          requiredParts: ['pose', 'left_hand', 'right_hand'] as const,
        },
        {
          keyframeId: 'open-finish',
          label: '双手展开结束',
          progress: 0.7,
          windowProgress: 0.15,
          requiredParts: ['pose', 'left_hand', 'right_hand'] as const,
        },
      ],
      evaluationPolicy: {
        ...pack.evaluationPolicy,
        keyframeTrajectoryWeight: 0.5,
      },
    };

    const correct = engine.evaluate(
      keyframePack,
      createRealtimeJudgeFixture('correct'),
    );
    const incorrect = engine.evaluate(
      keyframePack,
      createRealtimeJudgeFixture('incorrect'),
    );

    expect(correct.scores.keyframeTrajectory).toBeDefined();
    expect(incorrect.scores.keyframeTrajectory).toBeDefined();
    expect(correct.scores.keyframeTrajectory).toBeGreaterThan(
      incorrect.scores.keyframeTrajectory ?? 1,
    );
  });
});

function distortHand<T extends { x: number; y: number }>(
  landmarks: T[] | undefined,
): T[] | undefined {
  return landmarks?.map((landmark, index) =>
    index === 0
      ? landmark
      : {
          ...landmark,
          x: landmark.x + Math.cos(index) * 0.08,
          y: landmark.y + Math.sin(index) * 0.08,
        },
  );
}
