import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  ManagedPromptExecutionInput,
  ManagedPromptExecutionResult,
  PromptCatalogItem,
} from '../contracts/prompt-management.types';
import type {
  TeachingAgentEvent,
  TeachingAgentSession,
  TeachingAgentStartInput,
  TeachingAgentTurnResult,
  TeachingLessonPlan,
  TeachingLessonRegistrationResult,
} from '../contracts/teaching-agent.types';
import { ManagedPromptExecutorService } from '../prompts/managed-prompt-executor.service';
import { PromptCatalogService } from '../prompts/prompt-catalog.service';
import { TeachingAgentService } from './teaching-agent.service';

@ApiTags('VLM Core Teaching Agent')
@Controller('vlm-core/agent')
export class TeachingAgentController {
  constructor(
    private readonly agent: TeachingAgentService,
    private readonly promptCatalog: PromptCatalogService,
    private readonly promptExecutor: ManagedPromptExecutorService,
  ) {}

  @Get('prompts')
  @ApiOperation({ summary: '查看教学 Agent 使用的 Prompt ID、版本和模型策略' })
  listPrompts(): PromptCatalogItem[] {
    return this.promptCatalog.list();
  }

  @Post('prompts/execute')
  @ApiOperation({
    summary: '异步慢路径调用版本化云端 Prompt，不参与实时动作推进',
  })
  @ApiBody({ type: Object })
  executePrompt(
    @Body() input: ManagedPromptExecutionInput,
  ): Promise<ManagedPromptExecutionResult> {
    return this.promptExecutor.execute(input);
  }

  @Post('lessons/register')
  @ApiOperation({ summary: '注册一支预设舞蹈的有序教学计划' })
  @ApiBody({ type: Object })
  registerLesson(
    @Body() input: TeachingLessonPlan,
  ): TeachingLessonRegistrationResult {
    return this.agent.registerLesson(input);
  }

  @Post('sessions/start')
  @ApiOperation({ summary: '启动教学会话并生成完整演示工具命令' })
  @ApiBody({ type: Object })
  startSession(
    @Body() input: TeachingAgentStartInput,
  ): TeachingAgentTurnResult {
    return this.agent.startSession(input);
  }

  @Post('sessions/event')
  @ApiOperation({ summary: '提交视觉、播放器、语音或云端异步事件' })
  @ApiBody({ type: Object })
  handleEvent(@Body() input: TeachingAgentEvent): TeachingAgentTurnResult {
    return this.agent.handleEvent(input);
  }

  @Get('sessions/:sessionId')
  @ApiOperation({ summary: '读取当前教学会话状态' })
  getSession(@Param('sessionId') sessionId: string): TeachingAgentSession {
    return this.agent.getSession(sessionId);
  }
}
