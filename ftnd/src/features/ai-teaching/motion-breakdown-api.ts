const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

export interface CuratedMotion {
  motionId: string;
  startMs: number;
  endMs: number;
  label: string;
  steps: string[];
}

export interface CuratedMotionBreakdown {
  schemaVersion: 'curated-motion-breakdown-v1';
  danceId: string;
  title: string;
  sourceVideoUrl: string;
  durationMs: number;
  motions: CuratedMotion[];
}

export async function getMotionBreakdown(
  danceId: string,
): Promise<CuratedMotionBreakdown> {
  const response = await fetch(
    `${apiBaseUrl}/video-stage/motion-breakdowns/${encodeURIComponent(danceId)}`,
    { cache: 'no-store' },
  );

  if (!response.ok) throw new Error('Motion breakdown is unavailable.');
  return (await response.json()) as CuratedMotionBreakdown;
}
