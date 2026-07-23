import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { InterpretVoiceCommandDto } from './dto/interpret-voice-command.dto';
import { KimiVoiceCommandRouterService } from './kimi-voice-command-router.service';
import { VoiceControlService } from './voice-control.service';

@ApiTags('语音控制')
@Controller('api/voice/commands')
export class VoiceControlController {
  constructor(
    private readonly voiceControlService: VoiceControlService,
    private readonly kimiRouter: KimiVoiceCommandRouterService,
  ) {}

  @ApiOperation({
    summary: '解析基础语音指令',
    description:
      '将语音识别得到的文本转换为受支持的基础命令。本阶段只解析并返回结构化结果，不控制视频或调用 VLM。',
  })
  @ApiBody({ type: InterpretVoiceCommandDto })
  @ApiOkResponse({
    description: '返回命令识别结果。',
    schema: {
      examples: {
        recognized: {
          summary: '识别成功',
          value: {
            success: true,
            code: 'VOICE_COMMAND_RECOGNIZED',
            message: '已识别语音指令。',
            data: {
              accepted: true,
              command: {
                transcript: '倒回五秒',
                normalizedTranscript: '倒回五秒',
                intent: 'REWIND',
                confidence: 0.96,
                parameters: { seconds: 5 },
              },
              label: '倒回',
              responseText: '已识别：倒回 5 秒。',
              executionStatus: 'not-dispatched',
            },
          },
        },
        unknown: {
          summary: '未识别',
          value: {
            success: true,
            code: 'VOICE_COMMAND_NOT_RECOGNIZED',
            message: '暂时无法识别这条语音指令。',
            data: {
              accepted: false,
              command: {
                transcript: '帮我看看这个动作',
                normalizedTranscript: '帮我看看这个动作',
                intent: null,
                confidence: 0,
                parameters: {},
              },
              label: null,
              responseText: '暂时无法识别这条指令，请换一种说法。',
              executionStatus: 'not-dispatched',
            },
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: '语音文本为空、类型错误或长度超过限制。',
  })
  @Post('interpret')
  @HttpCode(200)
  async interpret(@Body() dto: InterpretVoiceCommandDto) {
    const localResult = this.voiceControlService.interpret(dto.transcript);
    if (localResult.data.accepted) return localResult;

    return (
      (await this.kimiRouter.interpret(
        dto.transcript,
        localResult.data.command.normalizedTranscript,
      )) ?? localResult
    );
  }
}
