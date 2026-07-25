import type { VoiceCommandResult } from "@/features/voice-control/types";

type VideoVoiceTarget = Pick<
  HTMLVideoElement,
  "currentTime" | "playbackRate" | "pause" | "play"
>;

interface RecordingVoiceControls {
  start: () => void | Promise<void>;
  stop: () => void;
}

export const PLAYBACK_RATE_STEPS = [0.5, 0.75, 1, 1.25, 1.5] as const;

export function adjacentPlaybackRate(
  currentRate: number,
  direction: 'slower' | 'faster',
): number {
  if (direction === 'slower') {
    return (
      [...PLAYBACK_RATE_STEPS]
        .reverse()
        .find((rate) => rate < currentRate) ?? PLAYBACK_RATE_STEPS[0]
    );
  }
  return (
    PLAYBACK_RATE_STEPS.find((rate) => rate > currentRate) ??
    PLAYBACK_RATE_STEPS[PLAYBACK_RATE_STEPS.length - 1]
  );
}

export async function executeVideoVoiceCommand(
  result: VoiceCommandResult,
  video: VideoVoiceTarget | null,
): Promise<boolean> {
  if (!result.accepted || !result.command.intent || !video) return false;

  switch (result.command.intent) {
    case "PAUSE":
      video.pause();
      return true;
    case "RESUME":
      await video.play();
      return true;
    case "RESTART":
      video.currentTime = 0;
      await video.play();
      return true;
    case "SLOW_DOWN":
      video.playbackRate = adjacentPlaybackRate(video.playbackRate, 'slower');
      return true;
    case "SPEED_UP":
      video.playbackRate = adjacentPlaybackRate(video.playbackRate, 'faster');
      return true;
    case "SET_PLAYBACK_RATE":
      video.playbackRate =
        PLAYBACK_RATE_STEPS.find(
          (rate) => rate === result.command.parameters.playbackRate,
        ) ?? 1;
      return true;
    default:
      return false;
  }
}

export function executeRecordingVoiceCommand(
  result: VoiceCommandResult,
  controls: RecordingVoiceControls,
): boolean {
  if (!result.accepted) return false;

  if (result.command.intent === "START_RECORDING") {
    void controls.start();
    return true;
  }
  if (result.command.intent === "STOP_RECORDING") {
    controls.stop();
    return true;
  }
  return false;
}
