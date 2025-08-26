// backend/testPrice_dev.js

"use strict";

// ==============================================
// Helper: normalize boolean env vars (true/1/yes/on)
// ==============================================
const asBool = (v) => /^(1|true|yes|on)$/i.test(String(v || "").trim());

// ==============================================
// Disables output buffering, making logs behave
// exactly like a terminal
// ==============================================
if (
  process.stdout &&
  process.stdout._handle &&
  process.stdout._handle.setBlocking
) {
  process.stdout._handle.setBlocking(true);
}

// ==============================================
//
// Per-bot data directories (isolation)
// + global holdings override (backend/logs/cryptoHoldings.json)
//
// ==============================================
const fsLogger = require("fs");
const pathLogger = require("path");
require("dotenv").config(); // Load .env early

// Each container/bot should set a unique BOT_ID, optionally a DATA_DIR
const BOT_ID = process.env.BOT_ID || "default";
const DATA_DIR =
  process.env.DATA_DIR || pathLogger.join(__dirname, "data", BOT_ID);

// Ensure helpers see the resolved data dir
process.env.DATA_DIR = DATA_DIR;

// Ensure DATA_DIR exists
try {
  fsLogger.mkdirSync(DATA_DIR, { recursive: true });
} catch (err) {
  console.error(`Failed to create DATA_DIR '${DATA_DIR}':`, err.message);
  process.exit(1);
}

// --- Holdings file resolution ---
// Preferred (shared): backend/logs/cryptoHoldings.json
const GLOBAL_HOLDINGS_FILE = pathLogger.join(
  __dirname,
  "logs",
  "cryptoHoldings.json"
);
// Per-bot file (where we ultimately read from)
const BOT_HOLDINGS_FILE = pathLogger.join(DATA_DIR, "cryptoHoldings.json");

// If HOLDINGS_FILE is explicitly set via env, it wins for the *shared* path used in earlier logic
const HOLDINGS_FILE = process.env.HOLDINGS_FILE || GLOBAL_HOLDINGS_FILE;
// We'll track the actual file we ended up using so demo refresh writes back there.
let CURRENT_HOLDINGS_PATH = HOLDINGS_FILE;

// File locations (overridable via env)
const LOG_FILE = process.env.LOG_FILE || "testPrice_output.txt";
const LOG_PATH = process.env.LOG_PATH || pathLogger.join(DATA_DIR, LOG_FILE);

// Diagnostics
console.log("DEBUG:", {
  __dirname,
  BOT_ID,
  DATA_DIR,
  GLOBAL_HOLDINGS_FILE,
  BOT_HOLDINGS_FILE,
  HOLDINGS_FILE, // preferred/explicit
  LOG_PATH,
});

// Create log stream and tee stdout/stderr
const logStream = fsLogger.createWriteStream(LOG_PATH, { flags: "w" });
const origStdout = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, encoding, callback) => {
  logStream.write(chunk);
  return origStdout(chunk, encoding, callback);
};
const origStderr = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, encoding, callback) => {
  logStream.write(chunk);
  return origStderr(chunk, encoding, callback);
};

// Preventing trading until after seeding process is complete
let tradingEnabled = false;
let soldOutSymbols = new Set();

// ==============================================
// Allow Ctrl+S / Ctrl+G key handling on UNIX terminals
// ==============================================
const { execSync } = require("child_process");
if (process.stdin.isTTY) {
  try {
    execSync("stty -ixon", { stdio: "inherit" });
  } catch (_) {}
}

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { getAccessToken, PUBLIC_API_KEY } = require("./sessionManager");
const { signRequest } = require("./signRequest");
const {
  writeSummary,
  finalizeSummary,
  updateWithPl24h,
} = require("./summary-writer");

// ==============================================
// Constants, env flags, and strategy config
// ==============================================
const TRADING_API = "https://trading.robinhood.com";
const USER_AGENT = "Mozilla/5.0 PowerShell/7.2.0";

const SIMPLE_BUY_THRESHOLD =
  parseFloat(process.env.SIMPLE_BUY_THRESHOLD) || 2.0;
const SIMPLE_SELL_THRESHOLD =
  parseFloat(process.env.SIMPLE_SELL_THRESHOLD) || 3.0;
const ENABLE_PEAK_CONFIRMATION = asBool(process.env.ENABLE_PEAK_CONFIRMATION);

const TEST_MODE = asBool(process.env.TEST_MODE);
const MAX_TEST_BUYS = parseInt(process.env.MAX_TEST_BUYS, 10) || 2;
const MAX_TEST_SELLS = parseInt(process.env.MAX_TEST_SELLS, 10) || 2;
const LIMIT_TO_MAX_BUY_SELL = asBool(process.env.LIMIT_TO_MAX_BUY_SELL);

const LOCKED_CASH_PERCENT = parseFloat(process.env.LOCKED_CASH_PERCENT) || 20;
const LOCKED_CASH_FRAC = Math.max(0, Math.min(LOCKED_CASH_PERCENT / 100, 1));

const DEFAULT_SLIPPAGE_PCT = parseFloat(process.env.defaultSlippage) || 2.0;
const DEFAULT_SLIPPAGE_FRAC = Math.max(
  0,
  Math.min(DEFAULT_SLIPPAGE_PCT / 100, 1)
);

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
if (config.testMode) {
  console.log(
    `🧪 TEST_MODE: trades simulated${config.limitBuysSells ? " (capped)" : ""}`
  );
}
console.log(
  `Peak-confirmation on BUY is ${
    config.enablePeakFilter ? "ENABLED" : "DISABLED"
  }`
);
console.log("Press CTRL+S for Status, CTRL+G for Grid, CTRL+C to exit\n");

// ==============================================
// Portfolio State and Strategy Setup
// ==============================================
const BASE_URL = "https://api.robinhood.com/marketdata/forex/quotes/";
let portfolio = {
  cashReserve: parseFloat(config.initialBalance.toFixed(2)),
  lockedCash: 0,
  cryptos: {},
  buysToday: 0,
  sellsToday: 0,
  stopLossesToday: 0,
  dailyProfitTotal: 0,
  startTime: new Date(),
  lastReset: new Date(),
  initialCryptoValue: 0,
  beginningPortfolioValue: 0,
  _holdingsSource: null, // track file we used
};
let strategies = {};
let selectedStrategy = null;
let firstCycleDone = false;

// === Graceful shutdown controls ===
let shuttingDown = false;
let cycleInFlight = null;

// ==============================================
// Helper: initialize per-symbol strategy state
// ==============================================
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
    module: null,
    grid: [],
  };
}

// ==============================================
// Prompt user to pick a strategy (supports env/CI)
// ==============================================
async function promptStrategySelection() {
  const files = fs
    .readdirSync(path.join(__dirname, "strategies"))
    .filter((f) => f.endsWith(".js"))
    .sort();
  const modules = files
    .map((f) => require(`./strategies/${f}`))
    .filter((m) => m.name && m.version && m.description);

  console.log("\n📌 Available Strategies:");
  modules.forEach((s, i) =>
    console.log(` [${i + 1}] ${s.name} (${s.version}) - ${s.description}`)
  );

  // Auto-select when STRATEGY_CHOICE is set (1..N) OR stdin isn't a TTY
  const DEFAULT_STRATEGY_INDEX = 8; // 0-based index for #9
  const envChoice = parseInt(process.env.STRATEGY_CHOICE || "", 10);
  const hasValidEnvChoice =
    Number.isInteger(envChoice) &&
    envChoice >= 1 &&
    envChoice <= modules.length;

  if (!process.stdin.isTTY || hasValidEnvChoice) {
    const index = hasValidEnvChoice ? envChoice - 1 : DEFAULT_STRATEGY_INDEX;
    const strat = modules[index] || modules[DEFAULT_STRATEGY_INDEX];
    config.strategy = `${strat.name} (${strat.version})`;
    selectedStrategy = strat;
    console.log(
      `\nAuto-selected strategy: ${config.strategy} ${
        hasValidEnvChoice ? "(from STRATEGY_CHOICE)" : "(default)"
      }`
    );
    return;
  }

  // Interactive prompt fallback
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  await new Promise((resolve) => {
    rl.question(`\nSelect strategy [default 9]: `, (input) => {
      const idx = parseInt((input || "").trim(), 10);
      const strat =
        modules[
          idx > 0 && idx <= modules.length ? idx - 1 : DEFAULT_STRATEGY_INDEX
        ];
      rl.close();
      config.strategy = `${strat.name} (${strat.version})`;
      selectedStrategy = strat;
      resolve();
    });
  });
}

// ==============================================
// Load holdings (seed per-bot from shared if needed), then read per-bot
// ==============================================
function loadHoldings() {
  // 1) If shared file exists and per-bot is missing/empty, copy shared → per-bot
  try {
    const sharedPath = GLOBAL_HOLDINGS_FILE;
    const botPath = BOT_HOLDINGS_FILE;

    const sharedExists = fs.existsSync(sharedPath);
    const botExists = fs.existsSync(botPath);

    let sharedData = null;
    if (sharedExists) {
      try {
        sharedData = JSON.parse(fs.readFileSync(sharedPath, "utf8"));
      } catch (e) {
        console.warn(`⚠️  Shared holdings unreadable: ${e.message}`);
      }
    }

    const isSharedUsable =
      sharedData &&
      typeof sharedData === "object" &&
      Object.keys(sharedData).length > 0;

    let isBotEmpty = true;
    if (botExists) {
      try {
        const botDataRaw = JSON.parse(fs.readFileSync(botPath, "utf8"));
        isBotEmpty = !botDataRaw || Object.keys(botDataRaw).length === 0;
      } catch (_) {
        isBotEmpty = true; // unreadable counts as empty
      }
    }

    if (isSharedUsable && (!botExists || isBotEmpty)) {
      fs.copyFileSync(sharedPath, botPath);
      console.log(`📥 Seeded per-bot holdings from shared file → ${botPath}`);
    }
  } catch (e) {
    console.warn(`⚠️  Seed step skipped: ${e.message}`);
  }

  // 2) Always load from the per-bot file (after seeding)
  let data = null;
  try {
    if (fs.existsSync(BOT_HOLDINGS_FILE)) {
      data = JSON.parse(fs.readFileSync(BOT_HOLDINGS_FILE, "utf8"));
      portfolio._holdingsSource = BOT_HOLDINGS_FILE;
      CURRENT_HOLDINGS_PATH = BOT_HOLDINGS_FILE;
      console.log(`✅ Using holdings file: ${BOT_HOLDINGS_FILE}`);
    }
  } catch (err) {
    console.error(`Failed reading per-bot holdings: ${err.message}`);
  }

  if (!data) {
    console.warn(
      `⚠️  No holdings file found with positions. Looked for:\n  - ${BOT_HOLDINGS_FILE}\n  - ${GLOBAL_HOLDINGS_FILE}\nProceeding with an empty portfolio.`
    );
    portfolio.cryptos = {};
    portfolio._holdingsSource = "(none)";
    CURRENT_HOLDINGS_PATH = BOT_HOLDINGS_FILE;
    return;
  }

  // Populate portfolio.cryptos with eligible positions
  portfolio.cryptos = {};
  for (const sym in data) {
    const { amount, costBasis } = data[sym] || {};
    if (Number(amount) > (config.minTradeAmount || 0.01)) {
      portfolio.cryptos[sym] = {
        amount: Number(amount),
        costBasis: Number(costBasis),
        grid: [
          {
            price: Number(costBasis),
            amount: Number(amount),
            time: Date.now(),
          },
        ],
      };
    }
  }
}

/**
 * Standardized grid and price/trend seeding for all strategies.
 * Must be called inside an async context.
 */
async function seedStrategyGrids() {
  Object.keys(portfolio.cryptos).forEach((sym) => {
    strategies[sym].grid = [...(portfolio.cryptos[sym].grid || [])];
  });

  const seedHistoryLength = Math.max(config.atrLookbackPeriod || 14, 50);

  await Promise.all(
    Object.keys(portfolio.cryptos).map(async (sym) => {
      const strat = strategies[sym];

      strat.priceHistory = strat.priceHistory || [];
      strat.trendHistory = strat.trendHistory || [];
      strat.grid = strat.grid || [];

      const holding = portfolio.cryptos[sym];
      if (holding && holding.amount >= config.minTradeAmount) {
        if (strat.grid.length === 0) {
          strat.grid.push({
            price: holding.costBasis,
            amount: holding.amount,
            time: Date.now() - seedHistoryLength * config.checkInterval,
          });
        }
        holding.costBasis = holding.costBasis || strat.grid[0].price;
      }

      let lastPrice = null;
      for (let i = seedHistoryLength; i > 0; i--) {
        const { price } = await getPrice(sym);
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

      if (typeof strat.module.updateStrategyState === "function") {
        strat.module.updateStrategyState(sym, strat, config);
      }

      console.log(
        `[SEED] ${sym} seeded with priceHistory=${
          strat.priceHistory.length
        }, trendHistory=${strat.trendHistory.length}, grid=${JSON.stringify(
          strat.grid
        )}, costBasis=${holding.costBasis}`
      );
    })
  );
}

// ==============================================
// (Demo-only) Refresh costBasis to first live price
// Writes back to the same file we loaded.
// ==============================================
async function refreshDemoCostBasis() {
  if (!CURRENT_HOLDINGS_PATH) CURRENT_HOLDINGS_PATH = BOT_HOLDINGS_FILE;
  for (const sym of Object.keys(portfolio.cryptos)) {
    const info = await getPrice(sym);
    if (info) portfolio.cryptos[sym].costBasis = info.price;
  }
  try {
    fs.writeFileSync(
      CURRENT_HOLDINGS_PATH,
      JSON.stringify(portfolio.cryptos, null, 2)
    );
    console.log(`💾 Updated holdings costBasis at ${CURRENT_HOLDINGS_PATH}`);
  } catch (err) {
    console.warn(
      `⚠️  Could not write holdings to ${CURRENT_HOLDINGS_PATH}: ${err.message}`
    );
  }
}

// ==============================================
// Printers: Holdings Table, Status, Grid
// ==============================================
function printHoldingsTable() {
  const rows = Object.entries(portfolio.cryptos).map(
    ([sym, { amount, costBasis }], i) => ({
      No: String(i + 1),
      Symbol: sym,
      Quantity: amount.toFixed(6),
      Price: (strategies[sym].lastPrice || 0).toFixed(
        config.priceDecimalPlaces
      ),
      CostBasis: costBasis.toFixed(6),
    })
  );
  const cols = ["No", "Symbol", "Quantity", "Price", "CostBasis"];
  const widths = {};
  cols.forEach((c) => {
    widths[c] = Math.max(c.length, ...rows.map((r) => r[c].length));
  });
  const sep = (l, m, r) => {
    let line = l;
    cols.forEach((c, i) => {
      line += "─".repeat(widths[c] + 2) + (i < cols.length - 1 ? m : r);
    });
    return line;
  };

  console.log("\nCurrent Holdings:");
  if (!rows.length) {
    console.log("(none)");
    return;
  }
  console.log(sep("┌", "┬", "┐"));
  let hdr = "│";
  cols.forEach((c) => {
    const pad = widths[c] - c.length,
      left = Math.floor(pad / 2),
      right = pad - left;
    hdr += ` ${" ".repeat(left)}${c}${" ".repeat(right)} │`;
  });
  console.log(hdr);
  console.log(sep("├", "┼", "┤"));
  rows.forEach((r) => {
    let line = "│";
    cols.forEach((c) => {
      const v = r[c],
        pad = widths[c] - v.length;
      line += ` ${v}${" ".repeat(pad)} │`;
    });
    console.log(line);
  });
  console.log(sep("└", "┴", "┘"));
}

// ==============================================
// Defensive: Calculate Portfolio Crypto Value
// ==============================================
async function computePortfolioCryptoValue() {
  let total = 0;
  for (const sym of Object.keys(portfolio.cryptos)) {
    const info = await getPrice(sym);
    const qty = Number(portfolio.cryptos[sym].amount);
    const price = info && Number(info.price);
    if (!isFinite(price) || !isFinite(qty)) {
      console.error(
        `❌ Bad value in crypto calculation for ${sym}: price=${price}, qty=${qty}`
      );
      continue;
    }
    total += price * qty;
  }
  return total;
}

// ==============================================
// Live Summary Writer: compute current summary from in-memory state
// ==============================================
async function computeLiveSummary() {
  let cryptoVal = 0;
  for (const sym of Object.keys(portfolio.cryptos ?? {})) {
    const price = Number(strategies[sym]?.lastPrice);
    const qty = Number(portfolio.cryptos[sym]?.amount);
    if (Number.isFinite(price) && Number.isFinite(qty))
      cryptoVal += price * qty;
  }
  const beginning = Number(portfolio.beginningPortfolioValue) || 0;
  const currentValue =
    Number(portfolio.cashReserve || 0) +
    Number(portfolio.lockedCash || 0) +
    cryptoVal;

  return {
    beginningPortfolioValue: beginning,
    duration: portfolio.startTime
      ? Math.floor((Date.now() - portfolio.startTime.getTime()) / 60000) +
        " min"
      : null,
    buys: portfolio.buysToday || 0,
    sells: portfolio.sellsToday || 0,
    totalPL: currentValue - beginning,
    cash: portfolio.cashReserve ?? null,
    cryptoMkt: cryptoVal,
    locked: portfolio.lockedCash ?? null,
    currentValue,
    dayPL: portfolio.dailyProfitTotal || 0,
  };
}

// ==============================================
// Print Status on CTRL+S (with defensive math)
// ==============================================
function printStatus() {
  let cryptoVal = 0;
  for (const sym of Object.keys(portfolio.cryptos)) {
    const price = Number(strategies[sym].lastPrice);
    const qty = Number(portfolio.cryptos[sym].amount);
    if (isFinite(price) && isFinite(qty)) {
      cryptoVal += price * qty;
    } else {
      console.error(
        `❌ Bad value in status for ${sym}: price=${price}, qty=${qty}`
      );
    }
  }

  const avg =
    portfolio.sellsToday > 0
      ? (portfolio.dailyProfitTotal / portfolio.sellsToday).toFixed(2)
      : "N/A";

  const slLimit =
    config.stopLossLimit == null
      ? `${portfolio.stopLossesToday}`
      : `${portfolio.stopLossesToday}/${config.stopLossLimit}`;

  const buysDisplay = config.testMode
    ? `${portfolio.buysToday}`
    : `${portfolio.buysToday}/${config.limitBuysSells ? MAX_TEST_BUYS : "∞"}`;

  const sellsDisplay = config.testMode
    ? `${portfolio.sellsToday}`
    : `${portfolio.sellsToday}/${config.limitBuysSells ? MAX_TEST_SELLS : "∞"}`;

  const safe = (n) => (isFinite(n) ? Number(n).toFixed(2) : "0.00");

  console.log("\n=== REALIZED P/L STATUS ===");
  console.log(`Buys:     ${buysDisplay}`);
  console.log(`Sells:    ${sellsDisplay}`);
  console.log(`StopLoss: ${slLimit}`);
  console.log(
    `Realized Profit:   $${safe(portfolio.dailyProfitTotal)} (avg $${avg})`
  );
  // --- Unrealized P/L calculation ---
  let cryptoPlusCash =
    Number(portfolio.cashReserve) +
    cryptoVal +
    Number(portfolio.lockedCash || 0);
  let unrealizedPL = cryptoPlusCash - portfolio.startingPortfolioValue;
  console.log(`Unrealized P/L:   $${safe(unrealizedPL)}`);
  console.log(
    `Cash: $${safe(portfolio.cashReserve)}, Crypto: $${safe(
      cryptoVal
    )}, Locked: $${safe(portfolio.lockedCash)}`
  );
}

// ==============================================
// Print Grid on CTRL+G
// ==============================================
function printGrid() {
  console.log("\n=== GRID ENTRIES ===");
  Object.keys(portfolio.cryptos).forEach((sym) => {
    console.log(`\n${sym} grid:`);
    const grid = strategies[sym].grid;
    if (!grid.length) console.log("  (empty)");
    else
      grid.forEach((lot, i) =>
        console.log(
          `  [${i + 1}] price=${lot.price.toFixed(
            config.priceDecimalPlaces
          )}, amount=${lot.amount}, time=${new Date(lot.time).toLocaleString()}`
        )
      );
  });
}

// ==============================================
// Fetch market data and update strategy state
// ==============================================
async function getPrice(symbol) {
  const token = await getAccessToken();
  try {
    const res = await axios.get(`${BASE_URL}${symbol}/`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        Origin: "https://robinhood.com",
      },
      timeout: 10000,
    });
    const price = parseFloat(res.data.mark_price);
    const strat = strategies[symbol];
    const prev = strat.lastPrice;

    strat.priceHistory.push(price);
    if (strat.priceHistory.length > config.atrLookbackPeriod + 1)
      strat.priceHistory.shift();

    if (typeof selectedStrategy.updateStrategyState === "function") {
      selectedStrategy.updateStrategyState(symbol, strat, config);
    }

    const dir =
      prev == null
        ? "neutral"
        : price > prev
        ? "up"
        : price < prev
        ? "down"
        : "neutral";
    strat.trendHistory.push(dir);
    if (strat.trendHistory.length > 3) strat.trendHistory.shift();

    strat.lastPrice = price;
    return { price, prev };
  } catch (err) {
    console.error(`❌ Price fetch failed for ${symbol}:`, err.message);
    return { price: 0, prev: 0 };
  }
}

// ==============================================
// Actual Sell execution logic (BUY handled inline)
// ==============================================
function executeTrade(symbol, action, price, sellAmount = null) {
  const strat = strategies[symbol];
  const holding = portfolio.cryptos[symbol];
  const PROFIT_LOCK_FRAC = parseFloat(process.env.PROFIT_LOCK_PARTIAL) || 0.0;
  const minHold = parseFloat(process.env.MIN_HOLD_AMOUNT) || 0.01;

  // Only SELL is supported here; BUYs are executed inline in runStrategyForSymbol
  if (action === "SELL") {
    let lot = strat.grid[0];
    if (!lot) return;

    // Determine the sell quantity
    let qtyToSell;
    if (
      sellAmount !== null &&
      sellAmount > 0 &&
      lot.amount - sellAmount >= minHold
    ) {
      qtyToSell = sellAmount;
      lot.amount -= qtyToSell;
      if (lot.amount < minHold) lot.amount = minHold;
    } else if (lot.amount > minHold) {
      qtyToSell = lot.amount - minHold;
      lot.amount = minHold;
    } else {
      console.log(
        `❌ SELL BLOCKED for ${symbol}: cannot sell below minimum holding (${minHold})`
      );
      return;
    }

    const proceeds =
      Math.round(price * qtyToSell * (1 - (strat.slippage || 0)) * 100) / 100;
    portfolio.cashReserve =
      Math.round((portfolio.cashReserve + proceeds) * 100) / 100;
    const profit = Math.round((proceeds - lot.price * qtyToSell) * 100) / 100;
    let lockedAmount = 0;
    if (profit > 0) {
      lockedAmount = Math.round(profit * PROFIT_LOCK_FRAC * 100) / 100;
      portfolio.lockedCash =
        Math.round((portfolio.lockedCash + lockedAmount) * 100) / 100;
    }
    holding.amount -= qtyToSell;

    if (holding.amount < config.minTradeAmount) {
      soldOutSymbols.add(symbol);
    }

    holding.costBasis = strat.grid.length
      ? strat.grid[strat.grid.length - 1].price
      : holding.costBasis;
    portfolio.dailyProfitTotal =
      Math.round((portfolio.dailyProfitTotal + profit) * 100) / 100;
    portfolio.sellsToday++;

    console.log(
      `🔴 SELL executed: ${qtyToSell.toFixed(6)} ${symbol} @ $${price.toFixed(
        config.priceDecimalPlaces
      )} P/L $${profit.toFixed(2)}  Locked: $${lockedAmount.toFixed(2)}`
    );
    console.log(`\nAfter SELL ${symbol} grid:`);
    if (strat.grid.length === 0) {
      console.log("  (empty)");
    } else {
      strat.grid.forEach((lot, i) =>
        console.log(
          `  [${i + 1}] price=${lot.price.toFixed(
            config.priceDecimalPlaces
          )}, amount=${lot.amount.toFixed(6)}, time=${new Date(
            lot.time
          ).toLocaleString()}`
        )
      );
    }
  }
}

// ==============================================
// Run one symbol’s strategy, maybe trade
// ==============================================
async function runStrategyForSymbol(symbol) {
  const holding = portfolio.cryptos[symbol];
  if (!holding) return;

  const strat = strategies[symbol];
  if (!strat) return;

  // Get price info and update state
  const info = await getPrice(symbol);
  if (!info || !info.price) return;

  // Maintain price/trend histories
  strat.priceHistory = strat.priceHistory || [];
  strat.trendHistory = strat.trendHistory || [];
  strat.priceHistory.push(info.price);
  if (strat.priceHistory.length > 250) strat.priceHistory.shift();

  if (strat.priceHistory.length >= 2) {
    const dir =
      info.price > strat.priceHistory[strat.priceHistory.length - 2]
        ? "up"
        : info.price < strat.priceHistory[strat.priceHistory.length - 2]
        ? "down"
        : "flat";
    strat.trendHistory.push(dir);
    if (strat.trendHistory.length > 250) strat.trendHistory.shift();
  }

  // Compose strategy state
  const strategyState = {
    priceHistory: strat.priceHistory,
    trendHistory: strat.trendHistory,
    grid: strat.grid,
    slippage: strat.slippage,
    trend: strat.trend || "rangebound",
  };

  // --- STRATEGY DECISION ---
  let action = null;
  let decision = null;

  if (strat.module && typeof strat.module.getTradeDecision === "function") {
    decision = strat.module.getTradeDecision({
      symbol,
      price: info.price,
      lastPrice:
        strat.priceHistory.length >= 2
          ? strat.priceHistory[strat.priceHistory.length - 2]
          : null,
      costBasis: holding.costBasis,
      strategyState,
      config,
      strat,
    });
    if (decision && decision.action) {
      action = decision.action.toUpperCase();
      console.log(
        `📈 Strategy decision for ${symbol}: ${action} @ $${info.price.toFixed(
          8
        )}`
      );
    } else {
      console.log(
        `💤 Strategy decision for ${symbol}: HOLD @ $${info.price.toFixed(8)}`
      );
    }

    if (asBool(process.env.DEBUG_BUYS)) {
      console.log(
        `[DEBUG][${symbol}] price=${info.price}, costBasis=${
          holding.costBasis
        }, trend=${strategyState.trend || "unknown"}, delta=${
          typeof strategyState.delta === "number"
            ? strategyState.delta.toFixed(6)
            : "n/a"
        }, atr=${
          typeof strategyState.atr === "number"
            ? strategyState.atr.toFixed(6)
            : "n/a"
        }`
      );
    }
  }

  // --- GUARD: Block trading if not enabled (during seeding) ---
  if (typeof tradingEnabled !== "undefined" && !tradingEnabled) {
    if (action) {
      console.log(`💤 Trade skipped for ${symbol} during seeding: ${action}`);
    }
    return;
  }

  // --- BUY HANDLING ---
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
    const actualQty = spend / info.price;
    if (actualQty < config.minTradeAmount) {
      console.log(
        `⚠️  BUY skipped for ${symbol}: actualQty (${actualQty}) < minTradeAmount`
      );
      return;
    }

    holding.amount += actualQty;
    portfolio.cashReserve =
      Math.round((portfolio.cashReserve - spend) * 100) / 100;

    strat.grid = strat.grid || [];
    strat.grid.push({ price: info.price, amount: actualQty, time: Date.now() });
    portfolio.buysToday++;

    console.log(
      `🟢 BUY executed: ${actualQty.toFixed(
        6
      )} ${symbol} @ $${info.price.toFixed(config.priceDecimalPlaces)}`
    );

    console.log(`\nAfter BUY ${symbol} grid:`);
    if (strat.grid.length === 0) {
      console.log("  (empty)");
    } else {
      strat.grid.forEach((lot, idx) =>
        console.log(
          `  [${idx + 1}] price=${lot.price.toFixed(
            config.priceDecimalPlaces
          )}, amount=${lot.amount.toFixed(6)}, time=${new Date(
            lot.time
          ).toLocaleString()}`
        )
      );
    }
    return;
  }

  // --- SELL HANDLING (with STOP-LOSS and MINIMUM HOLD GUARDS) ---
  if (action === "SELL") {
    strat.grid = strat.grid || [];
    const lot = strat.grid[0];
    if (!lot || lot.amount <= 0) {
      console.log(
        `❌ SELL skipped for ${symbol}: grid empty or lot amount <= 0; grid=`,
        JSON.stringify(strat.grid)
      );
      return;
    }

    const stopLossActive = asBool(process.env.STOP_LOSS_MODE);
    const stopLossPct = parseFloat(process.env.STOP_LOSS_THRESHOLD_PCT) || 10;
    const stopLossPrice = lot.price * (1 - stopLossPct / 100);
    const minHold = parseFloat(process.env.MIN_HOLD_AMOUNT) || 0.01;
    let sellableAmount = lot.amount - minHold;
    if (sellableAmount <= 0) {
      console.log(
        `❌ SELL BLOCKED for ${symbol}: cannot sell below minimum holding (${minHold})`
      );
      return;
    }

    if (info.price <= lot.price) {
      if (
        stopLossActive &&
        info.price < lot.price &&
        info.price <= stopLossPrice
      ) {
        console.log(
          `⚠️ STOP-LOSS SELL for ${symbol}: sell price $${info.price.toFixed(
            config.priceDecimalPlaces
          )} < stop-loss $${stopLossPrice.toFixed(
            config.priceDecimalPlaces
          )} (cost basis $${lot.price.toFixed(config.priceDecimalPlaces)})`
        );
      } else {
        console.log(
          `❌ SELL BLOCKED for ${symbol}: sell price $${info.price.toFixed(
            config.priceDecimalPlaces
          )} <= cost basis $${lot.price.toFixed(config.priceDecimalPlaces)}`
        );
        return;
      }
    }

    const slippage = strat.slippage || 0;
    const proceeds =
      Math.round(info.price * sellableAmount * (1 - slippage) * 100) / 100;
    const expectedProfit =
      Math.round((proceeds - lot.price * sellableAmount) * 100) / 100;

    if (
      !(stopLossActive && info.price < lot.price && info.price <= stopLossPrice)
    ) {
      if (expectedProfit <= 0) {
        console.log(
          `❌ SELL BLOCKED for ${symbol}: would yield non-positive profit ($${expectedProfit.toFixed(
            2
          )})`
        );
        return;
      }
    }

    executeTrade(symbol, "SELL", info.price, sellableAmount);
    lot.amount = Math.max(minHold, lot.amount - sellableAmount);

    console.log(`\nAfter SELL ${symbol} grid:`);
    if (strat.grid.length === 0) {
      console.log("  (empty)");
    } else {
      strat.grid.forEach((lot, idx) =>
        console.log(
          `  [${idx + 1}] price=${lot.price.toFixed(
            config.priceDecimalPlaces
          )}, amount=${lot.amount.toFixed(6)}, time=${new Date(
            lot.time
          ).toLocaleString()}`
        )
      );
    }
    return;
  }

  // No trade
  return;
}

// ==============================================
// Final Summary on CTRL+C (with defensive math)
// ==============================================
async function printFinalSummary() {
  const finalCrypto = await computePortfolioCryptoValue();
  const endValue =
    Math.round(
      (portfolio.cashReserve + portfolio.lockedCash + finalCrypto) * 100
    ) / 100;
  const startVal = Number(portfolio.beginningPortfolioValue) || 0;
  const profit = Math.round((endValue - startVal) * 100) / 100;
  const minutes = Math.floor((Date.now() - portfolio.startTime) / 60000);

  const finalBuys = config.testMode
    ? `${portfolio.buysToday}`
    : `${portfolio.buysToday}/${config.limitBuysSells ? MAX_TEST_BUYS : "∞"}`;

  const finalSells = config.testMode
    ? `${portfolio.sellsToday}`
    : `${portfolio.sellsToday}/${config.limitBuysSells ? MAX_TEST_SELLS : "∞"}`;

  const safe = (n) => (isFinite(n) ? Number(n).toFixed(2) : "0.00");

  console.log("\n=== TOTAL PORTFOLIO SUMMARY ===");
  console.log(`Beginning Portfolio Value: $${safe(startVal)}`);
  console.log(`Duration: ${minutes} min`);
  console.log(`Buys:     ${finalBuys}`);
  console.log(`Sells:    ${finalSells}`);
  console.log(`Total P/L:   $${safe(profit)}`);
  console.log(`Cash:        $${safe(portfolio.cashReserve)}`);
  console.log(`Crypto (mkt):$${safe(finalCrypto)}`);
  console.log(`Locked:      $${safe(portfolio.lockedCash)}`);
  console.log("=============================\n");

  // === FINAL HOLDINGS SUMMARY ===
  console.log("\n--- FINAL HOLDINGS (still owned) ---");
  let hasHoldings = false;
  Object.entries(portfolio.cryptos).forEach(([sym, data]) => {
    const amount = Number(data.amount);
    if (amount >= config.minTradeAmount) {
      hasHoldings = true;
      const lastPrice = strategies[sym]?.lastPrice || 0;
      const val = amount * lastPrice;
      console.log(
        `  ${sym}: ${amount.toFixed(6)} @ $${lastPrice.toFixed(
          6
        )} = $${val.toFixed(2)}`
      );
    }
  });
  if (!hasHoldings) {
    console.log("  (none)");
  }

  // === FULLY SOLD COINS (Sold Out) ===
  console.log("\n--- FULLY SOLD COINS (completely sold this run) ---");
  if (soldOutSymbols.size === 0) {
    console.log("  (none)");
  } else {
    for (const sym of soldOutSymbols) {
      const lastPrice = strategies[sym]?.lastPrice || 0;
      console.log(`  ${sym} (last known price $${lastPrice.toFixed(6)})`);
    }
  }
}

// ==============================================
// Main Execution Entry Point
// ==============================================
(async () => {
  await promptStrategySelection();

  // Fetch or skip BP
  if (!config.demoMode && !config.testMode) {
    // TODO: Add live BP fetch logic here if needed.
    // const bp = await fetchCryptoBuyingPower();
    // if (bp!=null) portfolio.cashReserve = bp;
  } else {
    console.log("🧪 TEST_MODE: skipping BP fetch");
  }

  // Load & initialize
  loadHoldings();
  Object.keys(portfolio.cryptos).forEach((sym) => {
    strategies[sym] = initializeStrategy(sym);
    strategies[sym].module = selectedStrategy;
  });
  await seedStrategyGrids();
  if (config.demoMode) await refreshDemoCostBasis();

  // Initial price fetch, table, key bindings
  await Promise.all(Object.keys(portfolio.cryptos).map((sym) => getPrice(sym)));
  printHoldingsTable();

  let initCrypto = 0;
  for (const sym of Object.keys(portfolio.cryptos)) {
    const info = await getPrice(sym);
    if (info) initCrypto += info.price * portfolio.cryptos[sym].amount;
  }
  portfolio.initialCryptoValue = initCrypto;
  portfolio.beginningPortfolioValue =
    Math.round((config.initialBalance + initCrypto) * 100) / 100;
  portfolio.startingPortfolioValue = portfolio.beginningPortfolioValue;
  console.log(
    `\n=== STARTUP SUMMARY ===\nBeginning Portfolio Value: $${portfolio.beginningPortfolioValue}`
  );
  if (portfolio._holdingsSource)
    console.log(`Holdings source: ${portfolio._holdingsSource}`);

  // Ctrl handlers
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
  }
  process.stdin.setEncoding("utf8");
  process.stdin.on("keypress", (str, key) => {
    if (key.ctrl && key.name === "s") printStatus();
    if (key.ctrl && key.name === "g") printGrid();
    if (key.ctrl && key.name === "e") printLegend();
    if (key.ctrl && key.name === "c") {
      process.stdin.setRawMode(false);
      process.emit("SIGINT");
    }
  });

  console.log("🔄 Seeding initial cycle (no trades)...");
  await Promise.all(
    Object.keys(portfolio.cryptos).map((sym) => runStrategyForSymbol(sym))
  );

  tradingEnabled = true;
  firstCycleDone = true;
  console.log("✅ Initial cycle complete — trading now enabled.");

  // 🔄 Write initial live summary now that trading is enabled
  try {
    const s = await computeLiveSummary();
    writeSummary(
      process.env.DATA_DIR,
      updateWithPl24h(process.env.DATA_DIR, s)
    );
  } catch {}

  async function runCycle() {
    if (shuttingDown) return;
    for (const sym of Object.keys(portfolio.cryptos)) {
      if (shuttingDown) return;
      await runStrategyForSymbol(sym);
    }
    if (shuttingDown) return;
    if (
      typeof selectedStrategy.shouldLockProfit === "function" &&
      typeof selectedStrategy.lockProfit === "function"
    ) {
      if (selectedStrategy.shouldLockProfit(portfolio, config)) {
        selectedStrategy.lockProfit(portfolio, config);
      }
    }
  }

  async function tickOnce() {
    if (cycleInFlight) return; // prevent overlapping cycles
    cycleInFlight = runCycle()
      .catch((err) =>
        console.error("Cycle error:", (err && err.message) || err)
      )
      .finally(() => {
        cycleInFlight = null;
      });
    await cycleInFlight;
    // 🔁 Write live summary after each completed cycle
    try {
      const s = await computeLiveSummary();
      writeSummary(
        process.env.DATA_DIR,
        updateWithPl24h(process.env.DATA_DIR, s)
      );
    } catch {}
  }

  const interval = setInterval(() => {
    tickOnce();
  }, config.checkInterval);

  process.once("SIGINT", async () => {
    shuttingDown = true;
    clearInterval(interval);

    try {
      if (cycleInFlight) {
        await Promise.race([
          cycleInFlight,
          new Promise((res) => setTimeout(res, 3000)),
        ]);
      }
    } catch (_) {}

    try {
      // 🧾 Finalize summary before exit
      try {
        const s = await computeLiveSummary();
        finalizeSummary(
          process.env.DATA_DIR,
          updateWithPl24h(process.env.DATA_DIR, s)
        );
      } catch {}
      await printFinalSummary();
    } catch (e) {
      console.error(e);
    }
    try {
      if (typeof logStream !== "undefined" && logStream && logStream.end)
        logStream.end();
    } catch (_) {}

    process.exit(0);
  });
})();

function printLegend() {
  console.log(`\n=== EMOJI LEGEND ===
🟢  BUY executed
🔴  SELL executed
⚠️   BUY skipped (limit/min/cash)
❌  SELL skipped (invalid lot/grid)
🔄  Strategy tick started
[TICK] Running strategy for SYMBOL
📈  Decision: BUY
📉  Decision: SELL
💤  HOLD or no decision
======================\n`);
}
