// strategies/simpleBuySell.js
// Version 1.1: Simple Buy Low/Sell High with Cost-Basis Gating

module.exports = {
  name: "Simple Buy Low/Sell High",
  version: "1.1",
  description:
    "Buys when price dips below costBasis by baseBuyThreshold; " +
    "sells when price rises above costBasis by baseSellThreshold; " +
    "ensures cost-basis gating for grid consistency.",

  /**
   * Decide whether to buy/sell based on:
   *  - percentage move from last tick
   *  - costBasis gating (must buy below costBasis, sell above costBasis)
   */
  getTradeDecision({ price, lastPrice, costBasis, strategyState, config }) {
    // Need a previous price to compare
    if (lastPrice == null) return;

    // Percentage change since last tick
    const pctChange = (price - lastPrice) / lastPrice;

    // BUY: price < costBasis AND downward move exceeds threshold
    if (price < costBasis && pctChange <= config.baseBuyThreshold) {
      return { action: "buy" };
    }

    // SELL: price > costBasis AND upward move exceeds threshold
    if (price > costBasis && pctChange >= config.baseSellThreshold) {
      return { action: "sell" };
    }

    // Otherwise hold
  },
};
