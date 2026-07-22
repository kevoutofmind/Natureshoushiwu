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

    const templateScores = pack.templates.map((template) =>
      this.compareTemplate(template, input.observation, requiredParts),
    );
    const best = templateScores.sort(
      (left, right) => right.scores.overall - left.scores.overall,
    )[0];
    const scores = best?.scores ?? { overall: 0, visibility };
    scores.visibility = visibility;
    const weakestPart = this.weakestPart(scores, requiredParts);

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

    const pose = this.sequenceSimilarity(
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
    const trajectory = this.trajectorySimilarity(
      sampledReference,
      sampledPractice,
    );
    const visibility = this.requiredVisibility(practiceFrames, requiredParts);
    const components: Array<[number | undefined, number]> = [
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

  private sequenceSimilarity(
    referenceFrames: SkeletonFrame[],
    practiceFrames: SkeletonFrame[],
    normalize: (frame: SkeletonFrame) => NormalizedPoint[] | undefined,
    distanceScale: number,
  ): number | undefined {
    const similarities: number[] = [];
    for (let index = 0; index < referenceFrames.length; index += 1) {
      const reference = normalize(referenceFrames[index]);
      const practice = normalize(practiceFrames[index]);
      if (!reference || !practice) {
        continue;
      }
      const distance = this.pointSetDistance(reference, practice);
      similarities.push(Math.exp(-distance / distanceScale));
    }
    return similarities.length === 0 ? undefined : this.average(similarities);
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
