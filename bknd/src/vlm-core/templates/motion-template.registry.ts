import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  MotionTemplatePack,
  TemplateRegistrationResult,
} from '../contracts/realtime-judge.types';

@Injectable()
export class MotionTemplateRegistry {
  private readonly packs = new Map<string, MotionTemplatePack>();

  register(pack: MotionTemplatePack): TemplateRegistrationResult {
    const key = this.key(pack.danceId, pack.motionId);
    const replaced = this.packs.has(key);
    this.packs.set(key, pack);

    return {
      schemaVersion: 'template-registration-v1',
      danceId: pack.danceId,
      motionId: pack.motionId,
      referenceCount: pack.templates.length,
      replaced,
    };
  }

  get(danceId: string, motionId: string): MotionTemplatePack {
    const pack = this.packs.get(this.key(danceId, motionId));
    if (!pack) {
      throw new NotFoundException({
        success: false,
        code: 'MOTION_TEMPLATE_NOT_FOUND',
        message: `未找到舞蹈 ${danceId} 的动作单元 ${motionId} 模板。`,
      });
    }
    return pack;
  }

  count(): number {
    return this.packs.size;
  }

  has(danceId: string, motionId: string): boolean {
    return this.packs.has(this.key(danceId, motionId));
  }

  private key(danceId: string, motionId: string): string {
    return `${danceId}:${motionId}`;
  }
}
