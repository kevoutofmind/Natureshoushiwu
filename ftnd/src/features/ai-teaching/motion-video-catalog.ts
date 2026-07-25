import { danceAssetId } from "./dance-assets";

export const TEACHING_MOTION_CLIP_COUNT = 4;

export function teachingMotionClipUrl(
  danceId: string,
  motionIndex: number,
): string | null {
  const assetDanceId = danceAssetId(danceId);
  if (
    !assetDanceId ||
    !Number.isInteger(motionIndex) ||
    motionIndex < 0 ||
    motionIndex >= TEACHING_MOTION_CLIP_COUNT
  ) {
    return null;
  }

  return `/dances/${assetDanceId}/motions/motion-${String(motionIndex + 1).padStart(2, "0")}.mp4`;
}

export function teachingMotionClipUrls(danceId: string): string[] {
  return Array.from(
    { length: TEACHING_MOTION_CLIP_COUNT },
    (_, index) => teachingMotionClipUrl(danceId, index)!,
  );
}
