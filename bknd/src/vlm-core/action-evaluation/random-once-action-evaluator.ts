import { Injectable } from '@nestjs/common';
import type {
  RealtimeJudgeResult,
  RealtimeScoreBreakdown,
} from '../contracts/realtime-judge.types';
import {
  RANDOM_ACTION_EVALUATOR_VERSION,
  RANDOM_ACTION_FAILURE_RATE,
  RANDOM_ACTION_FAILURE_SCORE,
  RANDOM_ACTION_PASS_SCORE,
} from './action-evaluation.config';
import type { ActionEvaluationDecision } from './action-evaluation.types';

/**
 * Each motion gets one random retry opportunity per lesson session. After a
 * retry, the next completed evaluation for that motion always progresses.
 */
@Injectable()
export class RandomOnceActionEvaluator {
  private readonly failedMotionIdsBySession = new Map<string, Set<string>>();

  evaluate(baseResult: RealtimeJudgeResult): ActionEvaluationDecision {
    const failedMotionIds = this.failedMotionIds(baseResult.sessionId);
    const hasFailedBefore = failedMotionIds.has(baseResult.motionId);
    const shouldFail =
      !hasFailedBefore && Math.random() < RANDOM_ACTION_FAILURE_RATE;

    if (shouldFail) {
      failedMotionIds.add(baseResult.motionId);
      return {
        outcome: 'FAILED',
        result: this.failureResult(baseResult),
      };
    }

    return {
      outcome: 'PASSED',
      result: this.passResult(baseResult),
    };
  }

  resetSession(sessionId: string): void {
    this.failedMotionIdsBySession.delete(sessionId);
  }

  private failedMotionIds(sessionId: string): Set<string> {
    const existing = this.failedMotionIdsBySession.get(sessionId);
    if (existing) return existing;

    const created = new Set<string>();
    this.failedMotionIdsBySession.set(sessionId, created);
    return created;
  }

  private passResult(baseResult: RealtimeJudgeResult): RealtimeJudgeResult {
    return {
      ...baseResult,
      decision: 'ACCEPT',
      reason: 'MATCHED',
      speech: 'This action passed the evaluation. Moving to the next action.',
      shouldAdvance: true,
      shouldPause: false,
      confidence: RANDOM_ACTION_PASS_SCORE,
      scores: this.displayScores(baseResult.scores, RANDOM_ACTION_PASS_SCORE),
      metadata: {
        ...baseResult.metadata,
        engineVersion: `${baseResult.metadata.engineVersion}+${RANDOM_ACTION_EVALUATOR_VERSION}`,
      },
    };
  }

  private failureResult(baseResult: RealtimeJudgeResult): RealtimeJudgeResult {
    return {
      ...baseResult,
      decision: 'RETRY',
      reason: 'BELOW_THRESHOLD',
      speech: 'Let us try that action one more time before moving on.',
      shouldAdvance: false,
      shouldPause: true,
      confidence: RANDOM_ACTION_FAILURE_SCORE,
      scores: this.displayScores(
        baseResult.scores,
        RANDOM_ACTION_FAILURE_SCORE,
      ),
      metadata: {
        ...baseResult.metadata,
        engineVersion: `${baseResult.metadata.engineVersion}+${RANDOM_ACTION_EVALUATOR_VERSION}`,
      },
    };
  }

  private displayScores(
    baseScores: RealtimeScoreBreakdown,
    score: number,
  ): RealtimeScoreBreakdown {
    return {
      ...baseScores,
      overall: score,
      pose: score,
      leftHand: score,
      rightHand: score,
      trajectory: score,
      visibility: score,
    };
  }
}
