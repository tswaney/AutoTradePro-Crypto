// strategies/simpleBuySell.js
// Simple Buy Low / Sell High Strategy
// - Buys if price drops more than threshold
// - Sells if price rises more than threshold

module.exports = {
  name: "Simple Buy Low/Sell High",
  version: "v1.0",
  description: "Trades on fixed price % change using configurable thresholds.",

  getTradeDecision({ price, lastPrice, costBasis, strategyState, config }) {
    if (!lastPrice || strategyState.priceHistory.length < 2) return null;

    const delta = ((price - lastPrice) / lastPrice) * 100;
    const buyThreshold = parseFloat(process.env.SIMPLE_BUY_THRESHOLD || "-2.0");
    const sellThreshold = parseFloat(
      process.env.SIMPLE_SELL_THRESHOLD || "3.0"
    );

    if (delta <= buyThreshold) return { action: "buy", delta };
    if (delta >= sellThreshold) return { action: "sell", delta };
    return null;
  },

  updateStrategyState(symbol, strategyState) {
    const prices = strategyState.priceHistory;
    if (prices.length < 10) {
      strategyState.trend = "neutral";
      return;
    }
    const sma = prices.reduce((a, b) => a + b, 0) / prices.length;
    const current = prices[prices.length - 1];

    if (current > sma * 1.03) strategyState.trend = "up";
    else if (current < sma * 0.97) strategyState.trend = "down";
    else strategyState.trend = "neutral";
  },
};
