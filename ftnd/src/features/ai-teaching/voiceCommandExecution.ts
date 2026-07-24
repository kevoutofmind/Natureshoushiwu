import type { VoiceCommandResult } from "@/features/voice-control/types";

type VideoVoiceTarget = Pick<
  HTMLVideoElement,
  "currentTime" | "playbackRate" | "pause" | "play"
>;

interface RecordingVoiceControls {
  start: () => void | Promise<void>;
  stop: () => void;
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
      video.playbackRate = 0.5;
      return true;
    case "SPEED_UP":
      video.playbackRate = 1.25;
      return true;
    case "SET_PLAYBACK_RATE":
      video.playbackRate = Math.max(
        0.25,
        Math.min(2, result.command.parameters.playbackRate ?? 1),
      );
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
