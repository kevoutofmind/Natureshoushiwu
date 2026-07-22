import {
  createLessonPlanFixture,
  realtimeAgentEvent,
  simpleAgentEvent,
} from '../fixtures/teaching-agent.fixtures';
import {
  createRealtimeJudgeFixture,
  createTemplatePackFixture,
} from '../fixtures/realtime.fixtures';
import { MockVlmProvider } from '../providers/mock-vlm.provider';
import { PromptCatalogService } from '../prompts/prompt-catalog.service';
import { GeometryRuleEngine } from '../rules/geometry-rule.engine';
import { SkeletonTemplateMatcherEngine } from '../rules/skeleton-template-matcher.engine';
import { MotionTemplateRegistry } from '../templates/motion-template.registry';
import { ComparisonInputValidator } from '../validation/comparison-input.validator';
import { RealtimeJudgeValidator } from '../validation/realtime-judge.validator';
import { VlmCoreService } from '../vlm-core.service';
import { LessonPlanRegistry } from './lesson-plan.registry';
import { TeachingAgentService } from './teaching-agent.service';
import { TeachingAgentSessionStore } from './teaching-agent-session.store';
import { TeachingAgentTools } from './teaching-agent.tools';
import { TeachingAgentValidator } from './teaching-agent.validator';

describe('TeachingAgentService', () => {
  function setup(motionIds: string[] = ['motion-001', 'motion-002']) {
    const templateRegistry = new MotionTemplateRegistry();
    const realtimeValidator = new RealtimeJudgeValidator();
    const vlmCore = new VlmCoreService(
      new MockVlmProvider(),
      new GeometryRuleEngine(),
      new ComparisonInputValidator(),
      new SkeletonTemplateMatcherEngine(),
      templateRegistry,
      realtimeValidator,
    );
    for (const motionId of motionIds) {
      const pack = createTemplatePackFixture();
      pack.motionId = motionId;
      pack.templates = pack.templates.map((template) => ({
        ...template,
        templateId: `${template.templateId}-${motionId}`,
      }));
      vlmCore.registerMotionTemplate(pack);
    }

    const promptCatalog = new PromptCatalogService();
    const agent = new TeachingAgentService(
      vlmCore,
      new LessonPlanRegistry(),
      new TeachingAgentSessionStore(),
      new TeachingAgentTools(),
      new TeachingAgentValidator(),
      templateRegistry,
      promptCatalog,
    );
    agent.registerLesson(createLessonPlanFixture(motionIds));
    return { agent };
  }

  it('runs preview, unit teaching, local judging and full challenge', () => {
    const { agent } = setup();
    const started = agent.startSession({
      schemaVersion: 'teaching-agent-start-v1',
      sessionId: 'agent-session-1',
      danceId: 'dance-001',
    });

    expect(started.session.phase).toBe('PREVIEW');
    expect(started.commands.map((command) => command.tool)).toContain(
      'PLAY_FULL_PREVIEW',
    );

    const demo = agent.handleEvent(
      simpleAgentEvent(
        'agent-session-1',
        'preview-done',
        'PREVIEW_FINISHED',
        0,
      ),
    );
    expect(demo.session.phase).toBe('MOTION_DEMO');

    const practice = agent.handleEvent(
      simpleAgentEvent(
        'agent-session-1',
        'demo-1-done',
        'MOTION_DEMO_FINISHED',
        1,
      ),
    );
    expect(practice.session.phase).toBe('PRACTICE');

    const firstPassed = agent.handleEvent(
      realtimeAgentEvent(
        'agent-session-1',
        'judge-1',
        'sample-1',
        createRealtimeJudgeFixture('correct').observation,
        2,
      ),
    );
    expect(firstPassed.session.currentMotionId).toBe('motion-002');
    expect(firstPassed.session.phase).toBe('MOTION_DEMO');

    agent.handleEvent(
      simpleAgentEvent(
        'agent-session-1',
        'demo-2-done',
        'MOTION_DEMO_FINISHED',
        3,
      ),
    );
    const secondPassed = agent.handleEvent(
      realtimeAgentEvent(
        'agent-session-1',
        'judge-2',
        'sample-2',
        createRealtimeJudgeFixture('correct').observation,
        4,
      ),
    );

    expect(secondPassed.session.phase).toBe('FULL_CHALLENGE');
    expect(secondPassed.commands.map((command) => command.tool)).toContain(
      'START_FULL_CHALLENGE',
    );

    const completed = agent.handleEvent(
      simpleAgentEvent(
        'agent-session-1',
        'challenge-done',
        'FULL_CHALLENGE_FINISHED',
        5,
      ),
    );
    expect(completed.session.phase).toBe('COMPLETED');
    expect(completed.commands.map((command) => command.tool)).toContain(
      'REQUEST_CLOUD_SUMMARY',
    );
  });

  it('replays an idempotent event without advancing the session twice', () => {
    const { agent } = setup(['motion-001']);
    agent.startSession({
      schemaVersion: 'teaching-agent-start-v1',
      sessionId: 'agent-session-idempotent',
      danceId: 'dance-001',
    });
    const event = simpleAgentEvent(
      'agent-session-idempotent',
      'same-event',
      'PREVIEW_FINISHED',
      0,
    );

    const first = agent.handleEvent(event);
    const replay = agent.handleEvent(event);

    expect(first.session.version).toBe(1);
    expect(replay.session.version).toBe(1);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.commands).toEqual(first.commands);
  });

  it('uses local retry policy and requests non-blocking cloud coaching', () => {
    const { agent } = setup(['motion-001']);
    agent.startSession({
      schemaVersion: 'teaching-agent-start-v1',
      sessionId: 'agent-session-retry',
      danceId: 'dance-001',
    });
    agent.handleEvent(
      simpleAgentEvent(
        'agent-session-retry',
        'preview-done',
        'PREVIEW_FINISHED',
        0,
      ),
    );
    agent.handleEvent(
      simpleAgentEvent(
        'agent-session-retry',
        'demo-done',
        'MOTION_DEMO_FINISHED',
        1,
      ),
    );
    const badObservation = createRealtimeJudgeFixture('incorrect').observation;
    const firstFailure = agent.handleEvent(
      realtimeAgentEvent(
        'agent-session-retry',
        'failure-1',
        'bad-sample-1',
        badObservation,
        2,
      ),
    );
    expect(firstFailure.session.phase).toBe('MOTION_DEMO');
    expect(firstFailure.commands.map((command) => command.tool)).not.toContain(
      'REQUEST_CLOUD_COACHING',
    );

    agent.handleEvent(
      simpleAgentEvent(
        'agent-session-retry',
        'retry-demo-done',
        'MOTION_DEMO_FINISHED',
        3,
      ),
    );
    const assisted = agent.handleEvent(
      realtimeAgentEvent(
        'agent-session-retry',
        'failure-2',
        'bad-sample-2',
        badObservation,
        4,
      ),
    );

    expect(assisted.session.phase).toBe('FULL_CHALLENGE');
    const cloudCommand = assisted.commands.find(
      (command) => command.tool === 'REQUEST_CLOUD_COACHING',
    );
    expect(cloudCommand).toBeDefined();
    expect(cloudCommand?.blocking).toBe(false);
    expect(cloudCommand?.arguments.prompt).toEqual({
      promptId: 'adaptive-motion-coaching',
      version: 'adaptive-motion-coaching-v1.0.0',
    });
  });

  it('never lets asynchronous cloud coaching control progression', () => {
    const { agent } = setup(['motion-001']);
    agent.startSession({
      schemaVersion: 'teaching-agent-start-v1',
      sessionId: 'agent-session-cloud',
      danceId: 'dance-001',
    });
    agent.handleEvent({
      schemaVersion: 'teaching-agent-event-v1',
      sessionId: 'agent-session-cloud',
      eventId: 'cloud-ready',
      type: 'CLOUD_COACHING_READY',
      motionId: 'motion-001',
      speech: '先单独练右手。',
      expectedVersion: 0,
    });

    const state = agent.getSession('agent-session-cloud');
    expect(state.phase).toBe('PREVIEW');
    expect(state.version).toBe(1);
  });
});
