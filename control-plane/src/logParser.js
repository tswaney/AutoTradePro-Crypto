// control-plane/src/logParser.js
// Robust log parser that derives summary even before first explicit Cash/Crypto lines.
// Computes Crypto (mkt) from the "Current Holdings" table and tracks Locked/counters.

const MONEY_RE = /-?\$?\s*([0-9][0-9,]*\.?[0-9]*)/;
const LOCKED_LINE_RE = /Locked:\s*\$?\s*([0-9][0-9,]*\.?[0-9]*)/g;
const PROFIT_LOCK_LINE_RE =
  /PROFIT LOCKED:\s*\$?\s*([0-9][0-9,]*\.?[0-9]*)\s*moved/i;
const BEGIN_PV_RE =
  /Beginning Portfolio Value:\s*\$?\s*([0-9][0-9,]*\.?[0-9]*)/;
const TOTAL_PL_RE = /Total P\/L:\s*\$?\s*([0-9][0-9,]*\.?[0-9]*)/;
const CASH_RE = /^\s*Cash\s*:?\s*\$?\s*([0-9][0-9,]*\.?[0-9]*)/im;
const CRYPTO_MKT_RE =
  /^\s*Crypto\s*\(mkt\)\s*:?\s*\$?\s*([0-9][0-9,]*\.?[0-9]*)/im;

// Table rows look like:
// │ 1  │ BTCUSD │ 0.037830 │ 114887.76802517 │ 113208.000000 │
const HOLDINGS_ROW_RE =
  /^\s*│\s*\d+\s*│\s*([A-Z0-9]+)\s*│\s*([-0-9.,]+)\s*│\s*([-0-9.,]+)\s*│/;

function toNumber(maybeStr) {
  if (maybeStr == null) return null;
  const s = String(maybeStr).replace(/[^0-9.-]/g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function parseLastLocked(text) {
  // Prefer the latest explicit "Locked: $X" total if present.
  let last = null;
  for (const m of text.matchAll(LOCKED_LINE_RE)) {
    last = toNumber(m[1]);
  }
  if (last != null) return last;

  // Fallback: sum individual profit-lock events if no "Locked:" total was printed yet.
  let sum = 0;
  let found = false;
  for (const m of text.matchAll(PROFIT_LOCK_LINE_RE)) {
    const v = toNumber(m[1]);
    if (v != null) {
      sum += v;
      found = true;
    }
  }
  return found ? sum : 0;
}

function parseBuysSells(text) {
  // Defensive: support multiple emoji/styles that might appear.
  const buyCount =
    (text.match(/BUY executed/gi) || []).length +
    (text.match(/🟢\s*BUY/gi) || []).length +
    (text.match(/✅\s*BUY/gi) || []).length;

  const sellCount =
    (text.match(/SELL executed/gi) || []).length +
    (text.match(/🔴\s*SELL/gi) || []).length;

  return { buyCount, sellCount };
}

function parseHoldingsTableValue(text) {
  // Find the last "Current Holdings:" block and sum qty*price for rows.
  const idx = text.lastIndexOf("Current Holdings:");
  if (idx === -1) return null;

  const tail = text.slice(idx);
  const lines = tail.split(/\r?\n/);
  let total = 0;
  let any = false;

  for (const line of lines) {
    const m = line.match(HOLDINGS_ROW_RE);
    if (!m) {
      // stop if we've walked past the table
      if (any && !line.includes("│")) break;
      continue;
    }
    const qty = toNumber(m[2]);
    const price = toNumber(m[3]);
    if (qty != null && price != null) {
      total += qty * price;
      any = true;
    }
  }
  return any ? total : null;
}

function parseMoneyByRegex(text, re) {
  const m = text.match(re);
  return m ? toNumber(m[1]) : null;
}

function fmt(amount) {
  if (amount == null || !Number.isFinite(amount)) return null;
  // Round to cents to avoid floating noise for API consumers/UI.
  return Math.round(amount * 100) / 100;
}

function buildSummary(logText) {
  const text = String(logText ?? "");

  const beginningPortfolioValue = parseMoneyByRegex(text, BEGIN_PV_RE);
  const totalPL = parseMoneyByRegex(text, TOTAL_PL_RE);

  // Try to read explicit Cash / Crypto(mkt) first…
  let cash = parseMoneyByRegex(text, CASH_RE);
  let cryptoMkt = parseMoneyByRegex(text, CRYPTO_MKT_RE);

  // …otherwise compute Crypto(mkt) from holdings table right away.
  if (cryptoMkt == null) {
    cryptoMkt = parseHoldingsTableValue(text);
  }

  // Locked total (prefer 'Locked: $X' total; fall back to sum of PROFIT LOCKED lines)
  const locked = parseLastLocked(text);

  // Compute current portfolio value with robust fallbacks.
  // If we still don't have cash, treat it as 0 until logs print it.
  const currentPortfolioValue = (cryptoMkt ?? 0) + (cash ?? 0) + (locked ?? 0);

  const { buyCount, sellCount } = parseBuysSells(text);

  return {
    beginningPortfolioValue: fmt(beginningPortfolioValue),
    buys: buyCount,
    sells: sellCount,
    totalPL: fmt(totalPL), // may be null until first time it’s printed
    cash: fmt(cash ?? 0),
    cryptoMkt: fmt(cryptoMkt ?? 0),
    locked: fmt(locked ?? 0),
    currentPortfolioValue: fmt(currentPortfolioValue),
  };
}

module.exports = {
  buildSummary,
  // exporting helpers makes unit/local testing easier
  _internal: {
    parseHoldingsTableValue,
    parseLastLocked,
    parseBuysSells,
    toNumber,
  },
};
