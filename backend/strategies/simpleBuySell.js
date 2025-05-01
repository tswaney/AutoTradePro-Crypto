// SimpleBuyLowSellHigh.js - Percentage-based threshold strategy
module.exports = {
  name: "Simple Buy Low/Sell High",
  version: "v1.0",
  description: "Trades on fixed price % change using configurable thresholds.",

  updateStrategyState(symbol, state) {
    // No trend logic needed
  },

  getTradeDecision({ price, lastPrice, strategyState }) {
    if (!lastPrice) return null;
    const changePct = (price - lastPrice) / lastPrice;

    if (changePct <= -0.02) return { action: "buy" };
    if (changePct >= 0.03 && (strategyState.grid?.length || 0) > 0)
      return { action: "sell" };
    return null;
  },
};
