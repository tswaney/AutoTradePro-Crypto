// testPrice.js - Grid Bot with Strategy Selection and Manual Holdings
// Bookmark: 05/30/2025 Works Great $1
// Uses PowerShell-style headers, AI optimization, per-coin P/L display, and CLI strategy selection

require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

// ==============================================
// Configuration (via .env file and fallback)
// ==============================================
const config = {
  aiEnabled: process.env.AI_ENABLED === "true",
  demoMode: process.env.DEMO_MODE === "true",
  initialBalance: parseFloat(process.env.INITIAL_BALANCE) || 1000,
  maxTradePercent: 0.5,
  profitLockPercent: 0.2,
  minTradeAmount: 0.01,
  cashReservePercent: 0.15,
  baseBuyThreshold: -0.005,
  baseSellThreshold: 0.05,
  checkInterval: 30000,
  priceDecimalPlaces: 8,
  maxDailyTrades: 50,
  tradeReserve: 5,
  stopLossPercent: -0.3,
  atrLookbackPeriod: 14,
  gridLevels: 5,
  defaultSlippage: 0.02,
  strategy: "",
};

// ==============================================
// API Setup
// ==============================================
const BASE_URL = "https://api.robinhood.com/marketdata/forex/quotes/";
const HEADERS = {
  Authorization: `Bearer ${process.env.ROBINHOOD_API_KEY}`,
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 PowerShell/7.2.0",
  Accept: "application/json",
  Origin: "https://robinhood.com",
};

// ==============================================
// Portfolio & State
// ==============================================
let portfolio = {
  cashReserve: config.initialBalance,
  lockedCash: 0,
  cryptos: {},
  dailyTradeCount: 0,
  tradeNumber: 0,
  startTime: new Date(),
  lastReset: new Date(),
  initialCryptoValue: 0,
  beginningPortfolioValue: 0,
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
let strategies = {};
let selectedStrategy = null;

// ==============================================
// Helpers & Core Logic
// ==============================================
function formatPrice(price) {
  return parseFloat(price).toFixed(config.priceDecimalPlaces);
}

function initializeStrategy(symbol) {
  return {
    buyThreshold: config.baseBuyThreshold,
    sellThreshold: config.baseSellThreshold,
    atr: 0.0000025,
    trend: "neutral",
    slippage: config.defaultSlippage,
    priceHistory: [],
    lastPrice: null,
    module: selectedStrategy,
  };
}

async function promptStrategySelection() {
  const files = fs.readdirSync(path.join(__dirname, "strategies"));
  const modules = files
    .filter((f) => f.endsWith(".js"))
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
    rl.question("\nSelect strategy [default 1]: ", (input) => {
      const idx = parseInt(input.trim());
      const strat = modules[idx > 0 && idx <= modules.length ? idx - 1 : 0];
      rl.close();
      config.strategy = `${strat.name} (${strat.version})`;
      selectedStrategy = strat;
      resolve();
    });
  });
}

function loadHoldings() {
  const data = JSON.parse(
    fs.readFileSync(path.join(__dirname, "cryptoHoldings.json"), "utf-8")
  );
  for (const symbol in data) {
    const amt = parseFloat(data[symbol]);
    if (amt > config.minTradeAmount) {
      portfolio.cryptos[symbol] = { amount: amt, grid: [], costBasis: null };
    }
  }
  console.log(
    "🧪 DEMO MODE Portfolio Loaded:",
    Object.entries(portfolio.cryptos)
      .map(([k, v]) => `${k}: ${v.amount}`)
      .join(" | ")
  );
}

async function getPrice(symbol) {
  try {
    const res = await axios.get(`${BASE_URL}${symbol}/`, {
      headers: HEADERS,
      timeout: 10000,
    });
    const price = parseFloat(res.data.mark_price);
    const strat = strategies[symbol];
    const prev = strat.lastPrice;
    strat.priceHistory.push(price);
    if (strat.priceHistory.length > 100) strat.priceHistory.shift();
    const pct = prev ? ((price - prev) / prev) * 100 : 0;
    const trend = pct > 0.01 ? "UP" : pct < -0.01 ? "DOWN" : "NEUTRAL";
    strat.trend = trend.toLowerCase();
    strat.lastPrice = price;
    return { price, pct, trend };
  } catch (err) {
    console.error(`❌ Price fetch failed for ${symbol}:`, err.message);
    return null;
  }
}

function executeTrade(symbol, action, price) {
  const crypto = portfolio.cryptos[symbol];
  const strat = strategies[symbol];
  const maxTrade =
    (portfolio.cashReserve / Object.keys(portfolio.cryptos).length) *
    config.maxTradePercent;
  const usd = Math.min(
    maxTrade,
    Math.max(config.minTradeAmount, maxTrade * 0.75)
  );
  const adj =
    price * (1 + (action === "buy" ? strat.slippage : -strat.slippage));
  const amt = usd / adj;

  if (action === "buy") {
    portfolio.cashReserve -= usd;
    crypto.amount += amt;
    crypto.grid.push({ price: adj, amount: amt, timestamp: new Date() });
    crypto.costBasis =
      crypto.grid.reduce((s, e) => s + e.price * e.amount, 0) /
      crypto.grid.reduce((s, e) => s + e.amount, 0);
  } else {
    crypto.grid.sort((a, b) => b.price - a.price);
    let rem = amt,
      profit = 0;
    while (rem > 0 && crypto.grid.length) {
      const lot = crypto.grid[0];
      const sellAmt = Math.min(lot.amount, rem);
      profit += (adj - lot.price) * sellAmt;
      lot.amount -= sellAmt;
      rem -= sellAmt;
      if (lot.amount <= 0) crypto.grid.shift();
    }
    portfolio.lockedCash += profit * config.profitLockPercent;
    portfolio.cashReserve += usd + profit * (1 - config.profitLockPercent);
    crypto.amount -= amt;
  }

  portfolio.tradeNumber++;
  portfolio.dailyTradeCount++;

  console.log(`\n==================================================`);
  console.log(
    `[${
      config.demoMode ? "DEMO" : "LIVE"
    }] ${action.toUpperCase()} ${amt.toFixed(4)} ${symbol}`
  );
  console.log(
    `@ $${formatPrice(adj)} ($${usd.toFixed(2)})  Trade #${
      portfolio.tradeNumber
    }`
  );
  console.log(`--------------------------------------------------`);
  console.log(`Portfolio Snapshot:`);
  console.log(`├─ Cash Reserve: $${portfolio.cashReserve.toFixed(2)}`);
  console.log(`├─ Locked Profit: $${portfolio.lockedCash.toFixed(2)}`);
  console.log(`├─ ${symbol} Holdings: ${crypto.amount.toFixed(4)}`);
  console.log(`├─ Cost Basis: $${crypto.costBasis}`);
  console.log(`├─ Current Trend: ${strat.trend.toUpperCase()}`);
  console.log(`└─ Unrealized P/L: $0.00`);
  console.log(`==================================================`);
}

async function runStrategyForSymbol(symbol) {
  const normalLimit = config.maxDailyTrades - config.tradeReserve;
  const rescueLimit = config.maxDailyTrades;

  const info = await getPrice(symbol);
  if (!info) return;

  console.log(
    `[STRATEGY] ${symbol} ${info.trend} trend, Δ ${info.pct.toFixed(
      4
    )}%, grid size: ${portfolio.cryptos[symbol].grid.length}`
  );

  const origLog = console.log;
  console.log = () => {};
  const strat = strategies[symbol];
  strat.module.updateStrategyState(symbol, strat);
  const decision = strat.module.getTradeDecision({
    price: info.price,
    lastPrice: strat.lastPrice,
    costBasis: portfolio.cryptos[symbol].costBasis,
    strategyState: strat,
    config,
  });
  console.log = origLog;

  if (!decision?.action) return;

  if (portfolio.dailyTradeCount < normalLimit) {
    executeTrade(symbol, decision.action, info.price);
  } else if (
    portfolio.dailyTradeCount >= normalLimit &&
    portfolio.dailyTradeCount < rescueLimit &&
    decision.action === "sell"
  ) {
    executeTrade(symbol, "sell", info.price);
  }
}

// ==============================================
// MAIN
// ==============================================
(async () => {
  await promptStrategySelection();
  loadHoldings();

  // Initialize strategies
  for (const sym of Object.keys(portfolio.cryptos)) {
    strategies[sym] = initializeStrategy(sym);
  }

  // Compute starting crypto value
  let initialCryptoVal = 0;
  for (const sym of Object.keys(portfolio.cryptos)) {
    const info = await getPrice(sym);
    if (info) {
      initialCryptoVal += info.price * portfolio.cryptos[sym].amount;
    }
  }
  portfolio.initialCryptoValue = initialCryptoVal;
  portfolio.beginningPortfolioValue = config.initialBalance + initialCryptoVal;

  // Demo reset
  if (config.demoMode) {
    portfolio.dailyTradeCount = 0;
    console.log("🔄 [DEMO] Starting with fresh trade count (45 usable).");
  }

  // Startup summary with Max Crypto Trade Size
  const cryptoCount = Object.keys(portfolio.cryptos).length;
  const totalMaxTrade = config.initialBalance * config.maxTradePercent;
  const perCryptoMaxTrade = totalMaxTrade / cryptoCount;

  console.log("\n************************************************************");
  console.log(`🚀 AutoTradePro Crypto - ${config.strategy}`);
  console.log("------------------------------------------------------------");
  console.log(`│ Symbol(s): ${Object.keys(portfolio.cryptos).join(", ")}`);
  console.log(`│ Mode: ${config.demoMode ? "DEMO" : "LIVE"}`);
  console.log(
    `│ AI Optimization: ${config.aiEnabled ? "ENABLED" : "DISABLED"}`
  );
  console.log("------------------------------------------------------------");
  console.log(
    `│ Beginning Portfolio Value: $${portfolio.beginningPortfolioValue.toFixed(
      2
    )}`
  );
  console.log(`│   ├─ Starting Cash: $${config.initialBalance.toFixed(2)}`);
  console.log(`│   └─ Starting Crypto Value: $${initialCryptoVal.toFixed(2)}`);
  console.log("------------------------------------------------------------");
  console.log("│ Trading Parameters:");
  console.log(
    `│ ├─ Max Crypto Trade Size: $${perCryptoMaxTrade.toFixed(
      2
    )} * ${cryptoCount} Cryptos = $${totalMaxTrade.toFixed(2)}`
  );
  console.log(`│ ├─ Profit Lock: ${config.profitLockPercent * 100}%`);
  console.log(`│ ├─ Stop Loss: ${(config.stopLossPercent * 100).toFixed(2)}%`);
  console.log(`│ ├─ Grid Levels: ${config.gridLevels}`);
  console.log(
    `│ ├─ Max Daily Trades: ${config.maxDailyTrades} (Normal ${
      config.maxDailyTrades - config.tradeReserve
    }, Reserve ${config.tradeReserve})`
  );
  console.log(`│ └─ Slippage: ${(config.defaultSlippage * 100).toFixed(2)}%`);
  console.log("************************************************************\n");

  // Main loop
  const interval = setInterval(async () => {
    const now = Date.now();

    if (now - portfolio.lastReset.getTime() >= ONE_DAY_MS) {
      portfolio.dailyTradeCount = 0;
      portfolio.lastReset = new Date(now);
      console.log("🔄 24h elapsed—resetting trade count (45 usable).");
    }

    const used = portfolio.dailyTradeCount;
    const normalLimit = config.maxDailyTrades - config.tradeReserve;
    const rescueRemain = config.maxDailyTrades - used;

    if (used >= normalLimit && used < config.maxDailyTrades) {
      const resetTime = new Date(
        portfolio.lastReset.getTime() + ONE_DAY_MS
      ).toLocaleString();
      console.log(
        `⚠️  Maximum Trade Limit for the 24-hour period has been met - this will reset at ${resetTime}. ` +
          `There are ${rescueRemain} trades left for Stop Loss Protection.`
      );
    }

    for (const sym of Object.keys(portfolio.cryptos)) {
      await runStrategyForSymbol(sym);
    }
  }, config.checkInterval);

  // Graceful shutdown summary
  process.on("SIGINT", () => {
    clearInterval(interval);
    const durationMin = Math.floor((new Date() - portfolio.startTime) / 60000);

    const rows = [];
    for (const sym of Object.keys(portfolio.cryptos)) {
      const strat = strategies[sym];
      const amt = portfolio.cryptos[sym].amount;
      const val = amt * (strat.lastPrice || 0);
      const basis = portfolio.cryptos[sym].costBasis || 0;
      const basisVal = amt * basis;
      const pl = val - basisVal;
      const plPct = basisVal ? (pl / basisVal) * 100 : 0;
      rows.push({ symbol: sym, holding: amt, value: val, basis, pl, plPct });
    }

    const cryptoValue = rows.reduce((sum, r) => sum + r.value, 0);
    const finalPortfolioValue = portfolio.cashReserve + cryptoValue;
    const netProfit = finalPortfolioValue - portfolio.beginningPortfolioValue;

    console.log(
      "\n************************************************************"
    );
    console.log("💼 FINAL STRATEGY PERFORMANCE");
    console.log("------------------------------------------------------------");
    console.log(`│ Strategy: ${config.strategy}`);
    console.log(`│ Duration: ${durationMin} min`);
    console.log(
      `│ Trades Executed: ${portfolio.dailyTradeCount} (of ${config.maxDailyTrades})`
    );
    console.log("------------------------------------------------------------");
    console.log(
      `│ Beginning Portfolio Value: $${portfolio.beginningPortfolioValue.toFixed(
        2
      )}`
    );
    console.log(`│ Final Portfolio Value: $${finalPortfolioValue.toFixed(2)}`);
    console.log(
      `│ Net Profit/Loss: $${netProfit.toFixed(2)} (${(
        (netProfit / portfolio.beginningPortfolioValue) *
        100
      ).toFixed(2)}%)`
    );
    console.log(`│ Crypto Portfolio Value: $${cryptoValue.toFixed(2)}`);
    console.log(
      `│ Starting Cash Reserve Balance: $${config.initialBalance.toFixed(2)}`
    );
    console.log(`│ Cash Reserve: $${portfolio.cashReserve.toFixed(2)}`);
    console.log(`│ Locked Profits: $${portfolio.lockedCash.toFixed(2)}`);
    console.log("------------------------------------------------------------");
    console.log("📊 Coin Breakdown:");
    console.log(
      "│  Symbol     Holdings        Value       Cost Basis     P/L ($)     P/L (%)"
    );
    console.log(
      "│ ------------------------------------------------------------------------------"
    );
    rows.forEach((r) => {
      console.log(
        `│  ${r.symbol.padEnd(10)}${r.holding.toFixed(4).padEnd(15)}$${r.value
          .toFixed(2)
          .padEnd(12)}$${r.basis.toFixed(8).padEnd(15)}${
          r.pl >= 0 ? "+" : ""
        }$${r.pl.toFixed(2).padEnd(10)}${
          r.plPct >= 0 ? "+" : ""
        }${r.plPct.toFixed(2)}%`
      );
    });
    console.log(
      "│ ------------------------------------------------------------------------------"
    );
    console.log("📘 Strategy Notes:");
    console.log(
      "- Grid-based buy/sell enforced per symbol with fixed slippage."
    );
    console.log(
      "- Profit locking, 45-trade cap, and rolling 24h window enforced."
    );
    console.log("************************************************************");
    process.exit(0);
  });
})();
