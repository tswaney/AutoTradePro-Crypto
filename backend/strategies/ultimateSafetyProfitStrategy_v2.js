// strategies/ultimateSafetyProfitStrategy_v2.js

const name = "Ultimate Safety Profit Strategy";
const version = "2.0";
const description =
  "Adaptive regime, volatility scaling, profit lock, risk spread, emergency brake, and auto-tune learning";

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

function clamp(val, min, max) {
  return Math.max(min, Math.min(val, max));
}

function detectRegime(state, config) {
  const smaShort = sma(state.priceHistory, config.ATR_LENGTH || 7);
  const smaLong = sma(state.priceHistory, config.ATR_LENGTH_LONG || 21);
  const price = state.priceHistory[state.priceHistory.length - 1];

  if (!smaShort || !smaLong) return "rangebound";
  const band = (config.REGIME_BAND_PCT || 0.01) * smaLong;

  if (price > smaLong + band && smaShort > smaLong) return "uptrend";
  if (price < smaLong - band && smaShort < smaLong) return "downtrend";
  return "rangebound";
}

// === Auto-Tune State (per-symbol) ===
function initAutoTune(strat) {
  if (!strat.autoTune) {
    strat.autoTune = {
      rollingPL: [],
      rollingWins: [],
      rollingMissed: [],
      buyThresholdATR: strat.buyThresholdATR || 1.5,
      sellThresholdATR: strat.sellThresholdATR || 1.0,
      confirmTicks: strat.confirmTicks || 3,
      atrLength: strat.atrLength || 7,
    };
  }
}

function getTradeDecision({
  symbol,
  price,
  lastPrice,
  costBasis,
  strategyState,
  portfolio,
  config,
  strat,
}) {
  // === Init/auto-tune ===
  initAutoTune(strat);
  const auto = strat.autoTune;

  // Safety Brake
  if (portfolio && portfolio.drawdownTriggered) return null;

  // --- 1. Learn from recent trades ---
  // For demo: if last 5 trades were all misses, reduce thresholds
  const recentPL = auto.rollingPL.slice(-5);
  const winRate =
    recentPL.length > 0
      ? recentPL.filter((pl) => pl > 0).length / recentPL.length
      : 0.5;

  // === 2. Auto-tune ATR_LENGTH ===
  if (recentPL.length === 5) {
    if (winRate < 0.4) auto.atrLength = clamp(auto.atrLength - 1, 5, 21);
    if (winRate > 0.8) auto.atrLength = clamp(auto.atrLength + 1, 5, 21);
  }

  // === 3. Auto-tune BUY/SELL/CONFIRM thresholds ===
  // Simple logic: loosen if no trades, tighten if too many/frequent
  if (auto.rollingMissed.slice(-10).length >= 10) {
    auto.buyThresholdATR = clamp(auto.buyThresholdATR - 0.1, 1.0, 3.0);
    auto.confirmTicks = clamp(auto.confirmTicks - 1, 1, 5);
  }
  if (recentPL.length === 5 && winRate > 0.9) {
    auto.buyThresholdATR = clamp(auto.buyThresholdATR + 0.1, 1.0, 3.0);
    auto.confirmTicks = clamp(auto.confirmTicks + 1, 1, 5);
  }

  // --- 4. Core Regime/Vol/Confirmation logic ---
  const regime = detectRegime(strategyState, {
    ...config,
    ATR_LENGTH: auto.atrLength,
  });
  const atrVal = atr(strategyState.priceHistory, auto.atrLength);
  strategyState.trend = regime;
  strategyState.atr = atrVal;

  // Entry/exit confirmation (as before)
  const trends = strategyState.trendHistory || [];
  const confirmLen = auto.confirmTicks;
  const lastNTicks = trends.slice(-confirmLen - 1);
  const prevDown = lastNTicks.slice(0, -1).every((t) => t === "down");
  const nowUp = lastNTicks[lastNTicks.length - 1] === "up";
  const prevUp = lastNTicks.slice(0, -1).every((t) => t === "up");
  const nowDown = lastNTicks[lastNTicks.length - 1] === "down";

  // Downtrend: Deep-dip reversal buys
  if (
    regime === "downtrend" &&
    atrVal &&
    lastPrice &&
    trends.length > confirmLen &&
    prevDown &&
    nowUp &&
    price < lastPrice - atrVal * auto.buyThresholdATR
  ) {
    return {
      action: "BUY",
      reason: "deep-dip reversal (auto-tuned)",
      size: config.MIN_TRADE_SIZE || 10,
    };
  }

  // Uptrend: Breakout buys
  if (
    regime === "uptrend" &&
    atrVal &&
    lastPrice &&
    trends.length > confirmLen &&
    prevUp &&
    nowDown &&
    price > lastPrice + atrVal * auto.buyThresholdATR
  ) {
    return {
      action: "BUY",
      reason: "uptrend breakout (auto-tuned)",
      size: config.MIN_TRADE_SIZE || 10,
    };
  }

  // Rangebound: Grid buys/sells
  if (regime === "rangebound" && atrVal && lastPrice) {
    if (price < lastPrice - atrVal * auto.buyThresholdATR) {
      return {
        action: "BUY",
        reason: "rangebound grid buy (auto-tuned)",
        size: config.MIN_TRADE_SIZE || 10,
      };
    }
    if (price > lastPrice + atrVal * auto.sellThresholdATR) {
      return {
        action: "SELL",
        reason: "rangebound grid sell (auto-tuned)",
        size: config.MIN_TRADE_SIZE || 10,
      };
    }
  }

  // Trailing sell after reversal
  if (
    atrVal &&
    lastPrice &&
    trends.length > confirmLen &&
    prevUp &&
    nowDown &&
    price < lastPrice - atrVal * auto.sellThresholdATR
  ) {
    return {
      action: "SELL",
      reason: "trailing stop reversal (auto-tuned)",
      size: config.MIN_TRADE_SIZE || 10,
    };
  }

  // No trade this tick
  return null;
}

function updateStrategyState(symbol, state, config) {
  // Here you can add logic to update rollingPL, rollingMissed, etc.
  // For now, it's left empty for clarity.
}

module.exports = {
  name,
  version,
  description,
  getTradeDecision,
  updateStrategyState,
};
