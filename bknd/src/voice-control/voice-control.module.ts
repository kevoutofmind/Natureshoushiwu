import { Module } from '@nestjs/common';
import { VoiceControlController } from './voice-control.controller';
import { KimiVoiceCommandRouterService } from './kimi-voice-command-router.service';
import { VoiceControlService } from './voice-control.service';
import { VoiceTranscriptionController } from './voice-transcription.controller';
import { WhisperTranscriptionService } from './whisper-transcription.service';

@Module({
  controllers: [VoiceControlController, VoiceTranscriptionController],
  providers: [
    VoiceControlService,
    KimiVoiceCommandRouterService,
    WhisperTranscriptionService,
  ],
  exports: [VoiceControlService],
})
export class VoiceControlModule {}
