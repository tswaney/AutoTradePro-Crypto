// strategies/moderateRetainMode_v3.js
// Version 3.0: Moderate Retain Mode with ATR fallback, 2-of-3 tick confirmations,
// reduced gridLevels (3) and shorter ATR lookback (7)

module.exports = {
  name: "Moderate Retain Mode",
  version: "3.0",
  description:
    "ATR-fallback thresholds, 2-of-3 tick confirmations, 3 grid levels, 7-period ATR lookback",

  /**
   * Called each tick: compute a 7-period ATR, then
   * fall back to base thresholds if ATR is too small.
   */
  updateStrategyState(symbol, state, config) {
    const lookback = 7;
    const hist = state.priceHistory.slice(-lookback - 1);
    if (hist.length > 1) {
      let sum = 0;
      for (let i = 1; i < hist.length; i++) {
        sum += Math.abs(hist[i] - hist[i - 1]);
      }
      const atr = sum / (hist.length - 1);
      state.atr = atr;
      // dynamic thresholds based on ATR
      const dynBuy = -atr;
      const dynSell = atr;
      // fallback if ATR thresholds are smaller than your base config
      state.dynamicBuyThreshold =
        Math.abs(dynBuy) < Math.abs(config.baseBuyThreshold)
          ? config.baseBuyThreshold
          : dynBuy;
      state.dynamicSellThreshold =
        Math.abs(dynSell) < Math.abs(config.baseSellThreshold)
          ? config.baseSellThreshold
          : dynSell;
    }
  },

  /**
   * getTradeDecision:
   * – Requires 2 of the last 3 ticks to be up (for buys) or down (for sells)
   * – Uses 3 gridLevels to slice thresholds
   * – Only buys if price < costBasis, only sells if price > costBasis
   */
  getTradeDecision({
    price,
    lastPrice,
    costBasis,
    strategyState: state,
    config,
  }) {
    const trends = state.trendHistory || [];
    if (trends.length < 3) return;

    const lastThree = trends.slice(-3);
    const downs = lastThree.filter((t) => t === "down").length;
    const ups = lastThree.filter((t) => t === "up").length;

    const levels = 3;
    const buyLevels = [];
    const sellLevels = [];
    const baseBuy = state.dynamicBuyThreshold ?? config.baseBuyThreshold;
    const baseSell = state.dynamicSellThreshold ?? config.baseSellThreshold;
    for (let i = 1; i <= levels; i++) {
      buyLevels.push(baseBuy * (i / levels));
      sellLevels.push(baseSell * (i / levels));
    }

    // SELL: at least 2/3 downs + price above costBasis + threshold met
    if (downs >= 2 && price > costBasis) {
      for (let i = levels - 1; i >= 0; i--) {
        if ((price - lastPrice) / lastPrice >= sellLevels[i]) {
          return { action: "sell", gridLevel: i + 1 };
        }
      }
    }

    // BUY: at least 2/3 ups + price below costBasis + threshold met
    if (ups >= 2 && price < costBasis) {
      for (let i = levels - 1; i >= 0; i--) {
        if ((lastPrice - price) / lastPrice >= Math.abs(buyLevels[i])) {
          return { action: "buy", gridLevel: i + 1 };
        }
      }
    }

    // otherwise, hold
  },
};
