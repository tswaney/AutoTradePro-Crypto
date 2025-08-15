// mobile/src/api/client.ts
const BASE_URL = (process.env.EXPO_PUBLIC_API_BASE || 'http://localhost:4000').replace(/\/$/, '');

async function tryHttp(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  if (!res.ok) throw new Error(await res.text());
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

function toggleApiPrefix(p: string) {
  if (p.startsWith('/api/')) return p.replace('/api/', '/');
  if (p === '/api') return '/';
  return p.startsWith('/') ? `/api${p}` : `/api/${p}`;
}

async function http(path: string, init?: RequestInit) {
  try { return await tryHttp(path, init); }
  catch { return await tryHttp(toggleApiPrefix(path), init); }
}

export const api = {
  status: (botId: string) => http(`/bots/${botId}/status`),
  start:  (botId: string) => http(`/bots/${botId}/start`, { method: 'POST' }),
  stop:   (botId: string) => http(`/bots/${botId}/stop`,  { method: 'POST' }),
  summary:(botId: string) => http(`/bots/${botId}/summary`),
  logs:   async function* (botId: string) {
    let cursor: string | undefined = undefined;
    while (true) {
      const p = cursor ? `/bots/${botId}/logs?cursor=${encodeURIComponent(cursor)}` : `/bots/${botId}/logs`;
      const chunk: any = await http(p);
      if (typeof chunk === 'string') {
        yield chunk;
      } else if (chunk && Array.isArray(chunk.lines)) {
        cursor = chunk.cursor ?? cursor;
        yield (chunk.lines || []).join('\n');
      } else if (chunk && typeof chunk.text === 'string') {
        yield chunk.text;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }
};
