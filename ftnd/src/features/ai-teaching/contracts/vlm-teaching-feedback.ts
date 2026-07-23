export const VLM_TEACHING_FEEDBACK_EVENT = 'move-match:vlm-teaching-feedback';

export type VlmFlowStatus = 'KEEP_WATCHING' | 'NOT_VISIBLE';

export interface VlmTeachingFeedback {
  shouldAdvance?: boolean;
  shouldPause?: boolean;
  status?: VlmFlowStatus;
  decision?:
    | 'ACCEPT'
    | 'ACCEPT_HINT'
    | 'RETRY'
    | 'KEEP_WATCHING'
    | 'NOT_VISIBLE';
}

export type VlmReactionKind =
  | 'NOT_VISIBLE'
  | 'SLOW_REPLAY'
  | 'ADVANCE'
  | 'KEEP_WATCHING';

export interface VlmReaction {
  kind: VlmReactionKind;
  receivedAt: number;
}

const knownStatuses: ReadonlySet<string> = new Set([
  'KEEP_WATCHING',
  'NOT_VISIBLE',
]);

export function normalizeVlmTeachingFeedback(
  value: unknown,
): VlmTeachingFeedback | null {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Record<string, unknown>;
  const status = candidate.status;
  const decision = candidate.decision;

  return {
    shouldAdvance: candidate.shouldAdvance === true,
    shouldPause: candidate.shouldPause === true,
    status:
      typeof status === 'string' && knownStatuses.has(status)
        ? (status as VlmFlowStatus)
        : undefined,
    decision:
      typeof decision === 'string' &&
      ['ACCEPT', 'ACCEPT_HINT', 'RETRY', 'KEEP_WATCHING', 'NOT_VISIBLE'].includes(
        decision,
      )
        ? (decision as VlmTeachingFeedback['decision'])
        : undefined,
  };
}

export function resolveVlmReaction(
  feedback: VlmTeachingFeedback,
): VlmReactionKind {
  if (feedback.decision === 'NOT_VISIBLE') return 'NOT_VISIBLE';
  if (feedback.shouldAdvance) return 'ADVANCE';
  if (feedback.shouldPause) return 'SLOW_REPLAY';
  if (feedback.decision === 'KEEP_WATCHING') return 'KEEP_WATCHING';
  if (feedback.status === 'KEEP_WATCHING') return 'KEEP_WATCHING';
  if (feedback.status === 'NOT_VISIBLE') return 'NOT_VISIBLE';
  return 'KEEP_WATCHING';
}

export function dispatchVlmTeachingFeedback(feedback: VlmTeachingFeedback) {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(
    new CustomEvent<VlmTeachingFeedback>(VLM_TEACHING_FEEDBACK_EVENT, {
      detail: feedback,
    }),
  );
}
