export type BotSummary = {
  beginningPortfolioValue?: number;
  duration?: string | number;
  buys?: number;
  sells?: number;
  totalPL?: number;
  cash?: number;
  cryptoMkt?: number;
  locked?: number;
};

export type BotCardStatus = 'running' | 'stopped' | 'idle';
