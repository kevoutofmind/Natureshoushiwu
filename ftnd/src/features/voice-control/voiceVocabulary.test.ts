import { describe, expect, it } from "vitest";
import { extractImmediateVoiceCommand } from "./immediateVoiceCommands";

describe("voice vocabulary", () => {
  it.each([
    ["请帮我减慢速度", "减慢速度"],
    ["能不能再快一点", "再快一点"],
    ["恢复到正常速度", "正常速度"],
    ["设置为零点七五倍速", "设置为零点七五倍速"],
  ])('extracts spoken command from "%s"', (transcript, command) => {
    expect(extractImmediateVoiceCommand(transcript)).toBe(command);
    expect(extractImmediateVoiceCommand('设置为0,5倍速')).toBe('设置为0.5倍速');
  });
});
