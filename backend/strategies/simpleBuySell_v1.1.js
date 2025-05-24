// strategies/simpleBuySell_v1.1.js
// Version 1.1: Simple Buy Low / Sell High (cost‐basis gating)

module.exports = {
  name:        "Simple Buy Low/Sell High",
  version:     "1.1",
  description:
    "Buys when price dips below costBasis by baseBuyThreshold; sells when price " +
    "rises above costBasis by baseSellThreshold; straightforward cost-basis gating.",

  updateStrategyState(symbol, state, config) {
    const h = state.priceHistory;
    if (h.length < 2) return;
    const prev = h[h.length - 2], curr = h[h.length - 1];
    const delta = (curr - prev) / prev;
    state.delta = delta;
    state.trend = delta > 0 ? "up" : delta < 0 ? "down" : "neutral";
  },

  getTradeDecision({ price, costBasis, strategyState: s, config }) {
    // (the [STRATEGY] log has been removed — summary is now handled in testPrice.js)

    // Compute delta vs cost basis
    const deltaCost = (price - costBasis) / costBasis;
    const pct = (deltaCost * 100).toFixed(4);

    // BUY if dipped past threshold
    if (deltaCost <= config.baseBuyThreshold) {
      console.log(
        `🟢 [${s.module.name}] BUY triggered: Δcost ${pct}% <= ${(config.baseBuyThreshold*100).toFixed(2)}%`
      );
      return { action: "buy" };
    }

    // SELL if up above threshold
    if (deltaCost >= config.baseSellThreshold) {
      console.log(
        `🔴 [${s.module.name}] SELL triggered: Δcost ${pct}% >= ${(config.baseSellThreshold*100).toFixed(2)}%`
      );
      return { action: "sell" };
    }

    // Otherwise HOLD
    return;
  },
};
