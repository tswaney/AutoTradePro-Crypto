// strategies/moderateRetainMode_v1.js
// Version 1.1: Grid-based trading strategy using configurable thresholds

module.exports = {
  name: "Moderate Retain Mode",
  version: "v1.1",
  description: "Grid strategy with moderate profit locking and cash reserve using config thresholds.",

  /**
   * updateStrategyState: track recent price trend
   * @param {string} symbol
   * @param {object} state  contains priceHistory, trend, delta
   * @param {object} config contains base thresholds
   */
  updateStrategyState(symbol, state, config) {
    if (state.priceHistory.length < 2) return;
    const last = state.priceHistory.at(-1);
    const prev = state.priceHistory.at(-2);
    const delta = (last - prev) / prev;
    state.trend = delta > 0 ? "UP" : delta < 0 ? "DOWN" : "NEUTRAL";
    state.delta = delta;
  },

  /**
   * getTradeDecision: decide buy or sell based on changePct vs config thresholds
   * @param {object} params
   * @param {number} params.price       current market price
   * @param {number} params.costBasis   last average purchase price
   * @param {object} params.strategyState  holds grid entries
   * @param {object} params.config      global config with thresholds
   * @returns {object|null} decision { action: 'buy'|'sell' }
   */
  getTradeDecision({ price, costBasis, strategyState, config }) {
    const { delta, trend } = strategyState;
    const gridSize = strategyState.grid?.length || 0;
    // Log current trend and delta for debugging
    console.log(
      `[STRATEGY] ${trend} trend, Δ ${(delta * 100).toFixed(4)}%, grid size: ${gridSize}`
    );

    // Initial buy if we have no cost basis yet
    if (!costBasis || costBasis === 0) {
      return { action: "buy" };
    }

    // Compute percent change from cost basis
    const changePct = (price - costBasis) / costBasis;

    // BUY: if changePct <= configured baseBuyThreshold
    // e.g. config.baseBuyThreshold = -0.005 means -0.5% drop
    if (changePct <= config.baseBuyThreshold) {
      return { action: "buy" };
    }

    // SELL: if changePct >= configured baseSellThreshold and we have inventory
    // e.g. config.baseSellThreshold = 0.05 means +5% gain
    if (gridSize > 0 && changePct >= config.baseSellThreshold) {
      return { action: "sell" };
    }

    // Otherwise, hold
    return null;
  },
};
