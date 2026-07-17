import type { TeachingWorkspaceResponse } from './types';

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

export async function getTeachingWorkspace(
  danceId?: string,
): Promise<TeachingWorkspaceResponse> {
  const query = danceId ? `?danceId=${encodeURIComponent(danceId)}` : '';
  const response = await fetch(`${apiBaseUrl}/ai-teaching/workspace${query}`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('AI 教学工作台服务暂时不可用。');
  }

  return (await response.json()) as TeachingWorkspaceResponse;
}
