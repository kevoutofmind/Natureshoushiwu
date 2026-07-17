export const AUTH_STORAGE_KEY = 'tiktok_ai_auth';

export interface AuthUser {
  id: string;
  email: string;
  createdAt: string;
}

export interface AuthSession {
  accessToken: string;
  user: AuthUser;
}

export interface AuthApiResponse {
  success: boolean;
  code: string;
  message: string;
  data?: AuthSession;
  fieldErrors?: Partial<Record<'email' | 'password', string>>;
}

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

export async function submitCredentials(
  mode: 'login' | 'signup',
  credentials: { email: string; password: string },
): Promise<AuthApiResponse> {
  try {
    const response = await fetch(`${apiBaseUrl}/users/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    const payload = (await response.json()) as AuthApiResponse;

    if (!response.ok) {
      return {
        success: false,
        code: payload.code ?? 'REQUEST_FAILED',
        message: payload.message ?? '请求失败，请稍后再试。',
        fieldErrors: payload.fieldErrors,
      };
    }

    return payload;
  } catch {
    return {
      success: false,
      code: 'API_UNAVAILABLE',
      message: '无法连接登录服务，请确认 NestJS 后端已启动。',
    };
  }
}

export function saveSession(session: AuthSession) {
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

export function readSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = window.localStorage.getItem(AUTH_STORAGE_KEY);
    return stored ? (JSON.parse(stored) as AuthSession) : null;
  } catch {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    return null;
  }
}

export function clearSession() {
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}
