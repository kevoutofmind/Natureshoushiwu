import { Module } from '@nestjs/common';
import { VoiceControlController } from './voice-control.controller';
import { KimiVoiceCommandRouterService } from './kimi-voice-command-router.service';
import { VoiceControlService } from './voice-control.service';

@Module({
  controllers: [VoiceControlController],
  providers: [VoiceControlService, KimiVoiceCommandRouterService],
  exports: [VoiceControlService],
})
export class VoiceControlModule {}
