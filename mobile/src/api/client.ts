// mobile/src/api/client.ts
const BASE_URL = process.env.EXPO_PUBLIC_API_BASE || 'http://localhost:4000';

async function http(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  if (!res.ok) throw new Error(await res.text());
  return res.headers.get('content-type')?.includes('application/json') ? res.json() : res.text();
}

export const api = {
  status: (botId: string) => http(`/api/bots/${botId}/status`),
  start: (botId: string) => http(`/api/bots/${botId}/start`, { method: 'POST' }),
  stop: (botId: string) => http(`/api/bots/${botId}/stop`, { method: 'POST' }),
  summary: (botId: string) => http(`/api/bots/${botId}/summary`),
  logs: async function* (botId: string) {
    while (true) {
      const chunk = await http(`/api/bots/${botId}/logs?since=now`);
      yield chunk as string;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
};