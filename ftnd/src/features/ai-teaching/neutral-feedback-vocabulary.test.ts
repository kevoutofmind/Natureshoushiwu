import { describe, expect, it } from "vitest";
import { DANCE_NEUTRAL_FEEDBACK_VOCABULARY } from "./dance-neutral-feedback-vocabulary";
import {
  buildNeutralFailurePrompt,
  NEUTRAL_FEEDBACK_VOCABULARY,
  selectNeutralFeedbackCues,
} from "./neutral-feedback-vocabulary";

describe("neutral feedback vocabulary", () => {
  it("draws generic cues from two different categories", () => {
    const cues = selectNeutralFeedbackCues({
      random: sequenceRandom([0, 0, 0, 0, 0]),
      limit: 2,
    });

    expect(cues).toHaveLength(2);
    expect(cues).toContain(NEUTRAL_FEEDBACK_VOCABULARY.framing[0]);
    expect(cues).toContain(NEUTRAL_FEEDBACK_VOCABULARY.posture[0]);
  });

  it("changes the combination when random choices change", () => {
    const first = selectNeutralFeedbackCues({ random: () => 0, limit: 2 });
    const second = selectNeutralFeedbackCues({ random: () => 0.99, limit: 2 });

    expect(first).not.toEqual(second);
  });

  it("combines the current dance cue with two generic categories", () => {
    const cues = selectNeutralFeedbackCues({
      danceId: "dance-001",
      actionIndex: 2,
      random: () => 0,
      limit: 3,
    });

    expect(cues).toHaveLength(3);
    expect(
      cues.some((cue) =>
        DANCE_NEUTRAL_FEEDBACK_VOCABULARY["dance-001"].actions[2].includes(cue),
      ),
    ).toBe(true);
    expect(cues).toContain(NEUTRAL_FEEDBACK_VOCABULARY.framing[0]);
    expect(cues).toContain(NEUTRAL_FEEDBACK_VOCABULARY.posture[0]);
  });

  it("uses the active dance when choosing the customized cue", () => {
    const catCues = selectNeutralFeedbackCues({
      danceId: "dance-001",
      actionIndex: 0,
      random: () => 0,
      limit: 3,
    });
    const cloudCues = selectNeutralFeedbackCues({
      danceId: "dance-002",
      actionIndex: 0,
      random: () => 0,
      limit: 3,
    });

    expect(catCues).not.toEqual(cloudCues);
  });

  it("builds a gentle randomized retry prompt", () => {
    const prompt = buildNeutralFailurePrompt({
      danceId: "dance-006",
      actionIndex: 3,
      random: () => 0,
      limit: 3,
    });

    expect(prompt).toContain("先别着急");
    expect(prompt).toContain("再完整跟一遍");
  });
});

function sequenceRandom(values: readonly number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length];
    index += 1;
    return value;
  };
}