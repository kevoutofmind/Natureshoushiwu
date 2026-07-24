export interface CuratedMotionBreakdown {
  schemaVersion: 'curated-motion-breakdown-v1';
  danceId: string;
  title: string;
  sourceVideoUrl: string;
  durationMs: number;
  motions: CuratedMotion[];
}

export interface CuratedMotion {
  motionId: string;
  startMs: number;
  endMs: number;
  label: string;
  steps: string[];
}
