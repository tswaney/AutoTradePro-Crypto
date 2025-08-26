// mobile/src/api.ts
// Control-plane API helpers for the mobile app.
// Set EXPO_PUBLIC_API_BASE in mobile/.env (e.g., http://localhost:4000)

export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE?.replace(/\/+$/, "") || "http://localhost:4000";

/* ------------------------------ core fetchers ------------------------------ */

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
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
    throw new Error(`API error: ${msg}`);
  }
  return data as T;
}

export const apiGet = <T = any>(path: string) =>
  request<T>(path, { method: "GET" });

export const apiPost = <T = any>(path: string, body?: any) =>
  request<T>(path, { method: "POST", body });

export async function apiGetText(path: string): Promise<string> {
  const url = `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/* ---------------------------------- types --------------------------------- */

export type BotSummary = {
  beginningPortfolioValue: number | null;
  duration: string | null;
  buys: number;
  sells: number;
  totalPL: number;       // live Total P/L
  cash: number | null;
  cryptoMkt: number | null;
  locked: number | null;
  currentValue: number;  // live current portfolio value
  dayPL: number;         // today's realized P/L
  pl24h?: number;        // trailing 24h total P/L (if available)
  pl24hAvg?: number;     // trailing 24h avg per hour (if available)
  strategy?: string | null; // active strategy
};

export type BotListItem = { id: string; name?: string; status?: string };
export type BotOverview = { id: string; name?: string; status?: string; summary: BotSummary };

/* ------------------------------ coercion utils ----------------------------- */

const n = (v: any): number => (v == null || v === "" ? 0 : Number(v));
const nOrNull = (v: any): number | null =>
  v == null || v === "" ? null : Number(v);

/* ------------------------------- API helpers ------------------------------ */

export const listBots = async (): Promise<BotListItem[]> => {
  const arr = await apiGet<any[]>(`/api/bots`);
  return Array.isArray(arr)
    ? arr.map((b) => ({
        id: String(b.id ?? b.name ?? "unknown"),
        name: typeof b.name === "string" ? b.name : String(b.id ?? ""),
        status: typeof b.status === "string" ? b.status : undefined,
      }))
    : [];
};

/** Wraps /api/bots/:id/summary and returns { id, name, status, summary } */
export const getBotOverview = async (botId: string): Promise<BotOverview> => {
  const raw = await apiGet<any>(`/api/bots/${encodeURIComponent(botId)}/summary`);
  const s = raw?.summary ?? raw;

  const summary: BotSummary =
    s && typeof s === "object"
      ? {
          beginningPortfolioValue: nOrNull(s.beginningPortfolioValue),
          duration: s.duration ?? null,
          buys: n(s.buys),
          sells: n(s.sells),
          totalPL: n(s.totalPL),
          cash: nOrNull(s.cash),
          cryptoMkt: nOrNull(s.cryptoMkt),
          locked: nOrNull(s.locked),
          currentValue: n(s.currentValue),
          dayPL: n(s.dayPL),
          pl24h: s.pl24h == null ? undefined : n(s.pl24h),
          pl24hAvg: s.pl24hAvg == null ? undefined : n(s.pl24hAvg),
          strategy:
            typeof s.strategy === "string" && s.strategy.trim()
              ? s.strategy
              : null,
        }
      : {
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
          strategy: null,
        };

  return {
    id: String(raw?.id ?? botId),
    name: typeof raw?.name === "string" ? raw.name : undefined,
    status: typeof raw?.status === "string" ? raw.status : undefined,
    summary,
  };
};

/** Kept for convenience in screens that only want the summary object */
export const getBotSummary = async (botId: string): Promise<BotSummary> => {
  const { summary } = await getBotOverview(botId);
  return summary;
};

/** Logs: try JSON endpoint (/logs?limit=), fall back to legacy text (/log?tail=) */
export const getBotLog = async (botId: string, limit = 200): Promise<string> => {
  try {
    const j = await apiGet<{ lines?: string[] }>(
      `/api/bots/${encodeURIComponent(botId)}/logs?limit=${limit}`
    );
    if (Array.isArray(j?.lines)) return j.lines.join("\n");
  } catch {
    // fall through to legacy
  }
  try {
    return await apiGetText(`/api/bots/${encodeURIComponent(botId)}/log?tail=${limit}`);
  } catch {
    return "";
  }
};

export const startBot = (botId: string) =>
  apiPost(`/api/bots/${encodeURIComponent(botId)}/start`);

export const stopBot = (botId: string) =>
  apiPost(`/api/bots/${encodeURIComponent(botId)}/stop`);

export const deleteBot = (botId: string) =>
  apiPost(`/api/bots/${encodeURIComponent(botId)}/delete`);
