import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  TeachingAgentEvent,
  TeachingAgentStartInput,
  TeachingLessonPlan,
} from '../contracts/teaching-agent.types';

const EVENT_TYPES = new Set<TeachingAgentEvent['type']>([
  'PREVIEW_FINISHED',
  'MOTION_DEMO_FINISHED',
  'REALTIME_OBSERVATION',
  'VOICE_COMMAND',
  'FULL_CHALLENGE_FINISHED',
  'CLOUD_COACHING_READY',
]);

@Injectable()
export class TeachingAgentValidator {
  validateLesson(plan: TeachingLessonPlan): void {
    if (plan.schemaVersion !== 'teaching-lesson-plan-v1') {
      this.fail('schemaVersion', '必须为 teaching-lesson-plan-v1');
    }
    this.nonEmpty(plan.danceId, 'danceId');
    this.nonEmpty(plan.title, 'title');
    this.nonEmpty(plan.referenceVideoId, 'referenceVideoId');
    this.timeRange(plan.previewStartMs, plan.previewEndMs, 'preview');
    if (!Array.isArray(plan.motions) || plan.motions.length === 0) {
      this.fail('motions', '至少需要一个动作单元');
    }

    const motionIds = new Set<string>();
    plan.motions.forEach((motion, index) => {
      this.nonEmpty(motion.motionId, `motions.${index}.motionId`);
      this.nonEmpty(motion.instruction, `motions.${index}.instruction`);
      this.timeRange(motion.demoStartMs, motion.demoEndMs, `motions.${index}`);
      if (motionIds.has(motion.motionId)) {
        this.fail(`motions.${index}.motionId`, '动作单元ID不能重复');
      }
      motionIds.add(motion.motionId);
      if (
        motion.demoPlaybackRate !== undefined &&
        (!Number.isFinite(motion.demoPlaybackRate) ||
          motion.demoPlaybackRate < 0.3 ||
          motion.demoPlaybackRate > 1.5)
      ) {
        this.fail(`motions.${index}.demoPlaybackRate`, '必须在0.3到1.5之间');
      }
    });

    const maxRetries = plan.policy?.maxRetriesPerMotion;
    if (
      maxRetries !== undefined &&
      (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5)
    ) {
      this.fail('policy.maxRetriesPerMotion', '必须是0到5之间的整数');
    }
  }

  validateStart(input: TeachingAgentStartInput): void {
    if (input.schemaVersion !== 'teaching-agent-start-v1') {
      this.fail('schemaVersion', '必须为 teaching-agent-start-v1');
    }
    this.nonEmpty(input.sessionId, 'sessionId');
    this.nonEmpty(input.danceId, 'danceId');
  }

  validateEvent(event: TeachingAgentEvent): void {
    if (event.schemaVersion !== 'teaching-agent-event-v1') {
      this.fail('schemaVersion', '必须为 teaching-agent-event-v1');
    }
    this.nonEmpty(event.sessionId, 'sessionId');
    this.nonEmpty(event.eventId, 'eventId');
    if (!EVENT_TYPES.has(event.type)) {
      this.fail('type', '不支持的教学事件');
    }
    if (
      event.expectedVersion !== undefined &&
      (!Number.isInteger(event.expectedVersion) || event.expectedVersion < 0)
    ) {
      this.fail('expectedVersion', '必须为非负整数');
    }
    if (event.type === 'REALTIME_OBSERVATION') {
      this.nonEmpty(event.sampleId, 'sampleId');
      if (!event.observation) {
        this.fail('observation', '实时观察不能为空');
      }
    }
    if (event.type === 'CLOUD_COACHING_READY') {
      this.nonEmpty(event.motionId, 'motionId');
      this.nonEmpty(event.speech, 'speech');
    }
  }

  private timeRange(start: number, end: number, field: string): void {
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start
    ) {
      this.fail(field, '时间必须满足 0 <= start < end');
    }
  }

  private nonEmpty(value: string | undefined, field: string): void {
    if (!value?.trim()) {
      this.fail(field, '不能为空');
    }
  }

  private fail(field: string, message: string): never {
    throw new BadRequestException({
      success: false,
      code: 'INVALID_TEACHING_AGENT_INPUT',
      message: '教学 Agent 输入不合法。',
      fieldErrors: { [field]: message },
    });
  }
}
