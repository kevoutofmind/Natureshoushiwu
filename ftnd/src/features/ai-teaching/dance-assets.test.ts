import { describe, expect, it } from "vitest";
import { danceAssetId } from "./dance-assets";

describe("dance assets", () => {
  it.each([
    ["cat", "dance-001"],
    ["cloud", "dance-002"],
    ["fade", "dance-003"],
    ["fight", "dance-004"],
    ["indo", "dance-005"],
    ["no", "dance-006"],
  ])("maps runtime dataset %s to public assets %s", (runtimeId, assetId) => {
    expect(danceAssetId(runtimeId)).toBe(assetId);
  });

  it("keeps catalog IDs and rejects unsafe paths", () => {
    expect(danceAssetId("dance-001")).toBe("dance-001");
    expect(danceAssetId("../secret")).toBeNull();
  });
});
