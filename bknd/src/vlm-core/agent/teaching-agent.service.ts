import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type {
  TeachingAgentCommand,
  TeachingAgentEvent,
  TeachingAgentPhase,
  TeachingAgentSession,
  TeachingAgentStartInput,
  TeachingAgentTrace,
  TeachingAgentTurnResult,
  TeachingLessonPlan,
  TeachingLessonRegistrationResult,
  TeachingMotionPlan,
  TeachingVoiceCommand,
} from '../contracts/teaching-agent.types';
import type { RealtimeJudgeResult } from '../contracts/realtime-judge.types';
import { PromptCatalogService } from '../prompts/prompt-catalog.service';
import { MotionTemplateRegistry } from '../templates/motion-template.registry';
import { VlmCoreService } from '../vlm-core.service';
import { LessonPlanRegistry } from './lesson-plan.registry';
import { TeachingAgentSessionStore } from './teaching-agent-session.store';
import { TeachingAgentTools } from './teaching-agent.tools';
import { TeachingAgentValidator } from './teaching-agent.validator';

const DEFAULT_MAX_RETRIES = 2;
const MAX_COMMANDS_PER_TURN = 8;

@Injectable()
export class TeachingAgentService {
  constructor(
    private readonly vlmCoreService: VlmCoreService,
    private readonly lessonRegistry: LessonPlanRegistry,
    private readonly sessionStore: TeachingAgentSessionStore,
    private readonly tools: TeachingAgentTools,
    private readonly validator: TeachingAgentValidator,
    private readonly templateRegistry: MotionTemplateRegistry,
    private readonly promptCatalog: PromptCatalogService,
  ) {}

  registerLesson(plan: TeachingLessonPlan): TeachingLessonRegistrationResult {
    this.validator.validateLesson(plan);
    return this.lessonRegistry.register(plan);
  }

  startSession(input: TeachingAgentStartInput): TeachingAgentTurnResult {
    const startedAt = Date.now();
    this.validator.validateStart(input);
    const plan = this.lessonRegistry.get(input.danceId);
    this.ensureTemplatesReady(plan);
    const now = new Date().toISOString();
    const session: TeachingAgentSession = {
      schemaVersion: 'teaching-agent-session-v1',
      sessionId: input.sessionId,
      danceId: input.danceId,
      phase: 'PREVIEW',
      currentMotionIndex: 0,
      currentMotionId: plan.motions[0].motionId,
      attemptIndex: 1,
      retryCount: 0,
      version: 0,
      completedMotions: [],
      startedAt: now,
      updatedAt: now,
    };
    this.sessionStore.create(session);

    const commands = [
      this.tools.command(session.sessionId, 'SPEAK', {
        speech: `你好，我是今天陪你练习的舞蹈老师。我们可以先一起感受一遍《${plan.title}》的节奏；如果你已经熟悉，也可以随时说“我准备好了”，直接开始拆动作。`,
      }),
      this.tools.command(
        session.sessionId,
        'PLAY_FULL_PREVIEW',
        {
          danceId: plan.danceId,
          referenceVideoId: plan.referenceVideoId,
          startMs: plan.previewStartMs,
          endMs: plan.previewEndMs,
          bgm: true,
        },
        { requiresAck: true, blocking: true },
      ),
    ];

    return this.turnResult(
      session,
      commands,
      this.trace(
        'session-start',
        undefined,
        session.phase,
        commands,
        startedAt,
      ),
      false,
    );
  }

  handleEvent(event: TeachingAgentEvent): TeachingAgentTurnResult {
    const startedAt = Date.now();
    this.validator.validateEvent(event);
    const replay = this.sessionStore.getEventResult(
      event.sessionId,
      event.eventId,
    );
    if (replay) {
      return { ...replay, idempotentReplay: true };
    }

    const session = this.sessionStore.get(event.sessionId);
    if (
      event.expectedVersion !== undefined &&
      event.expectedVersion !== session.version
    ) {
      throw new ConflictException({
        success: false,
        code: 'TEACHING_SESSION_VERSION_CONFLICT',
        message: `会话版本已更新，当前版本为 ${session.version}。`,
      });
    }

    const fromPhase = session.phase;
    const plan = this.lessonRegistry.get(session.danceId);
    const commands = this.routeEvent(session, plan, event);
    if (commands.length > MAX_COMMANDS_PER_TURN) {
      throw new ConflictException({
        success: false,
        code: 'TEACHING_AGENT_TOOL_LIMIT',
        message: '单次教学决策产生了过多工具命令。',
      });
    }

    session.version += 1;
    session.updatedAt = new Date().toISOString();
    this.sessionStore.save(session);
    const result = this.turnResult(
      session,
      commands,
      this.trace(event.eventId, fromPhase, session.phase, commands, startedAt),
      false,
    );
    this.sessionStore.rememberEventResult(
      event.sessionId,
      event.eventId,
      result,
    );
    return result;
  }

  getSession(sessionId: string): TeachingAgentSession {
    return this.sessionStore.get(sessionId);
  }

  private routeEvent(
    session: TeachingAgentSession,
    plan: TeachingLessonPlan,
    event: TeachingAgentEvent,
  ): TeachingAgentCommand[] {
    if (event.type === 'VOICE_COMMAND') {
      return this.handleVoiceCommand(session, plan, event.command);
    }
    if (event.type === 'CLOUD_COACHING_READY') {
      return this.handleCloudCoaching(session, event.motionId, event.speech);
    }
    if (session.phase === 'PAUSED') {
      throw this.invalidTransition(session.phase, event.type);
    }

    switch (event.type) {
      case 'PREVIEW_FINISHED':
        this.requirePhase(session, 'PREVIEW', event.type);
        return this.enterMotionDemo(session, plan);
      case 'MOTION_DEMO_FINISHED':
        this.requirePhase(session, 'MOTION_DEMO', event.type);
        return this.enterPractice(session);
      case 'REALTIME_OBSERVATION':
        this.requirePhase(session, 'PRACTICE', event.type);
        return this.handleRealtimeObservation(
          session,
          plan,
          event.sampleId,
          event.observation,
        );
      case 'FULL_CHALLENGE_FINISHED':
        this.requirePhase(session, 'FULL_CHALLENGE', event.type);
        return this.completeSession(session, plan);
      default:
        throw this.invalidTransition(session.phase, event);
    }
  }

  private enterMotionDemo(
    session: TeachingAgentSession,
    plan: TeachingLessonPlan,
  ): TeachingAgentCommand[] {
    session.phase = 'MOTION_DEMO';
    const motion = this.currentMotion(session, plan);
    return [
      this.tools.command(session.sessionId, 'SPEAK', {
        speech: motion.instruction,
      }),
      this.motionDemoCommand(session, plan, motion),
    ];
  }

  private enterPractice(session: TeachingAgentSession): TeachingAgentCommand[] {
    session.phase = 'PRACTICE';
    return [
      this.tools.command(session.sessionId, 'SPEAK', {
        speech:
          '好，现在轮到你。不要着急，我会等你把动作做完整，再给你一个最关键的建议。',
      }),
      this.tools.command(session.sessionId, 'START_REALTIME_EVALUATION', {
        danceId: session.danceId,
        motionId: session.currentMotionId,
        attemptIndex: session.attemptIndex,
      }),
    ];
  }

  private handleRealtimeObservation(
    session: TeachingAgentSession,
    plan: TeachingLessonPlan,
    sampleId: string,
    observation: Parameters<VlmCoreService['judgeRealtime']>[0]['observation'],
  ): TeachingAgentCommand[] {
    const result = this.vlmCoreService.judgeRealtime({
      schemaVersion: 'realtime-judge-v1',
      sessionId: session.sessionId,
      sampleId,
      danceId: session.danceId,
      motionId: session.currentMotionId,
      attemptIndex: session.attemptIndex,
      observation,
    });
    session.latestJudgeResult = result;

    switch (result.decision) {
      case 'KEEP_WATCHING':
        return [];
      case 'NOT_VISIBLE':
        return [
          this.tools.command(session.sessionId, 'SHOW_HINT', {
            speech: result.speech,
            code: result.reason,
          }),
        ];
      case 'ACCEPT':
        return this.advanceAfterPass(session, plan, result, 'PASSED');
      case 'ACCEPT_HINT':
        return this.advanceAfterPass(session, plan, result, 'PASSED_WITH_HINT');
      case 'RETRY':
        return this.retryOrAssist(session, plan, result);
    }
  }

  private advanceAfterPass(
    session: TeachingAgentSession,
    plan: TeachingLessonPlan,
    result: RealtimeJudgeResult,
    outcome: 'PASSED' | 'PASSED_WITH_HINT',
  ): TeachingAgentCommand[] {
    session.completedMotions.push({
      motionId: session.currentMotionId,
      outcome,
      attempts: session.attemptIndex,
      finalScore: result.scores.overall,
    });
    const feedback =
      outcome === 'PASSED'
        ? `很好，就是这个感觉。${result.speech}`
        : `已经很接近了，而且整体方向是对的。${result.speech}`;
    return this.advanceToNextStep(session, plan, feedback);
  }

  private retryOrAssist(
    session: TeachingAgentSession,
    plan: TeachingLessonPlan,
    result: RealtimeJudgeResult,
  ): TeachingAgentCommand[] {
    session.retryCount += 1;
    const maxRetries = plan.policy?.maxRetriesPerMotion ?? DEFAULT_MAX_RETRIES;
    const autoAdvance = plan.policy?.autoAdvanceAfterMaxRetries ?? true;

    if (session.retryCount <= maxRetries || !autoAdvance) {
      session.attemptIndex += 1;
      session.phase = 'MOTION_DEMO';
      const motion = this.currentMotion(session, plan);
      return [
        this.tools.command(session.sessionId, 'STOP_REALTIME_EVALUATION', {
          motionId: session.currentMotionId,
        }),
        this.tools.command(session.sessionId, 'SPEAK', {
          speech: `没关系，这个动作本来就需要一点时间。${result.speech} 我们放慢再看一次。`,
        }),
        this.motionDemoCommand(session, plan, motion, 0.55),
      ];
    }

    session.completedMotions.push({
      motionId: session.currentMotionId,
      outcome: 'ASSISTED',
      attempts: session.attemptIndex,
      finalScore: result.scores.overall,
    });
    session.pendingCloudCoachingForMotionId = session.currentMotionId;
    const cloudCommand = this.tools.command(
      session.sessionId,
      'REQUEST_CLOUD_COACHING',
      {
        prompt: this.promptCatalog.reference('adaptive-motion-coaching'),
        danceId: session.danceId,
        motionId: session.currentMotionId,
        attemptIndex: session.attemptIndex,
        localDecision: result,
      },
      { blocking: false },
    );
    return [
      this.tools.command(session.sessionId, 'STOP_REALTIME_EVALUATION', {
        motionId: session.currentMotionId,
      }),
      cloudCommand,
      ...this.advanceToNextStep(
        session,
        plan,
        '这一遍先不追求完美。记住刚才那个关键点，我们继续往下学，最后连起来时再自然地带回来。',
        false,
      ),
    ];
  }

  private advanceToNextStep(
    session: TeachingAgentSession,
    plan: TeachingLessonPlan,
    feedback: string,
    includeStopEvaluation = true,
  ): TeachingAgentCommand[] {
    const commands: TeachingAgentCommand[] = [];
    if (includeStopEvaluation) {
      commands.push(
        this.tools.command(session.sessionId, 'STOP_REALTIME_EVALUATION', {
          motionId: session.currentMotionId,
        }),
      );
    }
    commands.push(
      this.tools.command(session.sessionId, 'SPEAK', { speech: feedback }),
    );

    if (session.currentMotionIndex >= plan.motions.length - 1) {
      session.phase = 'FULL_CHALLENGE';
      session.retryCount = 0;
      commands.push(
        this.tools.command(
          session.sessionId,
          'START_FULL_CHALLENGE',
          {
            danceId: plan.danceId,
            referenceVideoId: plan.referenceVideoId,
            startMs: plan.previewStartMs,
            endMs: plan.previewEndMs,
            bgm: true,
          },
          { requiresAck: true, blocking: true },
        ),
      );
      return commands;
    }

    session.currentMotionIndex += 1;
    session.currentMotionId = plan.motions[session.currentMotionIndex].motionId;
    session.attemptIndex = 1;
    session.retryCount = 0;
    session.phase = 'MOTION_DEMO';
    const nextMotion = this.currentMotion(session, plan);
    commands.push(
      this.tools.command(session.sessionId, 'SPEAK', {
        speech: nextMotion.instruction,
      }),
      this.motionDemoCommand(session, plan, nextMotion),
    );
    return commands;
  }

  private handleVoiceCommand(
    session: TeachingAgentSession,
    plan: TeachingLessonPlan,
    command: TeachingVoiceCommand,
  ): TeachingAgentCommand[] {
    switch (command) {
      case 'PAUSE':
        if (session.phase === 'PAUSED' || session.phase === 'COMPLETED') {
          return [];
        }
        session.resumePhase = session.phase;
        session.phase = 'PAUSED';
        return [
          this.tools.command(session.sessionId, 'STOP_REALTIME_EVALUATION'),
          this.tools.command(session.sessionId, 'PAUSE_PLAYBACK'),
        ];
      case 'RESUME':
        if (session.phase !== 'PAUSED' || !session.resumePhase) {
          return [];
        }
        session.phase = session.resumePhase;
        session.resumePhase = undefined;
        return this.resumeCommands(session);
      case 'READY':
        if (session.phase === 'PREVIEW') {
          return [
            this.tools.command(session.sessionId, 'PAUSE_PLAYBACK'),
            this.tools.command(session.sessionId, 'SPEAK', {
              speech: '好，我们按你的节奏来，直接拆第一个动作。',
            }),
            ...this.enterMotionDemo(session, plan),
          ];
        }
        if (session.phase === 'MOTION_DEMO') {
          return [
            this.tools.command(session.sessionId, 'PAUSE_PLAYBACK'),
            ...this.enterPractice(session),
          ];
        }
        if (session.phase === 'PAUSED' && session.resumePhase) {
          session.phase = session.resumePhase;
          session.resumePhase = undefined;
          return this.resumeCommands(session);
        }
        return [
          this.tools.command(session.sessionId, 'SPEAK', {
            speech: '我在看着，你准备好就自然地做出来，不用抢拍。',
          }),
        ];
      case 'PREVIOUS_ACTION':
        session.currentMotionIndex = Math.max(
          0,
          session.currentMotionIndex - 1,
        );
        return this.restartCurrentMotion(session, plan);
      case 'REPEAT_ACTION':
        return this.restartCurrentMotion(session, plan);
      case 'NEXT_ACTION':
        if (!(plan.policy?.allowVoiceSkip ?? true)) {
          return [
            this.tools.command(session.sessionId, 'SPEAK', {
              speech: '当前课程不允许跳过动作。',
            }),
          ];
        }
        if (session.phase === 'FULL_CHALLENGE') {
          return [];
        }
        session.completedMotions.push({
          motionId: session.currentMotionId,
          outcome: 'SKIPPED',
          attempts: session.attemptIndex,
        });
        return this.advanceToNextStep(
          session,
          plan,
          '可以，这个动作我们先放一放，按你的选择进入下一个动作。',
        );
      case 'RESTART_LESSON':
        session.currentMotionIndex = 0;
        session.currentMotionId = plan.motions[0].motionId;
        session.attemptIndex = 1;
        session.retryCount = 0;
        session.completedMotions = [];
        session.phase = 'PREVIEW';
        return [
          this.tools.command(
            session.sessionId,
            'PLAY_FULL_PREVIEW',
            {
              danceId: plan.danceId,
              referenceVideoId: plan.referenceVideoId,
              startMs: plan.previewStartMs,
              endMs: plan.previewEndMs,
              bgm: true,
            },
            { requiresAck: true, blocking: true },
          ),
        ];
    }
  }

  private restartCurrentMotion(
    session: TeachingAgentSession,
    plan: TeachingLessonPlan,
  ): TeachingAgentCommand[] {
    session.currentMotionId = plan.motions[session.currentMotionIndex].motionId;
    session.attemptIndex = 1;
    session.retryCount = 0;
    session.phase = 'MOTION_DEMO';
    return [
      this.tools.command(session.sessionId, 'STOP_REALTIME_EVALUATION'),
      this.tools.command(session.sessionId, 'SPEAK', {
        speech: '好，我们不赶进度。再看一遍这个动作，你可以只注意手臂的路线。',
      }),
      this.motionDemoCommand(session, plan, this.currentMotion(session, plan)),
    ];
  }

  private resumeCommands(
    session: TeachingAgentSession,
  ): TeachingAgentCommand[] {
    if (session.phase === 'PRACTICE') {
      return [
        this.tools.command(session.sessionId, 'START_REALTIME_EVALUATION', {
          danceId: session.danceId,
          motionId: session.currentMotionId,
          attemptIndex: session.attemptIndex,
        }),
      ];
    }
    return [this.tools.command(session.sessionId, 'RESUME_PLAYBACK')];
  }

  private handleCloudCoaching(
    session: TeachingAgentSession,
    motionId: string,
    speech: string,
  ): TeachingAgentCommand[] {
    if (session.pendingCloudCoachingForMotionId !== motionId) {
      return [];
    }
    session.pendingCloudCoachingForMotionId = undefined;
    return [
      this.tools.command(session.sessionId, 'SHOW_HINT', {
        motionId,
        speech,
        source: 'cloud-vlm',
      }),
    ];
  }

  private completeSession(
    session: TeachingAgentSession,
    plan: TeachingLessonPlan,
  ): TeachingAgentCommand[] {
    session.phase = 'COMPLETED';
    return [
      this.tools.command(session.sessionId, 'SPEAK', {
        speech:
          '完成啦。你不是简单地跟完了一遍，而是真的把动作一点点学会了。最后这遍很有进步，给自己鼓个掌！',
      }),
      this.tools.command(
        session.sessionId,
        'REQUEST_CLOUD_SUMMARY',
        {
          prompt: this.promptCatalog.reference('lesson-session-summary'),
          danceId: plan.danceId,
          completedMotions: session.completedMotions,
        },
        { blocking: false },
      ),
      this.tools.command(session.sessionId, 'SESSION_COMPLETED', {
        danceId: plan.danceId,
      }),
    ];
  }

  private motionDemoCommand(
    session: TeachingAgentSession,
    plan: TeachingLessonPlan,
    motion: TeachingMotionPlan,
    forcedPlaybackRate?: number,
  ): TeachingAgentCommand {
    return this.tools.command(
      session.sessionId,
      'PLAY_MOTION_DEMO',
      {
        danceId: plan.danceId,
        motionId: motion.motionId,
        referenceVideoId: plan.referenceVideoId,
        startMs: motion.demoStartMs,
        endMs: motion.demoEndMs,
        playbackRate: forcedPlaybackRate ?? motion.demoPlaybackRate ?? 0.7,
        bgm: false,
      },
      { requiresAck: true, blocking: true },
    );
  }

  private currentMotion(
    session: TeachingAgentSession,
    plan: TeachingLessonPlan,
  ): TeachingMotionPlan {
    return plan.motions[session.currentMotionIndex];
  }

  private ensureTemplatesReady(plan: TeachingLessonPlan): void {
    const missingMotionIds = plan.motions
      .map((motion) => motion.motionId)
      .filter((motionId) => !this.templateRegistry.has(plan.danceId, motionId));
    if (missingMotionIds.length > 0) {
      throw new BadRequestException({
        success: false,
        code: 'TEACHING_TEMPLATES_NOT_READY',
        message: '教学开始前必须先注册所有动作单元的正确骨骼模板。',
        missingMotionIds,
      });
    }
  }

  private requirePhase(
    session: TeachingAgentSession,
    phase: TeachingAgentPhase,
    eventType: TeachingAgentEvent['type'],
  ): void {
    if (session.phase !== phase) {
      throw this.invalidTransition(session.phase, eventType);
    }
  }

  private invalidTransition(
    phase: TeachingAgentPhase,
    event: TeachingAgentEvent['type'] | TeachingAgentEvent,
  ): BadRequestException {
    const eventType = typeof event === 'string' ? event : event.type;
    return new BadRequestException({
      success: false,
      code: 'INVALID_TEACHING_AGENT_TRANSITION',
      message: `阶段 ${phase} 不能处理事件 ${eventType}。`,
    });
  }

  private turnResult(
    session: TeachingAgentSession,
    commands: TeachingAgentCommand[],
    trace: TeachingAgentTrace,
    idempotentReplay: boolean,
  ): TeachingAgentTurnResult {
    return {
      schemaVersion: 'teaching-agent-turn-v1',
      session,
      commands,
      trace,
      idempotentReplay,
    };
  }

  private trace(
    eventId: string,
    fromPhase: TeachingAgentPhase | undefined,
    toPhase: TeachingAgentPhase,
    commands: TeachingAgentCommand[],
    startedAt: number,
  ): TeachingAgentTrace {
    return {
      runId: `${eventId}-${startedAt}`,
      eventId,
      fromPhase,
      toPhase,
      selectedTools: commands.map((command) => command.tool),
      policy: 'deterministic-teaching-workflow-v1',
      cloudBlocking: false,
      latencyMs: Date.now() - startedAt,
    };
  }
}
