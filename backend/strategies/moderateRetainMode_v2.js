// strategies/moderateRetainMode_v2.js
// Version 2.0: Moderate Retain Mode with dynamic ATR thresholds,
// 3-tick confirmations, and grid-level entries

module.exports = {
  name: "Moderate Retain Mode",
  version: "2.1",
  description:
    "Grid-based trading with ATR-driven thresholds, 3-tick confirmations, and weighted grid entries",

  /**
   * Called each tick, updates ATR and dynamic thresholds
   */
  updateStrategyState(symbol, state, config) {
    // Compute ATR from priceHistory: average absolute diff over lookback
    const prices = state.priceHistory.map((p) => p);
    if (prices.length >= config.atrLookbackPeriod) {
      let sumTR = 0;
      for (let i = 1; i < prices.length; i++) {
        sumTR += Math.abs(prices[i] - prices[i - 1]);
      }
      const atr = sumTR / (prices.length - 1);
      state.atr = atr;
      // dynamic thresholds based on ATR
      state.dynamicBuyThreshold = -atr;
      state.dynamicSellThreshold = atr;
    }
  },

  /**
   * Decide whether to buy/sell/hold based on:
   *  - 3-tick trend confirmations
   *  - dynamic ATR thresholds
   *  - weighted gridLevels
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
    // Determine threshold per grid-level
    const buyLevels = [];
    const sellLevels = [];
    const baseBuy = state.dynamicBuyThreshold ?? config.baseBuyThreshold;
    const baseSell = state.dynamicSellThreshold ?? config.baseSellThreshold;
    for (let i = 1; i <= config.gridLevels; i++) {
      buyLevels.push(baseBuy * (i / config.gridLevels));
      sellLevels.push(baseSell * (i / config.gridLevels));
    }

    // SELL: require 3 DOWN ticks + price above costBasis + above one of the sellLevels
    if (lastThree.every((t) => t === "down") && price > costBasis) {
      // find highest grid-level met
      for (let i = config.gridLevels - 1; i >= 0; i--) {
        if ((price - lastPrice) / lastPrice >= sellLevels[i]) {
          return { action: "sell", gridLevel: i + 1 };
        }
      }
    }

    // BUY: require 3 UP ticks + price below costBasis + below one of the buyLevels
    if (lastThree.every((t) => t === "up") && price < costBasis) {
      for (let i = config.gridLevels - 1; i >= 0; i--) {
        if ((lastPrice - price) / lastPrice >= Math.abs(buyLevels[i])) {
          return { action: "buy", gridLevel: i + 1 };
        }
      }
    }

    // otherwise hold
    return;
  },
};
