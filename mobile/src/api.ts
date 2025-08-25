// mobile/api.ts
// Locked to localhost so the iOS Simulator reaches your Mac directly.
// You can later override with EXPO_PUBLIC_API_BASE when moving to Azure.
const RAW_BASE = (process.env.EXPO_PUBLIC_API_BASE || 'http://localhost:7071').replace(/\/$/, '');
console.log('API BASE =>', RAW_BASE);  // <— keep this while debugging

function withApiPrefix(path: string) {
  return path.startsWith('/api') ? path : `/api${path}`;
}

type Opts = RequestInit & { json?: any };

async function req(path: string, opts: Opts = {}) {
  const url = `${RAW_BASE}${withApiPrefix(path)}`;
  const init: RequestInit = {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.json != null ? JSON.stringify(opts.json) : opts.body,
  };
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(await res.text().catch(() => 'Request failed'));
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

export const apiGet = <T = any>(path: string) => req(path) as Promise<T>;
export const apiPost = <T = any>(path: string, json?: any) =>
  req(path, { method: 'POST', json }) as Promise<T>;
export const apiDelete = <T = any>(path: string) =>
  req(path, { method: 'DELETE' }) as Promise<T>;

export async function apiProbe(path: string): Promise<boolean> {
  try {
    const res = await fetch(`${RAW_BASE}${withApiPrefix(path)}`, { method: 'GET' });
    if (!res.ok) return false;
    const txt = await res.text();
    return !!txt.trim();
  } catch {
    return false;
  }
}

export async function logout() {
  try {
    await apiPost('/auth/logout');
  } catch {}
}
