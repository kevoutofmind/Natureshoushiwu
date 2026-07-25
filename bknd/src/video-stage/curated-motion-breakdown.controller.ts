import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CuratedMotionBreakdown } from './contracts/curated-motion-breakdown.types';
import { CuratedMotionBreakdownService } from './curated-motion-breakdown.service';

@ApiTags('Video Stage')
@Controller('api/video-stage/motion-breakdowns')
export class CuratedMotionBreakdownController {
  constructor(private readonly breakdowns: CuratedMotionBreakdownService) {}

  @Get(':danceId')
  @ApiOperation({ summary: '读取主示例视频的预处理动作拆解' })
  get(@Param('danceId') danceId: string): Promise<CuratedMotionBreakdown> {
    return this.breakdowns.get(danceId);
  }
}
