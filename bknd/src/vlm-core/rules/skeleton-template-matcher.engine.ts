import { Injectable } from '@nestjs/common';
import type {
  MotionReferenceTemplate,
  MotionTemplatePack,
  PracticeSkeletonObservation,
  RealtimeDecisionCode,
  RealtimeDecisionReason,
  RealtimeJudgeInput,
  RealtimeJudgeResult,
  RealtimeScoreBreakdown,
  RequiredSkeletonPart,
  SkeletonFrame,
  SkeletonLandmark,
} from '../contracts/realtime-judge.types';
import {
  TEMPLATE_MATCHER_CONFIG,
  TEMPLATE_MATCHER_VERSION,
} from './template-matcher.config';

interface TemplateScore {
  templateId: string;
  referenceRole?: MotionReferenceTemplate['referenceRole'];
  scores: RealtimeScoreBreakdown;
}

interface NormalizedPoint {
  x: number;
  y: number;
  z: number;
}

const UPPER_BODY_INDICES = [11, 12, 13, 14, 15, 16, 23, 24];
const POSE_MIRROR_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 4],
  [2, 5],
  [3, 6],
  [7, 8],
  [9, 10],
  [11, 12],
  [13, 14],
  [15, 16],
  [17, 18],
  [19, 20],
  [21, 22],
  [23, 24],
  [25, 26],
  [27, 28],
  [29, 30],
  [31, 32],
];

@Injectable()
export class SkeletonTemplateMatcherEngine {
  evaluate(
    pack: MotionTemplatePack,
    input: RealtimeJudgeInput,
  ): RealtimeJudgeResult {
    const startedAt = Date.now();
    const requiredParts = pack.requiredParts ?? [
      'pose',
      'left_hand',
      'right_hand',
    ];
    const visibility = this.requiredVisibility(
      input.observation.frames,
      requiredParts,
    );

    if (!this.hasRequiredVisibility(input.observation.frames, requiredParts)) {
      return this.result(
        pack,
        input,
        'NOT_VISIBLE',
        'LOW_VISIBILITY',
        '请稍微调整距离，让需要识别的上半身和双手完整出现在画面中。',
        false,
        false,
        1,
        { overall: 0, visibility },
        startedAt,
      );
    }

    const scoringProfile = pack.evaluationPolicy?.scoringProfile ?? 'balanced';
    const templateScores = pack.templates.map((template) =>
      this.compareTemplate(
        template,
        input.observation,
        requiredParts,
        scoringProfile,
      ),
    );
    const best = [...templateScores].sort(
      (left, right) => right.scores.overall - left.scores.overall,
    )[0];
    const scores = {
      ...(this.aggregateTemplateScores(pack, templateScores) ?? {
        overall: 0,
        visibility,
      }),
    };
    scores.visibility = visibility;
    const weakestPart =
      scoringProfile === 'hands-position-temporal'
        ? 'trajectory'
        : this.weakestPart(scores, requiredParts);

    const minimumObservationMs =
      pack.evaluationPolicy?.minimumObservationMs ??
      TEMPLATE_MATCHER_CONFIG.minimumObservationMs;
    const minimumCompletionProgress =
      pack.evaluationPolicy?.minimumCompletionProgress ??
      TEMPLATE_MATCHER_CONFIG.minimumCompletionProgress;
    const observationDurationMs = this.duration(input.observation.frames);

    if (
      input.observation.frames.length <
        TEMPLATE_MATCHER_CONFIG.minimumFrameCount ||
      observationDurationMs < minimumObservationMs ||
      input.observation.progress < minimumCompletionProgress
    ) {
      return this.result(
        pack,
        input,
        'KEEP_WATCHING',
        'INSUFFICIENT_OBSERVATION',
        '继续完成这个动作，我正在实时跟随。',
        false,
        false,
        Math.max(scores.overall, visibility),
        scores,
        startedAt,
        best?.templateId,
        weakestPart,
      );
    }

    const acceptThreshold =
      pack.evaluationPolicy?.acceptThreshold ??
      TEMPLATE_MATCHER_CONFIG.acceptThreshold;
    const acceptWithHintThreshold =
      pack.evaluationPolicy?.acceptWithHintThreshold ??
      TEMPLATE_MATCHER_CONFIG.acceptWithHintThreshold;

    if (scores.overall >= acceptThreshold) {
      return this.result(
        pack,
        input,
        'ACCEPT',
        'MATCHED',
        pack.acceptSpeech ?? '很好，这个动作完成了，我们进入下一个动作。',
        true,
        false,
        scores.overall,
        scores,
        startedAt,
        best?.templateId,
        weakestPart,
      );
    }

    if (scores.overall >= acceptWithHintThreshold) {
      return this.result(
        pack,
        input,
        'ACCEPT_HINT',
        'CLOSE_ENOUGH',
        pack.hintSpeech ?? this.gentleHint(weakestPart),
        true,
        false,
        scores.overall,
        scores,
        startedAt,
        best?.templateId,
        weakestPart,
      );
    }

    return this.result(
      pack,
      input,
      'RETRY',
      'BELOW_THRESHOLD',
      pack.retrySpeech ?? this.retryHint(weakestPart),
      false,
      true,
      1 - scores.overall,
      scores,
      startedAt,
      best?.templateId,
      weakestPart,
    );
  }

  private compareTemplate(
    template: MotionReferenceTemplate,
    observation: PracticeSkeletonObservation,
    requiredParts: RequiredSkeletonPart[],
    scoringProfile: 'balanced' | 'hands-position-temporal',
  ): TemplateScore {
    const practiceFrames =
      template.mirrored === observation.mirrored
        ? observation.frames
        : observation.frames.map((frame) => this.mirrorFrame(frame));
    const referenceEnd = Math.max(
      2,
      Math.min(
        template.frames.length,
        Math.round(
          template.frames.length * Math.max(0.1, observation.progress),
        ),
      ),
    );
    const referenceFrames = template.frames.slice(0, referenceEnd);
    const sampleCount = Math.max(
      2,
      Math.min(
        TEMPLATE_MATCHER_CONFIG.comparisonFrameCount,
        practiceFrames.length,
        referenceFrames.length,
      ),
    );
    const sampledPractice = this.sampleFrames(practiceFrames, sampleCount);
    const sampledReference = this.sampleFrames(referenceFrames, sampleCount);

    const handsPositionOnly = scoringProfile === 'hands-position-temporal';
    const pose = handsPositionOnly
      ? undefined
      : this.sequenceSimilarity(
          sampledReference,
          sampledPractice,
          (frame) => this.normalizedPose(frame),
          TEMPLATE_MATCHER_CONFIG.poseDistanceScale,
        );
    const leftHand = this.sequenceSimilarity(
      sampledReference,
      sampledPractice,
      (frame) => this.normalizedHand(frame.leftHand),
      TEMPLATE_MATCHER_CONFIG.handDistanceScale,
    );
    const rightHand = this.sequenceSimilarity(
      sampledReference,
      sampledPractice,
      (frame) => this.normalizedHand(frame.rightHand),
      TEMPLATE_MATCHER_CONFIG.handDistanceScale,
    );
    const trajectory = handsPositionOnly
      ? this.handPositionTimelineSimilarity(sampledReference, sampledPractice)
      : this.trajectorySimilarity(sampledReference, sampledPractice);
    const visibility = this.requiredVisibility(practiceFrames, requiredParts);
    const components: Array<[number | undefined, number]> = handsPositionOnly
      ? [[trajectory ?? 0, 1]]
      : [
          [pose, 0.5],
          [leftHand, requiredParts.includes('left_hand') ? 0.2 : 0.1],
          [rightHand, requiredParts.includes('right_hand') ? 0.2 : 0.1],
          [trajectory, 0.1],
        ];
    const available = components.filter(
      (component): component is [number, number] =>
        component[0] !== undefined && Number.isFinite(component[0]),
    );
    const weight = available.reduce((sum, component) => sum + component[1], 0);
    const overall =
      weight === 0
        ? 0
        : available.reduce(
            (sum, component) => sum + component[0] * component[1],
            0,
          ) / weight;

    return {
      templateId: template.templateId,
      referenceRole: template.referenceRole,
      scores: {
        overall: this.round(overall),
        pose: this.optionalRound(pose),
        leftHand: this.optionalRound(leftHand),
        rightHand: this.optionalRound(rightHand),
        trajectory: this.optionalRound(trajectory),
        visibility: this.round(visibility),
      },
    };
  }

  /**
   * The example shown in the UI remains the scoring anchor. The other nine
   * same-class performers can rescue natural body-shape/style differences,
   * but cannot outvote a badly timed or structurally different primary match.
   *
   * Packs created before referenceRole was introduced keep the original
   * best-template behavior for backward compatibility.
   */
  private aggregateTemplateScores(
    pack: MotionTemplatePack,
    templateScores: TemplateScore[],
  ): RealtimeScoreBreakdown | undefined {
    const primary = templateScores
      .filter((score) => score.referenceRole === 'primary')
      .sort((left, right) => right.scores.overall - left.scores.overall)[0];
    if (!primary) {
      return [...templateScores].sort(
        (left, right) => right.scores.overall - left.scores.overall,
      )[0]?.scores;
    }

    const count = Math.max(
      1,
      Math.round(
        pack.evaluationPolicy?.generalizationTemplateCount ??
          TEMPLATE_MATCHER_CONFIG.generalizationTemplateCount,
      ),
    );
    const generalization = templateScores
      .filter((score) => score.referenceRole !== 'primary')
      .sort((left, right) => right.scores.overall - left.scores.overall)
      .slice(0, count);
    if (generalization.length === 0) {
      return primary.scores;
    }

    const primaryWeight = Math.min(
      1,
      Math.max(
        0,
        pack.evaluationPolicy?.primaryTemplateWeight ??
          TEMPLATE_MATCHER_CONFIG.primaryTemplateWeight,
      ),
    );
    const generalizationScores = this.averageScoreBreakdowns(
      generalization.map((score) => score.scores),
    );
    return this.blendScoreBreakdowns(
      primary.scores,
      generalizationScores,
      primaryWeight,
    );
  }

  private averageScoreBreakdowns(
    scores: RealtimeScoreBreakdown[],
  ): RealtimeScoreBreakdown {
    return {
      overall: this.round(this.average(scores.map((score) => score.overall))),
      pose: this.averageOptional(scores.map((score) => score.pose)),
      leftHand: this.averageOptional(scores.map((score) => score.leftHand)),
      rightHand: this.averageOptional(scores.map((score) => score.rightHand)),
      trajectory: this.averageOptional(scores.map((score) => score.trajectory)),
      visibility: this.round(
        this.average(scores.map((score) => score.visibility)),
      ),
    };
  }

  private blendScoreBreakdowns(
    primary: RealtimeScoreBreakdown,
    generalization: RealtimeScoreBreakdown,
    primaryWeight: number,
  ): RealtimeScoreBreakdown {
    return {
      overall: this.round(
        primary.overall * primaryWeight +
          generalization.overall * (1 - primaryWeight),
      ),
      pose: this.blendOptional(
        primary.pose,
        generalization.pose,
        primaryWeight,
      ),
      leftHand: this.blendOptional(
        primary.leftHand,
        generalization.leftHand,
        primaryWeight,
      ),
      rightHand: this.blendOptional(
        primary.rightHand,
        generalization.rightHand,
        primaryWeight,
      ),
      trajectory: this.blendOptional(
        primary.trajectory,
        generalization.trajectory,
        primaryWeight,
      ),
      visibility: this.round(
        primary.visibility * primaryWeight +
          generalization.visibility * (1 - primaryWeight),
      ),
    };
  }

  private averageOptional(values: Array<number | undefined>) {
    const available = values.filter(
      (value): value is number => value !== undefined,
    );
    return available.length === 0
      ? undefined
      : this.round(this.average(available));
  }

  private blendOptional(
    primary: number | undefined,
    generalization: number | undefined,
    primaryWeight: number,
  ): number | undefined {
    if (primary === undefined) return this.optionalRound(generalization);
    if (generalization === undefined) return this.optionalRound(primary);
    return this.round(
      primary * primaryWeight + generalization * (1 - primaryWeight),
    );
  }

  private sequenceSimilarity(
    referenceFrames: SkeletonFrame[],
    practiceFrames: SkeletonFrame[],
    normalize: (frame: SkeletonFrame) => NormalizedPoint[] | undefined,
    distanceScale: number,
  ): number | undefined {
    const reference = referenceFrames
      .map(normalize)
      .filter((points): points is NormalizedPoint[] => Boolean(points));
    const practice = practiceFrames
      .map(normalize)
      .filter((points): points is NormalizedPoint[] => Boolean(points));
    if (reference.length === 0 || practice.length === 0) {
      return undefined;
    }

    // Different people rarely perform the same unit at exactly the same
    // speed. Dynamic time warping aligns nearby phases while preserving the
    // ordered motion, avoiding false retries caused only by tempo variation.
    const rows = reference.length + 1;
    const columns = practice.length + 1;
    const costs = Array.from({ length: rows }, () =>
      Array<number>(columns).fill(Number.POSITIVE_INFINITY),
    );
    const lengths = Array.from({ length: rows }, () =>
      Array<number>(columns).fill(0),
    );
    costs[0][0] = 0;

    for (let row = 1; row < rows; row += 1) {
      for (let column = 1; column < columns; column += 1) {
        const predecessors = [
          [costs[row - 1][column], lengths[row - 1][column]],
          [costs[row][column - 1], lengths[row][column - 1]],
          [costs[row - 1][column - 1], lengths[row - 1][column - 1]],
        ].sort((left, right) => left[0] - right[0]);
        costs[row][column] =
          predecessors[0][0] +
          this.pointSetDistance(reference[row - 1], practice[column - 1]);
        lengths[row][column] = predecessors[0][1] + 1;
      }
    }

    const pathLength = lengths[rows - 1][columns - 1];
    if (pathLength === 0) return undefined;
    const averageDistance = costs[rows - 1][columns - 1] / pathLength;
    return Math.exp(-averageDistance / distanceScale);
  }

  private trajectorySimilarity(
    referenceFrames: SkeletonFrame[],
    practiceFrames: SkeletonFrame[],
  ): number | undefined {
    const reference = this.wristTrajectory(referenceFrames);
    const practice = this.wristTrajectory(practiceFrames);
    if (!reference || !practice) {
      return undefined;
    }
    const distance = this.pointSetDistance(reference, practice);
    return Math.exp(
      -distance / TEMPLATE_MATCHER_CONFIG.trajectoryDistanceScale,
    );
  }

  /**
   * Index-aligned rather than DTW-aligned: a correct hand position at the
   * wrong moment receives a real penalty. Coordinates are body-relative so
   * different camera crops and performer proportions remain comparable.
   */
  private handPositionTimelineSimilarity(
    referenceFrames: SkeletonFrame[],
    practiceFrames: SkeletonFrame[],
  ): number | undefined {
    const frameCount = Math.min(referenceFrames.length, practiceFrames.length);
    let distanceSum = 0;
    let comparisonCount = 0;
    for (let index = 0; index < frameCount; index += 1) {
      const reference = this.normalizedHandAnchors(referenceFrames[index]);
      const practice = this.normalizedHandAnchors(practiceFrames[index]);
      if (!reference || !practice) continue;
      for (let handIndex = 0; handIndex < 2; handIndex += 1) {
        const expected = reference[handIndex];
        const observed = practice[handIndex];
        if (expected && observed) {
          distanceSum += this.distance(expected, observed);
          comparisonCount += 1;
        } else if (expected || observed) {
          distanceSum += 1.25;
          comparisonCount += 1;
        }
      }
    }
    if (comparisonCount < Math.max(2, Math.floor(frameCount * 0.5))) {
      return undefined;
    }
    return Math.exp(
      -(distanceSum / comparisonCount) /
        TEMPLATE_MATCHER_CONFIG.handPositionDistanceScale,
    );
  }

  private normalizedHandAnchors(
    frame: SkeletonFrame,
  ): [NormalizedPoint | undefined, NormalizedPoint | undefined] | undefined {
    const leftShoulder = frame.pose[11];
    const rightShoulder = frame.pose[12];
    if (!leftShoulder || !rightShoulder) return undefined;
    const scale = this.distance(leftShoulder, rightShoulder);
    if (scale < 0.01) return undefined;
    const center = {
      x: (leftShoulder.x + rightShoulder.x) / 2,
      y: (leftShoulder.y + rightShoulder.y) / 2,
      z: ((leftShoulder.z ?? 0) + (rightShoulder.z ?? 0)) / 2,
    };
    const normalize = (
      point: SkeletonLandmark | undefined,
    ): NormalizedPoint | undefined =>
      point
        ? {
            x: (point.x - center.x) / scale,
            y: (point.y - center.y) / scale,
            z: ((point.z ?? 0) - center.z) / scale,
          }
        : undefined;
    return [normalize(frame.leftHand?.[0]), normalize(frame.rightHand?.[0])];
  }

  private wristTrajectory(
    frames: SkeletonFrame[],
  ): NormalizedPoint[] | undefined {
    const poses = frames
      .map((frame) => this.normalizedPose(frame))
      .filter((pose): pose is NormalizedPoint[] => Boolean(pose));
    if (poses.length < 2) {
      return undefined;
    }
    const first = poses[0];
    return poses.flatMap((pose) => [
      this.subtract(pose[4], first[4]),
      this.subtract(pose[5], first[5]),
    ]);
  }

  private normalizedPose(frame: SkeletonFrame): NormalizedPoint[] | undefined {
    const leftShoulder = frame.pose[11];
    const rightShoulder = frame.pose[12];
    if (!leftShoulder || !rightShoulder) {
      return undefined;
    }
    const scale = this.distance(leftShoulder, rightShoulder);
    if (scale < 0.01) {
      return undefined;
    }
    const center = {
      x: (leftShoulder.x + rightShoulder.x) / 2,
      y: (leftShoulder.y + rightShoulder.y) / 2,
      z: ((leftShoulder.z ?? 0) + (rightShoulder.z ?? 0)) / 2,
    };

    return UPPER_BODY_INDICES.map((index) => {
      const point = frame.pose[index] ?? center;
      return {
        x: (point.x - center.x) / scale,
        y: (point.y - center.y) / scale,
        z: ((point.z ?? 0) - center.z) / scale,
      };
    });
  }

  private normalizedHand(
    landmarks: SkeletonLandmark[] | undefined,
  ): NormalizedPoint[] | undefined {
    if (!landmarks || landmarks.length < 21) {
      return undefined;
    }
    const wrist = landmarks[0];
    const middleMcp = landmarks[9];
    const scale = this.distance(wrist, middleMcp);
    if (scale < 0.005) {
      return undefined;
    }
    return landmarks.slice(0, 21).map((point) => ({
      x: (point.x - wrist.x) / scale,
      y: (point.y - wrist.y) / scale,
      z: ((point.z ?? 0) - (wrist.z ?? 0)) / scale,
    }));
  }

  private requiredVisibility(
    frames: SkeletonFrame[],
    requiredParts: RequiredSkeletonPart[],
  ): number {
    const values = requiredParts.map((part) =>
      this.partVisibility(frames, part),
    );
    return values.length === 0 ? 1 : Math.min(...values);
  }

  private hasRequiredVisibility(
    frames: SkeletonFrame[],
    requiredParts: RequiredSkeletonPart[],
  ): boolean {
    return requiredParts.every((part) => {
      const visibility = this.partVisibility(frames, part);
      return part === 'pose'
        ? visibility >= TEMPLATE_MATCHER_CONFIG.minimumPoseVisibility
        : visibility >= TEMPLATE_MATCHER_CONFIG.minimumHandVisibility;
    });
  }

  private partVisibility(
    frames: SkeletonFrame[],
    part: RequiredSkeletonPart,
  ): number {
    if (frames.length === 0) {
      return 0;
    }
    const frameValues = frames.map((frame) => {
      const landmarks =
        part === 'pose'
          ? UPPER_BODY_INDICES.map((index) => frame.pose[index]).filter(
              (landmark): landmark is SkeletonLandmark => Boolean(landmark),
            )
          : part === 'left_hand'
            ? frame.leftHand
            : frame.rightHand;
      if (!landmarks || landmarks.length === 0) {
        return 0;
      }
      // MediaPipe Hand landmarks expose `visibility: 0` even when the hand was
      // successfully detected. Unlike Pose, Hand has no meaningful per-point
      // visibility score; the presence of all 21 landmarks is the signal.
      if (part !== 'pose') {
        return landmarks.length >= 21 ? 1 : landmarks.length / 21;
      }
      const visible = landmarks.filter(
        (landmark) =>
          (landmark.visibility ?? 1) >=
          TEMPLATE_MATCHER_CONFIG.landmarkVisibilityThreshold,
      ).length;
      return visible / landmarks.length;
    });
    return this.average(frameValues);
  }

  private sampleFrames(
    frames: SkeletonFrame[],
    count: number,
  ): SkeletonFrame[] {
    if (frames.length === count) {
      return frames;
    }
    return Array.from({ length: count }, (_, index) => {
      const position =
        count === 1 ? 0 : (index * (frames.length - 1)) / (count - 1);
      return frames[Math.round(position)];
    });
  }

  private mirrorFrame(frame: SkeletonFrame): SkeletonFrame {
    const mirroredPose = frame.pose.map((point) => this.flipPoint(point));
    for (const [left, right] of POSE_MIRROR_PAIRS) {
      if (mirroredPose[left] && mirroredPose[right]) {
        const temporary = mirroredPose[left];
        mirroredPose[left] = mirroredPose[right];
        mirroredPose[right] = temporary;
      }
    }

    return {
      timestampMs: frame.timestampMs,
      pose: mirroredPose,
      leftHand: frame.rightHand?.map((point) => this.flipPoint(point)),
      rightHand: frame.leftHand?.map((point) => this.flipPoint(point)),
    };
  }

  private flipPoint(point: SkeletonLandmark): SkeletonLandmark {
    return { ...point, x: 1 - point.x };
  }

  private pointSetDistance(
    left: NormalizedPoint[],
    right: NormalizedPoint[],
  ): number {
    const count = Math.min(left.length, right.length);
    if (count === 0) {
      return Number.POSITIVE_INFINITY;
    }
    let total = 0;
    for (let index = 0; index < count; index += 1) {
      total += this.distance(left[index], right[index]);
    }
    return total / count;
  }

  private distance(
    left: Pick<SkeletonLandmark, 'x' | 'y' | 'z'>,
    right: Pick<SkeletonLandmark, 'x' | 'y' | 'z'>,
  ): number {
    return Math.sqrt(
      (left.x - right.x) ** 2 +
        (left.y - right.y) ** 2 +
        ((left.z ?? 0) - (right.z ?? 0)) ** 2,
    );
  }

  private subtract(
    left: NormalizedPoint,
    right: NormalizedPoint,
  ): NormalizedPoint {
    return {
      x: left.x - right.x,
      y: left.y - right.y,
      z: left.z - right.z,
    };
  }

  private weakestPart(
    scores: RealtimeScoreBreakdown,
    requiredParts: RequiredSkeletonPart[],
  ): RequiredSkeletonPart | 'trajectory' | undefined {
    const candidates: Array<
      [RequiredSkeletonPart | 'trajectory', number | undefined]
    > = [
      ['pose', scores.pose],
      ['left_hand', scores.leftHand],
      ['right_hand', scores.rightHand],
      ['trajectory', scores.trajectory],
    ];
    return candidates
      .filter(
        (
          candidate,
        ): candidate is [RequiredSkeletonPart | 'trajectory', number] =>
          candidate[1] !== undefined &&
          (candidate[0] === 'trajectory' ||
            requiredParts.includes(candidate[0])),
      )
      .sort((left, right) => left[1] - right[1])[0]?.[0];
  }

  private gentleHint(
    part: RequiredSkeletonPart | 'trajectory' | undefined,
  ): string {
    const hints: Record<RequiredSkeletonPart | 'trajectory', string> = {
      pose: '动作基本完成，上半身位置再贴近示范一点，我们继续。',
      left_hand: '动作基本完成，下一步注意左手手型，我们继续。',
      right_hand: '动作基本完成，下一步注意右手手型，我们继续。',
      trajectory: '动作基本完成，下一步让移动路线更连贯一些。',
    };
    return part ? hints[part] : '动作基本完成，保持这个感觉，我们继续。';
  }

  private retryHint(
    part: RequiredSkeletonPart | 'trajectory' | undefined,
  ): string {
    const hints: Record<RequiredSkeletonPart | 'trajectory', string> = {
      pose: '先对齐肩膀、手肘和手腕的位置，我们放慢再做一次。',
      left_hand: '左手和示范差异较大，先看清左手手型，再做一次。',
      right_hand: '右手和示范差异较大，先看清右手手型，再做一次。',
      trajectory: '动作路线还没有完整完成，跟着慢速示范再做一次。',
    };
    return part ? hints[part] : '这个动作还没有完整对齐，我们放慢再做一次。';
  }

  private duration(frames: SkeletonFrame[]): number {
    return frames.length < 2
      ? 0
      : frames[frames.length - 1].timestampMs - frames[0].timestampMs;
  }

  private average(values: number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private round(value: number): number {
    return Number(Math.min(1, Math.max(0, value)).toFixed(3));
  }

  private optionalRound(value: number | undefined): number | undefined {
    return value === undefined ? undefined : this.round(value);
  }

  private result(
    pack: MotionTemplatePack,
    input: RealtimeJudgeInput,
    decision: RealtimeDecisionCode,
    reason: RealtimeDecisionReason,
    speech: string,
    shouldAdvance: boolean,
    shouldPause: boolean,
    confidence: number,
    scores: RealtimeScoreBreakdown,
    startedAt: number,
    bestTemplateId?: string,
    weakestPart?: RequiredSkeletonPart | 'trajectory',
  ): RealtimeJudgeResult {
    return {
      schemaVersion: 'realtime-decision-v1',
      sessionId: input.sessionId,
      sampleId: input.sampleId,
      danceId: input.danceId,
      motionId: input.motionId,
      decision,
      reason,
      speech,
      shouldAdvance,
      shouldPause,
      confidence: this.round(confidence),
      bestTemplateId,
      weakestPart,
      scores,
      metadata: {
        engine: 'local-skeleton-template',
        engineVersion: TEMPLATE_MATCHER_VERSION,
        referenceCount: pack.templates.length,
        latencyMs: Date.now() - startedAt,
        cloudCalled: false,
      },
    };
  }
}
