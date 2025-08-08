// In a real deployment, this comes from Azure (Container Apps/ACI).
// For local dev, we keep a simple in-memory list.
export const bots = new Map([
  ['strat-moderate-btc', {
    botId: 'strat-moderate-btc',
    strategyFile: 'strategies/moderate_mode_v1.js',
    symbols: ['BTCUSD','SOLUSD'],
    status: 'stopped',
    mode: 'demo',
    aiEnabled: false,
    dataDir: './data/strat-moderate-btc'
  }]
]);

export function listBots() { return Array.from(bots.values()); }
export function getBot(id) { return bots.get(id) || null; }

export function startBot(id) {
  const b = bots.get(id); if (!b) return false;
  b.status = 'running'; return true;
}
export function stopBot(id) {
  const b = bots.get(id); if (!b) return false;
  b.status = 'stopped'; return true;
}
export function restartBot(id) {
  const b = bots.get(id); if (!b) return false;
  b.status = 'running'; return true;
}
export function patchBot(id, patch) {
  const b = bots.get(id); if (!b) return null;
  Object.assign(b, patch);
  return b;
}
