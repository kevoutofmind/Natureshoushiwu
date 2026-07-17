import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { AiTeachingService } from './ai-teaching.service';

@ApiTags('AI 教学')
@Controller('api/ai-teaching')
export class AiTeachingController {
  constructor(private readonly aiTeachingService: AiTeachingService) {}

  @ApiOperation({ summary: '获取 AI 教学工作区状态和能力' })
  @ApiQuery({
    name: 'danceId',
    required: false,
    description: '从热门手势舞页面选择的舞蹈 ID。',
    example: 'dance-001',
  })
  @ApiOkResponse({
    description: '返回选中舞蹈和当前已经接入的教学能力。',
    schema: {
      example: {
        success: true,
        code: 'TEACHING_WORKSPACE_READY',
        message: '教学工作区已接收手势舞选择。',
        data: {
          selectedDanceId: 'dance-001',
          capabilities: {
            cameraRecording: true,
            localDrafts: true,
            voiceControl: false,
            vlmCoaching: false,
          },
        },
      },
    },
  })
  @Get('workspace')
  getWorkspace(@Query('danceId') danceId?: string) {
    return this.aiTeachingService.getWorkspace(danceId);
  }
}
