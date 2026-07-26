import type { RealtimeJudgeResult } from '../contracts/realtime-judge.types';

export type ActionEvaluationOutcome = 'PASSED' | 'FAILED';

export interface ActionEvaluationDecision {
  outcome: ActionEvaluationOutcome;
  result: RealtimeJudgeResult;
}
