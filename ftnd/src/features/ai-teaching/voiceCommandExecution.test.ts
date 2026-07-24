import { describe, expect, it } from "vitest";
import type { VoiceCommandResult } from "@/features/voice-control/types";
import {
  executeRecordingVoiceCommand,
  executeVideoVoiceCommand,
} from "./voiceCommandExecution";

function result(
  intent: NonNullable<VoiceCommandResult["command"]["intent"]>,
  playbackRate?: number,
): VoiceCommandResult {
  return {
    accepted: true,
    command: {
      transcript: intent,
      normalizedTranscript: intent,
      intent,
      confidence: 1,
      parameters:
        playbackRate === undefined ? {} : { playbackRate },
    },
    label: intent,
    responseText: intent,
    executionStatus: "not-dispatched",
  };
}

function videoTarget() {
  let pauses = 0;
  let plays = 0;
  return {
    video: {
      currentTime: 8,
      playbackRate: 1,
      pause: () => {
        pauses += 1;
      },
      play: async () => {
        plays += 1;
      },
    },
    pauses: () => pauses,
    plays: () => plays,
  };
}

describe("voice command execution", () => {
  it("controls reference video playback directly", async () => {
    const target = videoTarget();

    await executeVideoVoiceCommand(result("PAUSE"), target.video);
    expect(target.pauses()).toBe(1);
    await executeVideoVoiceCommand(result("RESUME"), target.video);
    expect(target.plays()).toBe(1);
    await executeVideoVoiceCommand(result("RESTART"), target.video);
    expect(target.video.currentTime).toBe(0);
    expect(target.plays()).toBe(2);
  });

  it("sets fixed and requested playback rates", async () => {
    const target = videoTarget();

    await executeVideoVoiceCommand(result("SLOW_DOWN"), target.video);
    expect(target.video.playbackRate).toBe(0.5);
    await executeVideoVoiceCommand(result("SPEED_UP"), target.video);
    expect(target.video.playbackRate).toBe(1.25);
    await executeVideoVoiceCommand(
      result("SET_PLAYBACK_RATE", 1.5),
      target.video,
    );
    expect(target.video.playbackRate).toBe(1.5);
  });

  it("routes recording commands to the page controls", () => {
    let starts = 0;
    let stops = 0;
    const controls = {
      start: () => {
        starts += 1;
      },
      stop: () => {
        stops += 1;
      },
    };

    executeRecordingVoiceCommand(result("START_RECORDING"), controls);
    executeRecordingVoiceCommand(result("STOP_RECORDING"), controls);
    expect(starts).toBe(1);
    expect(stops).toBe(1);
  });
});
