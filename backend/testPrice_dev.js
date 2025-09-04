"use strict";

/* =====================================================================================
   testPrice_Dev.js — strategy runner with reliable hotkeys and stop→start continuity

   Fixes included:
   • Baseline stability: load once per run from baseline.json; “heal” only with enough
     coverage; never reassign mid-run. 24h P/L resets to the boot PV.
   • Price continuity: last known live prices are cached (prices.json) and used at boot
     to avoid PV collapse while fresh quotes arrive.
   • State persistence: cashReserve/lockedCash persisted (state.json) and restored.
   • Holdings persistence: persist the real position amount (not only grid sums).
   • Atomic writes: holdings/state/baseline/summary/pnl-24h/prices via .tmp+rename.
   • Hotkeys: works even if stdin isn’t a TTY (opens /dev/tty on POSIX), raw mode +
     readline; XON/XOFF disabled; also keeps signal & file-trigger fallbacks.
   • Ctrl+S detailed status + Ctrl+G grid dump restored (old-style rich output).

   Existing strategy interfaces and comments are preserved as much as possible.
   ===================================================================================== */

const fs = require("fs");
const path = require("path");
const tty = require("tty");
const axios = require("axios");
const readline = require("readline");
const { execSync } = require("child_process");
require("dotenv").config();

/* -------------------------------- tiny utils --------------------------------------- */
const asBool = (v) => /^(1|true|yes|on)$/i.test(String(v || "").trim());
const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const nowMs = () => Date.now();

/** Atomic write: write to .tmp then rename (prevents partial files on Stop) */
function safeWrite(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/* --- pretty printing helpers (for Ctrl+S/Ctrl+G output) --- */
const fmtUsd = (n) => (Number.isFinite(n) ? `$${Number(n).toFixed(2)}` : "-");
const fmtNum = (n, d = 6) => (Number.isFinite(n) ? Number(n).toFixed(d) : "-");
const pad = (s, w, side = "right") => {
  s = String(s);
  if (s.length >= w) return s;
  const p = " ".repeat(w - s.length);
  return side === "left" ? p + s : s + p;
};
const ago = (tMs) => {
  const ms = Date.now() - (Number(tMs) || 0);
  if (ms < 0) return "now";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h) return `${h}h ${m % 60}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
};

/* -------------------------------- logging tee -------------------------------------- */
const BOT_ID = process.env.BOT_ID || "default";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data", BOT_ID);
process.env.DATA_DIR = DATA_DIR;
fs.mkdirSync(DATA_DIR, { recursive: true });

const LOG_FILE = process.env.LOG_FILE || "testPrice_output.txt";
const LOG_PATH = process.env.LOG_PATH || path.join(DATA_DIR, LOG_FILE);
const logStream = fs.createWriteStream(LOG_PATH, { flags: "a" });
const _out = process.stdout.write.bind(process.stdout);
const _err = process.stderr.write.bind(process.stderr);
process.stdout.write = (c, e, cb) => {
  try {
    logStream.write(c);
  } catch {}
  return _out(c, e, cb);
};
process.stderr.write = (c, e, cb) => {
  try {
    logStream.write(c);
  } catch {}
  return _err(c, e, cb);
};
console.log("DEBUG:", { __dirname, BOT_ID, DATA_DIR, LOG_PATH });

/* -------------------------------- config ------------------------------------------- */
const USER_AGENT = "Mozilla/5.0 PowerShell/7.2.0";
const SIMPLE_BUY_THRESHOLD =
  parseFloat(process.env.SIMPLE_BUY_THRESHOLD) || 2.0;
const SIMPLE_SELL_THRESHOLD =
  parseFloat(process.env.SIMPLE_SELL_THRESHOLD) || 3.0;
const ENABLE_PEAK_CONFIRMATION = asBool(process.env.ENABLE_PEAK_CONFIRMATION);
const TEST_MODE = asBool(process.env.TEST_MODE);
const LIMIT_TO_MAX_BUY_SELL = asBool(process.env.LIMIT_TO_MAX_BUY_SELL);
const DEFAULT_SLIPPAGE_PCT = parseFloat(process.env.defaultSlippage) || 2.0;
const DEFAULT_SLIPPAGE_FRAC = Math.max(
  0,
  Math.min(DEFAULT_SLIPPAGE_PCT / 100, 1)
);
const PRICE_FRESHNESS_MS = parseInt(
  process.env.PRICE_FRESHNESS_MS || "120000",
  10
);
const REQUIRE_LIVE_FOR_TRADES = asBool(
  process.env.REQUIRE_LIVE_FOR_TRADES ?? "true"
);
const BASE_URL =
  process.env.BASE_URL || "https://api.robinhood.com/marketdata/forex/quotes/";

// Baseline & coverage knobs
const BASELINE_MODE = (process.env.BASELINE_MODE || "persist").toLowerCase(); // 'persist' | 'reset'
const BASELINE_MIN_COVERAGE = Math.max(
  0,
  Math.min(parseFloat(process.env.BASELINE_MIN_COVERAGE || "0.60"), 1)
); // default 60%
const BASELINE_HEAL_RATIO = Math.max(
  1,
  parseFloat(process.env.BASELINE_HEAL_RATIO || "4.0")
); // default 4x

const config = {
  aiEnabled: asBool(process.env.AI_ENABLED),
  demoMode: asBool(process.env.DEMO_MODE),
  testMode: TEST_MODE,
  limitBuysSells: LIMIT_TO_MAX_BUY_SELL,
  initialBalance: parseFloat(process.env.INITIAL_BALANCE) || 150,
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
console.log(`Price API base: ${BASE_URL}`);

/* ------------------------------- external bits ------------------------------------- */
let getAccessToken, PUBLIC_API_KEY;
try {
  ({ getAccessToken, PUBLIC_API_KEY } = require("./sessionManager"));
} catch {}
const { signRequest } = require("./signRequest");
const { writeSummary, finalizeSummary } = require("./summary-writer");

/* -------------------------------- state -------------------------------------------- */
let strategies = {};
let selectedStrategy = null;
const quotes = Object.create(null);
let tradingEnabled = false;
let shuttingDown = false;

let portfolio = {
  cashReserve: round2(
    parseFloat(process.env.INITIAL_CASH || config.initialBalance)
  ),
  lockedCash: 0,
  cryptos: {},
  buysToday: 0,
  sellsToday: 0,
  stopLossesToday: 0,
  dailyProfitTotal: 0,
  startTime: new Date(),
  lastReset: new Date(),
  beginningPortfolioValue: 0, // set once-per-run after boot logic
  _holdingsSource: null,
};

/* ----------------------------- persistence paths ----------------------------------- */
const GLOBAL_HOLDINGS_FILE = path.join(
  __dirname,
  "logs",
  "cryptoHoldings.json"
);
const BOT_HOLDINGS_FILE = path.join(DATA_DIR, "cryptoHoldings.json");
const HOLDINGS_FILE = process.env.HOLDINGS_FILE || GLOBAL_HOLDINGS_FILE;

const STATE_FILE = path.join(DATA_DIR, "state.json");
const BASELINE_FILE = path.join(DATA_DIR, "baseline.json");
const PNL24_FILE = path.join(DATA_DIR, "pnl-24h.json");
const SUMMARY_PATH = path.join(DATA_DIR, "summary.json");
const PRICES_FILE = path.join(DATA_DIR, "prices.json");

/* ------------------------- helpers: strategies & prices ---------------------------- */
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
    lastPriceAt: 0,
    lastPriceSource: "",
    module: null,
    grid: [],
  };
}

/* strategy selection (kept) */
const normKeepDots = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "");
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
  const modules = files
    .map((f) => ({
      mod: require(`./strategies/${f}`),
      stem: f.replace(/\.js$/i, ""),
    }))
    .filter((x) => x.mod && x.mod.name && x.mod.version && x.mod.description);

  console.log("\n📌 Available Strategies:");
  modules.forEach(({ mod }, i) =>
    console.log(` [${i + 1}] ${mod.name} (${mod.version}) - ${mod.description}`)
  );

  const rawWanted = (process.env.STRATEGY_NAME || "").trim();
  if (rawWanted) {
    let wanted = normKeepDots(rawWanted);
    if (STRATEGY_ALIASES[wanted])
      wanted = normKeepDots(STRATEGY_ALIASES[wanted]);
    const found =
      modules.find(({ mod }) => normKeepDots(mod.name) === wanted) ||
      modules.find(
        ({ mod }) => normKeepDots(`${mod.name} (${mod.version})`) === wanted
      ) ||
      modules.find(({ stem }) => normKeepDots(stem) === wanted);
    if (found) {
      selectedStrategy = found.mod;
      config.strategy = `${found.mod.name} (${found.mod.version})`;
      console.log(
        `\nAuto-selected strategy: ${config.strategy} via STRATEGY_NAME='${rawWanted}'`
      );
      return;
    }
    console.log(
      `[warn] STRATEGY_NAME='${rawWanted}' did not match; falling back to prompt/choice.`
    );
  }

  const DEFAULT_STRATEGY_INDEX = 8;
  const envChoice = parseInt(process.env.STRATEGY_CHOICE || "", 10);
  const okEnvChoice =
    Number.isInteger(envChoice) &&
    envChoice >= 1 &&
    envChoice <= modules.length;

  if (!process.stdin.isTTY || okEnvChoice) {
    const chosen =
      modules[okEnvChoice ? envChoice - 1 : DEFAULT_STRATEGY_INDEX] ||
      modules[DEFAULT_STRATEGY_INDEX];
    selectedStrategy = chosen.mod;
    config.strategy = `${chosen.mod.name} (${chosen.mod.version})`;
    console.log(
      `\nAuto-selected strategy: ${config.strategy} ${
        okEnvChoice ? "(from STRATEGY_CHOICE)" : "(default)"
      }`
    );
    return;
  }

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
      selectedStrategy = chosen.mod;
      config.strategy = `${chosen.mod.name} (${chosen.mod.version})`;
      resolve();
    });
  });
}

/* ------------------------------- holdings & state ---------------------------------- */
function seedPerBotHoldingsIfNeeded() {
  try {
    const sourceExists = fs.existsSync(HOLDINGS_FILE);
    const destExists = fs.existsSync(BOT_HOLDINGS_FILE);

    let destHasData = false;
    if (destExists) {
      try {
        const j = JSON.parse(fs.readFileSync(BOT_HOLDINGS_FILE, "utf8"));
        destHasData = j && Object.keys(j).length > 0;
      } catch {
        destHasData = false;
      }
    }
    if (sourceExists && !destExists) {
      fs.copyFileSync(HOLDINGS_FILE, BOT_HOLDINGS_FILE);
      console.log(
        `📥 Seeded per-bot holdings from '${HOLDINGS_FILE}' → '${BOT_HOLDINGS_FILE}'`
      );
    } else if (!destExists && !sourceExists) {
      safeWrite(BOT_HOLDINGS_FILE, JSON.stringify({}, null, 2));
    } else if (destExists && !destHasData && sourceExists) {
      fs.copyFileSync(HOLDINGS_FILE, BOT_HOLDINGS_FILE);
      console.log(
        `📥 Seeded per-bot holdings (dest empty) from '${HOLDINGS_FILE}'`
      );
    }
  } catch (e) {
    console.warn(`⚠️  Seed step skipped: ${e.message}`);
  }
}

// LOAD: prefer persisted amount/costBasis; reconstruct from grid only if needed
function loadHoldings() {
  seedPerBotHoldingsIfNeeded();
  let data = {};
  try {
    if (fs.existsSync(BOT_HOLDINGS_FILE)) {
      data = JSON.parse(fs.readFileSync(BOT_HOLDINGS_FILE, "utf8")) || {};
      portfolio._holdingsSource = BOT_HOLDINGS_FILE;
    }
  } catch (err) {
    console.error(`Failed reading per-bot holdings: ${err.message}`);
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
    } else {
      const sum = grid.reduce((s, g) => s + (Number(g.amount) || 0), 0);
      if (sum > (config.minTradeAmount || 0.01)) {
        portfolio.cryptos[sym] = {
          amount: sum,
          costBasis: grid[0]?.price || costBasis || 0,
          grid,
        };
      }
    }
  }
  console.log(`✅ Using holdings file: ${BOT_HOLDINGS_FILE}`);
}

// SAVE: keep the real position amount in file; grid is auxiliary
function saveHoldings() {
  try {
    const out = {};
    for (const sym of Object.keys(portfolio.cryptos)) {
      const h = portfolio.cryptos[sym] || {};
      const grid = (strategies[sym]?.grid || []).map((l) => ({
        price: Number(l.price) || Number(h.costBasis) || 0,
        amount: Number(l.amount) || 0,
        time: Number(l.time) || Date.now(),
      }));
      out[sym] = {
        amount:
          Number(h.amount) ||
          grid.reduce((s, l) => s + (Number(l.amount) || 0), 0),
        costBasis: Number(h.costBasis) || Number(grid[0]?.price) || 0,
        grid,
      };
    }
    safeWrite(BOT_HOLDINGS_FILE, JSON.stringify(out, null, 2));
    console.log(`💾 Saved holdings → ${BOT_HOLDINGS_FILE}`);
  } catch (e) {
    console.warn(`⚠️  Could not write holdings: ${e.message}`);
  }
}

/* ---------- state (cash/locked) ---------- */
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const j = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      if (Number.isFinite(j.cashReserve))
        portfolio.cashReserve = round2(Number(j.cashReserve));
      if (Number.isFinite(j.lockedCash))
        portfolio.lockedCash = round2(Number(j.lockedCash));
      console.log(
        `✅ Loaded state from ${STATE_FILE} (cash=${portfolio.cashReserve}, locked=${portfolio.lockedCash})`
      );
    }
  } catch (e) {
    console.warn(`⚠️  Could not load state: ${e.message}`);
  }
}
function saveState() {
  try {
    safeWrite(
      STATE_FILE,
      JSON.stringify(
        {
          cashReserve: round2(portfolio.cashReserve),
          lockedCash: round2(portfolio.lockedCash),
          ts: Date.now(),
        },
        null,
        2
      )
    );
  } catch (e) {
    console.warn(`⚠️  Could not write state: ${e.message}`);
  }
}

/* ------------------------------ prices & providers --------------------------------- */
const providers = {
  robinhood_public: {
    name: "robinhood_public",
    url: (sym) => `${BASE_URL}${encodeURIComponent(sym)}/`,
    headers: async () => ({
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    }),
    pick: (d) => parseFloat(d.mark_price),
  },
  coinbase: {
    name: "coinbase",
    url: (sym) =>
      `https://api.coinbase.com/v2/prices/${encodeURIComponent(
        sym.replace(/USD$/, "-USD")
      )}/spot`,
    headers: async () => ({
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    }),
    pick: (d) => parseFloat(d?.data?.amount),
  },
};

async function tryProvider(symbol, p) {
  try {
    const res = await axios.get(p.url(symbol), {
      headers: await p.headers(),
      timeout: 12000,
    });
    const price = p.pick(res.data);
    if (Number.isFinite(price) && price > 0)
      return { price, source: p.name, at: nowMs(), live: true };
  } catch (err) {
    console.error(
      `❌ ${symbol} via ${p.name} failed: ${err?.response?.status || ""} ${
        err?.message || ""
      }`
    );
  }
  return null;
}

/* ----- price cache (continuity across restarts) ----- */
function loadPrices() {
  try {
    return JSON.parse(fs.readFileSync(PRICES_FILE, "utf8")) || {};
  } catch {
    return {};
  }
}
function savePrices(map) {
  try {
    safeWrite(PRICES_FILE, JSON.stringify(map, null, 2));
  } catch {}
}
let priceCache = loadPrices();

async function getPrice(symbol, { requireLive = false } = {}) {
  const order = [providers.robinhood_public, providers.coinbase];
  for (const p of order) {
    const r = await tryProvider(symbol, p);
    if (r) {
      quotes[symbol] = r;
      priceCache[symbol] = { price: r.price, at: r.at, source: r.source }; // persist later each tick

      const st =
        strategies[symbol] || (strategies[symbol] = initializeStrategy(symbol));
      st.lastPrice = r.price;
      st.lastPriceAt = r.at;
      st.lastPriceSource = r.source;
      st.priceHistory.push(r.price);
      if (st.priceHistory.length > config.atrLookbackPeriod + 1)
        st.priceHistory.shift();
      const prev = st.priceHistory[st.priceHistory.length - 2];
      if (prev != null) {
        st.trendHistory.push(
          r.price > prev ? "up" : r.price < prev ? "down" : "neutral"
        );
        if (st.trendHistory.length > 3) st.trendHistory.shift();
      }
      if (typeof selectedStrategy?.updateStrategyState === "function") {
        selectedStrategy.updateStrategyState(symbol, st, config);
      }
      return { price: r.price, at: r.at, source: r.source, live: true };
    }
  }
  const st =
    strategies[symbol] || (strategies[symbol] = initializeStrategy(symbol));
  if (!requireLive) {
    const cached = priceCache[symbol];
    if (cached && Number.isFinite(cached.price))
      return {
        price: cached.price,
        at: cached.at,
        source: cached.source || "cache",
        live: false,
      };
    const q = quotes[symbol];
    if (q && Number.isFinite(q.price))
      return {
        price: q.price,
        at: q.at,
        source: q.source || "cache",
        live: false,
      };
    const cb = Number(portfolio.cryptos[symbol]?.costBasis) || 0;
    return { price: cb, at: nowMs(), source: "costBasis", live: false };
  }
  return { price: null, at: nowMs(), source: "none", live: false };
}

/* -------------------------------- seeding ------------------------------------------ */
async function seedStrategyGrids() {
  for (const sym of Object.keys(portfolio.cryptos)) {
    strategies[sym] = strategies[sym] || initializeStrategy(sym);
    strategies[sym].grid = [...(portfolio.cryptos[sym].grid || [])];
  }
  const seedLen = Math.max(config.atrLookbackPeriod || 14, 50);
  await Promise.all(
    Object.keys(portfolio.cryptos).map(async (sym) => {
      const st = strategies[sym];
      const holding = portfolio.cryptos[sym];
      if (
        holding &&
        holding.amount >= config.minTradeAmount &&
        st.grid.length === 0
      ) {
        st.grid.push({
          price: holding.costBasis,
          amount: holding.amount,
          time: nowMs() - seedLen * config.checkInterval,
        });
      }
      let last = null;
      for (let i = seedLen; i > 0; i--) {
        const { price } = await getPrice(sym, { requireLive: false });
        st.priceHistory.push(price);
        last = price;
        if (st.priceHistory.length > 1) {
          const prev = st.priceHistory[st.priceHistory.length - 2];
          st.trendHistory.push(
            price > prev ? "up" : price < prev ? "down" : "neutral"
          );
        }
      }
      st.lastPrice = last;
      console.log(
        `[SEED] ${sym} seeded: priceHistory=${
          st.priceHistory.length
        }, grid=${JSON.stringify(st.grid)}`
      );
    })
  );
  saveHoldings();
}

/* ------------------------------ snapshot & summary --------------------------------- */
function snapshotNow({ useCacheForStale = true } = {}) {
  let fresh = 0,
    cachedPart = 0,
    stale = 0,
    have = 0,
    covered = 0;
  for (const sym of Object.keys(portfolio.cryptos || {})) {
    const qty = Number(portfolio.cryptos[sym]?.amount || 0);
    if (!qty) continue;
    have += 1;

    const st = strategies[sym];
    const last = Number(st?.lastPrice);
    const at = Number(st?.lastPriceAt || 0);
    const liveOk =
      Number.isFinite(last) && at && nowMs() - at <= PRICE_FRESHNESS_MS;

    if (liveOk) {
      fresh += qty * last;
      covered += 1;
      continue;
    }

    const cached = priceCache[sym];
    if (useCacheForStale && cached && Number.isFinite(cached.price)) {
      cachedPart += qty * Number(cached.price);
      covered += 1;
    } else {
      const cb = Number(portfolio.cryptos[sym]?.costBasis) || 0;
      stale += qty * cb;
    }
  }
  const cash = round2(Number(portfolio.cashReserve || 0));
  const locked = round2(Number(portfolio.lockedCash || 0));
  fresh = round2(fresh);
  cachedPart = round2(cachedPart);
  stale = round2(stale);
  const currentValue = round2(cash + locked + fresh + cachedPart);
  const coverage = have ? covered / have : 1;

  return {
    cash,
    locked,
    cryptoMktFresh: fresh,
    cryptoMktCached: cachedPart,
    cryptoMktStale: stale,
    currentValue,
    coverage,
    symbolsTracked: have,
    symbolsCovered: covered,
  };
}

function writeSummaryJSON() {
  try {
    const snap = snapshotNow({ useCacheForStale: true });
    const now = nowMs();

    // 24h series
    let points = [];
    try {
      points = JSON.parse(fs.readFileSync(PNL24_FILE, "utf8")).points || [];
    } catch {}
    points.push({ t: now, v: snap.currentValue });
    const cutoff = now - 24 * 3600 * 1000 - 2 * 60 * 1000;
    points = points.filter(
      (p) => p && typeof p.t === "number" && p.t >= cutoff
    );
    safeWrite(PNL24_FILE, JSON.stringify({ points }, null, 2));

    let pl24h = 0,
      rate = 0,
      est = 0;
    if (points.length >= 2) {
      const oldest = points[0];
      const hrs = Math.max((now - oldest.t) / 3600000, 0.01);
      pl24h = round2(snap.currentValue - oldest.v);
      rate = round2(pl24h / hrs);
      est = round2(rate * 24);
    }

    const beginning = Number(portfolio.beginningPortfolioValue || 0);
    const totalPL = beginning ? round2(snap.currentValue - beginning) : 0;
    const durationMs = Math.max(
      0,
      now - (portfolio.startTime?.getTime?.() || now)
    );
    const overallRate = beginning
      ? round2(
          (snap.currentValue - beginning) / Math.max(durationMs / 3600000, 0.01)
        )
      : 0;

    const out = {
      beginningPortfolioValue: beginning || null,
      duration: Math.floor(durationMs / 60000),
      durationText: `${Math.floor(durationMs / 3600000)}h ${Math.floor(
        (durationMs % 3600000) / 60000
      )}m ${Math.floor((durationMs % 60000) / 1000)}s`,
      strategy: config.strategy,
      buys: Number(portfolio.buysToday || 0),
      sells: Number(portfolio.sellsToday || 0),
      pl24h,
      pl24hAvgRatePerHour: rate,
      pl24hEstimatedProfit: est,
      overall24hAvgRatePerHour: overallRate,
      totalPL,
      cash: snap.cash,
      cryptoMkt: round2(snap.cryptoMktFresh + snap.cryptoMktCached), // IMPORTANT: include cached
      locked: snap.locked,
      currentValue: snap.currentValue,
      dayPL: pl24h,
      staleCryptoMkt: snap.cryptoMktStale,
      coverage: snap.coverage,
      priceFreshnessMs: PRICE_FRESHNESS_MS,
    };

    safeWrite(SUMMARY_PATH, JSON.stringify(out, null, 2));
  } catch (e) {
    console.error("writeSummaryJSON failed:", e?.message || e);
  }
}

/* --------------------------------- hotkeys ----------------------------------------- */
function printLegend() {
  console.log(`\n=== EMOJI LEGEND ===
🟢  BUY executed
🔴  SELL executed
⚠️  BUY/SELL skipped (limit/min/cash/stale/loss)
🔄  Strategy tick started
📈  Decision: BUY
📉  Decision: SELL
💤  HOLD or no decision
======================\n`);
}

// Detailed status snapshot (old-style rich output)
function printStatus() {
  try {
    const snap = snapshotNow({ useCacheForStale: true });
    let last = null;
    try {
      last = JSON.parse(fs.readFileSync(SUMMARY_PATH, "utf8"));
    } catch {}

    const begin = Number(portfolio.beginningPortfolioValue || 0);
    const totalPL = begin ? round2(snap.currentValue - begin) : 0;

    const strategyName = last?.strategy || config.strategy || "(strategy)";
    const pl24h = Number.isFinite(last?.pl24h) ? last.pl24h : 0;
    const pl24hRate = Number.isFinite(last?.pl24hAvgRatePerHour)
      ? last.pl24hAvgRatePerHour
      : 0;
    const pl24hEst = Number.isFinite(last?.pl24hEstimatedProfit)
      ? last.pl24hEstimatedProfit
      : 0;

    const header = `\n=== STATUS @ ${new Date().toLocaleString()} ===
Strategy: ${strategyName}
Coverage: ${(snap.coverage * 100).toFixed(0)}%  (symbols ${
      snap.symbolsCovered
    }/${snap.symbolsTracked})
---------------------------------------------`;
    console.log(header);

    // top-line balances
    console.log(
      pad("Cash:", 14),
      pad(fmtUsd(snap.cash), 12, "left"),
      " | ",
      pad("Locked:", 10),
      pad(fmtUsd(snap.locked), 12, "left")
    );
    console.log(
      pad("Crypto (live+cached):", 22),
      pad(
        fmtUsd(round2(snap.cryptoMktFresh + snap.cryptoMktCached)),
        12,
        "left"
      ),
      " | ",
      pad("Stale (costBasis):", 18),
      pad(fmtUsd(snap.cryptoMktStale), 12, "left")
    );
    console.log(
      pad("Current Value:", 22),
      pad(fmtUsd(snap.currentValue), 12, "left"),
      " | ",
      pad("Beginning PV:", 16),
      pad(fmtUsd(begin || 0), 12, "left")
    );
    console.log(
      pad("Total P/L:", 22),
      pad(fmtUsd(totalPL), 12, "left"),
      " | ",
      pad("24h P/L:", 12),
      pad(fmtUsd(pl24h), 12, "left")
    );
    console.log(
      pad("24h Avg/hr:", 22),
      pad(fmtUsd(pl24hRate), 12, "left"),
      " | ",
      pad("Est 24h:", 12),
      pad(fmtUsd(pl24hEst), 12, "left")
    );

    const buys = Number(last?.buys ?? portfolio.buysToday ?? 0);
    const sells = Number(last?.sells ?? portfolio.sellsToday ?? 0);
    console.log(
      pad("Buys Today:", 22),
      pad(buys, 6, "left"),
      " | ",
      pad("Sells Today:", 14),
      pad(sells, 6, "left")
    );

    // per-symbol table
    console.log(
      "\nSYMBOL            QTY           LAST        SRC     AGE      VALUE"
    );
    console.log(
      "---------------------------------------------------------------------"
    );
    for (const sym of Object.keys(portfolio.cryptos || {}).sort()) {
      const h = portfolio.cryptos[sym];
      const st = strategies[sym] || {};
      const qty = Number(h?.amount || 0);
      if (!qty) continue;

      // prefer fresh, then cached, then cost basis
      let px = Number(st.lastPrice);
      let src = st.lastPriceSource || "";
      let when = st.lastPriceAt || 0;
      if (
        !(
          Number.isFinite(px) &&
          when &&
          Date.now() - when <= PRICE_FRESHNESS_MS
        )
      ) {
        const cp = (priceCache[sym] && Number(priceCache[sym].price)) || NaN;
        if (Number.isFinite(cp)) {
          px = cp;
          src = priceCache[sym].source || "cache";
          when = priceCache[sym].at || 0;
        } else {
          px = Number(h.costBasis) || 0;
          src = "costBasis";
          when = Date.now();
        }
      }
      const val = round2(qty * px);

      console.log(
        pad(sym, 8),
        pad(fmtNum(qty, 6), 14, "left"),
        pad(fmtNum(px, 8), 12, "left"),
        pad(src, 7),
        pad(ago(when), 8),
        pad(fmtUsd(val), 12, "left")
      );
    }
    console.log(
      "---------------------------------------------------------------------\n"
    );
  } catch (e) {
    console.log(`[status] error: ${e?.message || e}`);
  }
}

// Grid dump for current holdings (old-style)
function printGrid() {
  try {
    console.log("\n=== GRIDS ===");
    const symbols = Object.keys(portfolio.cryptos || {}).sort();
    if (!symbols.length) {
      console.log("(no holdings)");
      return;
    }

    for (const sym of symbols) {
      const h = portfolio.cryptos[sym];
      const st = strategies[sym] || {};
      const levels = Array.isArray(st.grid) ? st.grid : [];
      const total = Number(h?.amount || 0);
      console.log(
        `\n${sym}  (amount: ${fmtNum(total, 6)}, costBasis: ${fmtNum(
          Number(h?.costBasis || 0),
          8
        )})`
      );
      if (!levels.length) {
        console.log("  - no grid levels -");
        continue;
      }

      console.log("  Lvl   PRICE          AMOUNT        WHEN");
      console.log("  -----------------------------------------------");
      levels.forEach((g, i) => {
        console.log(
          "  ",
          pad(String(i + 1), 3, "left"),
          pad(fmtNum(Number(g.price) || 0, 8), 14, "left"),
          pad(fmtNum(Number(g.amount) || 0, 6), 14, "left"),
          pad(ago(Number(g.time) || 0), 10, "left")
        );
      });
    }
    console.log("\n");
  } catch (e) {
    console.log(`[grid] error: ${e?.message || e}`);
  }
}

function enableHotkeys(onShutdown) {
  // POSIX: disable flow control so Ctrl+S isn’t swallowed
  if (process.platform !== "win32") {
    try {
      execSync("stty -ixon -ixoff", { stdio: "ignore" });
    } catch {}
  }

  // Signals + file-based fallbacks (work even when headless)
  try {
    process.on("SIGUSR1", () => printStatus());
  } catch {}
  try {
    process.on("SIGUSR2", () => printLegend());
  } catch {}
  const triggers = {
    "ctrl-s": printStatus,
    "ctrl-g": printGrid,
    "ctrl-e": printLegend,
    "ctrl-c": () => onShutdown && onShutdown(),
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

  // Obtain a real TTY stream if stdin isn't one (POSIX)
  let input = process.stdin.isTTY ? process.stdin : null;
  if (!input && process.platform !== "win32") {
    try {
      const fd = fs.openSync("/dev/tty", "rs");
      input = new tty.ReadStream(fd);
    } catch {}
  }
  if (!input) {
    console.log(
      "[hotkeys] No TTY available; use signals or drop files (ctrl-s|ctrl-g|ctrl-e|ctrl-c)."
    );
    return;
  }

  // Support BOTH raw 'data' bytes and readline keypress events
  if (input.setRawMode && !input.isRaw) input.setRawMode(true);
  try {
    input.setEncoding(null);
  } catch {}
  input.resume();

  const lastHitAt = new Map();
  const hit = (k, fn) => {
    const t = nowMs(),
      prev = lastHitAt.get(k) || 0;
    if (t - prev < 180) return;
    lastHitAt.set(k, t);
    try {
      fn();
    } catch (e) {
      console.warn(`[hotkeys] handler error: ${e?.message || e}`);
    }
  };
  const ctrlMap = Object.fromEntries(
    Array.from({ length: 26 }, (_, i) => [i + 1, String.fromCharCode(97 + i)])
  );

  // a) raw bytes path (most robust)
  input.on("data", (buf) => {
    if (!buf || !buf.length) return;
    for (let i = 0; i < buf.length; i++) {
      const code = buf[i];
      if (code === 3) {
        hit("c", () => onShutdown && onShutdown());
        continue;
      } // Ctrl-C
      if (code >= 1 && code <= 26) {
        const k = ctrlMap[code];
        if (k === "s") hit("s", printStatus);
        else if (k === "g") hit("g", printGrid);
        else if (k === "e") hit("e", printLegend);
        else if (k === "c") hit("c", () => onShutdown && onShutdown());
      }
    }
  });

  // b) readline keypress path (helps on some terminals)
  try {
    readline.emitKeypressEvents(input);
    input.on("keypress", (_str, key) => {
      if (!key || !key.ctrl) return;
      if (key.name === "c") return onShutdown && onShutdown();
      if (key.name === "s") return printStatus();
      if (key.name === "g") return printGrid();
      if (key.name === "e") return printLegend();
    });
  } catch {}

  console.log(
    "[hotkeys] Keyboard hotkeys active (Ctrl+S status, Ctrl+G grid, Ctrl+E legend, Ctrl+C exit)."
  );
}

/* ------------------------------ trading core (kept) -------------------------------- */
function priceIsFreshFor(symbol, maxAgeMs) {
  const st = strategies[symbol];
  return !!(
    st &&
    st.lastPriceAt &&
    nowMs() - st.lastPriceAt <= (maxAgeMs || PRICE_FRESHNESS_MS)
  );
}

// SELL profitability gate
const FEES_FRAC = Math.max(
  0,
  Math.min(Number(process.env.FEES_FRAC || 0), 0.02)
);
function estimatedSellProfit({ price, entryPrice, qty, slippageFrac }) {
  const proceeds =
    price * qty * (1 - (Number(slippageFrac) || 0)) * (1 - FEES_FRAC);
  const cost = entryPrice * qty;
  return proceeds - cost;
}

async function runStrategyForSymbol(symbol) {
  const holding = portfolio.cryptos[symbol];
  if (!holding) return;

  const info = await getPrice(symbol, { requireLive: REQUIRE_LIVE_FOR_TRADES });
  if (!info || !Number.isFinite(info.price)) {
    console.log(`[${symbol}] no price yet`);
    return;
  }

  const strat =
    strategies[symbol] || (strategies[symbol] = initializeStrategy(symbol));
  const last = strat.priceHistory[strat.priceHistory.length - 1];
  strat.priceHistory.push(info.price);
  if (strat.priceHistory.length > 250) strat.priceHistory.shift();
  if (last != null) {
    strat.trendHistory.push(
      info.price > last ? "up" : info.price < last ? "down" : "neutral"
    );
    if (strat.trendHistory.length > 3) strat.trendHistory.shift();
  }
  if (typeof selectedStrategy?.updateStrategyState === "function") {
    try {
      selectedStrategy.updateStrategyState(symbol, strat, config);
    } catch (e) {
      console.warn(`[${symbol}] updateStrategyState error: ${e.message}`);
    }
  }

  let decision = null;
  let action = null;
  try {
    if (
      selectedStrategy &&
      typeof selectedStrategy.getTradeDecision === "function"
    ) {
      decision = selectedStrategy.getTradeDecision({
        symbol,
        price: info.price,
        lastPrice: last ?? null,
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

  if (!action) {
    console.log("💤  HOLD or no decision");
    return;
  }
  if (REQUIRE_LIVE_FOR_TRADES && !priceIsFreshFor(symbol)) {
    console.log(`⚠️  ${action} skipped for ${symbol}: price not fresh enough`);
    return;
  }

  if (action === "BUY") {
    const spend = Math.max(
      portfolio.cashReserve * 0.1,
      config.minTradeAmount * info.price
    );
    if (spend > portfolio.cashReserve) {
      console.log(
        `⚠️  BUY skipped for ${symbol}: Not enough cash (need $${spend.toFixed(
          2
        )}, have $${portfolio.cashReserve.toFixed(2)})`
      );
      return;
    }
    const qty = spend / info.price;
    if (!(qty >= config.minTradeAmount)) {
      console.log(
        `⚠️  BUY skipped for ${symbol}: qty (${qty}) < minTradeAmount`
      );
      return;
    }

    holding.amount = Number(holding.amount || 0) + qty; // keep real amount up to date
    portfolio.cashReserve = round2(portfolio.cashReserve - spend);
    const st = strategies[symbol];
    st.grid = st.grid || [];
    st.grid.push({ price: info.price, amount: qty, time: nowMs() });
    portfolio.buysToday++;

    console.log(
      `🟢 BUY ${symbol}: qty=${qty.toFixed(6)} @ $${info.price.toFixed(
        config.priceDecimalPlaces
      )}  cash=$${portfolio.cashReserve.toFixed(2)}  src=${info.source}`
    );
    saveHoldings();
    saveState(); // persist after every trade
    return;
  }

  if (action === "SELL") {
    const suggestedQty = Number(decision?.qty || 0);
    const posAmt = Number(holding.amount || 0);
    const qty =
      suggestedQty > 0 ? Math.min(suggestedQty, posAmt) : posAmt * 0.1;
    if (!Number.isFinite(qty) || qty <= 0) {
      console.log(`⚠️  SELL skipped for ${symbol}: no sellable qty`);
      return;
    }

    const lot0 = (strategies[symbol].grid || [])[0] || {
      price: holding.costBasis,
      amount: holding.amount,
    };
    const entryPrice = Number(lot0.price || holding.costBasis || 0);

    const slippageFrac =
      Number(strategies[symbol]?.slippage || config.defaultSlippage) || 0;
    const estProfit = estimatedSellProfit({
      price: info.price,
      entryPrice,
      qty,
      slippageFrac,
    });
    if (!(estProfit > 0)) {
      console.log(
        `⚠️  SELL skipped for ${symbol}: non-positive profit (est $${estProfit.toFixed(
          2
        )}) (price=${info.price.toFixed(
          config.priceDecimalPlaces
        )}, entry=${entryPrice.toFixed(
          config.priceDecimalPlaces
        )}, qty=${qty.toFixed(6)})`
      );
      return;
    }

    const proceeds = round2(info.price * qty * (1 - slippageFrac));
    portfolio.cashReserve = round2(portfolio.cashReserve + proceeds);
    holding.amount = round2(holding.amount - qty);
    portfolio.sellsToday++;

    // shrink first lot
    const st = strategies[symbol];
    if (st.grid && st.grid.length) {
      st.grid[0].amount = round2(Math.max(0, st.grid[0].amount - qty));
      if (st.grid[0].amount === 0) st.grid.shift();
    }

    console.log(
      `🔴 SELL ${symbol}: qty=${qty.toFixed(6)} @ $${info.price.toFixed(
        config.priceDecimalPlaces
      )}  cash=$${portfolio.cashReserve.toFixed(2)}  src=${info.source}`
    );
    saveHoldings();
    saveState();
    return;
  }

  console.log("💤  HOLD or no decision");
}

/* ----------------------------------- tick ------------------------------------------ */
async function tickOnce() {
  if (!tradingEnabled) return;
  const symbols = Object.keys(portfolio.cryptos || {});
  for (const sym of symbols) await runStrategyForSymbol(sym);

  // Persist latest prices each tick for continuity on next start
  savePrices(priceCache);

  writeSummaryJSON();
  try {
    await writeSummary(DATA_DIR);
  } catch {}
}

/* ----------------------------------- main ------------------------------------------ */
(async () => {
  await promptStrategySelection();
  console.log(`Strategy: ${config.strategy}`);

  // Load persisted state & holdings first
  loadState();
  loadHoldings();

  // Initialize strategy objects & seed
  Object.keys(portfolio.cryptos || {}).forEach(
    (s) => (strategies[s] = initializeStrategy(s))
  );
  await seedStrategyGrids();

  // Prime prices (best-effort, not strictly live)
  await Promise.all(
    Object.keys(portfolio.cryptos).map((sym) =>
      getPrice(sym, { requireLive: false })
    )
  );

  // ===== Baseline boot (coverage-aware, set once) =====
  const prevSummary = (() => {
    try {
      return JSON.parse(fs.readFileSync(SUMMARY_PATH, "utf8"));
    } catch {
      return null;
    }
  })();
  const snapBoot = snapshotNow({ useCacheForStale: true }); // include cached prices to avoid PV collapse

  let persistedBaseline = null;
  try {
    if (fs.existsSync(BASELINE_FILE))
      persistedBaseline = JSON.parse(
        fs.readFileSync(BASELINE_FILE, "utf8")
      )?.beginningPortfolioValue;
  } catch {}

  let baselineToUse = persistedBaseline;
  if (BASELINE_MODE === "reset" || !Number.isFinite(baselineToUse)) {
    baselineToUse = snapBoot.currentValue;
    safeWrite(
      BASELINE_FILE,
      JSON.stringify(
        {
          beginningPortfolioValue: baselineToUse,
          ts: nowMs(),
          mode: BASELINE_MODE,
        },
        null,
        2
      )
    );
    console.log(
      `📎 Set new Beginning Portfolio Value baseline: $${baselineToUse.toFixed(
        2
      )} (mode=${BASELINE_MODE})`
    );
  } else {
    const ratio =
      Math.max(baselineToUse, snapBoot.currentValue) /
      Math.max(1, Math.min(baselineToUse, snapBoot.currentValue));
    if (
      ratio > BASELINE_HEAL_RATIO &&
      snapBoot.coverage >= BASELINE_MIN_COVERAGE
    ) {
      console.log(
        `📎 Healed baseline (${round2(
          baselineToUse
        )} ⇒ ${snapBoot.currentValue.toFixed(2)}) with coverage ${(
          snapBoot.coverage * 100
        ).toFixed(0)}%`
      );
      baselineToUse = snapBoot.currentValue;
      safeWrite(
        BASELINE_FILE,
        JSON.stringify(
          {
            beginningPortfolioValue: baselineToUse,
            ts: nowMs(),
            healed: true,
            coverage: snapBoot.coverage,
          },
          null,
          2
        )
      );
    } else if (
      ratio > BASELINE_HEAL_RATIO &&
      snapBoot.coverage < BASELINE_MIN_COVERAGE &&
      prevSummary?.currentValue
    ) {
      console.log(
        `📎 Coverage ${(snapBoot.coverage * 100).toFixed(
          0
        )}% too low to heal; carrying forward previous PV $${prevSummary.currentValue.toFixed(
          2
        )}.`
      );
      baselineToUse = prevSummary.currentValue;
    } else {
      console.log(
        `📎 Using persisted Beginning Portfolio Value: $${round2(
          baselineToUse
        ).toFixed(2)} (coverage ${(snapBoot.coverage * 100).toFixed(0)}%)`
      );
    }
  }

  // IMPORTANT: set once and never overwrite during this run
  portfolio.beginningPortfolioValue = round2(baselineToUse);

  // Reset 24h series to the PV we will report at boot
  safeWrite(
    PNL24_FILE,
    JSON.stringify({ points: [{ t: nowMs(), v: baselineToUse }] }, null, 2)
  );
  console.log("🧭 24h P/L baseline set.");

  // First summary
  writeSummaryJSON();
  try {
    await writeSummary(DATA_DIR);
  } catch {}

  // Start loop
  tradingEnabled = true;
  const interval = setInterval(tickOnce, config.checkInterval);

  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(interval);
    try {
      writeSummaryJSON();
      await writeSummary(DATA_DIR);
      await finalizeSummary(DATA_DIR);
    } catch {}
    try {
      saveHoldings();
      saveState();
      savePrices(priceCache);
    } catch {}
    console.log("👋 Runner exiting.");
    process.exit(0);
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  enableHotkeys(shutdown);
})();
