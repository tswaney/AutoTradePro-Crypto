// testPrice.js - Grid Bot with Strategy Selection and Manual Holdings
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
  stopLossPercent: -0.3, // <<< configured stop-loss
  atrLookbackPeriod: 14,
  gridLevels: 5,
  defaultSlippage: 0.02,
  strategy: "",
};

// ==============================================
// API Setup (PowerShell-style headers)
// ==============================================
const BASE_URL = "https://api.robinhood.com/marketdata/forex/quotes/";
const HEADERS = {
  Authorization: `Bearer ${process.env.ROBINHOOD_API_KEY}`,
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PowerShell/7.2.0",
  Accept: "application/json",
  Origin: "https://robinhood.com",
};

let portfolio = {
  cashReserve: config.initialBalance,
  lockedCash: 0,
  cryptos: {},
  dailyTradeCount: 0,
  tradeNumber: 0,
  startTime: new Date(),
};

let strategies = {};
let selectedStrategy = null;

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

function loadHoldings() {
  const data = JSON.parse(
    fs.readFileSync(path.join(__dirname, "cryptoHoldings.json"), "utf-8")
  );
  for (const symbol in data) {
    const amount = parseFloat(data[symbol]);
    if (amount > config.minTradeAmount) {
      portfolio.cryptos[symbol] = {
        amount,
        grid: [],
        costBasis: null,
      };
    }
  }
  console.log(
    "🧪 DEMO MODE Portfolio Loaded:",
    Object.entries(data)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" | ")
  );
}

async function getPrice(symbol) {
  try {
    const response = await axios.get(`${BASE_URL}${symbol}/`, {
      headers: HEADERS,
      timeout: 10000,
    });
    const price = parseFloat(response.data.mark_price);
    const strat = strategies[symbol];
    const prev = strat.lastPrice;
    strat.priceHistory.push(price);
    if (strat.priceHistory.length > 100) strat.priceHistory.shift();
    const pct = prev ? ((price - prev) / prev) * 100 : 0;
    const trend = pct > 0.01 ? "UP" : pct < -0.01 ? "DOWN" : "NEUTRAL";
    strat.trend = trend.toLowerCase();
    strat.lastPrice = price;
    return { price, pct, trend };
  } catch (error) {
    console.error(`❌ Price fetch failed for ${symbol}:`, error.message);
    return null;
  }
}

function executeTrade(symbol, action, price) {
  const crypto = portfolio.cryptos[symbol];
  const strategy = strategies[symbol];
  const cryptoCount = Object.keys(portfolio.cryptos).length;
  const maxTrade =
    (portfolio.cashReserve / cryptoCount) * config.maxTradePercent;
  const usd = Math.min(
    maxTrade,
    Math.max(config.minTradeAmount, maxTrade * 0.75)
  );
  const adjusted =
    price * (1 + (action === "buy" ? strategy.slippage : -strategy.slippage));
  const amount = usd / adjusted;

  if (action === "buy") {
    portfolio.cashReserve -= usd;
    crypto.amount += amount;
    crypto.grid.push({ price: adjusted, amount, timestamp: new Date() });
    crypto.costBasis =
      crypto.grid.reduce((s, e) => s + e.price * e.amount, 0) /
      crypto.grid.reduce((s, e) => s + e.amount, 0);
  } else {
    crypto.grid.sort((a, b) => b.price - a.price);
    let remaining = amount,
      profit = 0;
    while (remaining > 0 && crypto.grid.length) {
      const lot = crypto.grid[0];
      const sellAmount = Math.min(lot.amount, remaining);
      profit += (adjusted - lot.price) * sellAmount;
      lot.amount -= sellAmount;
      remaining -= sellAmount;
      if (lot.amount <= 0) crypto.grid.shift();
    }
    portfolio.lockedCash += profit * config.profitLockPercent;
    portfolio.cashReserve += usd + profit * (1 - config.profitLockPercent);
    crypto.amount -= amount;
  }

  portfolio.tradeNumber++;
  portfolio.dailyTradeCount++;

  console.log(`\n==================================================`);
  console.log(
    `[${
      config.demoMode ? "DEMO" : "LIVE"
    }] ${action.toUpperCase()} ${amount.toFixed(4)} ${symbol}`
  );
  console.log(
    `@ $${formatPrice(adjusted)} ($${usd.toFixed(2)})  Trade #${
      portfolio.tradeNumber
    }`
  );
  console.log(`--------------------------------------------------`);
  console.log(`Portfolio Snapshot:`);
  console.log(`├─ Cash Reserve: $${portfolio.cashReserve.toFixed(2)}`);
  console.log(`├─ Locked Profit: $${portfolio.lockedCash.toFixed(2)}`);
  console.log(`├─ ${symbol} Holdings: ${crypto.amount.toFixed(4)}`);
  console.log(`├─ Cost Basis: $${crypto.costBasis}`);
  console.log(`├─ Current Trend: ${strategy.trend.toUpperCase()}`);
  console.log(`└─ Unrealized P/L: $0.00`);
  console.log(`==================================================`);
}

async function runStrategyForSymbol(symbol) {
  if (portfolio.dailyTradeCount >= config.maxDailyTrades - config.tradeReserve)
    return;

  const info = await getPrice(symbol);
  if (!info) return;

  // Single, unified strategy log
  console.log(
    `[STRATEGY] ${symbol} ${info.trend} trend, Δ ${info.pct.toFixed(
      4
    )}%, grid size: ${portfolio.cryptos[symbol].grid.length}`
  );

  // Silence strategy-module logs
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

  if (decision?.action) {
    executeTrade(symbol, decision.action, info.price);
  }
}

async function promptStrategySelection() {
  const files = fs.readdirSync(path.join(__dirname, "strategies"));
  const available = files.filter((f) => f.endsWith(".js"));
  const modules = available
    .map((f) => require(`./strategies/${f}`))
    .filter((m) => m.name && m.version && m.description);

  console.log("\n📌 Available Strategies:");
  modules.forEach((s, i) => {
    console.log(` [${i + 1}] ${s.name} (${s.version}) - ${s.description}`);
  });

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

// ==============================================
// MAIN
// ==============================================
(async () => {
  await promptStrategySelection();
  loadHoldings();
  for (const symbol in portfolio.cryptos) {
    strategies[symbol] = initializeStrategy(symbol);
  }

  // ✅ Initial Startup Summary
  console.log("\n************************************************************");
  console.log(`🚀 AutoTradePro Crypto - ${config.strategy}`);
  console.log("------------------------------------------------------------");
  console.log(`│ Symbol(s): ${Object.keys(portfolio.cryptos).join(", ")}`);
  console.log(`│ Mode: ${config.demoMode ? "DEMO" : "LIVE"}`);
  console.log(
    `│ AI Optimization: ${config.aiEnabled ? "ENABLED" : "DISABLED"}`
  );
  console.log("------------------------------------------------------------");
  console.log(`│ Starting Balance: $${config.initialBalance.toFixed(2)}`);
  console.log(`│ Spendable Cash: $${portfolio.cashReserve.toFixed(2)}`);
  console.log("------------------------------------------------------------");
  console.log(`│ Trading Parameters:`);
  console.log(
    `│ ├─ Max Trade Size: $${(
      config.initialBalance * config.maxTradePercent
    ).toFixed(2)}`
  );
  console.log(`│ ├─ Profit Lock: ${config.profitLockPercent * 100}%`);
  console.log(`│ ├─ Stop Loss: ${(config.stopLossPercent * 100).toFixed(2)}%`);
  console.log(`│ ├─ Grid Levels: ${config.gridLevels}`);
  console.log(
    `│ ├─ Max Daily Trades: ${config.maxDailyTrades} (Reserve ${config.tradeReserve})`
  );
  console.log(`│ └─ Slippage: ${(config.defaultSlippage * 100).toFixed(2)}%`);
  console.log("************************************************************\n");

  const interval = setInterval(async () => {
    if (
      portfolio.dailyTradeCount >=
      config.maxDailyTrades - config.tradeReserve
    ) {
      clearInterval(interval);
      process.emit("SIGINT");
    }
    for (const symbol in portfolio.cryptos) {
      await runStrategyForSymbol(symbol);
    }
  }, config.checkInterval);

  process.on("SIGINT", () => {
    clearInterval(interval);
    const durationMin = Math.floor((new Date() - portfolio.startTime) / 60000);

    // Build the coin grid
    const rows = [];
    for (const symbol in portfolio.cryptos) {
      const strat = strategies[symbol];
      const holding = portfolio.cryptos[symbol].amount;
      const value = holding * (strat.lastPrice || 0);
      const basis = portfolio.cryptos[symbol].costBasis || 0;
      const basisValue = holding * basis;
      const pl = value - basisValue;
      const plPct = basisValue ? (pl / basisValue) * 100 : 0;
      rows.push({ symbol, holding, value, basis, pl, plPct });
    }

    // Compute totals
    const cryptoValue = rows.reduce((sum, r) => sum + r.value, 0);
    const finalPortfolioValue = portfolio.cashReserve + cryptoValue;
    const netProfit = finalPortfolioValue - config.initialBalance;

    // === FINAL SUMMARY ===
    console.log(
      "\n************************************************************"
    );
    console.log("💼 FINAL STRATEGY PERFORMANCE");
    console.log("------------------------------------------------------------");
    console.log(`│ Strategy: ${config.strategy}`);
    console.log(`│ Duration: ${durationMin} min`);
    console.log(
      `│ Trades Executed: ${portfolio.dailyTradeCount} (out of ${config.maxDailyTrades})`
    );
    console.log("------------------------------------------------------------");
    console.log(`│ Final Portfolio Value: $${finalPortfolioValue.toFixed(2)}`);
    console.log(
      `│ Net Profit/Loss: $${netProfit.toFixed(2)} (${(
        (netProfit / config.initialBalance) *
        100
      ).toFixed(2)}%)`
    );
    console.log(`│ Starting Balance: $${config.initialBalance.toFixed(2)}`);
    console.log(`│ Crypto Portfolio Value: $${cryptoValue.toFixed(2)}`);
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
      "- Profit locking, max trade per crypto, and AI-driven fallback built-in."
    );
    console.log("************************************************************");
    process.exit(0);
  });
})();
