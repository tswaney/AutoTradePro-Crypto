// strategies/simpleBuySell_v1.3.js
// Simple Buy / Sell High (cost-basis gating) + optional Profit Lock + optional realism guards

// v1.3 base (unchanged when new ENV vars are unset):
//   - BUY if price <= costBasis + baseBuyThreshold (negative %)
//   - SELL if price >= costBasis + baseSellThreshold (positive %)
//   - Profit-lock hooks: shouldLockProfit(...) / lockProfit(...)
//
// New (opt-in via ENV):
//   SIMPLE_COOL_DOWN_SEC     = seconds to wait between decisions for the same symbol
//   SIMPLE_MIN_MOVE_PCT      = minimum absolute % move since last decision price
//   SIMPLE_SESSION_MAX_BUYS  = max BUY signals per symbol for the whole session
//   SIMPLE_SESSION_MAX_SELLS = max SELL signals per symbol for the whole session
//   SIMPLE_HOURLY_MAX_BUYS   = max BUY signals per symbol per rolling hour
//   SIMPLE_HOURLY_MAX_SELLS  = max SELL signals per symbol per rolling hour
//
// Profit-lock modes (ENV):
//   PROFIT_LOCK_ENABLE=true|false
//   PROFIT_LOCK_TYPE=scheduled|amount|both
//   PROFIT_LOCK_TIME=HH:mm
//   PROFIT_LOCK_AMOUNT=<number>
//   PROFIT_LOCK_PARTIAL=0..1
//
// NEW: Per-sell locking (requested behavior)
//   LOCK_PER_SELL=true|false
//     • If true, we lock realized profit immediately after sells (on next tick),
//       using PROFIT_LOCK_PARTIAL of current dailyProfitTotal.
//     • When LOCK_PER_SELL is true, scheduled/amount triggers are DISABLED.

const SEC = 1000;
const HOUR = 3600 * 1000;

const COOLDOWN_SEC = parseFloat(process.env.SIMPLE_COOL_DOWN_SEC || "0"); // e.g., 90
const MIN_MOVE_PCT = parseFloat(process.env.SIMPLE_MIN_MOVE_PCT || "0"); // e.g., 0.4

const SESSION_MAX_BUYS = parseInt(
  process.env.SIMPLE_SESSION_MAX_BUYS || "0",
  10
); // e.g., 10
const SESSION_MAX_SELLS = parseInt(
  process.env.SIMPLE_SESSION_MAX_SELLS || "0",
  10
); // e.g., 10

const HOURLY_MAX_BUYS = parseInt(process.env.SIMPLE_HOURLY_MAX_BUYS || "0", 10); // e.g., 6
const HOURLY_MAX_SELLS = parseInt(
  process.env.SIMPLE_HOURLY_MAX_SELLS || "0",
  10
); // e.g., 6

const LOCK_PER_SELL =
  String(process.env.LOCK_PER_SELL || "false").toLowerCase() === "true";
// NOTE: If LOCK_PER_SELL is true, scheduled/amount profit-lock triggers are ignored.

// Per-session counters (in-memory; reset when process restarts)
const sessionCounts = {
  buy: Object.create(null),
  sell: Object.create(null),
};

// Rolling hourly counters per symbol
const hourlyCounters = {
  buy: Object.create(null),
  sell: Object.create(null),
};
function hourBucket(ts) {
  return Math.floor(ts / HOUR);
}
function incHourly(kind, sym, ts) {
  const b = hourBucket(ts);
  const map = hourlyCounters[kind];
  let rec = map[sym];
  if (!rec || rec.bucket !== b) rec = map[sym] = { bucket: b, count: 0 };
  rec.count++;
  return rec.count;
}
function getHourly(kind, sym, ts) {
  const b = hourBucket(ts);
  const rec = hourlyCounters[kind]?.[sym];
  return rec && rec.bucket === b ? rec.count : 0;
}

module.exports = {
  name: "Simple Buy Low/Sell High",
  version: "1.3",
  description:
    "Buys when price dips below costBasis by baseBuyThreshold; sells when price " +
    "rises above costBasis by baseSellThreshold. Optional profit-lock and realism guards.",

  // --- State updates (unchanged) -----------------------------------------------------
  updateStrategyState(symbol, state, _config) {
    const h = state.priceHistory;
    if (!h || h.length < 2) return;
    const prev = h[h.length - 2];
    const curr = h[h.length - 1];
    const delta = (curr - prev) / (prev || 1);
    state.delta = delta;
    state.trend = delta > 0 ? "up" : delta < 0 ? "down" : "neutral";
  },

  // --- Decision (BUY/SELL) with optional realism guards ------------------------------
  getTradeDecision({ symbol, price, costBasis, strategyState: s, config }) {
    if (
      !Number.isFinite(price) ||
      !Number.isFinite(costBasis) ||
      costBasis <= 0
    )
      return;

    // Guard 1: cool-down since last decision on this symbol
    if (COOLDOWN_SEC > 0) {
      const lastAt = s._lastDecisionAt || 0;
      if (Date.now() - lastAt < COOLDOWN_SEC * SEC) return;
    }

    // Guard 2: require minimum absolute % move since last decision price
    if (MIN_MOVE_PCT > 0 && s._lastDecisionPrice > 0) {
      const movePct =
        Math.abs((price - s._lastDecisionPrice) / s._lastDecisionPrice) * 100;
      if (movePct < MIN_MOVE_PCT) return;
    }

    // Core v1.2 logic (unchanged)
    const deltaCost = (price - costBasis) / costBasis;
    let decision =
      deltaCost <= config.baseBuyThreshold
        ? { action: "buy" }
        : deltaCost >= config.baseSellThreshold
        ? { action: "sell" }
        : undefined;

    if (!decision) return;

    // Guard 3: per-session caps (per symbol)
    if (
      decision.action === "buy" &&
      SESSION_MAX_BUYS > 0 &&
      (sessionCounts.buy[symbol] || 0) >= SESSION_MAX_BUYS
    )
      return;
    if (
      decision.action === "sell" &&
      SESSION_MAX_SELLS > 0 &&
      (sessionCounts.sell[symbol] || 0) >= SESSION_MAX_SELLS
    )
      return;

    // Guard 4: per-hour caps (per symbol, rolling hour bucket)
    const now = Date.now();
    if (
      decision.action === "buy" &&
      HOURLY_MAX_BUYS > 0 &&
      getHourly("buy", symbol, now) >= HOURLY_MAX_BUYS
    )
      return;
    if (
      decision.action === "sell" &&
      HOURLY_MAX_SELLS > 0 &&
      getHourly("sell", symbol, now) >= HOURLY_MAX_SELLS
    )
      return;

    // Stamp decision time/price and bump counters (only when we actually emit)
    s._lastDecisionAt = now;
    s._lastDecisionPrice = price;

    if (decision.action === "buy") {
      sessionCounts.buy[symbol] = (sessionCounts.buy[symbol] || 0) + 1;
      incHourly("buy", symbol, now);
    } else {
      sessionCounts.sell[symbol] = (sessionCounts.sell[symbol] || 0) + 1;
      incHourly("sell", symbol, now);
    }

    return decision;
  },

  // --- Profit-lock (with per-sell mode) ---------------------------------------------
  _lastProfitLockTime: null,

  shouldLockProfit(portfolio, _config) {
    // Per-sell mode: lock immediately after a sell (on the next tick).
    // We don't have a direct "last action was sell" flag from the runner, so we
    // lock whenever dailyProfitTotal > 0; after lockProfit runs, dailyProfitTotal
    // goes down, preventing repeated locks. This approximates "per-sell" behavior.
    if (LOCK_PER_SELL) {
      return (
        Number.isFinite(portfolio?.dailyProfitTotal) &&
        portfolio.dailyProfitTotal > 0
      );
    }

    // Otherwise, use scheduled/amount triggers if enabled.
    if (String(process.env.PROFIT_LOCK_ENABLE).toLowerCase() !== "true")
      return false;

    const type = (process.env.PROFIT_LOCK_TYPE || "amount").toLowerCase();
    const now = new Date();

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

    if (type === "amount" || type === "both") {
      const thresh = parseFloat(process.env.PROFIT_LOCK_AMOUNT) || 0;
      if (
        Number.isFinite(portfolio?.dailyProfitTotal) &&
        portfolio.dailyProfitTotal >= thresh &&
        (!this._lastProfitLockTime ||
          Date.now() - this._lastProfitLockTime.getTime() > 3600 * 1000)
      ) {
        return true;
      }
    }

    return false;
  },

  lockProfit(portfolio, _config) {
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

      // Update last lock time for scheduled/amount mode; harmless in per-sell mode.
      this._lastProfitLockTime = new Date();
      return toLock;
    }
    return 0;
  },
};
