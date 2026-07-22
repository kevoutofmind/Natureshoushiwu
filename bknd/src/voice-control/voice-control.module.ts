import { Module } from '@nestjs/common';
import { VoiceControlController } from './voice-control.controller';
import { VoiceControlService } from './voice-control.service';

@Module({
  controllers: [VoiceControlController],
  providers: [VoiceControlService],
  exports: [VoiceControlService],
})
export class VoiceControlModule {}
