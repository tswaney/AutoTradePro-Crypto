// strategies/dynamicRegimeSwitching.js
// NOTE: This is the base strategy; see dynamicRegimeSwitchingProfitLock.js for version with profit locking logic!

module.exports = {
  name: "Dynamic Regime Switching",
  version: "1.0",
  description:
    "Auto-switches between DCA, Grid/Mean Reversion, and Accumulate based on market regime.",

  // --- Helper Functions ---
  sma(prices, len) {
    if (prices.length < len) return null;
    return prices.slice(-len).reduce((a, b) => a + b, 0) / len;
  },
  stdev(prices, len) {
    if (prices.length < len) return null;
    const avg = this.sma(prices, len);
    const variance =
      prices.slice(-len).reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) /
      len;
    return Math.sqrt(variance);
  },
  adx(trendHist) {
    // Crude approximation: returns 10 (weak), 25 (neutral), or 40 (strong trend)
    if (!trendHist || trendHist.length < 14) return 20;
    const up = trendHist.filter((t) => t === "up").length;
    const down = trendHist.filter((t) => t === "down").length;
    if (up > 10 || down > 10) return 40;
    if (up > 7 || down > 7) return 25;
    return 10;
  },

  // --- Core Regime Detection ---
  detectRegime(state, config) {
    const ph = state.priceHistory;
    if (!ph || ph.length < 201) return "uptrend"; // default until enough history

    const sma50 = this.sma(ph, 50);
    const sma200 = this.sma(ph, 200);
    const curr = ph[ph.length - 1];
    const adx = this.adx(state.trendHistory);

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

  // --- Core Trading Logic ---
  getTradeDecision({
    symbol,
    price,
    lastPrice,
    costBasis,
    strategyState,
    config,
  }) {
    const regime = this.detectRegime(strategyState, config);
    const grid = strategyState.grid || [];
    const sellThreshold = 0.01; // 1% above grid buy price

    // --- PATCH: Only sell if price is at least 1% above grid entry price ---
    if (grid && grid.length > 0) {
      const lot = grid[0];
      if (lot && lot.amount > 0 && price >= lot.price * (1 + sellThreshold)) {
        if (process.env.DEBUG) {
          console.log(
            `[DEBUG][${symbol}] Grid SELL: price $${price} > grid entry $${
              lot.price
            } (+${sellThreshold * 100}%)`
          );
        }
        return {
          action: "SELL",
          price: price,
          amount: lot.amount,
          reason: `Grid SELL: price $${price} > grid entry $${lot.price} +${
            sellThreshold * 100
          }%`,
        };
      }
    }

    if (process.env.DEBUG_BUYS) {
      console.log(
        `[DEBUG][${symbol}] Buy check: price=${price}, costBasis=${costBasis}, trend=${
          strategyState.trend || regime
        }`
      );
    }

    // --- DCA (Uptrend) ---
    if (regime === "uptrend") {
      if (price > costBasis * 1.01)
        return {
          action: "BUY",
          regime: "uptrend",
          reason: "Uptrend buy trigger",
        };
    }

    // --- Accumulate (Downtrend) ---
    if (regime === "downtrend") {
      if (lastPrice && price < lastPrice * 0.98)
        return {
          action: "BUY",
          regime: "downtrend",
          reason: "Downtrend buy trigger",
        };
    }

    // --- Mean Reversion/Grid (Rangebound) ---
    if (regime === "rangebound") {
      const sma = this.sma(strategyState.priceHistory, 50);
      if (sma && price < sma * 0.98)
        return {
          action: "BUY",
          regime: "rangebound",
          reason: "Rangebound buy trigger",
        };
    }

    // --- HOLD: No trigger met ---
    if (process.env.DEBUG) {
      console.log(`[DEBUG][${symbol}] No trade trigger at $${price}`);
    }
    return null;
  },

  // --- Optionally, update strategy state on each price update ---
  updateStrategyState(symbol, state, config) {
    // Always update the trend property to match regime detection
    if (state.priceHistory && state.priceHistory.length > 1) {
      state.trend = module.exports.detectRegime(state, config);
    }
  },
};
