import type { PopularDancesResponse } from './types';

const virtualDances = [
  {
    id: 'dance-001',
    title: '手势舞 1',
    creator: '入门律动',
    difficulty: '新手友好',
    durationSeconds: 24,
    runtimeDanceId: 'dance-001',
    coverGradient:
      'linear-gradient(145deg, #29104a 0%, #fe2c55 52%, #ff8a5b 100%)',
  },
  {
    id: 'dance-002',
    title: '手势舞 2',
    creator: '镜像节拍',
    difficulty: '轻松',
    durationSeconds: 26,
    runtimeDanceId: 'dance-001',
    coverGradient:
      'linear-gradient(145deg, #071f35 0%, #087f8c 48%, #25f4ee 100%)',
  },
  {
    id: 'dance-003',
    title: '手势舞 3',
    creator: '指尖流动',
    difficulty: '进阶',
    durationSeconds: 28,
    runtimeDanceId: 'dance-001',
    coverGradient:
      'linear-gradient(145deg, #20103f 0%, #6b4eff 50%, #25f4ee 100%)',
  },
  {
    id: 'dance-004',
    title: '手势舞 4',
    creator: '能量定格',
    difficulty: '进阶',
    durationSeconds: 30,
    runtimeDanceId: 'dance-001',
    coverGradient:
      'linear-gradient(145deg, #361303 0%, #ff7a00 50%, #ffd166 100%)',
  },
  {
    id: 'dance-005',
    title: '手势舞 5',
    creator: '舞台挑战',
    difficulty: '挑战',
    durationSeconds: 32,
    runtimeDanceId: 'dance-001',
    coverGradient:
      'linear-gradient(145deg, #071b13 0%, #00a86b 48%, #b8ff6a 100%)',
  },
];

export function getPopularDances(): Promise<PopularDancesResponse> {
  return Promise.resolve({
    success: true,
    code: 'VIRTUAL_POPULAR_DANCES_READY',
    message: '虚拟手势舞列表已加载。',
    data: {
      items: virtualDances,
      total: virtualDances.length,
    },
  });
}
