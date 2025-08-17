// /mobile/api.ts
const BASE_URL = (process.env.EXPO_PUBLIC_API_BASE || 'http://localhost:4000').replace(/\/$/, '');

async function tryFetch(path: string, init?: RequestInit) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  if (!res.ok) throw new Error(await res.text());
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}
function toggleApiPrefix(p: string) {
  if (p.startsWith('/api/')) return p.replace('/api/', '/');
  if (p === '/api') return '/';
  return p.startsWith('/') ? `/api${p}` : `/api/${p}`;
}
export async function apiGet(path: string) { try { return await tryFetch(path, { method: 'GET' }); } catch { return await tryFetch(toggleApiPrefix(path), { method: 'GET' }); } }
export async function apiPost(path: string, body?: any) {
  const init: RequestInit = { method: 'POST', body: body ? JSON.stringify(body) : undefined };
  try { return await tryFetch(path, init); } catch { return await tryFetch(toggleApiPrefix(path), init); }
}
export async function apiDelete(path: string) {
  const init: RequestInit = { method: 'DELETE' };
  try { return await tryFetch(path, init); } catch { return await tryFetch(toggleApiPrefix(path), init); }
}
export async function apiGetLogs(path: string) {
  const res: any = await apiGet(path);
  if (typeof res === 'string') return { lines: (res || '').split(/\r?\n/).filter(Boolean), cursor: undefined };
  if (Array.isArray(res)) return { lines: res.map(String), cursor: undefined };
  if (res && Array.isArray(res.lines)) return { lines: res.lines.map(String), cursor: res.cursor };
  if (res && typeof res.text === 'string') return { lines: res.text.split(/\r?\n/).filter(Boolean), cursor: undefined };
  return { lines: [], cursor: undefined };
}
