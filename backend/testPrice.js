// Load environment variables
require("dotenv").config();
const axios = require("axios");

// ==============================================
// API Configuration (PowerShell-style that worked)
// ==============================================
const BASE_URL = "https://api.robinhood.com/marketdata/forex/quotes/";
const HEADERS = {
  Authorization: `Bearer ${process.env.ROBINHOOD_API_KEY}`,
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PowerShell/7.2.0", // Critical
  Accept: "application/json",
  Origin: "https://robinhood.com",
  Referer: "https://robinhood.com/",
};

// ==============================================
// Trading Configuration
// ==============================================
const config = {
  symbol: "BONKUSD", // Start with BTCUSD to verify connection
  demoMode: true, // Hardcoded safety
  initialBalance: 1000, // Starting USD
  tradeAmount: 0.001, // BTC amount per trade
  buyThreshold: -0.1, // Buy if drops 1.5%
  sellThreshold: 0.25, // Sell if rises 3%
  checkInterval: 30000, // 30 seconds
  priceDecimalPlaces: 8, // For crypto decimals
};

// ==============================================
// Portfolio Tracker
// ==============================================
let portfolio = {
  usd: config.initialBalance,
  crypto: 0,
  lastPrice: null,
  trades: [],
};

// ==============================================
// Core Functions (PowerShell-verified)
// ==============================================

/**
 * PowerShell-style price fetcher that worked previously
 */
async function getPrice() {
  try {
    console.log(
      `\n[${new Date().toLocaleTimeString()}] Fetching ${config.symbol}...`
    );

    const response = await axios.get(`${BASE_URL}${config.symbol}/`, {
      headers: HEADERS,
      timeout: 10000,
    });

    // Debug: Log full response structure if needed
    // console.log("API Response:", response.data);

    const price = Number(response.data?.mark_price);
    if (!price || isNaN(price)) {
      throw new Error(`Invalid price format: ${response.data?.mark_price}`);
    }

    console.log(
      `✅ [${new Date().toLocaleTimeString()}] ${
        config.symbol
      } Price: $${price.toFixed(config.priceDecimalPlaces)}`
    );
    return price;
  } catch (error) {
    console.error(`❌ [${new Date().toLocaleTimeString()}] Failed:`, {
      status: error.response?.status,
      message: error.message,
      url: `${BASE_URL}${config.symbol}/`,
    });
    return null;
  }
}

/**
 * Trade executor with detailed logging
 */
function executeTrade(action, price, priceChange) {
  const amount =
    action === "buy"
      ? Math.min(config.tradeAmount, portfolio.usd / price)
      : Math.min(portfolio.crypto, config.tradeAmount);

  if (amount <= 0) {
    console.log(
      `⚠️ Insufficient ${action === "buy" ? "USD" : "BTC"} for trade`
    );
    return;
  }

  // Execute trade
  if (action === "buy") {
    portfolio.usd -= amount * price;
    portfolio.crypto += amount;
  } else {
    portfolio.usd += amount * price;
    portfolio.crypto -= amount;
  }

  // Record trade
  const trade = {
    action,
    price,
    amount,
    priceChange,
    timestamp: new Date(),
    usdBalance: portfolio.usd,
    cryptoBalance: portfolio.crypto,
  };
  portfolio.trades.push(trade);
  portfolio.lastPrice = price;

  // Display trade
  console.log(`
  ${"=".repeat(60)}
  [DEMO] ${action.toUpperCase()} ${amount.toFixed(6)} ${config.symbol} 
  @ $${price.toFixed(config.priceDecimalPlaces)}
  Δ ${priceChange.toFixed(2)}% ${priceChange > 0 ? "↑" : "↓"}
  USD: $${portfolio.usd.toFixed(2)} | ${config.symbol.replace(
    "USD",
    ""
  )}: ${portfolio.crypto.toFixed(6)}
  ${"=".repeat(60)}`);
}

/**
 * Strategy runner
 */
async function runStrategy() {
  const price = await getPrice();
  if (price === null) return;

  // Initialize
  if (portfolio.lastPrice === null) {
    portfolio.lastPrice = price;
    return;
  }

  const priceChange =
    ((price - portfolio.lastPrice) / portfolio.lastPrice) * 100;
  console.log(`   Price Change: ${priceChange.toFixed(2)}%`);

  // Execute strategy
  if (priceChange <= config.buyThreshold) {
    executeTrade("buy", price, priceChange);
  } else if (priceChange >= config.sellThreshold && portfolio.crypto > 0) {
    executeTrade("sell", price, priceChange);
  }

  portfolio.lastPrice = price;
}

// ==============================================
// Execution
// ==============================================

console.log(`
${"*".repeat(60)}
🚀 Starting ${config.symbol} Trading (PowerShell Mode)
${new Date().toLocaleString()}
${"-".repeat(60)}
│ API Key: ${process.env.ROBINHOOD_API_KEY?.substring(0, 6)}...
│ Balance: $${portfolio.usd.toFixed(2)}
│ Strategy: Buy ${config.buyThreshold}% ↓ | Sell ${config.sellThreshold}% ↑
${"*".repeat(60)}`);

// Initial run
runStrategy();

// Periodic execution
const interval = setInterval(runStrategy, config.checkInterval);

// Clean shutdown
process.on("SIGINT", () => {
  clearInterval(interval);

  const finalValue =
    portfolio.usd + portfolio.crypto * (portfolio.lastPrice || 0);

  console.log(`
  ${"*".repeat(60)}
  💼 Final Summary
  ${"-".repeat(60)}
  │ USD: $${portfolio.usd.toFixed(2)}
  │ ${config.symbol.replace("USD", "")}: ${portfolio.crypto.toFixed(6)}
  │ Value: $${finalValue.toFixed(2)}
  │ Trades: ${portfolio.trades.length}
  ${"-".repeat(60)}`);

  // Show all trades
  if (portfolio.trades.length > 0) {
    console.log("\n  🔄 Trade History:");
    portfolio.trades.forEach((trade, i) => {
      console.log(`
  ${"-".repeat(50)}
  #${i + 1} ${trade.timestamp.toLocaleTimeString()}
  ${trade.action.toUpperCase()} ${trade.amount.toFixed(
        6
      )} @ $${trade.price.toFixed(config.priceDecimalPlaces)}
  Δ ${trade.priceChange.toFixed(2)}% | USD: $${trade.usdBalance.toFixed(2)}
  ${"-".repeat(50)}`);
    });
  }

  process.exit(0);
});
