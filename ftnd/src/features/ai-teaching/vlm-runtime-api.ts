import type { ReferenceDanceDataset } from '@/features/video-stage/reference-dataset.types';
import type {
  TeachingAgentEventInput,
  TeachingAgentTurnResult,
} from './contracts/teaching-runtime';

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

export async function listReferenceDatasets(): Promise<
  Array<{ danceId: string; motionCount: number; sourceVideoCount: number }>
> {
  return request('/vlm-core/agent/datasets');
}

export async function getReferenceDataset(
  danceId: string,
): Promise<ReferenceDanceDataset | null> {
  const response = await fetch(
    `${apiBaseUrl}/vlm-core/agent/datasets/${encodeURIComponent(danceId)}`,
    { cache: 'no-store' },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`读取参考模板失败（${response.status}）。`);
  }
  return (await response.json()) as ReferenceDanceDataset;
}

export async function registerReferenceDataset(
  dataset: ReferenceDanceDataset,
): Promise<{ danceId: string; motionCount: number; referenceCount: number }> {
  return request('/vlm-core/agent/datasets/register', {
    method: 'POST',
    body: JSON.stringify(dataset),
  });
}

export async function startTeachingSession(
  sessionId: string,
  danceId: string,
): Promise<TeachingAgentTurnResult> {
  return request('/vlm-core/agent/sessions/start', {
    method: 'POST',
    body: JSON.stringify({
      schemaVersion: 'teaching-agent-start-v1',
      sessionId,
      danceId,
    }),
  });
}

export async function sendTeachingAgentEvent(
  sessionId: string,
  eventId: string,
  expectedVersion: number,
  event: TeachingAgentEventInput,
): Promise<TeachingAgentTurnResult> {
  return request('/vlm-core/agent/sessions/event', {
    method: 'POST',
    body: JSON.stringify({
      schemaVersion: 'teaching-agent-event-v1',
      sessionId,
      eventId,
      expectedVersion,
      ...event,
    }),
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    cache: 'no-store',
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
      code?: string;
    } | null;
    throw new Error(
      payload?.message ?? payload?.code ?? `教学服务请求失败（${response.status}）。`,
    );
  }
  return (await response.json()) as T;
}
