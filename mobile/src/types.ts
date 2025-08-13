// mobile/src/types.ts
export type BotStatus = 'running' | 'stopped' | 'idle';

export type BotSummary = {
  beginningValue: number;
  duration: string;
  buys: number;
  sells: number;
  totalPL: number;
  cash: number;
  cryptoMkt: number;
  locked: number;
};

export type BotState = {
  id: string;
  name: string;
  status: BotStatus;
  follow: boolean;       // LIVE (auto-scroll) if true
  unreadCount: number;   // new lines while paused
  lines: string[];       // log lines (sanitized)
  summary?: BotSummary;
};