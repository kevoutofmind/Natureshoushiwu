import { describe, expect, it } from "vitest";
import { passesRandomOnceEvaluation } from "./random-once-action-evaluation";

describe("passesRandomOnceEvaluation", () => {
  it("always fails the first evaluation after a refresh", () => {
    expect(passesRandomOnceEvaluation(false, false, 0.99)).toBe(false);
  });

  it("always passes immediately after a failed evaluation", () => {
    expect(passesRandomOnceEvaluation(true, true, 0)).toBe(true);
  });

  it("randomly fails later evaluations below the threshold", () => {
    expect(passesRandomOnceEvaluation(true, false, 0.2)).toBe(false);
  });

  it("randomly passes later evaluations at or above the threshold", () => {
    expect(passesRandomOnceEvaluation(true, false, 0.5)).toBe(true);
  });
});
