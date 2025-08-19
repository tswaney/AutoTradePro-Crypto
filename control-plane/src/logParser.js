// control-plane/src/logParser.js (ESM)
// Counts only EXECUTED trades, tracks last prices from decision/hold lines,
// and computes live Crypto (mkt) & Total P/L without keypress status.

const NUM = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};

export function round2(x) {
  return Math.round(NUM(x) * 100) / 100;
}

export function createBotState(seed) {
  return {
    id: seed.id,
    startedAt: seed.startedAt || Date.now(),
    strategy: seed.strategy || "",
    symbols: new Set(seed.symbols || []),

    holdings: seed.holdings || {}, // { SYM: { amount, costBasis } }

    buys: 0,
    sells: 0,

    cash: NUM(seed.cash) || 0,
    locked: NUM(seed.locked) || 0,
    crypto: 0,
    totalPL: 0,

    lastPrice: {}, // { SYM: price }
    startingValue: NUM(seed.startingValue) || 0,

    status: "stopped",
    lastLineAt: null,
    lastLine: "",
  };
}

export function computeCryptoValue(bot) {
  let total = 0;
  const holdings = bot.holdings || {};
  for (const sym of Object.keys(holdings)) {
    const qty = NUM(holdings[sym]?.amount);
    const px = NUM(bot.lastPrice[sym]);
    if (qty > 0 && Number.isFinite(px)) total += qty * px;
  }
  return round2(total);
}

export function applyLine(bot, ln) {
  bot.lastLine = ln;
  bot.lastLineAt = Date.now();

  let changed = false;
  let emitSnapshot = false;

  if (/\bInitial cycle complete\b/i.test(ln)) {
    bot.status = "running";
    changed = true;
    emitSnapshot = true;
  }
  if (/\b(stopped|exited)\b/i.test(ln)) {
    bot.status = "stopped";
    changed = true;
    emitSnapshot = true;
  }

  // Count ONLY executed trades
  const isBuyExec =
    /\bBUY executed:/i.test(ln) || /^🟢\s*BUY executed:/i.test(ln);
  const isSellExec =
    /\bSELL executed:/i.test(ln) || /^🔴\s*SELL executed:/i.test(ln);
  if (isBuyExec) {
    bot.buys += 1;
    changed = true;
    emitSnapshot = true;
  }
  if (isSellExec) {
    bot.sells += 1;
    changed = true;
    emitSnapshot = true;
    const mLocked = /Locked:\s*\$(-?\d+(?:\.\d+)?)/i.exec(ln);
    if (mLocked)
      bot.locked = Math.max(0, round2(NUM(bot.locked) + NUM(mLocked[1])));
  }

  // Track per-symbol prices from decision/hold/debug lines
  //  "📈 Strategy decision for BTCUSD: SELL @ $116307.69806500"
  //  "💤 Strategy decision for BONKUSD: HOLD @ $0.00002278"
  //  "[DEBUG][PEPEUSD] Buy check: price=0.000010795, ..."
  let sym, px;
  let mm = ln.match(
    /Strategy decision for\s+([A-Z0-9]+):\s+\w+\s+@\s+\$(-?\d+(?:\.\d+)?)/i
  );
  if (mm) {
    sym = mm[1];
    px = Number(mm[2]);
  } else {
    mm = ln.match(/\[DEBUG]\[([A-Z0-9]+)\].*?\bprice\s*=\s*(-?\d+(?:\.\d+)?)/i);
    if (mm) {
      sym = mm[1];
      px = Number(mm[2]);
    }
  }
  if (sym && Number.isFinite(px)) {
    bot.lastPrice[sym] = px;
    bot.symbols.add(sym);
    changed = true;
  }

  // Parse optional STATUS lines if present
  const mCash = /Cash:\s*\$(-?\d+(?:\.\d+)?)/i.exec(ln);
  const mCrypto = /Crypto\s*\(mkt\):\s*\$(-?\d+(?:\.\d+)?)/i.exec(ln);
  const mLock = /Locked:\s*\$(-?\d+(?:\.\d+)?)/i.exec(ln);
  const mTPL = /Total\s*P\/L:\s*\$(-?\d+(?:\.\d+)?)/i.exec(ln);
  if (mCash) {
    bot.cash = round2(NUM(mCash[1]));
    changed = true;
    emitSnapshot = true;
  }
  if (mCrypto) {
    bot.crypto = round2(NUM(mCrypto[1]));
    changed = true;
    emitSnapshot = true;
  }
  if (mLock) {
    bot.locked = round2(NUM(mLock[1]));
    changed = true;
    emitSnapshot = true;
  }
  if (mTPL) {
    bot.totalPL = round2(NUM(mTPL[1]));
    changed = true;
    emitSnapshot = true;
  }

  // If we just learned a price, recompute crypto and P/L even without STATUS
  if (sym) {
    const cryptoVal = computeCryptoValue(bot);
    const endValue = NUM(bot.cash) + NUM(bot.locked) + NUM(cryptoVal);
    bot.crypto = round2(cryptoVal);
    if (!bot.startingValue) bot.startingValue = round2(endValue); // first tick sets baseline
    bot.totalPL = round2(endValue - NUM(bot.startingValue));
    emitSnapshot = true;
    changed = true;
  }

  return { changed, emitSnapshot };
}
