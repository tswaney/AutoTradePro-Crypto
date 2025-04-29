// Load environment variables from .env file
require("dotenv").config();
const axios = require("axios");

// ==============================================
// Configuration
// ==============================================
const config = {
  symbol: process.env.CRYPTO_SYMBOL || "BTCUSD",
  aiEnabled: process.env.AI_ENABLED === "true",
  demoMode: true,
  initialBalance: 1000,
  maxTradePercent: 0.5,
  profitLockPercent: 0.2,
  minTradeAmount: 0.01,
  cashReservePercent: 0.15,
  baseBuyThreshold: -0.1,
  baseSellThreshold: 0.3,
  checkInterval: 30000,
  priceDecimalPlaces: 8,
  maxDailyTrades: 50,
  stopLossPercent: -0.3,
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
// Portfolio Tracker
// ==============================================
let portfolio = {
  cashReserve: config.initialBalance * (1 - config.cashReservePercent),
  lockedCash: 0,
  crypto: 0,
  lastPrice: null,
  trades: [],
  atr: 0.0000025,
  dailyTradeCount: 0,
  startingValue: config.initialBalance,
  lastStopLossCheck: null,
};

// ==============================================
// Core Functions (Fixed Price Handling)
// ==============================================

/**
 * Safely formats price with proper decimals
 */
function formatPrice(price) {
  if (typeof price !== "number" || isNaN(price)) {
    console.error("Invalid price value:", price);
    return "0.00000000";
  }
  return price.toFixed(config.priceDecimalPlaces).replace(/\.?0+$/, "");
}

/**
 * Robust price fetcher with error handling
 */
async function getPrice() {
  try {
    const response = await axios.get(`${BASE_URL}${config.symbol}/`, {
      headers: HEADERS,
      timeout: 10000,
    });

    // Validate response structure
    if (!response.data || typeof response.data.mark_price === "undefined") {
      throw new Error("Invalid API response structure");
    }

    const price = parseFloat(response.data.mark_price);
    if (isNaN(price)) {
      throw new Error("Price is not a number");
    }

    console.log(`✅ ${config.symbol} Price: $${formatPrice(price)}`);
    return price;
  } catch (error) {
    console.error(`❌ Price fetch failed: ${error.message}`);
    return null;
  }
}

/**
 * Executes trade with safety checks
 */
function executeTrade(action, price, priceChange) {
  // Convert price to number if it isn't already
  price = typeof price === "number" ? price : parseFloat(price);
  if (isNaN(price)) {
    console.error("Invalid price in executeTrade");
    return;
  }

  // Calculate trade size (safety-constrained)
  const maxTradeAmount = portfolio.cashReserve * config.maxTradePercent;
  const amountUSD = Math.min(
    maxTradeAmount,
    Math.max(config.minTradeAmount, maxTradeAmount * 0.75)
  );
  const amount = amountUSD / price;

  // Validate trade
  if (amount <= 0 || (action === "sell" && portfolio.crypto <= 0)) {
    console.log(
      `⚠️ No ${action}: Insufficient ${action === "buy" ? "cash" : "crypto"}`
    );
    return;
  }

  // Execute trade
  if (action === "buy") {
    portfolio.cashReserve -= amountUSD;
    portfolio.crypto += amount;
  } else {
    const profit = amount * price - amount * portfolio.lastPrice;
    portfolio.lockedCash += profit * config.profitLockPercent;
    portfolio.cashReserve +=
      amountUSD + profit * (1 - config.profitLockPercent);
    portfolio.crypto -= amount;
  }

  // Record trade
  const trade = {
    action,
    price,
    amount,
    amountUSD,
    priceChange,
    timestamp: new Date(),
  };
  portfolio.trades.push(trade);
  portfolio.dailyTradeCount++;
  portfolio.lastPrice = price;

  // Display trade
  console.log(`
  ${"=".repeat(50)}
  [${
    config.demoMode ? "DEMO" : "LIVE"
  }] ${action.toUpperCase()} ${amount.toFixed(0)} ${config.symbol}
  @ $${formatPrice(price)} ($${amountUSD.toFixed(2)})
  Δ ${priceChange.toFixed(2)}%
  ${"-".repeat(20)}
  Portfolio Snapshot:
  ├─ Cash Reserve: $${portfolio.cashReserve.toFixed(2)}
  ├─ Locked Profit: $${portfolio.lockedCash.toFixed(2)}
  ├─ ${config.symbol.replace("USD", "")} Holdings: ${portfolio.crypto.toFixed(
    0
  )}
  └─ ${config.symbol.replace("USD", "")} Value: $${(
    portfolio.crypto * price
  ).toFixed(2)}
  ${"=".repeat(50)}`);
}

// ==============================================
// Strategy Execution
// ==============================================
async function runStrategy() {
  if (portfolio.dailyTradeCount >= config.maxDailyTrades) {
    console.log("⚠️ Daily trade limit reached");
    return;
  }

  const price = await getPrice();
  if (!price) return;

  // Initialize on first run
  if (portfolio.lastPrice === null) {
    portfolio.lastPrice = price;
    return;
  }

  const priceChange =
    ((price - portfolio.lastPrice) / portfolio.lastPrice) * 100;
  console.log(`📈 Price Change: ${priceChange.toFixed(2)}%`);

  // Strategy rules
  if (priceChange <= config.buyThreshold * portfolio.atr) {
    executeTrade("buy", price, priceChange);
  } else if (priceChange >= config.sellThreshold * portfolio.atr) {
    executeTrade("sell", price, priceChange);
  }

  portfolio.lastPrice = price;
}

// ==============================================
// Initialization
// ==============================================
console.log(`
${"*".repeat(60)}
🚀 Safety-First Crypto Trading Bot
${"-".repeat(60)}
│ Symbol: ${config.symbol}
│ Mode: ${config.demoMode ? "DEMO" : "LIVE"}
│ AI Optimization: ${config.aiEnabled ? "ENABLED" : "DISABLED"}
${"-".repeat(60)}
│ Trade Settings:
│ ├─ Max Risk: ${config.maxTradePercent * 100}% per trade
│ ├─ Profit Lock: ${config.profitLockPercent * 100}%
│ ├─ Cash Reserve: ${config.cashReservePercent * 100}%
│ ├─ Stop Loss: ${config.stopLossPercent * 100}%
│ └─ Max Trades/Day: ${config.maxDailyTrades}
${"*".repeat(60)}`);

// Start trading
runStrategy();
const interval = setInterval(runStrategy, config.checkInterval);

// Clean shutdown
process.on("SIGINT", () => {
  clearInterval(interval);
  const finalValue =
    portfolio.cashReserve +
    portfolio.lockedCash +
    portfolio.crypto * (portfolio.lastPrice || 0);

  console.log(`
  ${"*".repeat(60)}
  💼 Final Summary
  ${"-".repeat(60)}
  │ Total Trades: ${portfolio.trades.length}
  │ Ending Value: $${finalValue.toFixed(2)}
  │ P/L: ${finalValue >= config.initialBalance ? "+" : ""}$${(
    finalValue - config.initialBalance
  ).toFixed(2)}
  ${"*".repeat(60)}`);
  process.exit(0);
});
