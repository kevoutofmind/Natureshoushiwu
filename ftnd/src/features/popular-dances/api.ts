import type { PopularDancesResponse } from './types';

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

export async function getPopularDances(): Promise<PopularDancesResponse> {
  const response = await fetch(`${apiBaseUrl}/popular-dances`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`热门手势舞列表加载失败（${response.status}）。`);
  }
  return (await response.json()) as PopularDancesResponse;
}
