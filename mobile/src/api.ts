// mobile/src/api.ts
// Helper for the control-plane API used by the mobile app.
// Set EXPO_PUBLIC_API_BASE in mobile/.env for your dev server (e.g., http://localhost:4000)

export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE?.replace(/\/+$/, "") || "http://localhost:4000";

type FetchOpts = {
  method?: "GET" | "POST" | "DELETE" | "PUT" | "PATCH";
  body?: any;
  headers?: Record<string, string>;
};

async function request<T = any>(path: string, opts: FetchOpts = {}): Promise<T> {
  const url = `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url, {
    method: opts.method || "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.text();
  const data = (() => {
    try {
      return text ? JSON.parse(text) : ({} as any);
    } catch {
      // return raw text if not JSON
      return { raw: text };
    }
  })();

  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
    throw new Error(`API error: ${msg}`);
  }
  return data as T;
}

export function apiGet<T = any>(path: string): Promise<T> {
  return request<T>(path, { method: "GET" });
}
export function apiPost<T = any>(path: string, body?: any): Promise<T> {
  return request<T>(path, { method: "POST", body });
}
export async function apiGetText(path: string): Promise<string> {
  const url = `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ---- Types & helpers for the bot screens ----
export type BotSummary = {
  beginningPortfolioValue: number | null;
  duration: string | null;
  buys: number;
  sells: number;
  totalPL: number;      // live Total P/L
  cash: number | null;
  cryptoMkt: number | null;
  locked: number | null;
  currentValue: number; // live current portfolio value
  dayPL: number;        // today's realized P/L
  pl24h?: number;       // NEW: trailing 24h total P/L
  pl24hAvg?: number;    // NEW: trailing 24h avg per hour
};

// Coercion helpers (server may send strings)
const n = (v: any): number => (v == null ? 0 : Number(v));
const nOrNull = (v: any): number | null =>
  v == null || v === "" ? null : Number(v);

export const getBotSummary = async (botId: string): Promise<BotSummary> => {
  const raw = await apiGet<any>(`/api/bots/${encodeURIComponent(botId)}/summary`);
  const s = raw?.summary ?? raw; // tolerate both wrapped and unwrapped shapes

  // If the server returned nothing, provide a safe empty summary so UI doesn't break
  if (!s || typeof s !== "object") {
    return {
      beginningPortfolioValue: null,
      duration: null,
      buys: 0,
      sells: 0,
      totalPL: 0,
      cash: null,
      cryptoMkt: null,
      locked: null,
      currentValue: 0,
      dayPL: 0,
      pl24h: 0,
      pl24hAvg: 0,
    };
  }

  return {
    beginningPortfolioValue: nOrNull(s.beginningPortfolioValue),
    duration: s.duration ?? null,
    buys: n(s.buys || 0),
    sells: n(s.sells || 0),
    totalPL: n(s.totalPL),
    cash: nOrNull(s.cash),
    cryptoMkt: nOrNull(s.cryptoMkt),
    locked: nOrNull(s.locked),
    currentValue: n(s.currentValue),
    dayPL: n(s.dayPL),
    pl24h: s.pl24h == null ? undefined : n(s.pl24h),
    pl24hAvg: s.pl24hAvg == null ? undefined : n(s.pl24hAvg),
  };
};

export const startBot = (botId: string) =>
  apiPost(`/api/bots/${encodeURIComponent(botId)}/start`);

export const stopBot = (botId: string) =>
  apiPost(`/api/bots/${encodeURIComponent(botId)}/stop`);

export const getBotLog = (botId: string, tail = 200) =>
  apiGetText(`/api/bots/${encodeURIComponent(botId)}/log?tail=${tail}`);

// Optional: list bots if your control-plane exposes it
export type BotListItem = { id: string; name?: string; status?: string };
export const listBots = () => apiGet<BotListItem[]>(`/api/bots`);
