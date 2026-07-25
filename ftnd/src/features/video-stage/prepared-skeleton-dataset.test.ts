import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPreparedReferenceDataset } from "./prepared-skeleton-dataset";

describe("buildPreparedReferenceDataset", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps one dance class isolated and marks sequence 1 as the primary example", async () => {
    const raw = await readFile(
      path.resolve(process.cwd(), "..", "bknd", "data", "cat.json"),
      "utf8",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(raw, { status: 200 })),
    );

    const dataset = await buildPreparedReferenceDataset("dance-001");

    expect(dataset.sourceVideoCount).toBe(10);
    expect(dataset.templatePacks.length).toBeGreaterThan(1);
    for (const pack of dataset.templatePacks) {
      expect(pack.templates).toHaveLength(10);
      expect(
        pack.templates.filter(
          (template) => template.referenceRole === "primary",
        ),
      ).toHaveLength(1);
      expect(
        pack.templates.every((template) =>
          template.sourceVideoId.startsWith("cat ("),
        ),
      ).toBe(true);
      expect(pack.evaluationPolicy.primaryTemplateWeight).toBe(0.7);
      expect(pack.evaluationPolicy.generalizationTemplateCount).toBe(3);
      expect(pack.evaluationPolicy.scoringProfile).toBe("balanced");
    }
  });

  it("builds fade as a hand-only, index-aligned temporal profile", async () => {
    const raw = await readFile(
      path.resolve(process.cwd(), "..", "bknd", "data", "fade.json"),
      "utf8",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(raw, { status: 200 })),
    );

    const dataset = await buildPreparedReferenceDataset("dance-003");

    expect(dataset.sourceVideoCount).toBe(10);
    for (const pack of dataset.templatePacks) {
      expect(pack.templates).toHaveLength(10);
      expect(pack.requiredParts).toEqual(["left_hand", "right_hand"]);
      expect(pack.evaluationPolicy.scoringProfile).toBe(
        "hands-position-temporal",
      );
    }
  });
});
