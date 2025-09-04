// strategies/simpleBuySell_v1.1.js
// Version 1.2: Simple Buy Low / Sell High (cost-basis gating) + optional Profit Lock

// Changes in 1.2:
// - Added optional profit-lock hooks: shouldLockProfit(...) and lockProfit(...)
// - BUY/SELL decision logic is IDENTICAL to v1.1; enabling profit lock does not
//   change when trades are signaled — it only lets the runner lock realized P&L.
//
// Env controls (OFF by default):
//   PROFIT_LOCK_ENABLE=true|false
//   PROFIT_LOCK_TYPE=scheduled|amount|both
//   PROFIT_LOCK_TIME=HH:mm              (e.g., "01:00")
//   PROFIT_LOCK_AMOUNT=number           (lock when dailyProfitTotal >= amount)
//   PROFIT_LOCK_PARTIAL=0..1            (fraction of dailyProfitTotal to lock)
//
// Note: The main runner already calls strategy.shouldLockProfit/lockProfit (if present).
//       After you paste this file, the Simple strategy will participate in locking
//       when PROFIT_LOCK_ENABLE=true.
//
// NO console logging here — the runner handles output.

module.exports = {
  name: "Simple Buy Low/Sell High",
  version: "1.2",
  description:
    "Buys when price dips below costBasis by baseBuyThreshold; sells when price " +
    "rises above costBasis by baseSellThreshold; straightforward cost-basis gating. " +
    "(v1.2 adds optional profit-lock hooks.)",

  // --- v1.1 behavior (unchanged) ----------------------------------------------------

  /**
   * updateStrategyState:
   * Updates internal state such as trend direction and percent change.
   * Called by the main program after each price update.
   *
   * @param {string} symbol
   * @param {object} state  contains priceHistory, trend, delta
   * @param {object} config contains base thresholds
   */
  updateStrategyState(symbol, state, config) {
    const h = state.priceHistory;
    if (!h || h.length < 2) return;
    const prev = h[h.length - 2],
      curr = h[h.length - 1];
    const delta = (curr - prev) / (prev || 1);
    state.delta = delta;
    state.trend = delta > 0 ? "up" : delta < 0 ? "down" : "neutral";
  },

  /**
   * getTradeDecision:
   * Returns {action: 'buy'} or {action: 'sell'} if conditions are met, or undefined to hold.
   * Called by the main program with all required context for that symbol.
   *
   * @param {object} params
   * @param {number} params.price         current market price
   * @param {number} params.costBasis     current cost basis
   * @param {object} params.strategyState strategy state (trend/delta/history)
   * @param {object} params.config        current config
   * @returns {object|undefined}          { action: 'buy'|'sell' }
   */
  getTradeDecision({ price, costBasis, strategyState: s, config }) {
    if (
      !Number.isFinite(price) ||
      !Number.isFinite(costBasis) ||
      costBasis <= 0
    )
      return;

    // Compute delta vs cost basis
    const deltaCost = (price - costBasis) / costBasis;

    // BUY if price is below cost basis by baseBuyThreshold
    if (deltaCost <= config.baseBuyThreshold) {
      return { action: "buy" };
    }

    // SELL if price is above cost basis by baseSellThreshold
    if (deltaCost >= config.baseSellThreshold) {
      return { action: "sell" };
    }

    // Otherwise HOLD (no action)
    return;
  },

  // --- v1.2 additions: optional Profit Lock hooks -----------------------------------

  _lastProfitLockTime: null,

  /**
   * shouldLockProfit(portfolio, config) -> boolean
   * Returns true if we should lock profit now, based on env settings.
   * - Only active when PROFIT_LOCK_ENABLE=true
   * - Modes:
   *    • scheduled: lock once after PROFIT_LOCK_TIME each day
   *    • amount:    lock when portfolio.dailyProfitTotal >= PROFIT_LOCK_AMOUNT
   *    • both:      either scheduled or amount condition triggers
   */
  shouldLockProfit(portfolio, config) {
    if (String(process.env.PROFIT_LOCK_ENABLE).toLowerCase() !== "true")
      return false;

    const type = (process.env.PROFIT_LOCK_TYPE || "amount").toLowerCase();
    const now = new Date();

    // Scheduled daily time (e.g., "01:00")
    if (type === "scheduled" || type === "both") {
      const [h, m] = (process.env.PROFIT_LOCK_TIME || "00:00")
        .split(":")
        .map((n) => parseInt(n, 10));
      const todayLock = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        Number.isFinite(h) ? h : 0,
        Number.isFinite(m) ? m : 0,
        0,
        0
      );
      if (
        (!this._lastProfitLockTime || this._lastProfitLockTime < todayLock) &&
        now >= todayLock
      ) {
        return true;
      }
    }

    // Amount threshold
    if (type === "amount" || type === "both") {
      const thresh = parseFloat(process.env.PROFIT_LOCK_AMOUNT) || 0;
      if (
        Number.isFinite(portfolio?.dailyProfitTotal) &&
        portfolio.dailyProfitTotal >= thresh &&
        (!this._lastProfitLockTime ||
          now - this._lastProfitLockTime > 3600 * 1000) // 1h cool-down
      ) {
        return true;
      }
    }

    return false;
  },

  /**
   * lockProfit(portfolio, config) -> number
   * Moves a portion (or all) of portfolio.dailyProfitTotal into portfolio.lockedCash
   * and resets dailyProfitTotal accordingly. Returns the amount locked.
   */
  lockProfit(portfolio, config) {
    if (!portfolio) return 0;
    const partial = Math.max(
      0,
      Math.min(parseFloat(process.env.PROFIT_LOCK_PARTIAL) || 1.0, 1.0)
    );
    const toLock =
      Math.round((portfolio.dailyProfitTotal || 0) * partial * 100) / 100;

    if (toLock > 0) {
      portfolio.lockedCash =
        Math.round(((portfolio.lockedCash || 0) + toLock) * 100) / 100;
      portfolio.dailyProfitTotal =
        Math.round(((portfolio.dailyProfitTotal || 0) - toLock) * 100) / 100;
      this._lastProfitLockTime = new Date();
      return toLock;
    }
    return 0;
  },
};
