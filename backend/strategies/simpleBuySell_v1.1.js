// strategies/simpleBuySell_v1.1.js
// Version 1.1: Simple Buy Low / Sell High (cost-basis gating)
//
// Exports a pure strategy object for use in AutoTradePro-Crypto
// NO logging/output here—main program handles all status/console output

module.exports = {
  name:        "Simple Buy Low/Sell High",
  version:     "1.1",
  description:
    "Buys when price dips below costBasis by baseBuyThreshold; sells when price " +
    "rises above costBasis by baseSellThreshold; straightforward cost-basis gating.",

  /**
   * updateStrategyState:
   * Updates internal state such as trend direction and percent change.
   * Called by the main program after each price update.
   *
   * @param {string} symbol
   * @param {object} state  contains priceHistory, trend, delta
   * @param {object} config contains base thresholds
   */
  updateStrategyState(symbol, state, config) {
    const h = state.priceHistory;
    if (h.length < 2) return;
    const prev = h[h.length - 2], curr = h[h.length - 1];
    const delta = (curr - prev) / prev;
    state.delta = delta;
    state.trend = delta > 0 ? "up" : delta < 0 ? "down" : "neutral";
  },

  /**
   * getTradeDecision:
   * Returns {action: 'buy'} or {action: 'sell'} if conditions are met, or undefined to hold.
   * Called by the main program with all required context for that symbol.
   *
   * @param {object} params
   * @param {number} params.price         current market price
   * @param {number} params.costBasis     current cost basis
   * @param {object} params.strategyState strategy state (trend/delta/history)
   * @param {object} params.config        current config
   * @returns {object|undefined}          { action: 'buy'|'sell' }
   */
  getTradeDecision({ price, costBasis, strategyState: s, config }) {
    // Compute delta vs cost basis
    const deltaCost = (price - costBasis) / costBasis;

    // BUY if price is below cost basis by baseBuyThreshold
    if (deltaCost <= config.baseBuyThreshold) {
      return { action: "buy" };
    }

    // SELL if price is above cost basis by baseSellThreshold
    if (deltaCost >= config.baseSellThreshold) {
      return { action: "sell" };
    }

    // Otherwise HOLD (no action)
    return;
  },
};
