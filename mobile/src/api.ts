import { API_BASE, WS_BASE } from './config';

/** Optional: hook to handle 401s globally (e.g., force sign-out) */
let onAuthFailed: (() => void) | null = null;
export function setAuthFailedHandler(fn: () => void) {
  onAuthFailed = fn;
}

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(message: string, status: number, body: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** Core request with timeout & consistent errors */
async function request<T>(
  method: HttpMethod,
  path: string,
  token: string,
  body?: any,
  timeoutMs = 20000
): Promise<T> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': body ? 'application/json' : undefined as any,
        Authorization: `Bearer ${token}`,
      } as any,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    let parsed: any = null;
    const text = await res.text();
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }

    if (!res.ok) {
      if (res.status === 401 && onAuthFailed) onAuthFailed();
      throw new ApiError(typeof parsed === 'string' ? parsed : (parsed?.message || 'API error'), res.status, parsed);
    }

    return parsed as T;
  } finally {
    clearTimeout(t);
  }
}

/** Public helpers */
export function apiGet<T = any>(path: string, token: string) {
  return request<T>('GET', path, token);
}
export function apiPost<T = any>(path: string, token: string, body?: any) {
  return request<T>('POST', path, token, body);
}
export function apiPatch<T = any>(path: string, token: string, body?: any) {
  return request<T>('PATCH', path, token, body);
}
export function apiDelete<T = any>(path: string, token: string) {
  return request<T>('DELETE', path, token);
}

/** Tiny helper to build query strings */
export function q(params: Record<string, string | number | boolean | undefined | null>) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

/** WebSocket for live logs (token via query param for simplicity) */
export function openLogsSocket(botId: string, token: string): WebSocket {
  const url = `${WS_BASE}/bots/${encodeURIComponent(botId)}/logs/stream${q({ access_token: token })}`;
  return new WebSocket(url);
}
