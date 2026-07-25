import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  MotionTemplatePack,
  RealtimeJudgeInput,
  SkeletonFrame,
  SkeletonLandmark,
} from '../contracts/realtime-judge.types';

@Injectable()
export class RealtimeJudgeValidator {
  validateTemplatePack(pack: MotionTemplatePack): void {
    if (pack.schemaVersion !== 'motion-template-pack-v1') {
      this.fail('schemaVersion', '必须为 motion-template-pack-v1');
    }
    this.nonEmpty(pack.danceId, 'danceId');
    this.nonEmpty(pack.motionId, 'motionId');
    this.nonEmpty(pack.instruction, 'instruction');

    if (
      !Number.isFinite(pack.expectedDurationMs) ||
      pack.expectedDurationMs < 500
    ) {
      this.fail('expectedDurationMs', '必须是不小于 500 ms 的有限数值');
    }
    if (!Array.isArray(pack.templates) || pack.templates.length === 0) {
      this.fail('templates', '至少需要一条正确参考骨骼模板');
    }

    if (pack.keyframes !== undefined) {
      if (!Array.isArray(pack.keyframes) || pack.keyframes.length === 0) {
        this.fail('keyframes', '关键帧标注必须是非空数组');
      }
      const keyframeIds = new Set<string>();
      let previousProgress = -1;
      pack.keyframes.forEach((keyframe, index) => {
        this.nonEmpty(keyframe.keyframeId, `keyframes.${index}.keyframeId`);
        this.nonEmpty(keyframe.label, `keyframes.${index}.label`);
        if (keyframeIds.has(keyframe.keyframeId)) {
          this.fail(
            `keyframes.${index}.keyframeId`,
            '同一动作中的关键帧ID不能重复',
          );
        }
        keyframeIds.add(keyframe.keyframeId);
        this.unitInterval(keyframe.progress, `keyframes.${index}.progress`);
        if (keyframe.progress <= previousProgress) {
          this.fail(`keyframes.${index}.progress`, '关键帧进度必须严格递增');
        }
        previousProgress = keyframe.progress;
        if (keyframe.windowProgress !== undefined) {
          this.unitInterval(
            keyframe.windowProgress,
            `keyframes.${index}.windowProgress`,
          );
          if (keyframe.windowProgress === 0) {
            this.fail(
              `keyframes.${index}.windowProgress`,
              '关键帧轨迹窗口必须大于0',
            );
          }
        }
        if (keyframe.weight !== undefined) {
          if (!Number.isFinite(keyframe.weight) || keyframe.weight <= 0) {
            this.fail(
              `keyframes.${index}.weight`,
              '关键帧相对权重必须是大于0的有限数值',
            );
          }
        }
        if (keyframe.templateProgress !== undefined) {
          if (
            typeof keyframe.templateProgress !== 'object' ||
            Array.isArray(keyframe.templateProgress)
          ) {
            this.fail(
              `keyframes.${index}.templateProgress`,
              '模板关键帧位置必须是对象',
            );
          }
          for (const [templateId, progress] of Object.entries(
            keyframe.templateProgress,
          )) {
            this.nonEmpty(
              templateId,
              `keyframes.${index}.templateProgress.templateId`,
            );
            this.unitInterval(
              progress,
              `keyframes.${index}.templateProgress.${templateId}`,
            );
          }
        }
      });
    }

    pack.templates.forEach((template, index) => {
      this.nonEmpty(template.templateId, `templates.${index}.templateId`);
      this.nonEmpty(template.sourceVideoId, `templates.${index}.sourceVideoId`);
      this.validateFrames(template.frames, `templates.${index}.frames`);
      if (template.frames.length < 5) {
        this.fail(`templates.${index}.frames`, '正确参考模板至少需要5个骨骼帧');
      }
      if (
        template.frames[template.frames.length - 1].timestampMs -
          template.frames[0].timestampMs <
        450
      ) {
        this.fail(
          `templates.${index}.frames`,
          '正确参考模板至少需要覆盖450 ms',
        );
      }
    });

    const policy = pack.evaluationPolicy;
    if (policy?.acceptThreshold !== undefined) {
      this.unitInterval(
        policy.acceptThreshold,
        'evaluationPolicy.acceptThreshold',
      );
    }
    if (policy?.acceptWithHintThreshold !== undefined) {
      this.unitInterval(
        policy.acceptWithHintThreshold,
        'evaluationPolicy.acceptWithHintThreshold',
      );
    }
    if (
      policy?.acceptThreshold !== undefined &&
      policy.acceptWithHintThreshold !== undefined &&
      policy.acceptWithHintThreshold > policy.acceptThreshold
    ) {
      this.fail(
        'evaluationPolicy',
        'acceptWithHintThreshold 不能高于 acceptThreshold',
      );
    }
    if (policy?.minimumCompletionProgress !== undefined) {
      this.unitInterval(
        policy.minimumCompletionProgress,
        'evaluationPolicy.minimumCompletionProgress',
      );
    }
    if (
      policy?.minimumObservationMs !== undefined &&
      (!Number.isFinite(policy.minimumObservationMs) ||
        policy.minimumObservationMs < 100)
    ) {
      this.fail(
        'evaluationPolicy.minimumObservationMs',
        '必须是不小于100 ms的有限数值',
      );
    }
    if (policy?.keyframeTrajectoryWeight !== undefined) {
      this.unitInterval(
        policy.keyframeTrajectoryWeight,
        'evaluationPolicy.keyframeTrajectoryWeight',
      );
    }
  }

  validateJudgeInput(input: RealtimeJudgeInput): void {
    if (input.schemaVersion !== 'realtime-judge-v1') {
      this.fail('schemaVersion', '必须为 realtime-judge-v1');
    }
    this.nonEmpty(input.sessionId, 'sessionId');
    this.nonEmpty(input.sampleId, 'sampleId');
    this.nonEmpty(input.danceId, 'danceId');
    this.nonEmpty(input.motionId, 'motionId');
    this.unitInterval(input.observation?.progress, 'observation.progress');
    this.validateFrames(input.observation?.frames, 'observation.frames');
  }

  private validateFrames(
    frames: SkeletonFrame[] | undefined,
    field: string,
  ): void {
    if (!Array.isArray(frames) || frames.length === 0) {
      this.fail(field, '至少需要一个骨骼帧');
    }

    let previousTimestamp = -1;
    frames.forEach((frame, frameIndex) => {
      if (
        !Number.isFinite(frame.timestampMs) ||
        frame.timestampMs < 0 ||
        frame.timestampMs < previousTimestamp
      ) {
        this.fail(
          `${field}.${frameIndex}.timestampMs`,
          '时间戳必须非负且单调递增',
        );
      }
      previousTimestamp = frame.timestampMs;

      if (!Array.isArray(frame.pose) || frame.pose.length < 17) {
        this.fail(`${field}.${frameIndex}.pose`, '至少需要17个人体关键点');
      }
      this.validateLandmarks(frame.pose, `${field}.${frameIndex}.pose`);
      if (frame.leftHand !== undefined) {
        this.validateHand(frame.leftHand, `${field}.${frameIndex}.leftHand`);
      }
      if (frame.rightHand !== undefined) {
        this.validateHand(frame.rightHand, `${field}.${frameIndex}.rightHand`);
      }
    });
  }

  private validateHand(landmarks: SkeletonLandmark[], field: string): void {
    if (!Array.isArray(landmarks) || landmarks.length < 21) {
      this.fail(field, '手部必须包含21个关键点');
    }
    this.validateLandmarks(landmarks, field);
  }

  private validateLandmarks(
    landmarks: SkeletonLandmark[],
    field: string,
  ): void {
    landmarks.forEach((landmark, index) => {
      if (!Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) {
        this.fail(`${field}.${index}`, 'x 和 y 必须为有限数值');
      }
      if (landmark.z !== undefined && !Number.isFinite(landmark.z)) {
        this.fail(`${field}.${index}.z`, 'z 必须为有限数值');
      }
      if (landmark.visibility !== undefined) {
        this.unitInterval(landmark.visibility, `${field}.${index}.visibility`);
      }
    });
  }

  private nonEmpty(value: string | undefined, field: string): void {
    if (!value?.trim()) {
      this.fail(field, '不能为空');
    }
  }

  private unitInterval(value: number | undefined, field: string): void {
    if (
      !Number.isFinite(value) ||
      value === undefined ||
      value < 0 ||
      value > 1
    ) {
      this.fail(field, '必须在0到1之间');
    }
  }

  private fail(field: string, message: string): never {
    throw new BadRequestException({
      success: false,
      code: 'INVALID_REALTIME_JUDGE_INPUT',
      message: '实时骨骼判别输入不合法。',
      fieldErrors: { [field]: message },
    });
  }
}
