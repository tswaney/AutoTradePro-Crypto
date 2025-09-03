"use strict";

/* =====================================================================================
   testPrice_Dev.js — LIVE quotes, robust strategy selection, safe SELLs, hotkeys

   Surgical fixes, no feature loss:
   • Restored interactive strategy prompt + FORCE_STRATEGY_PROMPT override.
   • Strategy name matching accepts dotted versions (e.g., v1.1) and filename fallback.
   • Runner-level SELL safety: do not execute SELL if profit <= 0 after slippage/fees.
     (Strategy still decides; runner only blocks loss-making sells.)
   • Profit-lock only after SELL (never from initial cash).
   • Live pricing providers (RH auth, Coinbase, RH public, Binance) with freshness gating.
   • Duration in minutes + durationText. Fresh-only valuation in summary (stale separated).
   • Reliable terminal hotkeys (Ctrl+S status, Ctrl+G grid, Ctrl+E legend, Ctrl+C exit).
   ===================================================================================== */

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const readline = require("readline");
const { execSync } = require("child_process");
require("dotenv").config();

/* ------------------------------ tiny utils ----------------------------------------- */
const asBool = (v) => /^(1|true|yes|on)$/i.test(String(v || "").trim());
const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;

/* Ensure logs flush like a terminal */
try {
  if (process.stdout?._handle?.setBlocking)
    process.stdout._handle.setBlocking(true);
} catch {}
try {
  if (process.stderr?._handle?.setBlocking)
    process.stderr._handle.setBlocking(true);
} catch {}

/* Robinhood auth (present if your repo includes sessionManager.js) */
let getAccessToken, PUBLIC_API_KEY;
try {
  ({ getAccessToken, PUBLIC_API_KEY } = require("./sessionManager"));
} catch {
  getAccessToken = null;
  PUBLIC_API_KEY = null;
}

/* Other locals you already had */
const { signRequest } = require("./signRequest");
const { writeSummary, finalizeSummary } = require("./summary-writer");

/* =====================================================================================
   Per-bot data dir, logs, holdings
   ===================================================================================== */
const BOT_ID = process.env.BOT_ID || "default";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data", BOT_ID);
process.env.DATA_DIR = DATA_DIR;

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {
  console.error(`Failed to create DATA_DIR '${DATA_DIR}': ${e.message}`);
  process.exit(1);
}

const LOG_FILE = process.env.LOG_FILE || "testPrice_output.txt";
const LOG_PATH = process.env.LOG_PATH || path.join(DATA_DIR, LOG_FILE);
const logStream = fs.createWriteStream(LOG_PATH, { flags: "a" });
const _stdoutWrite = process.stdout.write.bind(process.stdout);
const _stderrWrite = process.stderr.write.bind(process.stderr);
process.stdout.write = (chunk, enc, cb) => {
  try {
    logStream.write(chunk);
  } catch {}
  return _stdoutWrite(chunk, enc, cb);
};
process.stderr.write = (chunk, enc, cb) => {
  try {
    logStream.write(chunk);
  } catch {}
  return _stderrWrite(chunk, enc, cb);
};

console.log("DEBUG:", { __dirname, BOT_ID, DATA_DIR, LOG_PATH });

/* =====================================================================================
   Config / constants
   ===================================================================================== */
const TRADING_API = "https://trading.robinhood.com";
const USER_AGENT = "Mozilla/5.0 PowerShell/7.2.0";

const SIMPLE_BUY_THRESHOLD =
  parseFloat(process.env.SIMPLE_BUY_THRESHOLD) || 2.0;
const SIMPLE_SELL_THRESHOLD =
  parseFloat(process.env.SIMPLE_SELL_THRESHOLD) || 3.0; // <-- fixed

const ENABLE_PEAK_CONFIRMATION = asBool(process.env.ENABLE_PEAK_CONFIRMATION);

const TEST_MODE = asBool(process.env.TEST_MODE);
const MAX_TEST_BUYS = parseInt(process.env.MAX_TEST_BUYS, 10) || 2;
const MAX_TEST_SELLS = parseInt(process.env.MAX_TEST_SELLS, 10) || 2;
const LIMIT_TO_MAX_BUY_SELL = asBool(process.env.LIMIT_TO_MAX_BUY_SELL);

// Profit-lock: % of realized SELL profit → lockedCash (NEVER from initial cash)
const PROFIT_LOCK_PERCENT = parseFloat(process.env.PROFIT_LOCK_PERCENT ?? 20);
const PROFIT_LOCK_FRAC = Math.max(0, Math.min(PROFIT_LOCK_PERCENT / 100, 1));

// Slippage
const DEFAULT_SLIPPAGE_PCT = parseFloat(process.env.defaultSlippage) || 2.0;
const DEFAULT_SLIPPAGE_FRAC = Math.max(
  0,
  Math.min(DEFAULT_SLIPPAGE_PCT / 100, 1)
);

// Price freshness + gating
const PRICE_FRESHNESS_MS = parseInt(
  process.env.PRICE_FRESHNESS_MS || "120000",
  10
); // 2 min
const REQUIRE_LIVE_FOR_TRADES = asBool(
  process.env.REQUIRE_LIVE_FOR_TRADES ?? "true"
);

// Provider order
const DEFAULT_PROVIDERS = "robinhood_auth,coinbase,robinhood_public,binance";
const PROVIDER_ORDER = String(process.env.PRICE_PROVIDERS || DEFAULT_PROVIDERS)
  .split(",")
  .map((x) => x.trim().toLowerCase())
  .filter(Boolean);

// Force an interactive prompt even when a runner detaches TTY
const FORCE_STRATEGY_PROMPT = asBool(process.env.FORCE_STRATEGY_PROMPT);

/* Primary runtime config */
const config = {
  aiEnabled: asBool(process.env.AI_ENABLED),
  demoMode: asBool(process.env.DEMO_MODE),
  testMode: TEST_MODE,
  limitBuysSells: LIMIT_TO_MAX_BUY_SELL,
  initialBalance: parseFloat(process.env.INITIAL_BALANCE) || 1000,
  minTradeAmount: 0.01,
  baseBuyThreshold: -(SIMPLE_BUY_THRESHOLD / 100),
  baseSellThreshold: SIMPLE_SELL_THRESHOLD / 100,
  atrLookbackPeriod: 14,
  gridLevels: 10,
  defaultSlippage: DEFAULT_SLIPPAGE_FRAC,
  priceDecimalPlaces: 8,
  buyLimit: Infinity,
  sellLimit: Infinity,
  stopLossLimit: null,
  stopLossPercent: -0.3,
  dailyProfitTarget: null,
  checkInterval: 30 * 1000,
  strategy: "",
  enablePeakFilter: ENABLE_PEAK_CONFIRMATION,
};

console.log(`\n=== Running in ${config.demoMode ? "DEMO" : "LIVE"} mode ===`);
if (config.testMode)
  console.log(
    `🧪 TEST_MODE: trades simulated${config.limitBuysSells ? " (capped)" : ""}`
  );
console.log(
  `Peak-confirmation on BUY is ${
    config.enablePeakFilter ? "ENABLED" : "DISABLED"
  }`
);
console.log(
  "Press CTRL+S for Status, CTRL+G for Grid, CTRL+E for Legend, CTRL+C to exit\n"
);

/* =====================================================================================
   Global state
   ===================================================================================== */
const BASE_URL =
  process.env.BASE_URL || "https://api.robinhood.com/marketdata/forex/quotes/";
console.log(`Price API base: ${BASE_URL}`);

let portfolio = {
  cashReserve: round2(
    parseFloat(process.env.INITIAL_CASH || config.initialBalance)
  ),
  lockedCash: 0, // grows ONLY from realized SELL profits
  cryptos: {},
  buysToday: 0,
  sellsToday: 0,
  stopLossesToday: 0,
  dailyProfitTotal: 0,
  startTime: new Date(),
  lastReset: new Date(),
  initialCryptoValue: 0,
  beginningPortfolioValue: 0,
  startingPortfolioValue: 0,
  _holdingsSource: null,
};

let strategies = {};
let selectedStrategy = null;

// Track quotes + freshness
const quotes = Object.create(null);

// Trading flags
let tradingEnabled = false;
let shuttingDown = false;

/* =====================================================================================
   Terminal setup
   ===================================================================================== */
if (process.stdin.isTTY) {
  try {
    execSync("stty -ixon", { stdio: "inherit" });
  } catch {}
}

/* =====================================================================================
   Strategy scaffolding
   ===================================================================================== */
function initializeStrategy(symbol) {
  return {
    buyThreshold: config.baseBuyThreshold,
    sellThreshold: config.baseSellThreshold,
    atr: 0,
    dynamicBuyThreshold: null,
    dynamicSellThreshold: null,
    trend: "neutral",
    slippage: config.defaultSlippage,
    priceHistory: [],
    trendHistory: [],
    lastPrice: null,
    lastPriceAt: 0, // when the last live price was seen (ms)
    lastPriceSource: "", // which provider served the last live price
    module: null,
    grid: [],
  };
}

/* =====================================================================================
   Strategy selection (interactive by default; tolerant name/filename matching)
   ===================================================================================== */

// Preserve dots in versions so "v1.1" still matches
const normKeepDots = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "");

// Common aliases (extend as needed)
const STRATEGY_ALIASES = {
  "simplebuysell_v1.1": "Simple Buy Low/Sell High (1.1)",
  simplebuylowsellhigh: "Simple Buy Low/Sell High (1.1)",
  ultimate_safety_profit: "Ultimate Safety Profit Strategy (1.0)",
};

async function promptStrategySelection() {
  const dir = path.join(__dirname, "strategies");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .sort();

  // Load modules and keep filename stems for fallback matching
  const modules = files
    .map((f) => {
      const mod = require(`./strategies/${f}`);
      return { mod, file: f, stem: f.replace(/\.js$/i, "") };
    })
    .filter((x) => x.mod && x.mod.name && x.mod.version && x.mod.description);

  console.log("\n📌 Available Strategies:");
  modules.forEach(({ mod }, i) =>
    console.log(` [${i + 1}] ${mod.name} (${mod.version}) - ${mod.description}`)
  );

  // Resolve requested name if present
  const rawWanted = (process.env.STRATEGY_NAME || "").trim();
  if (rawWanted && !FORCE_STRATEGY_PROMPT) {
    let wanted = normKeepDots(rawWanted);
    if (STRATEGY_ALIASES[wanted])
      wanted = normKeepDots(STRATEGY_ALIASES[wanted]);

    // Try display-name (preserving dots), then "Name (Version)", then filename stem
    const found =
      modules.find(({ mod }) => normKeepDots(mod.name) === wanted) ||
      modules.find(
        ({ mod }) => normKeepDots(`${mod.name} (${mod.version})`) === wanted
      ) ||
      modules.find(({ stem }) => normKeepDots(stem) === wanted);

    if (found) {
      config.strategy = `${found.mod.name} (${found.mod.version})`;
      selectedStrategy = found.mod;
      console.log(
        `\nAuto-selected strategy: ${config.strategy} via STRATEGY_NAME='${rawWanted}'`
      );
      return;
    } else {
      console.log(
        `[warn] STRATEGY_NAME='${rawWanted}' did not match; falling back to prompt/choice.`
      );
    }
  }

  const DEFAULT_STRATEGY_INDEX = 8; // #9 human index (your historical default)
  const envChoice = parseInt(process.env.STRATEGY_CHOICE || "", 10);
  const okEnvChoice =
    Number.isInteger(envChoice) &&
    envChoice >= 1 &&
    envChoice <= modules.length;

  // Auto-select in non-interactive mode unless forced to prompt
  if ((!process.stdin.isTTY || okEnvChoice) && !FORCE_STRATEGY_PROMPT) {
    const chosen =
      modules[okEnvChoice ? envChoice - 1 : DEFAULT_STRATEGY_INDEX] ||
      modules[DEFAULT_STRATEGY_INDEX];
    config.strategy = `${chosen.mod.name} (${chosen.mod.version})`;
    selectedStrategy = chosen.mod;
    console.log(
      `\nAuto-selected strategy: ${config.strategy} ${
        okEnvChoice ? "(from STRATEGY_CHOICE)" : "(default)"
      }`
    );
    return;
  }

  // Interactive prompt (default when started from a terminal)
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  await new Promise((resolve) => {
    rl.question(`\nSelect strategy [default 9]: `, (input) => {
      const idx = parseInt((input || "").trim(), 10);
      const chosen =
        modules[
          idx > 0 && idx <= modules.length ? idx - 1 : DEFAULT_STRATEGY_INDEX
        ];
      rl.close();
      config.strategy = `${chosen.mod.name} (${chosen.mod.version})`;
      selectedStrategy = chosen.mod;
      resolve();
    });
  });
}

/* =====================================================================================
   Holdings (per-bot)
   ===================================================================================== */
const GLOBAL_HOLDINGS_FILE = path.join(
  __dirname,
  "logs",
  "cryptoHoldings.json"
);
const BOT_HOLDINGS_FILE = path.join(DATA_DIR, "cryptoHoldings.json");
const HOLDINGS_FILE = process.env.HOLDINGS_FILE || GLOBAL_HOLDINGS_FILE;

// Seed per-bot from shared on first run (if per-bot missing/empty)
function seedPerBotHoldingsIfNeeded() {
  try {
    const sourceExists = fs.existsSync(HOLDINGS_FILE);
    const destExists = fs.existsSync(BOT_HOLDINGS_FILE);

    let destEmpty = true;
    if (destExists) {
      try {
        const j = JSON.parse(fs.readFileSync(BOT_HOLDINGS_FILE, "utf8"));
        destEmpty = !j || Object.keys(j).length === 0;
      } catch {
        destEmpty = true;
      }
    }

    if (sourceExists && (!destExists || destEmpty)) {
      fs.copyFileSync(HOLDINGS_FILE, BOT_HOLDINGS_FILE);
      console.log(
        `📥 Seeded per-bot holdings from '${HOLDINGS_FILE}' → '${BOT_HOLDINGS_FILE}'`
      );
    }
  } catch (e) {
    console.warn(`⚠️  Seed step skipped: ${e.message}`);
  }
}

function loadHoldings() {
  seedPerBotHoldingsIfNeeded();

  let data = null;
  try {
    if (fs.existsSync(BOT_HOLDINGS_FILE)) {
      data = JSON.parse(fs.readFileSync(BOT_HOLDINGS_FILE, "utf8"));
      portfolio._holdingsSource = BOT_HOLDINGS_FILE;
      console.log(`✅ Using holdings file: ${BOT_HOLDINGS_FILE}`);
    }
  } catch (err) {
    console.error(`Failed reading per-bot holdings: ${err.message}`);
  }

  if (!data) {
    console.warn(
      `⚠️  No holdings file found.\n  Looked for:\n  - ${BOT_HOLDINGS_FILE}\n  - ${HOLDINGS_FILE}\nProceeding with empty positions.`
    );
    portfolio.cryptos = {};
    portfolio._holdingsSource = "(none)";
    return;
  }

  portfolio.cryptos = {};
  for (const sym of Object.keys(data)) {
    const entry = data[sym] || {};
    const amount = Number(entry.amount) || 0;
    const costBasis = Number(entry.costBasis) || 0;
    const grid = Array.isArray(entry.grid)
      ? entry.grid.map((g) => ({
          price: Number(g.price) || costBasis,
          amount: Number(g.amount) || 0,
          time: Number(g.time) || Date.now(),
        }))
      : [];
    if (amount > (config.minTradeAmount || 0.01)) {
      portfolio.cryptos[sym] = { amount, costBasis, grid };
    }
  }
}

function saveHoldings() {
  try {
    const out = {};
    for (const sym of Object.keys(portfolio.cryptos)) {
      const grid = (strategies[sym]?.grid || []).map((l) => ({
        price: Number(l.price) || 0,
        amount: Number(l.amount) || 0,
        time: Number(l.time) || Date.now(),
      }));
      const totalAmt = grid.reduce((s, l) => s + (Number(l.amount) || 0), 0);
      const costBasis = grid.length
        ? Number(grid[grid.length - 1].price)
        : portfolio.cryptos[sym].costBasis || 0;
      out[sym] = {
        amount: Number(totalAmt),
        costBasis: Number(costBasis),
        grid,
      };
    }
    fs.writeFileSync(BOT_HOLDINGS_FILE, JSON.stringify(out, null, 2));
  } catch (e) {
    console.warn(
      `⚠️  Could not write holdings to ${BOT_HOLDINGS_FILE}: ${e.message}`
    );
  }
}

/* =====================================================================================
   Live price providers + freshness gate
   ===================================================================================== */

// Symbol mappers
const mapForRH = (s) => s; // BTCUSD
const mapForCoinbase = (s) =>
  s.endsWith("USD") ? s.replace(/USD$/, "-USD") : s; // BTC-USD
const mapForBinance = (s) =>
  s.endsWith("USD") ? s.replace(/USD$/, "USDT") : s; // BTCUSDT

const warnOnce = new Set();

async function rhAuthHeaders() {
  try {
    if (!getAccessToken) throw new Error("sessionManager not available");
    const token = await getAccessToken();
    const headers = {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    };
    if (PUBLIC_API_KEY) headers["X-API-Key"] = PUBLIC_API_KEY;
    return headers;
  } catch (e) {
    if (!warnOnce.has("rh-auth")) {
      console.error(`❌ Robinhood auth unavailable: ${e?.message || e}`);
      warnOnce.add("rh-auth");
    }
    return { "User-Agent": USER_AGENT, Accept: "application/json" };
  }
}

const providers = {
  robinhood_auth: {
    name: "robinhood_auth",
    url: (sym) => `${BASE_URL}${encodeURIComponent(mapForRH(sym))}/`,
    headers: rhAuthHeaders,
    pick: (d) => parseFloat(d.mark_price),
  },
  coinbase: {
    name: "coinbase",
    url: (sym) =>
      `https://api.coinbase.com/v2/prices/${encodeURIComponent(
        mapForCoinbase(sym)
      )}/spot`,
    headers: async () => ({
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    }),
    pick: (d) => parseFloat(d?.data?.amount),
  },
  robinhood_public: {
    name: "robinhood_public",
    url: (sym) => `${BASE_URL}${encodeURIComponent(mapForRH(sym))}/`,
    headers: async () => ({
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    }),
    pick: (d) => parseFloat(d.mark_price),
  },
  binance: {
    name: "binance",
    url: (sym) =>
      `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(
        mapForBinance(sym)
      )}`,
    headers: async () => ({
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    }),
    pick: (d) => parseFloat(d.price),
  },
};

async function tryProvider(symbol, p) {
  const url = p.url(symbol);
  let headers = {};
  try {
    headers = typeof p.headers === "function" ? await p.headers() : {};
  } catch {}
  try {
    const res = await axios.get(url, { headers, timeout: 12000 });
    const price = p.pick(res.data);
    if (Number.isFinite(price) && price > 0)
      return { price, source: p.name, live: true, at: Date.now() };
    throw new Error("bad-price");
  } catch (err) {
    const code = err?.response?.status;
    const msg = err?.message || err?.code || "(no message)";
    if (!warnOnce.has(`${p.name}:${symbol}`)) {
      console.error(`❌ ${symbol} via ${p.name} failed: ${code || ""} ${msg}`);
      warnOnce.add(`${p.name}:${symbol}`);
    }
    return null;
  }
}

/**
 * getPrice(symbol, {requireLive:boolean})
 * - Tries providers in order until a live quote is obtained.
 * - Caches {price, at, source, live} in quotes[symbol] and per-symbol strategy state.
 * - If requireLive=false and no provider works → fallback (cache or costBasis) with live:false.
 */
async function getPrice(symbol, opts = {}) {
  const requireLive = !!opts.requireLive;
  const order = PROVIDER_ORDER.filter((k) => providers[k]);

  for (const key of order) {
    const r = await tryProvider(symbol, providers[key]);
    if (r) {
      quotes[symbol] = r;
      const strat =
        strategies[symbol] || (strategies[symbol] = initializeStrategy(symbol));
      strat.lastPrice = r.price;
      strat.lastPriceAt = r.at;
      strat.lastPriceSource = r.source;

      // maintain short histories
      strat.priceHistory.push(r.price);
      if (strat.priceHistory.length > config.atrLookbackPeriod + 1)
        strat.priceHistory.shift();
      const prev = strat.priceHistory[strat.priceHistory.length - 2];
      if (prev != null) {
        strat.trendHistory.push(
          r.price > prev ? "up" : r.price < prev ? "down" : "neutral"
        );
        if (strat.trendHistory.length > 3) strat.trendHistory.shift();
      }
      if (typeof selectedStrategy?.updateStrategyState === "function") {
        selectedStrategy.updateStrategyState(symbol, strat, config);
      }
      return { price: r.price, ts: r.at, prev, source: r.source, live: true };
    }
  }

  // Fall back if allowed
  const strat =
    strategies[symbol] || (strategies[symbol] = initializeStrategy(symbol));
  const q = quotes[symbol];
  if (!requireLive) {
    if (q && Number.isFinite(q.price))
      return {
        price: q.price,
        ts: q.at,
        prev: strat.lastPrice,
        source: q.source || "cache",
        live: false,
      };
    const cb = Number(portfolio.cryptos[symbol]?.costBasis) || 0;
    return {
      price: cb || 0,
      ts: Date.now(),
      prev: strat.lastPrice,
      source: "costBasis",
      live: false,
    };
  }

  return {
    price: null,
    ts: Date.now(),
    prev: strat.lastPrice,
    source: "none",
    live: false,
  };
}

/* =====================================================================================
   Seeding strategy grids
   ===================================================================================== */
async function seedStrategyGrids() {
  for (const sym of Object.keys(portfolio.cryptos)) {
    strategies[sym] = strategies[sym] || initializeStrategy(sym);
    strategies[sym].grid = [...(portfolio.cryptos[sym].grid || [])];
  }

  const seedLen = Math.max(config.atrLookbackPeriod || 14, 50);
  await Promise.all(
    Object.keys(portfolio.cryptos).map(async (sym) => {
      const strat = strategies[sym];
      const holding = portfolio.cryptos[sym];

      strat.priceHistory = strat.priceHistory || [];
      strat.trendHistory = strat.trendHistory || [];
      strat.grid = strat.grid || [];

      if (holding && holding.amount >= config.minTradeAmount) {
        if (strat.grid.length === 0) {
          strat.grid.push({
            price: holding.costBasis,
            amount: holding.amount,
            time: Date.now() - seedLen * config.checkInterval,
          });
        }
        holding.costBasis = holding.costBasis || strat.grid[0].price;
      }

      let lastPrice = null;
      for (let i = seedLen; i > 0; i--) {
        const { price } = await getPrice(sym, { requireLive: false }); // seeding can use fallback
        strat.priceHistory.push(price);
        lastPrice = price;
        if (strat.priceHistory.length > 1) {
          const prev = strat.priceHistory[strat.priceHistory.length - 2];
          strat.trendHistory.push(
            price > prev ? "up" : price < prev ? "down" : "neutral"
          );
        }
      }
      strat.lastPrice = lastPrice;

      if (typeof strat.module?.updateStrategyState === "function") {
        strat.module.updateStrategyState(sym, strat, config);
      }

      console.log(
        `[SEED] ${sym} seeded: priceHistory=${
          strat.priceHistory.length
        }, grid=${JSON.stringify(strat.grid)}`
      );
    })
  );

  saveHoldings();
}

/* =====================================================================================
   Profit-lock helpers (SELL realized profit → locked cash ONLY)
   ===================================================================================== */
function computeRealizedProfit({ price, entryPrice, qty }) {
  const q = Number(qty) || 0;
  if (!(Number.isFinite(q) && q > 0 && Number.isFinite(entryPrice))) return 0;
  return Math.max(0, (Number(price) - Number(entryPrice)) * q);
}
function lockProfitFromSell(realizedProfit) {
  const profit = Math.max(0, Number(realizedProfit) || 0);
  if (!profit || PROFIT_LOCK_FRAC === 0) return 0;
  const toLock = round2(profit * PROFIT_LOCK_FRAC);
  const transfer = Math.min(toLock, Math.max(0, portfolio.cashReserve)); // take from cashReserve only
  if (!transfer) return 0;
  portfolio.cashReserve = round2(portfolio.cashReserve - transfer);
  portfolio.lockedCash = round2(portfolio.lockedCash + transfer);
  return transfer;
}

/* =====================================================================================
   Summary writer (duration minutes; fresh-only cryptoMkt; stale debug)
   ===================================================================================== */
const SUMMARY_PATH = path.join(DATA_DIR, "summary.json");
const PNL24_FILE = path.join(DATA_DIR, "pnl-24h.json");

function fmtDuration(ms) {
  const s = Math.floor(ms / 1000),
    h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = s % 60;
  return `${h}h ${m}m ${sec}s`;
}

function writeSummaryJSON() {
  try {
    let cryptoMktFresh = 0;
    let cryptoMktStale = 0;
    let staleCount = 0;

    for (const sym of Object.keys(portfolio.cryptos || {})) {
      const qty = Number(portfolio.cryptos[sym]?.amount || 0);
      const st = strategies[sym];
      const last = Number(st?.lastPrice);
      const at = Number(st?.lastPriceAt || 0);
      if (!Number.isFinite(qty)) continue;

      if (
        Number.isFinite(last) &&
        at &&
        Date.now() - at <= PRICE_FRESHNESS_MS
      ) {
        cryptoMktFresh += qty * last;
      } else {
        staleCount++;
        const cb = Number(portfolio.cryptos[sym]?.costBasis) || 0;
        const val = (Number.isFinite(last) ? last : cb) * qty;
        cryptoMktStale += val;
      }
    }
    cryptoMktFresh = round2(cryptoMktFresh);
    cryptoMktStale = round2(cryptoMktStale);

    const cash = round2(Number(portfolio.cashReserve || 0));
    const locked = round2(Number(portfolio.lockedCash || 0));
    const currentValue = round2(cash + locked + cryptoMktFresh); // headline excludes stale

    const beginning = Number(portfolio.beginningPortfolioValue || 0);
    const totalPL = beginning ? round2(currentValue - beginning) : 0;

    // rolling 24h mark-to-market on the *fresh* value
    let points = [];
    try {
      points = JSON.parse(fs.readFileSync(PNL24_FILE, "utf8")).points || [];
    } catch {}
    const now = Date.now();
    points.push({ t: now, v: currentValue });
    const cutoff = now - 24 * 3600 * 1000 - 2 * 60 * 1000;
    points = points.filter(
      (p) => p && typeof p.t === "number" && p.t >= cutoff
    );
    try {
      fs.writeFileSync(PNL24_FILE, JSON.stringify({ points }, null, 2));
    } catch {}

    let pl24h = 0,
      pl24hAvgRatePerHour = 0,
      pl24hEstimatedProfit = 0;
    if (points.length >= 2) {
      const oldest = points[0];
      const hrs = Math.max((now - oldest.t) / 3600000, 0.01);
      pl24h = round2(currentValue - oldest.v);
      pl24hAvgRatePerHour = round2(pl24h / hrs);
      pl24hEstimatedProfit = round2(pl24hAvgRatePerHour * 24);
    }

    const durationMs = Math.max(
      0,
      now -
        (portfolio.startTime?.getTime?.() ||
          Date.parse(portfolio.startTime || now))
    );
    const durationMin = Math.floor(durationMs / 60000);
    const durationText = fmtDuration(durationMs);
    const hrsOverall = Math.max(durationMs / 3600000, 0.01);
    const overall24hAvgRatePerHour = round2(
      (currentValue - beginning) / hrsOverall
    );

    const out = {
      beginningPortfolioValue: beginning || null,
      duration: durationMin,
      durationText,
      strategy: config.strategy,
      buys: Number(portfolio.buysToday || 0),
      sells: Number(portfolio.sellsToday || 0),
      pl24h,
      pl24hAvgRatePerHour,
      pl24hEstimatedProfit,
      overall24hAvgRatePerHour,
      totalPL,
      cash,
      cryptoMkt: cryptoMktFresh,
      locked,
      currentValue,
      dayPL: pl24h,
      // debug-only (helps detect consumer double-counting):
      staleCryptoMkt: cryptoMktStale,
      staleSymbols: staleCount,
      priceFreshnessMs: PRICE_FRESHNESS_MS,
    };

    fs.writeFileSync(SUMMARY_PATH, JSON.stringify(out, null, 2));
  } catch (e) {
    console.error("writeSummaryJSON failed:", e?.message || e);
  }
}

/* =====================================================================================
   Printers + Hotkeys
   ===================================================================================== */
function printLegend() {
  console.log(`\n=== EMOJI LEGEND ===
🟢  BUY executed
🔴  SELL executed
⚠️  BUY/SELL skipped (limit/min/cash/stale/loss)
🔄  Strategy tick started
[TICK] Running strategy for SYMBOL
📈  Decision: BUY
📉  Decision: SELL
💤  HOLD or no decision
======================\n`);
}
function printStatus() {
  /* optional: add your richer status here */
}
function printGrid() {
  /* optional: grid display */
}

// Reliable hotkeys (NEW)
// === Reliable terminal hotkeys with non-TTY fallbacks (UPDATED) ===
function enableHotkeys(shutdownFn) {
  const announce = (msg) => console.log(`[hotkeys] ${msg}`);

  // Always install fallbacks (work in TTY and non-TTY)
  try {
    process.on("SIGUSR1", () => {
      printStatus();
      announce("SIGUSR1 → status");
    });
    process.on("SIGUSR2", () => {
      printLegend();
      announce("SIGUSR2 → legend");
    });
  } catch {}

  // File-based triggers (create empty files in DATA_DIR to trigger once)
  try {
    const triggers = {
      "ctrl-s": () => {
        printStatus();
        announce("file trigger ctrl-s");
      },
      "ctrl-g": () => {
        printGrid();
        announce("file trigger ctrl-g");
      },
      "ctrl-e": () => {
        printLegend();
        announce("file trigger ctrl-e");
      },
      "ctrl-c": () => {
        announce("file trigger ctrl-c");
        if (typeof shutdownFn === "function") shutdownFn();
      },
    };
    setInterval(() => {
      for (const f of Object.keys(triggers)) {
        const p = path.join(DATA_DIR, f);
        if (fs.existsSync(p)) {
          try {
            triggers[f]();
          } finally {
            try {
              fs.unlinkSync(p);
            } catch {}
          }
        }
      }
    }, 1000);
  } catch {}

  if (!process.stdin.isTTY) {
    announce(
      "TTY not attached → keyboard hotkeys disabled; use SIGUSR1 / SIGUSR2 or create files ctrl-s|ctrl-g|ctrl-e|ctrl-c in DATA_DIR."
    );
    return;
  }

  // TTY path: enable real-time keypresses
  try {
    process.stdin.removeAllListeners("keypress");
  } catch {}
  // NEW: ensure Node emits keypress events
  readline.emitKeypressEvents(process.stdin);
  try {
    process.stdin.setEncoding("utf8");
  } catch {}
  // NEW: raw mode so Ctrl+<key> reaches us
  if (process.stdin.setRawMode && !process.stdin.isRaw)
    process.stdin.setRawMode(true);
  process.stdin.resume();

  // NEW: handle Ctrl+S / Ctrl+G / Ctrl+E / Ctrl+C
  process.stdin.on("keypress", (_str, key) => {
    if (!key) return;
    const { ctrl, name } = key;
    if (ctrl && name === "c") {
      if (typeof shutdownFn === "function") shutdownFn();
      return;
    }
    if (ctrl && name === "s") {
      printStatus();
    } else if (ctrl && name === "g") {
      printGrid();
    } else if (ctrl && name === "e") {
      printLegend();
    }
  });

  announce(
    "keyboard hotkeys active (Ctrl+S status, Ctrl+G grid, Ctrl+E legend, Ctrl+C exit)."
  );
}

/* =====================================================================================
   Strategy run loop (strategy decides; runner blocks loss-making SELLs)
   ===================================================================================== */

// SELL safety helpers (NEW)
const MIN_SELL_PROFIT_DOLLARS = Number(
  process.env.MIN_SELL_PROFIT_DOLLARS ?? 0
); // 0 => strictly > 0
const FEES_FRAC = Math.max(
  0,
  Math.min(Number(process.env.FEES_FRAC || 0), 0.02)
); // optional tiny fee buffer
function estimatedSellProfit({ price, entryPrice, qty, slippageFrac }) {
  const proceedPrice = price * (1 - Math.max(0, slippageFrac || 0) - FEES_FRAC);
  return (proceedPrice - entryPrice) * qty;
}

async function runStrategyForSymbol(symbol) {
  console.log(`🔄 [TICK] Running strategy for ${symbol}`);

  const info = await getPrice(symbol, { requireLive: REQUIRE_LIVE_FOR_TRADES });
  if (!info.live || !Number.isFinite(info.price)) {
    console.log(
      `⏸️  Skipping ${symbol}: no fresh live price (providers: ${PROVIDER_ORDER.join(
        " > "
      )})`
    );
    return;
  }

  const strat =
    strategies[symbol] || (strategies[symbol] = initializeStrategy(symbol));
  const holding = portfolio.cryptos[symbol] || { amount: 0, costBasis: 0 };

  // Strategy makes the decision (unchanged)
  let decision = null;
  let action = null;
  try {
    if (strat.module && typeof strat.module.getTradeDecision === "function") {
      decision = strat.module.getTradeDecision({
        symbol,
        price: info.price,
        lastPrice:
          strat.priceHistory.length >= 2
            ? strat.priceHistory[strat.priceHistory.length - 2]
            : null,
        costBasis: holding.costBasis,
        strategyState: strat,
        config,
      });
      action = decision?.action ? String(decision.action).toUpperCase() : null;
    }
  } catch (e) {
    console.warn(`[${symbol}] decision error: ${e.message}`);
    return;
  }

  if (!tradingEnabled) return; // block until initial seed done

  // BUY
  if (action === "BUY") {
    const spend = Math.max(
      portfolio.cashReserve * 0.1,
      config.minTradeAmount * info.price
    );
    if (spend > portfolio.cashReserve) {
      console.log(
        `⚠️  BUY skipped for ${symbol}: need $${spend.toFixed(
          2
        )} > cash $${portfolio.cashReserve.toFixed(2)}`
      );
      return;
    }
    const qty = spend / info.price;
    if (qty < config.minTradeAmount) {
      console.log(
        `⚠️  BUY skipped for ${symbol}: qty ${qty.toFixed(6)} < min ${
          config.minTradeAmount
        }`
      );
      return;
    }

    portfolio.cashReserve = round2(portfolio.cashReserve - spend);
    const pos = (portfolio.cryptos[symbol] ||= {
      amount: 0,
      costBasis: info.price,
      grid: [],
    });
    pos.amount += qty;

    strat.grid = strat.grid || [];
    strat.grid.push({ price: info.price, amount: qty, time: Date.now() });

    portfolio.buysToday = (portfolio.buysToday || 0) + 1;
    console.log(
      `🟢 BUY ${symbol}: qty=${qty.toFixed(6)} @ $${info.price.toFixed(
        config.priceDecimalPlaces
      )}  cash=$${portfolio.cashReserve.toFixed(2)}  src=${info.source}`
    );
    saveHoldings();
    return;
  }

  // SELL (strategy-decided) — runner blocks if non-profitable after slippage/fees
  if (action === "SELL") {
    const suggestedQty = Number(decision?.qty || 0);
    const posAmt = Number(holding.amount || 0);
    const qty =
      suggestedQty > 0 ? Math.min(suggestedQty, posAmt) : posAmt * 0.1;

    if (!Number.isFinite(qty) || qty <= 0) {
      console.log(`⚠️  SELL skipped for ${symbol}: invalid qty`);
      return;
    }

    // Prefer strategy-supplied lot entry; else fall back to costBasis
    const entryPrice =
      Number(decision?.entryPrice) || Number(holding.costBasis) || 0;

    // Hard safety gate: never sell at a loss (after slippage/fees)
    const slippageFrac =
      Number(strategies[symbol]?.slippage || config.defaultSlippage) || 0;
    const estProfit = estimatedSellProfit({
      price: info.price,
      entryPrice,
      qty,
      slippageFrac,
    });
    if (!(estProfit > MIN_SELL_PROFIT_DOLLARS)) {
      console.log(
        `⚠️  SELL skipped for ${symbol}: non-positive profit (est $${estProfit.toFixed(
          2
        )}) ` +
          `(price=${info.price.toFixed(
            config.priceDecimalPlaces
          )}, entry=${entryPrice}, qty=${qty.toFixed(6)})`
      );
      return;
    }

    // Execute profitable SELL
    const proceeds = qty * info.price;
    portfolio.cashReserve = round2(portfolio.cashReserve + proceeds);
    portfolio.cryptos[symbol].amount = round2(posAmt - qty);

    // Realized profit for profit-lock
    const realizedFromStrategy = Number(decision?.realizedProfit);
    const realizedProfit = Number.isFinite(realizedFromStrategy)
      ? Math.max(0, realizedFromStrategy)
      : Math.max(0, (info.price - entryPrice) * qty);

    const moved = lockProfitFromSell(realizedProfit);
    if (moved > 0)
      console.log(
        `🔒 Locked ${PROFIT_LOCK_PERCENT}% of realized profit → $${moved.toFixed(
          2
        )}`
      );

    portfolio.sellsToday = (portfolio.sellsToday || 0) + 1;
    console.log(
      `🔴 SELL ${symbol}: qty=${qty.toFixed(6)} @ $${info.price.toFixed(
        config.priceDecimalPlaces
      )}  ` +
        `cash=$${portfolio.cashReserve.toFixed(
          2
        )} locked=$${portfolio.lockedCash.toFixed(2)}  src=${info.source}`
    );
    saveHoldings();
    return;
  }

  console.log(`💤  HOLD or no decision`);
}

/* =====================================================================================
   Tick & main
   ===================================================================================== */
async function tickOnce() {
  if (!tradingEnabled) return;
  const symbols = Object.keys(portfolio.cryptos || {});
  for (const sym of symbols) {
    await runStrategyForSymbol(sym);
  }
  writeSummaryJSON();
  try {
    await writeSummary(DATA_DIR);
  } catch {}
}

(async () => {
  // 1) Strategy selection
  await promptStrategySelection();

  // 2) Load holdings and attach strategy modules
  loadHoldings();
  for (const sym of Object.keys(portfolio.cryptos)) {
    strategies[sym] = initializeStrategy(sym);
    strategies[sym].module = selectedStrategy;
  }

  // 3) Seed state from holdings + some history
  await seedStrategyGrids();

  // 4) Preload quotes (best effort) before enabling trades
  await Promise.all(
    Object.keys(portfolio.cryptos).map((sym) =>
      getPrice(sym, { requireLive: false })
    )
  );

  // 5) Compute initial PV using fresh-only marks available right now
  let initCrypto = 0;
  for (const sym of Object.keys(portfolio.cryptos)) {
    const st = strategies[sym];
    if (
      Number.isFinite(st?.lastPrice) &&
      st.lastPriceAt &&
      Date.now() - st.lastPriceAt <= PRICE_FRESHNESS_MS
    ) {
      initCrypto += (portfolio.cryptos[sym]?.amount || 0) * st.lastPrice;
    }
  }
  initCrypto = round2(initCrypto);
  portfolio.initialCryptoValue = initCrypto;

  // Baseline for P&L (no auto-locking at start)
  portfolio.beginningPortfolioValue = round2(
    portfolio.cashReserve + portfolio.lockedCash + initCrypto
  );
  portfolio.startingPortfolioValue = portfolio.beginningPortfolioValue;

  // Emit first summary
  writeSummaryJSON();
  try {
    await writeSummary(DATA_DIR);
  } catch {}

  // 6) Enable trading & timers
  tradingEnabled = true;

  const interval = setInterval(tickOnce, config.checkInterval);

  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(interval);
    try {
      writeSummaryJSON();
    } catch {}
    try {
      await writeSummary(DATA_DIR);
    } catch {}
    try {
      await finalizeSummary(DATA_DIR);
    } catch {}
    try {
      saveHoldings();
    } catch {}
    console.log("👋 Runner exiting.");
    process.exit(0);
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Enable hotkeys AFTER shutdown is defined
  enableHotkeys(shutdown);
})();
