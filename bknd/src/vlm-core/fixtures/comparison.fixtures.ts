import type { VlmComparisonInput } from '../contracts/vision.types';

export function createCorrectComparisonFixture(): VlmComparisonInput {
  return {
    schemaVersion: 'vision-output-v0',
    sessionId: 'fixture-session',
    sampleId: 'fixture-correct',
    actionId: 'dance-001',
    motionId: 'motion-03',
    references: [
      {
        referenceId: 'reference-take-01',
        videoId: 'reference-video-01',
        startMs: 2000,
        peakMs: 2500,
        endMs: 3000,
        frameUrls: ['mock://reference/peak.jpg'],
      },
    ],
    selectedReferenceId: 'reference-take-01',
    practice: {
      videoId: 'practice-video-01',
      startMs: 2200,
      peakMs: 2700,
      endMs: 3200,
      frameUrls: ['mock://practice/peak.jpg'],
    },
    measurements: [],
    quality: {
      alignmentConfidence: 0.95,
      bodyVisibility: 0.97,
      leftHandVisibility: 0.94,
      rightHandVisibility: 0.93,
      visibleBodyParts: [
        'left_shoulder',
        'right_shoulder',
        'left_elbow',
        'right_elbow',
        'left_wrist',
        'right_wrist',
      ],
      occludedBodyParts: [],
      mirrored: false,
    },
    completion: {
      status: 'completed',
      alignedReferenceCoverage: 1,
    },
    context: {
      actionName: '双手交叉展开舞',
      motionName: '双手放至肩膀',
      referenceInstruction: '把双手放到肩膀两侧，手肘自然向外。',
      attemptIndex: 1,
      locale: 'zh-CN',
    },
  };
}

export function createElbowErrorFixture(): VlmComparisonInput {
  const fixture = createCorrectComparisonFixture();
  return {
    ...fixture,
    sampleId: 'fixture-elbow-error',
    measurements: [
      {
        metric: 'right_elbow_angle_deg',
        bodyPart: 'right_elbow',
        referenceValue: 82,
        practiceValue: 125,
        delta: 43,
        tolerance: 15,
        reliability: 0.97,
        unit: 'degree',
      },
    ],
  };
}

export function createWrongHandShapeFixture(): VlmComparisonInput {
  const fixture = createCorrectComparisonFixture();
  return {
    ...fixture,
    sampleId: 'fixture-hand-error',
    measurements: [
      {
        metric: 'right_hand_shape_match',
        bodyPart: 'right_hand',
        referenceValue: 1,
        practiceValue: 0,
        delta: -1,
        reliability: 0.96,
        unit: 'category',
        expectedLabel: '比耶',
        observedLabel: '张手',
      },
    ],
  };
}

export function createLowVisibilityFixture(): VlmComparisonInput {
  const fixture = createCorrectComparisonFixture();
  return {
    ...fixture,
    sampleId: 'fixture-low-visibility',
    quality: {
      ...fixture.quality,
      bodyVisibility: 0.54,
      leftHandVisibility: 0.3,
      rightHandVisibility: 0.28,
      occludedBodyParts: ['left_hand', 'right_hand'],
    },
  };
}

export function createPartialAttemptFixture(): VlmComparisonInput {
  const fixture = createCorrectComparisonFixture();
  return {
    ...fixture,
    sampleId: 'fixture-partial',
    completion: {
      status: 'paused',
      alignedReferenceCoverage: 0.43,
      pauseStartMs: 2850,
    },
  };
}
