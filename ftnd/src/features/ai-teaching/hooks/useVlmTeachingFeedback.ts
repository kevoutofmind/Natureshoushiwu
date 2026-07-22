'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  type VlmReaction,
  type VlmTeachingFeedback,
  VLM_TEACHING_FEEDBACK_EVENT,
  normalizeVlmTeachingFeedback,
  resolveVlmReaction,
} from '../contracts/vlm-teaching-feedback';
import { dispatchTeachingStageCommand } from '@/features/video-stage';

export function useVlmTeachingFeedback() {
  const [reaction, setReaction] = useState<VlmReaction | null>(null);
  const [actionIndex, setActionIndex] = useState(1);

  const applyFeedback = useCallback((feedback: VlmTeachingFeedback) => {
    const kind = resolveVlmReaction(feedback);
    setReaction({ kind, receivedAt: Date.now() });

    if (kind === 'SLOW_REPLAY') {
      dispatchTeachingStageCommand({
        type: 'REPLAY_CURRENT_ACTION',
        playbackRate: 0.5,
      });
    }

    if (kind === 'ADVANCE') {
      setActionIndex((currentIndex) => currentIndex + 1);
      dispatchTeachingStageCommand({ type: 'ADVANCE_ACTION' });
    }
  }, []);

  useEffect(() => {
    const handleFeedbackEvent = (event: Event) => {
      const feedback = normalizeVlmTeachingFeedback(
        (event as CustomEvent<unknown>).detail,
      );
      if (feedback) applyFeedback(feedback);
    };

    window.addEventListener(VLM_TEACHING_FEEDBACK_EVENT, handleFeedbackEvent);
    return () =>
      window.removeEventListener(
        VLM_TEACHING_FEEDBACK_EVENT,
        handleFeedbackEvent,
      );
  }, [applyFeedback]);

  return { actionIndex, applyFeedback, reaction };
}
