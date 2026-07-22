import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  MotionTemplatePack,
  RealtimeJudgeInput,
  RealtimeJudgeResult,
  TemplateRegistrationResult,
} from './contracts/realtime-judge.types';
import type { VlmHealthStatus } from './contracts/teaching.types';
import { AnalyzeComparisonDto } from './dto/analyze-comparison.dto';
import { TeachingDecisionResponseDto } from './dto/teaching-decision-response.dto';
import { VlmCoreService } from './vlm-core.service';

@ApiTags('VLM Core')
@Controller('vlm-core')
export class VlmCoreController {
  constructor(private readonly vlmCoreService: VlmCoreService) {}

  @Get('health')
  @ApiOperation({ summary: '检查本地实时判别引擎与可选云端增强状态' })
  @ApiOkResponse({ description: 'VLM Core 当前状态' })
  getHealth(): VlmHealthStatus {
    return this.vlmCoreService.getHealth();
  }

  @Post('templates/register')
  @ApiOperation({
    summary: '赛前注册一个动作单元的多条正确骨骼模板',
  })
  @ApiBody({ type: Object })
  registerTemplate(
    @Body() input: MotionTemplatePack,
  ): TemplateRegistrationResult {
    return this.vlmCoreService.registerMotionTemplate(input);
  }

  @Post('realtime/decide')
  @ApiOperation({
    summary: '使用本地骨骼模板实时判定，通过时绝不等待云端',
  })
  @ApiBody({ type: Object })
  judgeRealtime(@Body() input: RealtimeJudgeInput): RealtimeJudgeResult {
    return this.vlmCoreService.judgeRealtime(input);
  }

  @Post('analyze')
  @ApiOperation({
    summary: '兼容旧版视觉测量协议的本地规则判别',
  })
  @ApiOkResponse({ type: TeachingDecisionResponseDto })
  analyze(@Body() input: AnalyzeComparisonDto): TeachingDecisionResponseDto {
    return this.vlmCoreService.analyzeComparison(input);
  }
}
