// strategies/dynamicRegimeSwitching.js

module.exports = {
  name: "Dynamic Regime Switching",
  version: "1.0",
  description: "Auto-switches between DCA, Grid/Mean Reversion, and Accumulate based on market regime.",

  // --- Helper Functions ---
  sma(prices, len) {
    if (prices.length < len) return null;
    return prices.slice(-len).reduce((a, b) => a + b, 0) / len;
  },
  stdev(prices, len) {
    if (prices.length < len) return null;
    const avg = this.sma(prices, len);
    const variance = prices.slice(-len).reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / len;
    return Math.sqrt(variance);
  },
  adx(trendHist) {
    // Crude approximation: returns 10 (weak), 25 (neutral), or 40 (strong trend)
    if (!trendHist || trendHist.length < 14) return 20;
    const up   = trendHist.filter(t => t === "up").length;
    const down = trendHist.filter(t => t === "down").length;
    if (up > 10 || down > 10) return 40;
    if (up > 7 || down > 7) return 25;
    return 10;
  },

  // --- Core Regime Detection ---
  detectRegime(state, config) {
    const ph = state.priceHistory;
    if (!ph || ph.length < 201) return "uptrend"; // default until enough history

    const sma50  = this.sma(ph, 50);
    const sma200 = this.sma(ph, 200);
    const curr   = ph[ph.length - 1];
    const adx    = this.adx(state.trendHistory);

    // Uptrend: Short MA above long MA, current price above both, strong ADX
    if (sma50 && sma200 && curr > sma50 && sma50 > sma200 && adx >= 25)
      return "uptrend";
    // Downtrend: Short MA below long MA, price below both, strong ADX
    if (sma50 && sma200 && curr < sma50 && sma50 < sma200 && adx >= 25)
      return "downtrend";
    // Rangebound: Price within 1% of sma200, weak ADX
    if (sma200 && Math.abs(curr - sma200) / sma200 < 0.01 && adx < 25)
      return "rangebound";
    // Default
    return "rangebound";
  },

  // --- Trade Logic for Each Regime ---
  getTradeDecision({ price, lastPrice, costBasis, strategyState, config }) {
    const regime = this.detectRegime(strategyState, config);

    // --- DCA (Uptrend) ---
    if (regime === "uptrend") {
      // DCA Buy: buy if at least 1% above cost basis, no SELLs
      if (price > costBasis * 1.01)
        return { action: "BUY", regime: "uptrend" };
    }

    // --- Accumulate (Downtrend) ---
    if (regime === "downtrend") {
      // Only buy, and only if price is at least 2% below last price (DCA/add more)
      if (lastPrice && price < lastPrice * 0.98)
        return { action: "BUY", regime: "downtrend" };
    }

    // --- Mean Reversion/Grid (Rangebound) ---
    if (regime === "rangebound") {
      const sma = this.sma(strategyState.priceHistory, 50);
      if (!sma) return null;
      // If price 2% below mean, BUY; 2% above mean, SELL
      if (price < sma * 0.98)
        return { action: "BUY", regime: "rangebound" };
      if (price > sma * 1.02)
        return { action: "SELL", regime: "rangebound" };
    }

    return null;
  },

  // --- Optionally, update strategy state on each price update ---
  updateStrategyState(symbol, state, config) {
    // No-op for now; extend for smarter learning
  }
};
