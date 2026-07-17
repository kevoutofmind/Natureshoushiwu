import { Module } from '@nestjs/common';
import { VideoStageModule } from '../video-stage';
import { VlmCoreModule } from '../vlm-core';
import { VoiceControlModule } from '../voice-control';
import { AiTeachingController } from './ai-teaching.controller';
import { AiTeachingService } from './ai-teaching.service';

@Module({
  imports: [VlmCoreModule, VideoStageModule, VoiceControlModule],
  controllers: [AiTeachingController],
  providers: [AiTeachingService],
})
export class AiTeachingModule {}
