export const TEACHING_MOTION_CLIP_COUNT = 4;

export function teachingMotionClipUrl(
  danceId: string,
  motionIndex: number,
): string | null {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(danceId) ||
    !Number.isInteger(motionIndex) ||
    motionIndex < 0 ||
    motionIndex >= TEACHING_MOTION_CLIP_COUNT
  ) {
    return null;
  }

  return `/dances/${danceId}/motions/motion-${String(motionIndex + 1).padStart(2, "0")}.mp4`;
}

export function teachingMotionClipUrls(danceId: string): string[] {
  return Array.from(
    { length: TEACHING_MOTION_CLIP_COUNT },
    (_, index) => teachingMotionClipUrl(danceId, index)!,
  );
}
