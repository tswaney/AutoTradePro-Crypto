// strategies/dynamicRegimeSwitchingProfitLock.js
// Extension of Dynamic Regime Switching with Profit Locking logic

const { parseISO, isAfter, addDays } = require("date-fns");

module.exports = {
  name: "Dynamic Regime Switching + Profit Lock",
  version: "2.0",
  description:
    "Switches regimes (DCA, Grid, Accumulate) AND auto-locks profits daily or when threshold reached.",

  // --- Helper Functions (copied from v1) ---
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
    if (!trendHist || trendHist.length < 14) return 20;
    const up = trendHist.filter((t) => t === "up").length;
    const down = trendHist.filter((t) => t === "down").length;
    if (up > 10 || down > 10) return 40;
    if (up > 7 || down > 7) return 25;
    return 10;
  },

  // --- Regime Detection (same as v1) ---
  detectRegime(state, config) {
    const ph = state.priceHistory;
    if (!ph || ph.length < 201) return "uptrend"; // default until enough history
    const sma50 = this.sma(ph, 50);
    const sma200 = this.sma(ph, 200);
    const curr = ph[ph.length - 1];
    const adx = this.adx(state.trendHistory);
    if (sma50 && sma200 && curr > sma50 && sma50 > sma200 && adx >= 25)
      return "uptrend";
    if (sma50 && sma200 && curr < sma50 && sma50 < sma200 && adx >= 25)
      return "downtrend";
    if (sma200 && Math.abs(curr - sma200) / sma200 < 0.01 && adx < 25)
      return "rangebound";
    return "rangebound";
  },

  // --- Profit Locking State (per bot run) ---
  _lastProfitLockTime: null,

  /**
   * Should we lock profits? (returns true if lock event should occur)
   * - Scheduled: at the specified daily time (HH:mm)
   * - Amount: if daily profit exceeds a specified value
   */
  shouldLockProfit(portfolio, config) {
    // Check if profit lock is enabled
    if (process.env.PROFIT_LOCK_ENABLE !== "true") return false;

    const now = new Date();

    // Scheduled time logic (defaults to 00:00 if unset)
    if (
      process.env.PROFIT_LOCK_TYPE === "scheduled" ||
      process.env.PROFIT_LOCK_TYPE === "both"
    ) {
      const [h, m] = (process.env.PROFIT_LOCK_TIME || "00:00")
        .split(":")
        .map(Number);
      const todayLockTime = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        h,
        m,
        0,
        0
      );
      if (
        (!this._lastProfitLockTime ||
          this._lastProfitLockTime < todayLockTime) &&
        now >= todayLockTime
      ) {
        return true;
      }
    }

    // Amount logic
    const lockAmount = parseFloat(process.env.PROFIT_LOCK_AMOUNT) || 0;
    if (
      (process.env.PROFIT_LOCK_TYPE === "amount" ||
        process.env.PROFIT_LOCK_TYPE === "both") &&
      portfolio.dailyProfitTotal >= lockAmount &&
      (!this._lastProfitLockTime ||
        now - this._lastProfitLockTime > 3600 * 1000) // Only once per hour
    ) {
      return true;
    }

    return false;
  },

  /**
   * Lock the current daily profit to lockedCash, reset dailyProfitTotal.
   * Returns the amount locked.
   */
  lockProfit(portfolio, config) {
    const lockPartial = parseFloat(process.env.PROFIT_LOCK_PARTIAL) || 1.0;
    const amountToLock =
      Math.round(portfolio.dailyProfitTotal * lockPartial * 100) / 100;
    if (amountToLock > 0) {
      portfolio.lockedCash =
        Math.round((portfolio.lockedCash + amountToLock) * 100) / 100;
      portfolio.dailyProfitTotal =
        Math.round((portfolio.dailyProfitTotal - amountToLock) * 100) / 100;
      this._lastProfitLockTime = new Date();
      console.log(
        `🔒 PROFIT LOCKED: $${amountToLock} moved to locked cash. [${this._lastProfitLockTime.toLocaleString()}]`
      );
      return amountToLock;
    }
    return 0;
  },

  // --- Core Trading Logic (as before) ---
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

    // --- DCA (Uptrend) ---
    if (regime === "uptrend") {
      if (price > costBasis * 1.01)
        return {
          action: "BUY",
          regime: "uptrend",
          reason: "Uptrend buy trigger",
        };
    }

    if (process.env.DEBUG) {
      console.log(
        `[DEBUG][${symbol}] Grid SELL: price $${price} > grid entry $${
          lot.price
        } (+${sellThreshold * 100}%)`
      );
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

  updateStrategyState(symbol, state, config) {
    if (state.priceHistory && state.priceHistory.length > 1) {
      state.trend = module.exports.detectRegime(state, config);
    }
  },
};
