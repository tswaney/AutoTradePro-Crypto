// strategies/superAdaptiveStrategy.js

/**
 * Super Adaptive All-Weather Crypto Strategy
 * - Regime aware (uptrend, downtrend, range)
 * - Volatility-aware (ATR-driven thresholds)
 * - Uses swing confirmation for entries/exits
 * - Grid logic in sideways, momentum logic in trends
 * - All parameters .env driven (see below)
 */

const name = "Super Adaptive Strategy";
const version = "1.0";
const description =
  "Hybrid regime/volatility/swing strategy for all market conditions (adaptive grid, momentum, reversal, profit lock).";

function sma(arr, len) {
  if (!arr || arr.length < len) return null;
  return arr.slice(-len).reduce((a, b) => a + b, 0) / len;
}

function atr(prices, period) {
  if (!prices || prices.length < period + 1) return null;
  let sum = 0;
  for (let i = prices.length - period; i < prices.length; ++i) {
    sum += Math.abs(prices[i] - prices[i - 1]);
  }
  return sum / period;
}

// Regime detector: uptrend, downtrend, or range
function detectRegime(state, config) {
  const smaShort = sma(state.priceHistory, config.SUPER_SMA_SHORT || 14);
  const smaLong = sma(state.priceHistory, config.SUPER_SMA_LONG || 50);
  const price = state.priceHistory[state.priceHistory.length - 1];

  if (!smaShort || !smaLong) return "rangebound";
  const band = (config.SUPER_REGIME_BAND_PCT || 0.01) * smaLong;

  if (price > smaLong + band && smaShort > smaLong) return "uptrend";
  if (price < smaLong - band && smaShort < smaLong) return "downtrend";
  return "rangebound";
}

function getTradeDecision({
  symbol,
  price,
  lastPrice,
  costBasis,
  strategyState,
  portfolio,
  config,
}) {
  // === Safety Brake ===
  if (portfolio.drawdownTriggered) return null;

  // === Regime/Volatility Detection ===
  const regime = detectRegime(strategyState, config);
  const atrVal = atr(strategyState.priceHistory, config.SUPER_ATR_PERIOD || 14);

  // Set for debug and UI
  strategyState.trend = regime;
  strategyState.atr = atrVal;

  // === Confirmation logic ===
  const trends = strategyState.trendHistory || [];
  const confirmLen = config.SUPER_CONFIRM_TICKS || 2;
  const lastNTicks = trends.slice(-confirmLen - 1);
  const prevDown = lastNTicks.slice(0, -1).every((t) => t === "down");
  const nowUp = lastNTicks[lastNTicks.length - 1] === "up";
  const prevUp = lastNTicks.slice(0, -1).every((t) => t === "up");
  const nowDown = lastNTicks[lastNTicks.length - 1] === "down";

  // === Position sizing ===
  const minTrade = config.SUPER_MIN_TRADE_SIZE || 10;
  const maxTrade = config.SUPER_MAX_TRADE_SIZE || 250;

  // === DOWN: Buy only after deep dip + reversal confirmation ===
  if (
    regime === "downtrend" &&
    atrVal &&
    lastPrice &&
    trends.length > confirmLen &&
    prevDown &&
    nowUp
  ) {
    const deepDrop =
      price < lastPrice - atrVal * (config.SUPER_DEEP_DIP_ATR_MULT || 2.0);
    if (deepDrop) {
      return {
        action: "BUY",
        reason: "deep-dip reversal in downtrend",
        size: minTrade,
      };
    }
  }

  // === UP: Buy on breakouts (but only on uptrend reversal) ===
  if (
    regime === "uptrend" &&
    atrVal &&
    lastPrice &&
    trends.length > confirmLen &&
    prevUp &&
    nowDown
  ) {
    const breakout =
      price > lastPrice + atrVal * (config.SUPER_UPTREND_BREAKOUT_ATR || 1.2);
    if (breakout) {
      return {
        action: "BUY",
        reason: "uptrend breakout with reversal",
        size: minTrade,
      };
    }
  }

  // === RANGE: Classic grid buys/sells ===
  if (regime === "rangebound" && atrVal && lastPrice) {
    const gridBuy =
      price < lastPrice - atrVal * (config.SUPER_GRID_BUY_ATR || 1.0);
    const gridSell =
      price > lastPrice + atrVal * (config.SUPER_GRID_SELL_ATR || 1.0);

    if (gridBuy) {
      return { action: "BUY", reason: "rangebound grid buy", size: minTrade };
    }
    if (gridSell) {
      return { action: "SELL", reason: "rangebound grid sell", size: minTrade };
    }
  }

  // === PROFIT LOCK/STOP LOGIC (trailing, scheduled, or amount) ===
  // (Can expand this as needed for your specific profit lock rules)

  // === Trailing sell after up move and reversal (works in all regimes) ===
  if (
    atrVal &&
    lastPrice &&
    trends.length > confirmLen &&
    prevUp &&
    nowDown &&
    price < lastPrice - atrVal * (config.SUPER_TRAILING_SELL_ATR || 1.5)
  ) {
    return {
      action: "SELL",
      reason: "trailing stop reversal",
      size: minTrade,
    };
  }

  // No trade this tick
  return null;
}

// Optional: state update (ATR, trend, etc.)
function updateStrategyState(symbol, state, config) {
  state.atr = atr(state.priceHistory, config.SUPER_ATR_PERIOD || 14);
  state.trend = detectRegime(state, config);
}

module.exports = {
  name,
  version,
  description,
  getTradeDecision,
  updateStrategyState,
};
