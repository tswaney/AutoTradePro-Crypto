// strategies.js
// Static list that mirrors your bot's strategy menu (IDs must match the numbers your script expects).
export const strategies = [
  { id: 1, name: 'Dynamic Regime Switching (1.0)', desc: 'Auto-switches between DCA, Grid/Mean Reversion, and Accumulate based on market regime.' },
  { id: 2, name: 'Dynamic Regime Switching + Profit Lock (2.0)', desc: 'Switches regimes and auto-locks profits daily or when threshold reached.' },
  { id: 3, name: 'Moderate Retain Mode (v1.1)', desc: 'Grid strategy with moderate profit locking and cash reserve using config thresholds.' },
  { id: 4, name: 'Moderate Retain Mode (2.1)', desc: 'Grid-based trading with ATR-driven thresholds, 3-tick confirmations, and weighted grid entries.' },
  { id: 5, name: 'Moderate Retain Mode (3.0)', desc: 'ATR-fallback thresholds, 2-of-3 tick confirmations, 3 grid levels, 7-period ATR lookback.' },
  { id: 6, name: 'Moderate Retain Mode (4.0)', desc: 'Grid-based trading with ATR thresholds, 2-of-3 confirmations, weighted grid entries, +24h pullback buys and +5% sells.' },
  { id: 7, name: 'Simple Buy Low/Sell High (1.1)', desc: 'Buys below cost basis threshold; sells above; simple gating.' },
  { id: 8, name: 'Super Adaptive Strategy (1.0)', desc: 'Hybrid regime/volatility/swing strategy for varied market conditions.' },
  { id: 9, name: 'Ultimate Safety Profit Strategy (1.0)', desc: 'Adaptive regime, volatility scaling, profit lock, risk spread, emergency brake.' },
  { id: 10, name: 'Ultimate Safety Profit Strategy (2.0)', desc: 'Adds auto-tune learning to (1.0).' },
];

export function getStrategies() { return strategies; }
export function getById(id) { return strategies.find(s => s.id === Number(id)); }
