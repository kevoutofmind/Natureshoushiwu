import { describe, expect, it } from "vitest";
import { extractVoiceWakeWordPayload } from "./wakeWords";

describe("早上好 wake word", () => {
  it.each(["早上好", "早上号", "早上豪", "早上浩"])(
    "recognizes %s as a wake word",
    (wakeWord) => {
      expect(extractVoiceWakeWordPayload(wakeWord + "，下一个动作")).toEqual({
        matched: true,
        payload: "下一个动作",
      });
    },
  );

  it.each(["Lumi", "Lulu", "Mumu", "Bubu", "露露", "木木", "布布"])(
    "does not keep the old wake word %s",
    (wakeWord) => {
      expect(extractVoiceWakeWordPayload(wakeWord + "，下一个动作").matched).toBe(
        false,
      );
    },
  );
});