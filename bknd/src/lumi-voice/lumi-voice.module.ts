import { Module } from '@nestjs/common';
import { LumiVoiceController } from './lumi-voice.controller';
import { LumiVoiceService } from './lumi-voice.service';

@Module({
  controllers: [LumiVoiceController],
  providers: [LumiVoiceService],
})
export class LumiVoiceModule {}
