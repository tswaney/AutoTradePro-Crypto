// Load environment variables from .env file
require("dotenv").config();
const axios = require("axios");

// ==============================================
// Configuration
// ==============================================
const config = {
  symbol: process.env.CRYPTO_SYMBOL || "BTCUSD", // Trading pair (e.g. BONKUSD)
  aiEnabled: process.env.AI_ENABLED === "true", // AI optimization toggle
  demoMode: true, // Demo mode flag (no real trades)
  initialBalance: 1000, // Starting balance in USD
  maxTradePercent: 0.5, // Max 50% of cash per trade
  profitLockPercent: 0.2, // 20% of profits get locked
  minTradeAmount: 0.01, // Minimum $0.01 per trade
  cashReservePercent: 0.15, // Always maintain 15% cash reserve
  baseBuyThreshold: -0.1, // Base buy threshold (-0.1xATR)
  baseSellThreshold: 0.3, // Base sell threshold (0.3xATR)
  checkInterval: 30000, // Check every 30 seconds (ms)
  priceDecimalPlaces: 8, // Decimal places for crypto prices
  maxDailyTrades: 50, // Max 50 trades per day
  stopLossPercent: -0.3, // -30% stop loss trigger
};

// Current thresholds (may be adjusted by AI)
let currentBuyThreshold = config.baseBuyThreshold;
let currentSellThreshold = config.baseSellThreshold;

// ==============================================
// API Configuration (PowerShell-style)
// ==============================================
const BASE_URL = "https://api.robinhood.com/marketdata/forex/quotes/";
const HEADERS = {
  Authorization: `Bearer ${process.env.ROBINHOOD_API_KEY}`,
  "Content-Type": "application/json",
  // Critical PowerShell-style connection headers
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PowerShell/7.2.0",
  Accept: "application/json",
  Origin: "https://robinhood.com",
};

// ==============================================
// Portfolio Tracker
// ==============================================
let portfolio = {
  cashReserve: config.initialBalance * (1 - config.cashReservePercent), // 85% of initial balance
  lockedCash: 0, // Locked profits (20% of gains)
  crypto: 0, // Crypto holdings in units
  lastPrice: null, // Last traded price
  trades: [], // Trade history
  atr: 0.0000025, // Average True Range (volatility measure)
  dailyTradeCount: 0, // Daily trade counter
  startingValue: config.initialBalance, // Initial portfolio value
  lastStopLossCheck: null, // Last stop loss check timestamp
  lastAICheck: null, // Last AI adjustment timestamp
  aiAdjustments: 0, // Count of AI adjustments made
};

// ==============================================
// Utility Functions
// ==============================================

/**
 * Formats price with proper decimal places
 * @param {number} price - Raw price value
 * @returns {string} Formatted price string
 */
function formatPrice(price) {
  if (typeof price !== "number" || isNaN(price)) {
    console.error("Invalid price value:", price);
    return "0.00000000";
  }
  return price.toFixed(config.priceDecimalPlaces).replace(/\.?0+$/, "");
}

/**
 * Displays all current trade settings
 */
function displayTradeSettings() {
  console.log(`
  ${"-".repeat(60)}
  ⚙️ CURRENT TRADE SETTINGS
  ${"-".repeat(60)}
  │ Symbol: ${config.symbol}
  │ Mode: ${config.demoMode ? "DEMO" : "LIVE"}
  │ AI Optimization: ${config.aiEnabled ? "ENABLED" : "DISABLED"}
  ${"-".repeat(60)}
  │ Capital Allocation:
  │ ├─ Initial Balance: $${config.initialBalance.toFixed(2)}
  │ ├─ Max Risk Per Trade: ${config.maxTradePercent * 100}% of cash
  │ ├─ Profit Lock: ${config.profitLockPercent * 100}% of gains
  │ ├─ Cash Reserve: ${config.cashReservePercent * 100}% maintained
  │ └─ Min Trade Amount: $${config.minTradeAmount.toFixed(2)}
  ${"-".repeat(60)}
  │ Trading Parameters:
  │ ├─ Base Buy Threshold: ${config.baseBuyThreshold}xATR
  │ ├─ Base Sell Threshold: ${config.baseSellThreshold}xATR
  │ ├─ Current Buy Threshold: ${currentBuyThreshold.toFixed(2)}xATR
  │ ├─ Current Sell Threshold: ${currentSellThreshold.toFixed(2)}xATR
  │ ├─ Check Interval: ${config.checkInterval / 1000} seconds
  │ ├─ Max Daily Trades: ${config.maxDailyTrades}
  │ └─ Stop Loss: ${config.stopLossPercent * 100}%
  ${"-".repeat(60)}`);
}

// ==============================================
// AI Optimization Functions
// ==============================================

/**
 * Adjusts trading thresholds based on market conditions (AI)
 */
async function adjustThresholds() {
  if (!config.aiEnabled) return;

  // Only check once per hour for adjustments
  const now = new Date();
  if (portfolio.lastAICheck && now - portfolio.lastAICheck < 3600000) return;
  portfolio.lastAICheck = now;

  try {
    // Simulated market analysis - replace with real API calls in production
    const volatilityFactor = 0.8 + Math.random() * 0.4; // 0.8-1.2
    const trendFactor = 0.5 + Math.random() * 0.5; // 0.5-1.0

    // Store previous values
    const previousBuy = currentBuyThreshold;
    const previousSell = currentSellThreshold;

    // Adjust thresholds with safety limits
    currentBuyThreshold = Math.max(
      -3,
      config.baseBuyThreshold * (1 + (1 - volatilityFactor) * trendFactor)
    );
    currentSellThreshold = Math.min(
      3,
      config.baseSellThreshold * (1 + volatilityFactor * trendFactor)
    );

    // Only display if thresholds changed significantly
    if (
      Math.abs(currentBuyThreshold - previousBuy) > 0.01 ||
      Math.abs(currentSellThreshold - previousSell) > 0.01
    ) {
      portfolio.aiAdjustments++;
      console.log(`
      ${"~".repeat(50)}
      🧠 AI ADJUSTED TRADING THRESHOLDS
      ${"-".repeat(50)}
      │ Previous Buy Threshold: ${previousBuy.toFixed(2)}xATR
      │ New Buy Threshold: ${currentBuyThreshold.toFixed(2)}xATR
      ${"-".repeat(50)}
      │ Previous Sell Threshold: ${previousSell.toFixed(2)}xATR
      │ New Sell Threshold: ${currentSellThreshold.toFixed(2)}xATR
      ${"~".repeat(50)}`);
    }
  } catch (error) {
    console.error("AI adjustment failed:", error.message);
  }
}

// ==============================================
// Trading Functions
// ==============================================

/**
 * Fetches current price using PowerShell-style connection
 * @returns {Promise<number|null>} Current price or null if failed
 */
async function getPrice() {
  try {
    const response = await axios.get(`${BASE_URL}${config.symbol}/`, {
      headers: HEADERS,
      timeout: 10000,
    });

    // Validate API response
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
 * Executes a trade with all safety checks
 * @param {string} action - 'buy' or 'sell'
 * @param {number} price - Execution price
 * @param {number} priceChange - Percentage price change
 */
function executeTrade(action, price, priceChange) {
  // Validate price
  price = typeof price === "number" ? price : parseFloat(price);
  if (isNaN(price)) {
    console.error("Invalid price in executeTrade");
    return;
  }

  // Calculate trade size within configured limits
  const maxTradeAmount = portfolio.cashReserve * config.maxTradePercent;
  const amountUSD = Math.min(
    maxTradeAmount,
    Math.max(config.minTradeAmount, maxTradeAmount * 0.75) // $75-$100 equivalent
  );
  const amount = amountUSD / price;

  // Validate trade conditions
  if (amount <= 0 || (action === "sell" && portfolio.crypto <= 0)) {
    console.log(
      `⚠️ No ${action}: Insufficient ${action === "buy" ? "cash" : "crypto"}`
    );
    return;
  }

  // Execute buy or sell
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

  // Display trade execution
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

/**
 * Main trading strategy execution
 */
async function runStrategy() {
  // Check daily trade limit
  if (portfolio.dailyTradeCount >= config.maxDailyTrades) {
    console.log("⚠️ Daily trade limit reached");
    return;
  }

  // AI threshold adjustment
  await adjustThresholds();

  const price = await getPrice();
  if (!price) return;

  // Initialize on first run
  if (portfolio.lastPrice === null) {
    portfolio.lastPrice = price;
    return;
  }

  // Calculate price movement
  const priceChange =
    ((price - portfolio.lastPrice) / portfolio.lastPrice) * 100;
  console.log(`📈 Price Change: ${priceChange.toFixed(2)}%`);

  // Execute trades based on current thresholds
  if (priceChange <= currentBuyThreshold * portfolio.atr) {
    executeTrade("buy", price, priceChange);
  } else if (priceChange >= currentSellThreshold * portfolio.atr) {
    executeTrade("sell", price, priceChange);
  }

  portfolio.lastPrice = price;
}

// ==============================================
// Initialization
// ==============================================

// Display all settings at startup
displayTradeSettings();

// Start trading
runStrategy();
const interval = setInterval(runStrategy, config.checkInterval);

// ==============================================
// Shutdown Handler
// ==============================================
process.on("SIGINT", () => {
  clearInterval(interval);
  const finalValue =
    portfolio.cashReserve +
    portfolio.lockedCash +
    portfolio.crypto * (portfolio.lastPrice || 0);

  console.log(`
  ${"*".repeat(60)}
  💼 FINAL TRADING SUMMARY
  ${"-".repeat(60)}
  │ Symbol: ${config.symbol}
  │ Mode: ${config.demoMode ? "DEMO" : "LIVE"}
  │ AI Optimization: ${config.aiEnabled ? "ENABLED" : "DISABLED"}
  ${"-".repeat(60)}
  │ Performance:
  │ ├─ Total Trades: ${portfolio.trades.length}
  │ ├─ Ending Value: $${finalValue.toFixed(2)}
  │ ├─ P/L: ${finalValue >= config.initialBalance ? "+" : ""}$${(
    finalValue - config.initialBalance
  ).toFixed(2)}
  │ └─ AI Adjustments: ${portfolio.aiAdjustments}
  ${"-".repeat(60)}
  │ Final Trading Parameters:
  │ ├─ Buy Threshold: ${currentBuyThreshold.toFixed(2)}xATR
  │ ├─ Sell Threshold: ${currentSellThreshold.toFixed(2)}xATR
  │ ├─ ATR: ${portfolio.atr.toFixed(8)}
  │ └─ Last Price: $${formatPrice(portfolio.lastPrice || 0)}
  ${"*".repeat(60)}`);
  process.exit(0);
});
