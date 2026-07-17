import { Module } from '@nestjs/common';
import { VideoStageService } from './video-stage.service';

@Module({
  providers: [VideoStageService],
  exports: [VideoStageService],
})
export class VideoStageModule {}
