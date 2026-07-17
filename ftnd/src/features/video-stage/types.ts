export type VideoStagePlaybackState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'recording'
  | 'error';

export interface VideoStageSource {
  id: string;
  title: string;
  videoUrl: string;
  durationSeconds?: number;
}

export interface ActionTimelineSegment {
  id: string;
  startSeconds: number;
  endSeconds: number;
  label?: string;
}
