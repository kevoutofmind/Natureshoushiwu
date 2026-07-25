import { Body, Controller, Header, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SynthesizeLumiVoiceDto } from './dto/synthesize-lumi-voice.dto';
import { LumiVoiceService } from './lumi-voice.service';

@Controller('api/lumi/voice')
export class LumiVoiceController {
  constructor(private readonly lumiVoiceService: LumiVoiceService) {}

  @Post('synthesize')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async synthesize(
    @Body() dto: SynthesizeLumiVoiceDto,
    @Res() response: Response,
  ) {
    const audio = await this.lumiVoiceService.synthesize(dto.text, dto.voice);
    response.type(audio.contentType);
    response.send(audio.buffer);
  }
}
