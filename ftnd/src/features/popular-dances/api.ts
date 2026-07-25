import type { PopularDancesResponse } from './types';

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

const localPopularDances: PopularDancesResponse['data']['items'] = [
  {
    id: 'dance-001',
    title: 'Cat',
    creator: '热门手势舞',
    coverUrl: '/dances/dance-001/reference.mp4',
    runtimeDanceId: 'dance-001',
    durationSeconds: 19,
    difficulty: '新手友好',
  },
  {
    id: 'dance-002',
    title: 'Cloud',
    creator: '热门手势舞',
    coverUrl: '/dances/dance-002/reference.mp4',
    runtimeDanceId: 'dance-002',
    durationSeconds: 17,
    difficulty: '轻松',
  },
  {
    id: 'dance-003',
    title: 'Fade',
    creator: '热门手势舞',
    coverUrl: '/dances/dance-003/reference.mp4',
    runtimeDanceId: 'dance-003',
    durationSeconds: 11,
    difficulty: '轻松',
  },
  {
    id: 'dance-004',
    title: 'Fight',
    creator: '热门手势舞',
    coverUrl: '/dances/dance-004/reference.mp4',
    runtimeDanceId: 'dance-004',
    durationSeconds: 11,
    difficulty: '进阶',
  },
  {
    id: 'dance-005',
    title: 'Indo',
    creator: '热门手势舞',
    coverUrl: '/dances/dance-005/reference.mp4',
    runtimeDanceId: 'dance-005',
    durationSeconds: 9,
    difficulty: '新手友好',
  },
  {
    id: 'dance-006',
    title: 'No',
    creator: '热门手势舞',
    coverUrl: '/dances/dance-006/reference.mp4',
    runtimeDanceId: 'dance-006',
    durationSeconds: 16,
    difficulty: '进阶',
  },
];

function localPopularDancesResponse(): PopularDancesResponse {
  return {
    success: true,
    code: 'LOCAL_POPULAR_DANCES_READY',
    message: '本地热门手势舞视频已加载。',
    data: {
      items: localPopularDances,
      total: localPopularDances.length,
    },
  };
}

export async function getPopularDances(): Promise<PopularDancesResponse> {
  try {
    const response = await fetch(`${apiBaseUrl}/popular-dances`, {
      cache: 'no-store',
    });

    if (!response.ok) {
      return localPopularDancesResponse();
    }

    const result = (await response.json()) as PopularDancesResponse;
    if (result.data?.items?.length) {
      return result;
    }
  } catch {
    return localPopularDancesResponse();
  }

  return localPopularDancesResponse();
}
