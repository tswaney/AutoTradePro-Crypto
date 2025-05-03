// strategies/moderateRetainMode_v4.js
// Version 4.0: Looser entries on 24h pullbacks, flat 5% profit exits, plus v3.0 confirmations & ATR grids

module.exports = {
  name: "Moderate Retain Mode",
  version: "4.0",
  description:
    "Grid-based trading with ATR thresholds, 2-of-3 confirmations, weighted grid entries, " +
    "plus 24h-average pullback buys (–10%) and flat profit sells (+5%).",

  /**
   * Called each tick, updates ATR and dynamic thresholds (same as v3.0)
   */
  updateStrategyState(symbol, state, config) {
    // Compute ATR over the last config.atrLookbackPeriod ticks:
    const prices = state.priceHistory;
    if (prices.length >= config.atrLookbackPeriod + 1) {
      let sumTR = 0;
      for (let i = 1; i < prices.length; i++) {
        sumTR += Math.abs(prices[i] - prices[i - 1]);
      }
      state.atr = sumTR / (prices.length - 1);
      state.dynamicBuyThreshold = -state.atr;
      state.dynamicSellThreshold = state.atr;
    }

    // Maintain a rolling 24h price history for average:
    const now = Date.now();
    state.recent24h = (state.recent24h || []).concat({
      price: state.lastPrice ?? prices[prices.length - 1],
      time: now,
    });
    const cutoff = now - 24 * 60 * 60 * 1000;
    state.recent24h = state.recent24h.filter((p) => p.time >= cutoff);
  },

  /**
   * Decide buy/sell/HOLD:
   *  - 2-of-3 tick confirmations
   *  - ATR-based grid thresholds (v3 logic)
   *  - OR pullback buy (10% below 24h average)
   *  - OR flat profit sell (5% above cost basis)
   */
  getTradeDecision({ price, lastPrice, costBasis, strategyState: s, config }) {
    const trends = s.trendHistory || [];
    if (trends.length < 3 || lastPrice == null) return;

    // compute last-three summary
    const lastThree = trends.slice(-3);
    const downs = lastThree.filter((t) => t === "down").length;
    const ups = lastThree.filter((t) => t === "up").length;

    // compute 24h average price
    const recent = s.recent24h || [];
    const avg24h = recent.length
      ? recent.reduce((sum, p) => sum + p.price, 0) / recent.length
      : null;

    // --- SELL: either v3 dynamic-grid OR flat 5% profit ---
    if (downs >= 2 && price > costBasis) {
      // flat 5% profit check
      if (price >= costBasis * (1 + config.baseSellThreshold)) {
        return { action: "sell", reason: "flat5%" };
      }
      // otherwise fall back to v3 grid logic:
      // find highest ATR grid level met
      const baseSell = s.dynamicSellThreshold ?? config.baseSellThreshold;
      const levels = [];
      for (let i = 1; i <= config.gridLevels; i++) {
        levels.push(baseSell * (i / config.gridLevels));
      }
      for (let i = levels.length - 1; i >= 0; i--) {
        if ((price - lastPrice) / lastPrice >= levels[i]) {
          return { action: "sell", gridLevel: i + 1, reason: "atrGrid" };
        }
      }
    }

    // --- BUY: either pullback 10% below 24h avg OR v3 dynamic-grid ---
    if (ups >= 2 && price < costBasis) {
      // pullback buy if average known
      if (avg24h !== null && price <= avg24h * (1 - 0.1)) {
        return { action: "buy", reason: "24hPullback" };
      }
      // otherwise v3 ATR grid buy logic
      const baseBuy = s.dynamicBuyThreshold ?? config.baseBuyThreshold;
      const levels = [];
      for (let i = 1; i <= config.gridLevels; i++) {
        levels.push(baseBuy * (i / config.gridLevels));
      }
      for (let i = levels.length - 1; i >= 0; i--) {
        if ((lastPrice - price) / lastPrice >= Math.abs(levels[i])) {
          return { action: "buy", gridLevel: i + 1, reason: "atrGrid" };
        }
      }
    }

    // otherwise hold
  },
};
