// strategies/simpleBuySell_v1.2.js
// Simple Buy / Sell High (cost-basis gating) + optional Profit Lock + optional realism guards

// v1.2 base (unchanged when new ENV vars are unset):
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
// Notes:
//   • All new guards are evaluated *before* returning a decision.
//   • If unset / 0 / blank, guards are disabled and behavior matches your old v1.2.
//   • This module does not log; the runner handles output.

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
  version: "1.2",
  description:
    "Buys when price dips below costBasis by baseBuyThreshold; sells when price " +
    "rises above costBasis by baseSellThreshold. Optional profit-lock and realism guards.",

  // --- State updates (unchanged) -----------------------------------------------------
  updateStrategyState(symbol, state, config) {
    const h = state.priceHistory;
    if (!h || h.length < 2) return;
    const prev = h[h.length - 2],
      curr = h[h.length - 1];
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

    // Optional guard 1: cool-down since last decision on this symbol
    if (COOLDOWN_SEC > 0) {
      const lastAt = s._lastDecisionAt || 0;
      if (Date.now() - lastAt < COOLDOWN_SEC * SEC) return;
    }

    // Optional guard 2: require minimum absolute % move since last decision price
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

    // Optional guard 3: per-session caps (per symbol)
    if (decision.action === "buy" && SESSION_MAX_BUYS > 0) {
      if ((sessionCounts.buy[symbol] || 0) >= SESSION_MAX_BUYS) return;
    }
    if (decision.action === "sell" && SESSION_MAX_SELLS > 0) {
      if ((sessionCounts.sell[symbol] || 0) >= SESSION_MAX_SELLS) return;
    }

    // Optional guard 4: per-hour caps (per symbol, rolling hour bucket)
    const now = Date.now();
    if (decision.action === "buy" && HOURLY_MAX_BUYS > 0) {
      if (getHourly("buy", symbol, now) >= HOURLY_MAX_BUYS) return;
    }
    if (decision.action === "sell" && HOURLY_MAX_SELLS > 0) {
      if (getHourly("sell", symbol, now) >= HOURLY_MAX_SELLS) return;
    }

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

  // --- Profit-lock (unchanged; optional) ---------------------------------------------
  _lastProfitLockTime: null,

  shouldLockProfit(portfolio, _config) {
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
      )
        return true;
    }

    if (type === "amount" || type === "both") {
      const thresh = parseFloat(process.env.PROFIT_LOCK_AMOUNT) || 0;
      if (
        Number.isFinite(portfolio?.dailyProfitTotal) &&
        portfolio.dailyProfitTotal >= thresh &&
        (!this._lastProfitLockTime ||
          now - this._lastProfitLockTime > 3600 * 1000)
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
      this._lastProfitLockTime = new Date();
      return toLock;
    }
    return 0;
  },
};
