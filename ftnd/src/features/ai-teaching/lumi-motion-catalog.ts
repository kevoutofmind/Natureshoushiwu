const LUMI_MOTION_FILES: Record<string, string[]> = {
  "dance-001": ["cat1.mp4", "cat2.mp4", "cat3.mp4", "cat4.mp4"],
  "dance-002": ["cloud1.mp4", "cloud2.mp4", "cloud3.mp4", "cloud4.mp4"],
  "dance-003": ["fade1.mp4", "fade2.mp4", "fade3.mp4", "fade4.mp4"],
  "dance-004": ["fightt1.mp4", "fightt2.mp4", "fightt3.mp4", "fighttt4.mp4"],
  "dance-005": ["indoo1.mp4", "indoo2.mp4", "indoo3.mp4", "indoo4.mp4"],
  "dance-006": ["noo1.mp4", "noo2.mp4", "noo3.mp4", "noo4.mp4"],
};

const LUMI_MOTION_TIMELINE_ENDS_MS: Record<string, number[]> = {
  // These are calibrated to the actions displayed in the Lumi sequence, not
  // the durations of the individual motion files. Some clips hold their final
  // pose after the action is complete.
  "dance-001": [7200, 11000, 14200, 18574],
  "dance-002": [5000, 9140, 13130, 16933],
  "dance-003": [3500, 5300, 7400, 10733],
  "dance-004": [4000, 5600, 7500, 11000],
  "dance-005": [3800, 5500, 7600, 9467],
  "dance-006": [4400, 8200, 11900, 15867],
};

export function resolveLumiDanceId(danceId: string): string {
  return danceId in LUMI_MOTION_FILES ? danceId : "dance-001";
}

export function lumiMotionClipUrls(danceId: string): string[] {
  const resolvedDanceId = resolveLumiDanceId(danceId);
  return LUMI_MOTION_FILES[resolvedDanceId].map(
    (fileName) => `/lumi-motions/${resolvedDanceId}/${fileName}`,
  );
}

export function lumiMotionTimelineEndsMs(danceId: string): number[] {
  return LUMI_MOTION_TIMELINE_ENDS_MS[resolveLumiDanceId(danceId)];
}
