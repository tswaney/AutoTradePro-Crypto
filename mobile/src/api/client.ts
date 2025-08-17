// /mobile/src/api/client.ts
// Minimal fetch client with JSON/text handling and DELETE support.

const BASE_URL =
  (typeof process !== 'undefined' && (process as any).env?.EXPO_PUBLIC_API_BASE_URL) ||
  (typeof process !== 'undefined' && (process as any).env?.API_BASE_URL) ||
  'http://localhost:4000';

type Method = 'GET'|'POST'|'DELETE';

async function request<T = any>(method: Method, path: string, body?: any): Promise<T> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  let payload: any = undefined;

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(url, { method, headers, body: payload });
  const ct = res.headers.get('content-type') || '';
  const isJson = ct.includes('application/json');

  if (!res.ok) {
    const errText = isJson ? JSON.stringify(await res.json()).slice(0, 500) : (await res.text()).slice(0, 500);
    throw new Error(errText || `HTTP ${res.status}`);
  }

  if (isJson) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export const apiGet    = <T=any>(path: string) => request<T>('GET', path);
export const apiPost   = <T=any>(path: string, body?: any) => request<T>('POST', path, body);
export const apiDelete = <T=any>(path: string) => request<T>('DELETE', path);

// convenience
export const logout = () => apiPost('/auth/logout', {});
