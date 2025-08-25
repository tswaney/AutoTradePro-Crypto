const fs = require("fs");
const path = require("path");

function safe(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function writeSummary(dir, s) {
  try {
    const p = path.join(dir, "summary.json");
    const safeSummary = {
      beginningPortfolioValue: s.beginningPortfolioValue ?? null,
      duration: s.duration ?? null,
      buys: Math.max(0, Number(s.buys || 0)),
      sells: Math.max(0, Number(s.sells || 0)),
      totalPL: safe(s.totalPL),
      cash: s.cash == null ? null : safe(s.cash),
      cryptoMkt: s.cryptoMkt == null ? null : safe(s.cryptoMkt),
      locked: s.locked == null ? null : safe(s.locked),
      currentValue: safe(s.currentValue),
      dayPL: safe(s.dayPL),
    };
    fs.writeFileSync(p, JSON.stringify(safeSummary, null, 2));
  } catch {}
}

function finalizeSummary(dir, s) {
  writeSummary(dir, s);
}

module.exports = { writeSummary, finalizeSummary };
