import { describe, expect, it } from "vitest";
import {
  extractLumiWakeCommand,
  resolveLumiWakeTurn,
} from "./lumiWakeWord";

describe("extractLumiWakeCommand", () => {
  it("extracts a command spoken after the English wake word", () => {
    expect(extractLumiWakeCommand("Lumi，显示骨架")).toEqual({
      detected: true,
      commandText: "显示骨架",
    });
  });

  it("accepts a wake word before a second utterance", () => {
    expect(extractLumiWakeCommand("lumi")).toEqual({
      detected: true,
      commandText: "",
    });
  });

  it("accepts common Chinese transcriptions of Lumi", () => {
    expect(extractLumiWakeCommand("露米，慢一点")).toEqual({
      detected: true,
      commandText: "慢一点",
    });
  });

  it("does not wake for an ordinary instruction", () => {
    expect(extractLumiWakeCommand("下一个动作")).toEqual({
      detected: false,
      commandText: "下一个动作",
    });
  });
});

describe("resolveLumiWakeTurn", () => {
  it("keeps an ordinary command inert while Lumi is in standby", () => {
    expect(resolveLumiWakeTurn("下一个动作", false)).toEqual({
      type: "standby",
    });
  });

  it("executes the same command after Lumi has been awakened", () => {
    expect(resolveLumiWakeTurn("下一个动作", true)).toEqual({
      type: "command",
      commandText: "下一个动作",
    });
  });
});
