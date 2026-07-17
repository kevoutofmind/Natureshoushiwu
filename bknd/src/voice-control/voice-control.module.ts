import { Module } from '@nestjs/common';
import { VoiceControlService } from './voice-control.service';

@Module({
  providers: [VoiceControlService],
  exports: [VoiceControlService],
})
export class VoiceControlModule {}
