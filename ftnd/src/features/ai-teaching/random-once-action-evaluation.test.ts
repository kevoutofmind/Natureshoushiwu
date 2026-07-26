import { describe, expect, it } from "vitest";
import { passesRandomOnceEvaluation } from "./random-once-action-evaluation";

describe("passesRandomOnceEvaluation", () => {
  it("fails an initial evaluation below the threshold", () => {
    expect(passesRandomOnceEvaluation(false, 0.2)).toBe(false);
  });

  it("passes an initial evaluation at or above the threshold", () => {
    expect(passesRandomOnceEvaluation(false, 0.5)).toBe(true);
  });

  it("always passes after the action has failed once", () => {
    expect(passesRandomOnceEvaluation(true, 0)).toBe(true);
  });
});
