export interface PopularDance {
  id: string;
  title: string;
  creator?: string;
  coverUrl?: string;
  coverGradient?: string;
  runtimeDanceId?: string;
  durationSeconds?: number;
  difficulty?: string;
}

export interface PopularDancesResponse {
  success: boolean;
  code: string;
  message: string;
  data: {
    items: PopularDance[];
    total: number;
  };
}
