// testPrice.js - DEMO MODE WITH MANUAL CRYPTO HOLDINGS
// Uses PowerShell-style authentication headers
// Loads holdings from cryptoHoldings.json (no Robinhood live auth)

require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ==============================================
// Configuration (Demo mode + AI strategy logic)
// ==============================================
const config = {
  aiEnabled: process.env.AI_ENABLED === "true",
  demoMode: true, // Force demo mode
  initialBalance: parseFloat(process.env.INITIAL_BALANCE) || 1000,
  maxTradePercent: 0.5,
  profitLockPercent: 0.2,
  minTradeAmount: 0.01,
  cashReservePercent: 0.2,
  baseBuyThreshold: -1.5,
  baseSellThreshold: 1.5,
  checkInterval: 30000,
  priceDecimalPlaces: 8,
  maxDailyTrades: 50,
  stopLossPercent: -0.3,
  atrLookbackPeriod: 14,
  gridLevels: 5,
  defaultSlippage: 0.02,
  strategy: "Grid Demo Strategy v1.7 - Manual Holdings",
};

const BASE_URL = "https://api.robinhood.com/marketdata/forex/quotes/";
const HEADERS = {
  Authorization: `Bearer ${process.env.ROBINHOOD_API_KEY}`,
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PowerShell/7.2.0",
  Accept: "application/json",
  Origin: "https://robinhood.com",
};

// ==============================================
// Portfolio Setup (loaded from cryptoHoldings.json)
// ==============================================
let portfolio = {
  cashReserve: config.initialBalance,
  lockedCash: 0,
  cryptos: {},
  dailyTradeCount: 0,
};

let strategies = {}; // per-symbol strategy tracking

function formatPrice(price) {
  return parseFloat(price).toFixed(config.priceDecimalPlaces);
}

function initializeStrategy() {
  return {
    buyThreshold: config.baseBuyThreshold,
    sellThreshold: config.baseSellThreshold,
    atr: 0.0000025,
    trend: "neutral",
    slippage: config.defaultSlippage,
    priceHistory: [],
    lastPrice: null,
  };
}

// Load manual holdings from local JSON file
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
        costBasis: null, // will be calculated after buys
      };
      strategies[symbol] = initializeStrategy();
    }
  }

  console.log(
    "🧪 DEMO MODE Portfolio Loaded:",
    Object.entries(data)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" | ")
  );
}

// Price fetch using PowerShell headers
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

function analyzeMarket(symbol) {
  const strategy = strategies[symbol];
  const prices = strategy.priceHistory;
  if (prices.length < 10) return (strategy.trend = "neutral");

  const sma = prices.reduce((a, b) => a + b, 0) / prices.length;
  const current = prices[prices.length - 1];

  if (current > sma * 1.03) strategy.trend = "up";
  else if (current < sma * 0.97) strategy.trend = "down";
  else strategy.trend = "neutral";

  if (config.aiEnabled) {
    if (strategy.trend === "up") {
      strategy.buyThreshold = Math.max(-2, config.baseBuyThreshold * 0.7);
      strategy.sellThreshold = Math.min(2, config.baseSellThreshold * 1.3);
    } else if (strategy.trend === "down") {
      strategy.buyThreshold = Math.max(-1, config.baseBuyThreshold * 0.5);
      strategy.sellThreshold = Math.min(1.5, config.baseSellThreshold * 0.7);
    }
  }
}

function executeTrade(symbol, action, price) {
  const crypto = portfolio.cryptos[symbol];
  const strategy = strategies[symbol];
  const cryptoCount = Object.keys(portfolio.cryptos).length;

  // Trade cap per symbol: cashReserve ÷ cryptos × maxTradePercent
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

async function runStrategyForSymbol(symbol) {
  if (portfolio.dailyTradeCount >= config.maxDailyTrades) return;
  const price = await getPrice(symbol);
  if (!price) return;
  analyzeMarket(symbol);
  const strategy = strategies[symbol];
  if (strategy.priceHistory.length < 2) return;

  const prev = strategy.priceHistory[strategy.priceHistory.length - 2];
  const delta = ((price - prev) / prev) * 100;
  const ratio = portfolio.cryptos[symbol].costBasis
    ? price / portfolio.cryptos[symbol].costBasis
    : 1;

  if (ratio < 0.95 && delta <= strategy.buyThreshold * strategy.atr)
    return executeTrade(symbol, "buy", price);
  if (ratio > 1.05 && delta >= strategy.sellThreshold * strategy.atr)
    return executeTrade(symbol, "sell", price);
}

// ==============================================
// Initialization
// ==============================================
(async () => {
  loadHoldings();

  console.log(`\n🚀 ${config.strategy}`);
  console.log(`Symbol(s): ${Object.keys(portfolio.cryptos).join(", ")}`);

  const interval = setInterval(async () => {
    if (portfolio.dailyTradeCount >= config.maxDailyTrades)
      return clearInterval(interval);
    for (const symbol in portfolio.cryptos) await runStrategyForSymbol(symbol);
  }, config.checkInterval);

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
