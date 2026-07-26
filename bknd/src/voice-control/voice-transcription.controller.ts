import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  WhisperTranscriptionService,
  type WhisperAudioFile,
} from './whisper-transcription.service';

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

@ApiTags('语音控制')
@Controller('api/voice/transcriptions')
export class VoiceTranscriptionController {
  constructor(
    private readonly transcription: WhisperTranscriptionService,
  ) {}

  @Post()
  @ApiOperation({ summary: '使用配置的 Whisper 提供者将语音转写为文字' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        files: 1,
        fileSize: MAX_AUDIO_BYTES,
      },
    }),
  )
  async transcribe(@UploadedFile() file?: WhisperAudioFile) {
    if (!file?.buffer?.length) {
      throw new BadRequestException({
        code: 'VOICE_AUDIO_REQUIRED',
        message: '请上传待转写的音频文件。',
      });
    }

    const result = await this.transcription.transcribe(file);
    return {
      success: true,
      code: result.text
        ? 'VOICE_TRANSCRIPTION_READY'
        : 'VOICE_TRANSCRIPTION_EMPTY',
      message: result.text ? '语音转写完成。' : '本段音频未识别到文字。',
      data: result,
    };
  }
}
