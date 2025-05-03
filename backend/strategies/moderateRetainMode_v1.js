// ModerateRetainMode.js - Grid-based trading strategy
module.exports = {
  name: "Moderate Retain Mode",
  version: "v1.0",
  description: "Grid strategy with moderate profit locking and cash reserve.",

  updateStrategyState(symbol, state) {
    if (state.priceHistory.length < 2) return;
    const delta =
      (state.priceHistory.at(-1) - state.priceHistory.at(-2)) /
      state.priceHistory.at(-2);
    state.trend = delta > 0.01 ? "UP" : delta < -0.01 ? "DOWN" : "NEUTRAL";
    state.delta = delta;
  },

  getTradeDecision({ price, costBasis, strategyState, config }) {
    const { delta, trend } = strategyState;
    const gridSize = strategyState.grid?.length || 0;
    console.log(
      `[STRATEGY] ${trend} trend, Δ ${(delta * 100).toFixed(
        4
      )}%, grid size: ${gridSize}`
    );

    if (!costBasis || costBasis === 0) {
      return { action: "buy" };
    }

    const changePct = (price - costBasis) / costBasis;

    if (changePct <= -0.015) return { action: "buy" };
    if (changePct >= 0.02 && gridSize > 0) return { action: "sell" };
    return null;
  },
};
