// Load environment variables from .env file
require("dotenv").config();
const axios = require("axios");

// ==============================================
// Configuration
// ==============================================
const config = {
  symbol: process.env.CRYPTO_SYMBOL || "BONKUSD",
  aiEnabled: process.env.AI_ENABLED === "true",
  demoMode: true,
  initialBalance: 1000,
  maxTradePercent: 0.5,
  profitLockPercent: 0.2,
  minTradeAmount: 0.01,
  cashReservePercent: 0,
  baseBuyThreshold: -1.5,
  baseSellThreshold: 1.5,
  checkInterval: 30000,
  priceDecimalPlaces: 8,
  maxDailyTrades: 50,
  stopLossPercent: -0.3,
  atrLookbackPeriod: 14,
  gridLevels: 5,
  defaultSlippage: 0.02, // 2% default slippage
  strategy: "Grid-Enhanced Moderate-Moderate Retain Mode v1.1",
};

// Current thresholds (AI-adjusted)
let currentStrategy = {
  buyThreshold: config.baseBuyThreshold,
  sellThreshold: config.baseSellThreshold,
  atr: 0.0000025,
  changes: [],
  trend: "neutral",
  costBasis: null,
  slippage: config.defaultSlippage,
};

// ==============================================
// API Configuration (PowerShell-style)
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
// Portfolio Tracker with Grid System
// ==============================================
let portfolio = {
  cashReserve: config.initialBalance,
  lockedCash: 0,
  crypto: 0,
  lastPrice: null,
  trades: [],
  grid: [],
  dailyTradeCount: 0,
  startingValue: config.initialBalance,
  priceHistory: [], // Track recent prices for fallback analysis
};

// ==============================================
// Core Functions
// ==============================================

/**
 * Formats price with proper decimal places
 */
function formatPrice(price) {
  if (typeof price !== "number" || isNaN(price)) {
    console.error("Invalid price value:", price);
    return "0.00000000";
  }
  return price.toFixed(config.priceDecimalPlaces).replace(/\.?0+$/, "");
}

/**
 * Fetches current market price
 */
async function getPrice() {
  try {
    const response = await axios.get(`${BASE_URL}${config.symbol}/`, {
      headers: HEADERS,
      timeout: 10000,
    });

    if (!response.data || typeof response.data.mark_price === "undefined") {
      throw new Error("Invalid API response structure");
    }

    const price = parseFloat(response.data.mark_price);
    if (isNaN(price)) {
      throw new Error("Price is not a number");
    }

    // Add to price history for fallback analysis
    portfolio.priceHistory.push(price);
    if (portfolio.priceHistory.length > 100) {
      portfolio.priceHistory.shift();
    }

    console.log(`✅ ${config.symbol} Price: $${formatPrice(price)}`);
    return price;
  } catch (error) {
    console.error(`❌ Price fetch failed: ${error.message}`);
    return null;
  }
}

/**
 * Fallback market analysis using recent price data
 */
function performFallbackAnalysis() {
  if (portfolio.priceHistory.length < 10) {
    console.log("ℹ️ Insufficient data for fallback analysis");
    return;
  }

  // Simple moving average
  const sum = portfolio.priceHistory.reduce((a, b) => a + b, 0);
  const sma = sum / portfolio.priceHistory.length;

  // Current price
  const currentPrice =
    portfolio.priceHistory[portfolio.priceHistory.length - 1];

  // Determine trend
  if (currentPrice > sma * 1.03) {
    currentStrategy.trend = "up";
  } else if (currentPrice < sma * 0.97) {
    currentStrategy.trend = "down";
  } else {
    currentStrategy.trend = "neutral";
  }

  console.log(
    `ℹ️ Fallback Analysis: Trend ${currentStrategy.trend.toUpperCase()} (SMA: $${formatPrice(
      sma
    )})`
  );
}

/**
 * AI Market Analysis with fallback
 */
async function analyzeMarket() {
  if (!config.aiEnabled) return;

  try {
    // Use fallback analysis if historical API fails
    performFallbackAnalysis();

    // Adjust thresholds based on trend
    const previousStrategy = { ...currentStrategy };

    if (currentStrategy.trend === "up") {
      currentStrategy.buyThreshold = Math.max(
        -2,
        config.baseBuyThreshold * 0.7
      );
      currentStrategy.sellThreshold = Math.min(
        2,
        config.baseSellThreshold * 1.3
      );
    } else if (currentStrategy.trend === "down") {
      currentStrategy.buyThreshold = Math.max(
        -1,
        config.baseBuyThreshold * 0.5
      );
      currentStrategy.sellThreshold = Math.min(
        1.5,
        config.baseSellThreshold * 0.7
      );
    }

    // Record changes
    if (
      currentStrategy.buyThreshold !== previousStrategy.buyThreshold ||
      currentStrategy.sellThreshold !== previousStrategy.sellThreshold
    ) {
      currentStrategy.changes.push({
        timestamp: new Date(),
        previous: previousStrategy,
        new: { ...currentStrategy },
        reason: `Trend: ${currentStrategy.trend} (Fallback)`,
      });

      console.log(`
      ${"~".repeat(50)}
      🧠 AI UPDATE (FALLBACK)
      ${"-".repeat(50)}
      │ Trend: ${currentStrategy.trend.toUpperCase()}
      │ Buy Threshold: ${previousStrategy.buyThreshold.toFixed(
        2
      )}xATR → ${currentStrategy.buyThreshold.toFixed(2)}xATR
      │ Sell Threshold: ${previousStrategy.sellThreshold.toFixed(
        2
      )}xATR → ${currentStrategy.sellThreshold.toFixed(2)}xATR
      ${"~".repeat(50)}`);
    }
  } catch (error) {
    console.error("AI analysis failed:", error.message);
  }
}

/**
 * Executes trade with grid tracking
 */
function executeTrade(action, price, priceChange) {
  price = typeof price === "number" ? price : parseFloat(price);
  if (isNaN(price)) {
    console.error("Invalid price in executeTrade");
    return;
  }

  // Calculate trade size with slippage
  const maxTradeAmount = portfolio.cashReserve * config.maxTradePercent;
  const amountUSD = Math.min(
    maxTradeAmount,
    Math.max(config.minTradeAmount, maxTradeAmount * 0.75)
  );
  const adjustedPrice =
    action === "buy"
      ? price * (1 + currentStrategy.slippage)
      : price * (1 - currentStrategy.slippage);
  const amount = amountUSD / adjustedPrice;

  if (amount <= 0 || (action === "sell" && portfolio.crypto <= 0)) {
    console.log(
      `⚠️ No ${action}: Insufficient ${action === "buy" ? "cash" : "crypto"}`
    );
    return;
  }

  if (action === "buy") {
    portfolio.cashReserve -= amountUSD;
    portfolio.crypto += amount;
    portfolio.grid.push({
      price: adjustedPrice,
      amount,
      timestamp: new Date(),
    });
    currentStrategy.costBasis =
      portfolio.grid.reduce(
        (sum, entry) => sum + entry.price * entry.amount,
        0
      ) / portfolio.grid.reduce((sum, entry) => sum + entry.amount, 0);
  } else {
    portfolio.grid.sort((a, b) => b.price - a.price);
    let remaining = amount;
    let profit = 0;

    while (remaining > 0 && portfolio.grid.length > 0) {
      const lot = portfolio.grid[0];
      const sellAmount = Math.min(lot.amount, remaining);

      profit += (adjustedPrice - lot.price) * sellAmount;
      lot.amount -= sellAmount;
      remaining -= sellAmount;

      if (lot.amount <= 0) {
        portfolio.grid.shift();
      }
    }

    portfolio.lockedCash += profit * config.profitLockPercent;
    portfolio.cashReserve +=
      amountUSD + profit * (1 - config.profitLockPercent);
    portfolio.crypto -= amount;

    currentStrategy.costBasis =
      portfolio.grid.length > 0
        ? portfolio.grid.reduce(
            (sum, entry) => sum + entry.price * entry.amount,
            0
          ) / portfolio.grid.reduce((sum, entry) => sum + entry.amount, 0)
        : null;
  }

  // Record trade
  const trade = {
    action,
    price: adjustedPrice,
    amount,
    amountUSD,
    priceChange,
    timestamp: new Date(),
    costBasis: currentStrategy.costBasis,
    trend: currentStrategy.trend,
  };
  portfolio.trades.push(trade);
  portfolio.dailyTradeCount++;

  // Calculate total portfolio value
  const totalValue =
    portfolio.cashReserve +
    portfolio.lockedCash +
    portfolio.crypto * (portfolio.lastPrice || 0);

  console.log(`
  ${"=".repeat(50)}
  [${
    config.demoMode ? "DEMO" : "LIVE"
  }] ${action.toUpperCase()} ${amount.toFixed(0)} ${config.symbol}
  @ $${formatPrice(adjustedPrice)} ($${amountUSD.toFixed(2)})
  Δ ${priceChange.toFixed(2)}%
  ${"-".repeat(20)}
  Portfolio Snapshot:
  ├─ Cash Reserve: $${portfolio.cashReserve.toFixed(2)}
  ├─ Locked Profit: $${portfolio.lockedCash.toFixed(2)}
  ├─ ${config.symbol.replace("USD", "")} Holdings: ${portfolio.crypto.toFixed(
    0
  )}
  ├─ Cost Basis: $${
    currentStrategy.costBasis ? formatPrice(currentStrategy.costBasis) : "N/A"
  }
  ├─ Current Trend: ${currentStrategy.trend.toUpperCase()}
  └─ Total Value: $${totalValue.toFixed(2)}
  ${"=".repeat(50)}`);
}

/**
 * Main trading strategy
 */
async function runStrategy() {
  if (portfolio.dailyTradeCount >= config.maxDailyTrades) {
    console.log("⚠️ Daily trade limit reached");
    return;
  }

  await analyzeMarket();
  const price = await getPrice();
  if (!price) return;

  if (portfolio.lastPrice === null) {
    portfolio.lastPrice = price;
    return;
  }

  const priceChange =
    ((price - portfolio.lastPrice) / portfolio.lastPrice) * 100;
  console.log(`📈 Price Change: ${priceChange.toFixed(2)}%`);

  // Grid-aware decision making
  if (currentStrategy.costBasis) {
    const priceRatio = price / currentStrategy.costBasis;
    if (
      priceRatio < 0.95 &&
      priceChange <= currentStrategy.buyThreshold * currentStrategy.atr
    ) {
      executeTrade("buy", price, priceChange);
    } else if (
      priceRatio > 1.05 &&
      priceChange >= currentStrategy.sellThreshold * currentStrategy.atr
    ) {
      executeTrade("sell", price, priceChange);
    }
  } else {
    if (priceChange <= currentStrategy.buyThreshold * currentStrategy.atr) {
      executeTrade("buy", price, priceChange);
    }
  }

  portfolio.lastPrice = price;
}

// ==============================================
// Initialization
// ==============================================
(async () => {
  console.log(`\n🔍 Performing initial analysis...`);
  await analyzeMarket();
  console.log("✅ Initial analysis complete");

  console.log(`
  ${"*".repeat(60)}
  🚀 AutoTradePro Crypto - ${config.strategy}
  ${"-".repeat(60)}
  │ Symbol: ${config.symbol}
  │ Mode: ${config.demoMode ? "DEMO" : "LIVE"}
  │ AI Optimization: ${config.aiEnabled ? "ENABLED" : "DISABLED"}
  ${"-".repeat(60)}
  │ Starting Balance: $${config.initialBalance.toFixed(2)}
  │ Spendable Cash: $${portfolio.cashReserve.toFixed(2)}
  ${"-".repeat(60)}
  │ Trading Parameters:
  │ ├─ Max Trade Size: $${(
    config.initialBalance * config.maxTradePercent
  ).toFixed(2)}
  │ ├─ Profit Lock: ${config.profitLockPercent * 100}%
  │ ├─ Grid Levels: ${config.gridLevels}
  │ └─ Slippage: ${(currentStrategy.slippage * 100).toFixed(2)}%
  ${"*".repeat(60)}`);

  runStrategy();
  const interval = setInterval(runStrategy, config.checkInterval);

  process.on("SIGINT", () => {
    clearInterval(interval);
    const finalValue =
      portfolio.cashReserve +
      portfolio.lockedCash +
      portfolio.crypto * (portfolio.lastPrice || 0);
    const pl = finalValue - config.initialBalance;

    console.log(`
    ${"*".repeat(60)}
    💼 FINAL STRATEGY PERFORMANCE
    ${"-".repeat(60)}
    │ Symbol: ${config.symbol}
    │ Strategy: ${config.strategy}
    ${"-".repeat(60)}
    │ Performance:
    │ ├─ Total Trades: ${portfolio.trades.length}
    │ ├─ Ending Value: $${finalValue.toFixed(2)}
    │ ├─ P/L: ${pl >= 0 ? "+" : ""}$${Math.abs(pl).toFixed(2)} (${(
      (pl / config.initialBalance) *
      100
    ).toFixed(2)}%)
    │ └─ AI Adjustments: ${currentStrategy.changes.length}
    ${"-".repeat(60)}
    │ Portfolio Composition:
    │ ├─ Cash Reserve: $${portfolio.cashReserve.toFixed(2)}
    │ ├─ Locked Profit: $${portfolio.lockedCash.toFixed(2)}
    │ ├─ ${config.symbol.replace(
      "USD",
      ""
    )} Holdings: ${portfolio.crypto.toFixed(0)}
    │ └─ ${config.symbol.replace("USD", "")} Value: $${(
      portfolio.crypto * (portfolio.lastPrice || 0)
    ).toFixed(2)}
    ${"*".repeat(60)}`);
    process.exit(0);
  });
})();
