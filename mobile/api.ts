// /mobile/api.ts  (kept as in prior patch; included for completeness)
const BASE = process.env.EXPO_PUBLIC_API_BASE || 'http://localhost:4000';
type Json = any;
async function http<T = Json>(path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith('http') ? path : BASE + (path.startsWith('/') ? path : `/${path}`);
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  const text = await res.text();
  const ct = res.headers.get('content-type') || '';
  const isJson = ct.includes('application/json');
  const isHtml = ct.includes('text/html');
  const data = isJson ? (text ? JSON.parse(text) : {}) : text;
  if (!res.ok) {
    const msg = isHtml ? res.statusText || 'Request failed' : (typeof data === 'string' ? data : (data?.message || res.statusText));
    throw new Error(msg);
  }
  // @ts-ignore
  return data;
}
export const apiGet = <T = Json>(path: string) => http<T>(path, { method: 'GET' });
export const apiPost = <T = Json>(path: string, body?: any) => http<T>(path, { method: 'POST', body: body == null ? undefined : JSON.stringify(body) });
export const apiDelete = <T = Json>(path: string) => http<T>(path, { method: 'DELETE' });
export async function logout() {
  const tryReq = async (fn: () => Promise<any>) => { try { await fn(); return true; } catch { return false; } };
  await tryReq(() => apiPost('/auth/logout')) || await tryReq(() => apiPost('/auth/signout')) || await tryReq(() => apiGet('/auth/signout'));
}
