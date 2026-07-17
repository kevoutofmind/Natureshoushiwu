export interface VideoSegment {
  id: string;
  videoId: string;
  startMs: number;
  endMs: number;
  actionLabel?: string;
}

export interface VideoStageSession {
  id: string;
  danceId: string;
  referenceVideoUrl?: string;
}
