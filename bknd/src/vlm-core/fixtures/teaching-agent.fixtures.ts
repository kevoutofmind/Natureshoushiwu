import type {
  TeachingAgentEvent,
  TeachingLessonPlan,
} from '../contracts/teaching-agent.types';
import type { PracticeSkeletonObservation } from '../contracts/realtime-judge.types';

export function createLessonPlanFixture(
  motionIds: string[] = ['motion-001', 'motion-002'],
): TeachingLessonPlan {
  return {
    schemaVersion: 'teaching-lesson-plan-v1',
    danceId: 'dance-001',
    title: '测试手势舞',
    referenceVideoId: 'reference-video-a',
    previewStartMs: 0,
    previewEndMs: 9000,
    policy: {
      maxRetriesPerMotion: 1,
      allowVoiceSkip: true,
      autoAdvanceAfterMaxRetries: true,
    },
    motions: motionIds.map((motionId, index) => ({
      motionId,
      instruction: `教学动作 ${index + 1}`,
      demoStartMs: index * 3000,
      demoEndMs: (index + 1) * 3000,
      demoPlaybackRate: 0.7,
    })),
  };
}

export function simpleAgentEvent(
  sessionId: string,
  eventId: string,
  type: 'PREVIEW_FINISHED' | 'MOTION_DEMO_FINISHED' | 'FULL_CHALLENGE_FINISHED',
  expectedVersion?: number,
): TeachingAgentEvent {
  return {
    schemaVersion: 'teaching-agent-event-v1',
    sessionId,
    eventId,
    type,
    expectedVersion,
  };
}

export function realtimeAgentEvent(
  sessionId: string,
  eventId: string,
  sampleId: string,
  observation: PracticeSkeletonObservation,
  expectedVersion?: number,
): TeachingAgentEvent {
  return {
    schemaVersion: 'teaching-agent-event-v1',
    sessionId,
    eventId,
    type: 'REALTIME_OBSERVATION',
    sampleId,
    observation,
    expectedVersion,
  };
}
