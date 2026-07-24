import { describe, expect, it } from "vitest";
import {
  extractImmediateVoiceCommand,
  IMMEDIATE_COMMAND_RESET_DELAY_MS,
} from "./immediateVoiceCommands";

describe("immediate voice commands", () => {
  it("extracts the latest keyword from accumulated speech", () => {
    expect(extractImmediateVoiceCommand("也太慢别太快")).toBe("别太快");
  });

  it("keeps the one-second recognition reset interval", () => {
    expect(IMMEDIATE_COMMAND_RESET_DELAY_MS).toBe(1000);
  });
});
