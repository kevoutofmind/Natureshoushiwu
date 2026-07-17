export interface DanceDraft {
  id: string;
  danceId: string | null;
  title: string;
  createdAt: string;
  mimeType: string;
  video: Blob;
}

export type NewDanceDraft = Omit<DanceDraft, 'id' | 'createdAt'>;
