// strategies/moderateRetain.js
// Moderate Retain Mode (Baseline Strategy v1.0)
// - Grid trading with balanced thresholds
// - Locks 20% of profit, retains 15% cash

module.exports = {
  name: "Moderate Retain Mode",
  version: "v1.0",
  description: "Grid strategy with moderate profit locking and cash reserve.",

  getTradeDecision({ price, lastPrice, costBasis, strategyState, config }) {
    if (!lastPrice || !costBasis || strategyState.priceHistory.length < 2)
      return null;

    const delta = ((price - lastPrice) / lastPrice) * 100;
    const ratio = price / costBasis;
    const atr = strategyState.atr;

    if (ratio < 0.95 && delta <= config.baseBuyThreshold * atr)
      return { action: "buy", delta };
    if (ratio > 1.05 && delta >= config.baseSellThreshold * atr)
      return { action: "sell", delta };
    return null;
  },

  updateStrategyState(symbol, strategyState) {
    const prices = strategyState.priceHistory;
    if (prices.length < 10) {
      strategyState.trend = "neutral";
      return;
    }
    const sma = prices.reduce((a, b) => a + b, 0) / prices.length;
    const current = prices[prices.length - 1];

    if (current > sma * 1.03) strategyState.trend = "up";
    else if (current < sma * 0.97) strategyState.trend = "down";
    else strategyState.trend = "neutral";
  },
};
