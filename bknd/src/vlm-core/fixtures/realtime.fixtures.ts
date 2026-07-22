import type {
  MotionTemplatePack,
  RealtimeJudgeInput,
  SkeletonFrame,
  SkeletonLandmark,
} from '../contracts/realtime-judge.types';

export function createTemplatePackFixture(): MotionTemplatePack {
  return {
    schemaVersion: 'motion-template-pack-v1',
    danceId: 'dance-001',
    motionId: 'motion-001',
    motionName: '双手从肩膀向外打开',
    instruction: '双手放在肩膀附近，然后平滑向外打开。',
    expectedDurationMs: 3000,
    requiredParts: ['pose', 'left_hand', 'right_hand'],
    templates: [
      {
        templateId: 'reference-person-a',
        sourceVideoId: 'reference-video-a',
        mirrored: false,
        frames: createSequence('correct'),
      },
      {
        templateId: 'reference-person-b',
        sourceVideoId: 'reference-video-b',
        mirrored: false,
        frames: createSequence('correct', 0.015),
      },
    ],
  };
}

export function createRealtimeJudgeFixture(
  variant: 'correct' | 'incorrect' | 'not-visible' = 'correct',
  progress = 1,
): RealtimeJudgeInput {
  return {
    schemaVersion: 'realtime-judge-v1',
    sessionId: 'session-001',
    sampleId: `sample-${variant}`,
    danceId: 'dance-001',
    motionId: 'motion-001',
    attemptIndex: 1,
    observation: {
      mirrored: false,
      progress,
      frames: createSequence(variant),
    },
  };
}

function createSequence(
  variant: 'correct' | 'incorrect' | 'not-visible',
  offset = 0,
): SkeletonFrame[] {
  return Array.from({ length: 10 }, (_, index) =>
    createFrame(index * 100, index / 9, variant, offset),
  );
}

function createFrame(
  timestampMs: number,
  progress: number,
  variant: 'correct' | 'incorrect' | 'not-visible',
  offset: number,
): SkeletonFrame {
  const visibility = variant === 'not-visible' ? 0.05 : 0.99;
  const pose = Array.from({ length: 33 }, () => point(0.5, 0.5, visibility));
  pose[11] = point(0.4 + offset, 0.35, visibility);
  pose[12] = point(0.6 + offset, 0.35, visibility);
  pose[13] = point(0.35 + offset, 0.5, visibility);
  pose[14] = point(0.65 + offset, 0.5, visibility);
  pose[15] = point(0.34 - progress * 0.16 + offset, 0.42, visibility);
  pose[16] = point(0.66 + progress * 0.16 + offset, 0.42, visibility);
  pose[23] = point(0.45 + offset, 0.75, visibility);
  pose[24] = point(0.55 + offset, 0.75, visibility);

  if (variant === 'incorrect') {
    pose[13] = point(0.58, 0.3, visibility);
    pose[14] = point(0.42, 0.3, visibility);
    pose[15] = point(0.62, 0.15, visibility);
    pose[16] = point(0.38, 0.15, visibility);
  }

  return {
    timestampMs,
    pose,
    leftHand: createHand(0.2, 0.42, visibility, variant === 'incorrect'),
    rightHand: createHand(0.8, 0.42, visibility, variant === 'incorrect'),
  };
}

function createHand(
  wristX: number,
  wristY: number,
  visibility: number,
  incorrect: boolean,
): SkeletonLandmark[] {
  return Array.from({ length: 21 }, (_, index) => {
    if (index === 0) {
      return point(wristX, wristY, visibility);
    }
    const finger = Math.floor((index - 1) / 4);
    const joint = ((index - 1) % 4) + 1;
    if (incorrect) {
      const angle = (index / 21) * Math.PI * 2;
      return point(
        wristX + Math.cos(angle) * 0.025,
        wristY + Math.sin(angle) * 0.025,
        visibility,
      );
    }
    return point(
      wristX + (finger - 2) * 0.012,
      wristY - joint * 0.018,
      visibility,
    );
  });
}

function point(x: number, y: number, visibility: number): SkeletonLandmark {
  return { x, y, z: 0, visibility };
}
