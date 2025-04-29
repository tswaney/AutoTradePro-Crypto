// Load environment variables from .env file
require("dotenv").config();
const axios = require("axios");

// API Configuration
const BASE_URL = "https://api.robinhood.com/marketdata/forex/quotes/";
const symbol = "BONKUSD"; // Crypto symbol to track

// Request Headers
const HEADERS = {
  Authorization: `Bearer ${process.env.ROBINHOOD_API_KEY}`,
  "Content-Type": "application/json",
  "User-Agent": "Node.js Crypto Tracker/1.0",
  Accept: "application/json",
};

// Demo Trading Configuration
const DEMO_MODE = true; // Set to false for live trading
const INITIAL_BALANCE = 1000; // Starting balance in USD
const TRADE_AMOUNT = 0.01; // Amount of crypto to trade per transaction

// Track demo portfolio state
let demoPortfolio = {
  usdBalance: INITIAL_BALANCE,
  cryptoAmount: 0,
  lastTradePrice: null,
  trades: [],
};

/**
 * Simulates a trade in demo mode
 * @param {string} action - 'buy' or 'sell'
 * @param {number} price - Current market price
 */
function simulateTrade(action, price) {
  try {
    const amount = action === "buy" ? TRADE_AMOUNT : demoPortfolio.cryptoAmount;
    const cost = amount * price;

    if (action === "buy" && demoPortfolio.usdBalance >= cost) {
      demoPortfolio.usdBalance -= cost;
      demoPortfolio.cryptoAmount += amount;
      demoPortfolio.lastTradePrice = price;
      logTrade(action, price, amount);
    } else if (action === "sell" && demoPortfolio.cryptoAmount >= amount) {
      demoPortfolio.usdBalance += cost;
      demoPortfolio.cryptoAmount -= amount;
      demoPortfolio.lastTradePrice = price;
      logTrade(action, price, amount);
    }
  } catch (error) {
    console.error("❌ Trade simulation failed:", error.message);
  }
}

/**
 * Logs trade details to console and portfolio history
 */
function logTrade(action, price, amount) {
  const trade = {
    action,
    price,
    amount,
    timestamp: new Date().toISOString(),
    portfolioValue:
      demoPortfolio.usdBalance + demoPortfolio.cryptoAmount * price,
  };

  demoPortfolio.trades.push(trade);
  console.log(
    `[DEMO] ${action.toUpperCase()} ${amount} ${symbol} @ $${price.toFixed(
      8
    )} | ` +
      `USD: $${demoPortfolio.usdBalance.toFixed(2)} | ` +
      `${symbol}: ${demoPortfolio.cryptoAmount.toFixed(8)}`
  );
}

/**
 * Implements basic trading strategy
 */
function runStrategy(currentPrice) {
  if (!demoPortfolio.lastTradePrice) {
    demoPortfolio.lastTradePrice = currentPrice;
    return;
  }

  const priceChangePercent =
    ((currentPrice - demoPortfolio.lastTradePrice) /
      demoPortfolio.lastTradePrice) *
    100;

  // Example strategy: Buy on 2% drop, sell on 5% rise
  if (priceChangePercent <= -2) simulateTrade("buy", currentPrice);
  if (priceChangePercent >= 5 && demoPortfolio.cryptoAmount > 0) {
    simulateTrade("sell", currentPrice);
  }
}

/**
 * Fetches current market price and executes strategy
 */
async function getCryptoQuote() {
  try {
    // Add timeout and retry configuration
    const response = await axios.get(`${BASE_URL}${symbol}/`, {
      headers: HEADERS,
      timeout: 5000, // 5 second timeout
    });

    const quote = response.data;
    console.log(`\n✅ ${symbol} Price: $${quote.mark_price}`);

    if (DEMO_MODE) {
      runStrategy(quote.mark_price);
    }
  } catch (error) {
    // Enhanced error handling
    if (error.code === "ECONNABORTED") {
      console.warn("⚠️ Request timeout - retrying...");
    } else if (error.response) {
      // API error response
      console.error(
        `❌ API Error (${error.response.status}):`,
        error.response.data?.message || "No error details"
      );
    } else if (error.request) {
      // No response received
      console.error("❌ Network Error:", error.message);
    } else {
      // Other errors
      console.error("❌ Unexpected Error:", error.message);
    }
  }
}

// Initialize and run every 30 seconds
console.log(`Starting ${symbol} price tracker (Demo Mode: ${DEMO_MODE})`);
getCryptoQuote(); // Immediate first run
const interval = setInterval(getCryptoQuote, 30 * 1000); // 30 second interval
//const interval = setInterval(getCryptoQuote, 5 * 60 * 1000); // 5 minutes interval

// Cleanup on exit
process.on("SIGINT", () => {
  clearInterval(interval);
  console.log("\n📊 Final Portfolio Summary:");
  console.log(`- USD Balance: $${demoPortfolio.usdBalance.toFixed(2)}`);
  console.log(`- ${symbol} Holdings: ${demoPortfolio.cryptoAmount.toFixed(8)}`);
  console.log(`- Total Trades: ${demoPortfolio.trades.length}`);
  process.exit(0);
});
