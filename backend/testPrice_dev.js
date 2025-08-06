// backend/testPrice_dev.js

"use strict";

// ==============================================
// Redirect all stdout & stderr to a log file
// ==============================================
const fsLogger = require("fs");
const pathLogger = require("path");
const logFilePath = pathLogger.join(__dirname, "testPrice_output.txt");
const logStream = fsLogger.createWriteStream(logFilePath, { flags: "w" });
// Preventing trading until after seeding process is complete
let tradingEnabled = false;
let soldOutSymbols = new Set();

const origStdout = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, encoding, callback) => {
  logStream.write(chunk);
  origStdout(chunk, encoding, callback);
};
const origStderr = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, encoding, callback) => {
  logStream.write(chunk);
  origStderr(chunk, encoding, callback);
};

// ==============================================
// Allow Ctrl+S / Ctrl+G key handling on UNIX terminals
// ==============================================
const { execSync } = require("child_process");
if (process.stdin.isTTY) {
  try {
    execSync("stty -ixon", { stdio: "inherit" });
  } catch (_) {}
}

// ==============================================
// Load environment variables from .env
// ==============================================
require("dotenv").config();

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { getAccessToken, PUBLIC_API_KEY } = require("./sessionManager");
const { signRequest } = require("./signRequest");

// ==============================================
// Constants, env flags, and strategy config
// ==============================================
const TRADING_API = "https://trading.robinhood.com";
const USER_AGENT = "Mozilla/5.0 PowerShell/7.2.0";

const SIMPLE_BUY_THRESHOLD =
  parseFloat(process.env.SIMPLE_BUY_THRESHOLD) || 2.0;
const SIMPLE_SELL_THRESHOLD =
  parseFloat(process.env.SIMPLE_SELL_THRESHOLD) || 3.0;
const ENABLE_PEAK_CONFIRMATION =
  process.env.ENABLE_PEAK_CONFIRMATION === "true";

const TEST_MODE = process.env.TEST_MODE === "true";
const MAX_TEST_BUYS = parseInt(process.env.MAX_TEST_BUYS, 10) || 2;
const MAX_TEST_SELLS = parseInt(process.env.MAX_TEST_SELLS, 10) || 2;
const LIMIT_TO_MAX_BUY_SELL = process.env.LIMIT_TO_MAX_BUY_SELL === "true";

// New: Locked Cash percent, expects a whole number (e.g., 20 for 20%)
const LOCKED_CASH_PERCENT = parseFloat(process.env.LOCKED_CASH_PERCENT) || 20;
const LOCKED_CASH_FRAC = Math.max(0, Math.min(LOCKED_CASH_PERCENT / 100, 1));

// New: Slippage, expects a whole number (e.g., 2 for 2%)
const DEFAULT_SLIPPAGE_PCT = parseFloat(process.env.defaultSlippage) || 2.0;
const DEFAULT_SLIPPAGE_FRAC = Math.max(
  0,
  Math.min(DEFAULT_SLIPPAGE_PCT / 100, 1)
);

// Tunable config (per-strategy)
const config = {
  aiEnabled: process.env.AI_ENABLED === "true",
  demoMode: process.env.DEMO_MODE === "true",
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
};
let strategies = {};
let selectedStrategy = null;
let firstCycleDone = false;

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
// Prompt user to pick a strategy
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

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    const DEFAULT_STRATEGY_INDEX = 8; // 0-based index for #9
    rl.question(`\nSelect strategy [default 9]: `, (input) => {
      const idx = parseInt(input.trim(), 10);
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
// Load holdings from disk and seed each grid
// ==============================================
function loadHoldings() {
  const data = JSON.parse(
    fs.readFileSync(path.join(__dirname, "cryptoHoldings.json"), "utf8")
  );
  for (const sym in data) {
    const { amount, costBasis } = data[sym];
    if (amount > config.minTradeAmount) {
      portfolio.cryptos[sym] = {
        amount,
        costBasis,
        grid: [{ price: costBasis, amount, time: Date.now() }],
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

      // Initialize state arrays if needed
      strat.priceHistory = strat.priceHistory || [];
      strat.trendHistory = strat.trendHistory || [];
      strat.grid = strat.grid || [];

      // If we already have holdings for this symbol, seed the grid and costBasis
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

      // Seed the priceHistory (simulate past prices)
      let lastPrice = null;
      for (let i = seedHistoryLength; i > 0; i--) {
        const { price } = await getPrice(sym);
        strat.priceHistory.push(price);
        lastPrice = price;
        // Optionally, seed trendHistory for confirmation-based strategies
        if (strat.priceHistory.length > 1) {
          const prev = strat.priceHistory[strat.priceHistory.length - 2];
          strat.trendHistory.push(
            price > prev ? "up" : price < prev ? "down" : "neutral"
          );
        }
      }
      strat.lastPrice = lastPrice;

      // Now run updateStrategyState so derived fields (ATR, etc.) are initialized
      if (typeof strat.module.updateStrategyState === "function") {
        strat.module.updateStrategyState(sym, strat, config);
      }

      // Print seeding summary for debug
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
// ==============================================
async function refreshDemoCostBasis() {
  for (const sym of Object.keys(portfolio.cryptos)) {
    const info = await getPrice(sym);
    if (info) portfolio.cryptos[sym].costBasis = info.price;
  }
  fs.writeFileSync(
    path.join(__dirname, "cryptoHoldings.json"),
    JSON.stringify(portfolio.cryptos, null, 2)
  );
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
// Actual Buy/Sell execution logic
// ==============================================
function executeTrade(symbol, action, price, sellAmount = null) {
  const strat = strategies[symbol];
  const holding = portfolio.cryptos[symbol];
  const LOCKED_CASH_FRAC = parseFloat(process.env.PROFIT_LOCK_PARTIAL) || 0.0;
  const minHold = parseFloat(process.env.MIN_HOLD_AMOUNT) || 0.01;

  // PATCH: Always use the minTradeAmount from config for empty detection
  const minTradeAmount = config.minTradeAmount || minHold;

  if (action === "BUY") {
    // === Core Buy Logic ===
    // You should set 'actualQty' appropriately in your buy code
    strat.grid.push({ price, amount: actualQty, time: Date.now() });
    holding.amount = (holding.amount || 0) + actualQty;
    portfolio.buysToday++;

    // === Formatted Output ===
    console.log(
      `🟢 BUY executed: ${actualQty.toFixed(6)} ${symbol} @ $${price.toFixed(
        config.priceDecimalPlaces
      )}`
    );

    // Print grid state after BUY, with numbered entries and human-readable times.
    console.log(`\nAfter BUY ${symbol} grid:`);
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
  } else if (action === "SELL") {
    // PATCH: Only partially sell the lot if it would drop below minHold
    let lot = strat.grid[0];
    if (!lot) return;

    // PATCH: Determine the sell quantity
    let qtyToSell;
    if (
      sellAmount !== null &&
      sellAmount > 0 &&
      lot.amount - sellAmount >= minHold
    ) {
      qtyToSell = sellAmount;
      lot.amount -= qtyToSell;
      // If lot remains above minHold, do not shift it from the grid
      if (lot.amount < minHold) lot.amount = minHold; // Patch: extra safety
    } else if (lot.amount > minHold) {
      qtyToSell = lot.amount - minHold;
      lot.amount = minHold; // Reduce to anchor
    } else {
      // Not enough to sell (would go below min hold)
      console.log(
        `❌ SELL BLOCKED for ${symbol}: cannot sell below minimum holding (${minHold})`
      );
      return;
    }

    // PATCH: If after sell lot is exactly minHold, do NOT shift it (keep in grid)
    if (lot.amount > minHold * 0.999) {
      // Remain in grid as anchor lot
    } else {
      // Defensive fallback: should not happen, but just in case, keep as anchor
      lot.amount = minHold;
    }

    const proceeds =
      Math.round(price * qtyToSell * (1 - (strat.slippage || 0)) * 100) / 100;
    portfolio.cashReserve =
      Math.round((portfolio.cashReserve + proceeds) * 100) / 100;
    const profit = Math.round((proceeds - lot.price * qtyToSell) * 100) / 100;
    let lockedAmount = 0;
    if (profit > 0) {
      lockedAmount = Math.round(profit * LOCKED_CASH_FRAC * 100) / 100;
      portfolio.lockedCash =
        Math.round((portfolio.lockedCash + lockedAmount) * 100) / 100;
    }
    holding.amount -= qtyToSell;

    // PATCH: Never remove the anchor grid lot, even if holding drops to minHold
    if (holding.amount < minTradeAmount) {
      soldOutSymbols.add(symbol); // If you use this elsewhere, still flag
    }

    holding.costBasis = strat.grid.length
      ? strat.grid[strat.grid.length - 1].price
      : holding.costBasis;
    portfolio.dailyProfitTotal =
      Math.round((portfolio.dailyProfitTotal + profit) * 100) / 100;
    portfolio.sellsToday++;

    // --- FORMATTED OUTPUT ---
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
    trend: strat.trend || "rangebound", // <---- THIS IS KEY
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
    });
    if (decision && decision.action) {
      action = decision.action.toUpperCase();
      console.log(
        `📈 Strategy decision for ${symbol}: ${action} @ $${info.price.toFixed(
          8
        )}`
      );
    } else {
      // Even if no buy/sell, always log a HOLD decision for traceability
      console.log(
        `💤 Strategy decision for ${symbol}: HOLD @ $${info.price.toFixed(8)}`
      );
    }

    // --- 🔥 PATCH: TREND DEBUG LOGGING ---
    if (process.env.DEBUG_BUYS === "true") {
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
    // Optionally: log that trade is skipped during seeding (always prints HOLD if null)
    if (action) {
      console.log(`💤 Trade skipped for ${symbol} during seeding: ${action}`);
    }
    return;
  }

  // --- BUY HANDLING ---
  if (action === "BUY") {
    // === Calculate spend for this buy ===
    // Use a small portion of cash per buy, but always ensure at least the minimum trade size.
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

    // === Execute Buy: always allow new grid lot, even if anchor/minHold exists ===
    // This enables DCA/grid buys at any price dip signal, regardless of prior grid state.
    holding.amount += actualQty;
    portfolio.cashReserve =
      Math.round((portfolio.cashReserve - spend) * 100) / 100;

    strat.grid = strat.grid || [];
    strat.grid.push({ price: info.price, amount: actualQty, time: Date.now() });
    portfolio.buysToday++;

    // === Formatted Output ===
    console.log(
      `🟢 BUY executed: ${actualQty.toFixed(
        6
      )} ${symbol} @ $${info.price.toFixed(config.priceDecimalPlaces)}`
    );

    // Print grid state after BUY, with numbered entries and human-readable times.
    console.log(`\nAfter BUY ${symbol} grid:`);
    if (strat.grid.length === 0) {
      // If grid is empty, indicate so for clarity (should not happen in this logic)
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

  // --- SELL HANDLING (with STOP-LOSS and MINIMUM HOLD PATCH) ---
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

    // STOP-LOSS and min hold logic...
    const stopLossActive = process.env.STOP_LOSS_MODE === "true";
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

    // 🛡️ SELL GUARD: Block if price <= cost basis unless STOP-LOSS is active
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

    // 🔥 CALCULATE ACTUAL PROFIT before committing to sell
    const slippage = strat.slippage || 0;
    const proceeds =
      Math.round(info.price * sellableAmount * (1 - slippage) * 100) / 100;
    const expectedProfit =
      Math.round((proceeds - lot.price * sellableAmount) * 100) / 100;

    // SELL GUARD: Block if expectedProfit <= 0 (zero or loss) unless STOP-LOSS
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

    // ✅ Now safe to sell
    executeTrade(symbol, "SELL", info.price, sellableAmount, lot); // 🔥 pass `lot`
    // Reduce lot in grid (DO NOT REMOVE LOT, only update amount)
    lot.amount -= sellableAmount;
    if (lot.amount < minHold) {
      lot.amount = minHold;
    }

    // --- FORMATTED GRID OUTPUT ---
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

  // No trade, already logged as HOLD above
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
  seedStrategyGrids();
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

  const interval = setInterval(async () => {
    for (const sym of Object.keys(portfolio.cryptos)) {
      await runStrategyForSymbol(sym);
    }

    // Profit Lock Check: Run once per tick after all symbols
    if (
      typeof selectedStrategy.shouldLockProfit === "function" &&
      typeof selectedStrategy.lockProfit === "function"
    ) {
      if (selectedStrategy.shouldLockProfit(portfolio, config)) {
        selectedStrategy.lockProfit(portfolio, config);
      }
    }
  }, config.checkInterval);

  process.on("SIGINT", async () => {
    clearInterval(interval);
    await printFinalSummary();
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
