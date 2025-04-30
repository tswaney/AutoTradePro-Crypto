// testPrice.js - Grid Bot with Strategy Selection and Manual Holdings
// Uses PowerShell-style headers, AI optimization, and CLI strategy selection

require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

// ==============================================
// Configuration
// ==============================================
const config = {
  aiEnabled: process.env.AI_ENABLED === "true",
  demoMode: true, // Only supports demo trading currently
  initialBalance: parseFloat(process.env.INITIAL_BALANCE) || 1000,
  maxTradePercent: 0.5,
  profitLockPercent: 0.2,
  minTradeAmount: 0.01,
  cashReservePercent: 0.15,
  baseBuyThreshold: -0.5,
  baseSellThreshold: 0.5,
  checkInterval: 30000,
  priceDecimalPlaces: 8,
  maxDailyTrades: 50,
  stopLossPercent: -0.3,
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

// ==============================================
// Portfolio State
// ==============================================
let portfolio = {
  cashReserve: config.initialBalance,
  lockedCash: 0,
  cryptos: {}, // Each symbol gets amount, grid, and costBasis
  dailyTradeCount: 0,
};
let strategies = {}; // Per-symbol strategy state
let selectedStrategy = null; // Chosen strategy module

// Format prices to n decimals
function formatPrice(price) {
  return parseFloat(price).toFixed(config.priceDecimalPlaces);
}

// Initializes strategy structure per crypto symbol
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

// Loads crypto amounts from local json file
function loadHoldings() {
  const data = JSON.parse(
    fs.readFileSync(path.join(__dirname, "cryptoHoldings.json"), "utf-8")
  );
  for (const symbol in data) {
    const amount = parseFloat(data[symbol]);
    if (amount > 0) {
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

// Fetches current price from Robinhood quote endpoint
async function getPrice(symbol) {
  try {
    const response = await axios.get(`${BASE_URL}${symbol}/`, {
      headers: HEADERS,
      timeout: 10000,
    });
    const price = parseFloat(response.data.mark_price);
    strategies[symbol].priceHistory.push(price);
    if (strategies[symbol].priceHistory.length > 100)
      strategies[symbol].priceHistory.shift();
    strategies[symbol].lastPrice = price;
    console.log(`✅ ${symbol} Price: $${formatPrice(price)}`);
    return price;
  } catch (error) {
    console.error(`❌ Price fetch failed for ${symbol}:`, error.message);
    return strategies[symbol]?.lastPrice;
  }
}

// Executes trade using grid logic
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

  portfolio.dailyTradeCount++;
  console.log(
    `[${
      config.demoMode ? "DEMO" : "LIVE"
    }] ${action.toUpperCase()} ${amount.toFixed(4)} ${symbol} @ $${formatPrice(
      adjusted
    )}`
  );
}

// Executes one cycle of strategy for a symbol
async function runStrategyForSymbol(symbol) {
  if (portfolio.dailyTradeCount >= config.maxDailyTrades) return;
  const price = await getPrice(symbol);
  if (!price) return;

  const strat = strategies[symbol];
  strat.module.updateStrategyState(symbol, strat);

  const trade = strat.module.getTradeDecision({
    price,
    lastPrice: strat.lastPrice,
    costBasis: portfolio.cryptos[symbol].costBasis,
    strategyState: strat,
    config,
  });

  if (trade?.action) executeTrade(symbol, trade.action, price);
}

// Lists available strategy modules and prompts user to choose one
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
      const index = parseInt(input.trim());
      const strat =
        modules[index > 0 && index <= modules.length ? index - 1 : 0];
      rl.close();
      config.strategy = `${strat.name} (${strat.version})`;
      selectedStrategy = strat;
      resolve();
    });
  });
}

// ==============================================
// MAIN EXECUTION
// ==============================================
(async () => {
  await promptStrategySelection(); // CLI prompt to pick strategy
  loadHoldings(); // Load holdings from file

  // Apply strategy to each crypto
  for (const symbol in portfolio.cryptos) {
    strategies[symbol] = initializeStrategy(symbol);
  }

  console.log(`\n🚀 ${config.strategy}`);
  console.log(`Symbol(s): ${Object.keys(portfolio.cryptos).join(", ")}`);

  // Repeats trading loop every X seconds
  const interval = setInterval(async () => {
    if (portfolio.dailyTradeCount >= config.maxDailyTrades)
      return clearInterval(interval);
    for (const symbol in portfolio.cryptos) await runStrategyForSymbol(symbol);
  }, config.checkInterval);

  // Graceful shutdown with performance summary
  process.on("SIGINT", () => {
    clearInterval(interval);
    let total = portfolio.cashReserve + portfolio.lockedCash;
    for (const symbol in portfolio.cryptos) {
      total +=
        portfolio.cryptos[symbol].amount * (strategies[symbol].lastPrice || 0);
    }
    console.log(
      `\n💼 FINAL VALUE: $${total.toFixed(2)} | Trades: ${
        portfolio.dailyTradeCount
      }`
    );
    process.exit(0);
  });
})();
