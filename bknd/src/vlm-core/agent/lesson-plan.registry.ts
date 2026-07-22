import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  TeachingLessonPlan,
  TeachingLessonRegistrationResult,
} from '../contracts/teaching-agent.types';

@Injectable()
export class LessonPlanRegistry {
  private readonly plans = new Map<string, TeachingLessonPlan>();

  register(plan: TeachingLessonPlan): TeachingLessonRegistrationResult {
    const replaced = this.plans.has(plan.danceId);
    this.plans.set(plan.danceId, plan);
    return {
      schemaVersion: 'teaching-lesson-registration-v1',
      danceId: plan.danceId,
      motionCount: plan.motions.length,
      replaced,
    };
  }

  get(danceId: string): TeachingLessonPlan {
    const plan = this.plans.get(danceId);
    if (!plan) {
      throw new NotFoundException({
        success: false,
        code: 'TEACHING_LESSON_NOT_FOUND',
        message: `未找到舞蹈 ${danceId} 的教学计划。`,
      });
    }
    return plan;
  }

  count(): number {
    return this.plans.size;
  }
}
