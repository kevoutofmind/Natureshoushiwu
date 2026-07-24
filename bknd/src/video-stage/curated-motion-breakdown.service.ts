import { Injectable, NotFoundException } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { CuratedMotionBreakdown } from './contracts/curated-motion-breakdown.types';

@Injectable()
export class CuratedMotionBreakdownService {
  private readonly dancesRoot = resolve(process.cwd(), '..', 'data', 'dances');

  async get(danceId: string): Promise<CuratedMotionBreakdown> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(danceId)) {
      throw new NotFoundException({
        success: false,
        code: 'MOTION_BREAKDOWN_NOT_FOUND',
        message: '动作拆解数据不存在。',
      });
    }

    const file = join(
      this.dancesRoot,
      danceId,
      'processed',
      'motion-breakdown.json',
    );

    try {
      return JSON.parse(await readFile(file, 'utf8')) as CuratedMotionBreakdown;
    } catch {
      throw new NotFoundException({
        success: false,
        code: 'MOTION_BREAKDOWN_NOT_FOUND',
        message: `舞蹈 ${danceId} 尚未生成动作拆解数据。`,
      });
    }
  }
}
