export const VIDEO_STAGE_COMMAND_EVENT = 'move-match:video-stage-command';

export type TeachingStageCommand =
  | { type: 'ADVANCE_ACTION' }
  | { type: 'REPLAY_CURRENT_ACTION'; playbackRate: 0.5 };

export function dispatchTeachingStageCommand(command: TeachingStageCommand) {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(
    new CustomEvent<TeachingStageCommand>(VIDEO_STAGE_COMMAND_EVENT, {
      detail: command,
    }),
  );
}
