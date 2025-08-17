// control-plane/src/persistence.js
// Small helper for per-bot meta.json persistence under BOT_DATA_ROOT/<botId>/meta.json
import fs from 'fs';
import path from 'path';

export function metaPathFor(botDataRoot, botId) {
  return path.join(botDataRoot, botId, 'meta.json');
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function loadAllBotsFromDisk(botDataRoot) {
  const bots = {};
  try {
    const entries = fs.readdirSync(botDataRoot, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const botId = ent.name;
      const metaFile = metaPathFor(botDataRoot, botId);
      if (!fs.existsSync(metaFile)) continue;
      try {
        const metaRaw = fs.readFileSync(metaFile, 'utf8');
        const meta = JSON.parse(metaRaw);
        // minimal validation
        if (!meta || typeof meta !== 'object' || !meta.id) continue;
        bots[botId] = {
          id: meta.id,
          name: meta.name || meta.id,
          status: 'stopped',
          strategyId: meta.strategyId || '',
          symbols: Array.isArray(meta.symbols) ? meta.symbols : [],
          config: meta.config || {},
          logs: [], cursor: 0,
          buys: Number(meta.buys || 0),
          sells: Number(meta.sells || 0),
          cash: Number(meta.cash || 0),
          cryptoMkt: Number(meta.cryptoMkt || 0),
          locked: Number(meta.locked || 0),
          totalPL: Number(meta.totalPL || 0),
          beginningPortfolioValue: Number(meta.beginningPortfolioValue || 0),
          bornAt: Number(meta.bornAt || Date.now()),
        };
      } catch (e) {
        // skip bad meta files
      }
    }
  } catch (e) {
    // botDataRoot might not exist yet
  }
  return bots;
}

export function saveBotMeta(botDataRoot, bot) {
  const dir = path.join(botDataRoot, bot.id);
  ensureDir(dir);
  const metaFile = metaPathFor(botDataRoot, bot.id);
  const meta = {
    id: bot.id,
    name: bot.name,
    strategyId: bot.strategyId,
    symbols: bot.symbols,
    config: bot.config || {},
    beginningPortfolioValue: Number(bot.beginningPortfolioValue || 0),
    bornAt: Number(bot.bornAt || Date.now()),
    buys: Number(bot.buys || 0),
    sells: Number(bot.sells || 0),
    cash: Number(bot.cash || 0),
    cryptoMkt: Number(bot.cryptoMkt || 0),
    locked: Number(bot.locked || 0),
    totalPL: Number(bot.totalPL || 0),
    lastSavedAt: Date.now(),
    version: 1,
  };
  try {
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
    return true;
  } catch (e) {
    return false;
  }
}
