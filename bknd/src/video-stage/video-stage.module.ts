import { Module } from '@nestjs/common';
import { CuratedMotionBreakdownController } from './curated-motion-breakdown.controller';
import { CuratedMotionBreakdownService } from './curated-motion-breakdown.service';
import { VideoStageService } from './video-stage.service';

@Module({
  controllers: [CuratedMotionBreakdownController],
  providers: [VideoStageService, CuratedMotionBreakdownService],
  exports: [VideoStageService],
})
export class VideoStageModule {}
