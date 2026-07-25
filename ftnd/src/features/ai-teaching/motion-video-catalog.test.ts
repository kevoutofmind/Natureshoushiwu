import { describe, expect, it } from "vitest";
import {
  teachingMotionClipUrl,
  teachingMotionClipUrls,
} from "./motion-video-catalog";

describe("teaching motion video catalog", () => {
  it("maps the four big actions to stable public video paths", () => {
    expect(teachingMotionClipUrls("dance-005")).toEqual([
      "/dances/dance-005/motions/motion-01.mp4",
      "/dances/dance-005/motions/motion-02.mp4",
      "/dances/dance-005/motions/motion-03.mp4",
      "/dances/dance-005/motions/motion-04.mp4",
    ]);
  });

  it("rejects an invalid dance or out-of-range action", () => {
    expect(teachingMotionClipUrl("../secret", 0)).toBeNull();
    expect(teachingMotionClipUrl("dance-001", 4)).toBeNull();
  });
});
