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
    // 1) Always log the [STRATEGY] line
    console.log(
      `[STRATEGY] ${s.trend.toUpperCase()} trend, Δ ${(s.delta * 100).toFixed(4)}%, grid size: ${s.grid.length}`
    );

    // 2) Compute delta vs cost basis
    const deltaCost = (price - costBasis) / costBasis;
    const pct = (deltaCost * 100).toFixed(4);

    // 3) BUY if dipped past threshold
    if (deltaCost <= config.baseBuyThreshold) {
      console.log(
        `🟢 [SIMPLE] BUY triggered: Δcost ${pct}% <= ${(config.baseBuyThreshold*100).toFixed(2)}%`
      );
      return { action: "buy" };
    }

    // 4) SELL if up above threshold
    if (deltaCost >= config.baseSellThreshold) {
      console.log(
        `🔴 [SIMPLE] SELL triggered: Δcost ${pct}% >= ${(config.baseSellThreshold*100).toFixed(2)}%`
      );
      return { action: "sell" };
    }

    // 5) Otherwise HOLD
    return;
  },
};
