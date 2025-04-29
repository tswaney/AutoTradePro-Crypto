// Load environment variables from .env file
require("dotenv").config();
const axios = require("axios");

// API Configuration (PowerShell-style that worked previously)
const BASE_URL = "https://api.robinhood.com/marketdata/forex/quotes/";
const HEADERS = {
  Authorization: `Bearer ${process.env.ROBINHOOD_API_KEY}`,
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PowerShell/7.2.0", // Critical for API compatibility
  Accept: "application/json",
};

// Trading Configuration
const config = {
  symbol: "BONKUSD", // Start with BTCUSD to verify connection
  demoMode: true, // Hardcoded safety - no real trades
  initialBalance: 1000, // Starting USD balance
  tradeAmount: 0.001, // BTC amount per trade
  buyThreshold: -1.5, // Buy if price drops 1.5%
  sellThreshold: 3, // Sell if price rises 3%
  checkInterval: 30000, // 30 seconds (avoid rate limits)
  priceDecimalPlaces: 8, // For proper crypto price display
};

// Portfolio Tracker
let portfolio = {
  usd: config.initialBalance,
  crypto: 0,
  lastPrice: null,
  trades: [],
};

/**
 * Safely fetches current price with type validation
 * @returns {Promise<number|null>} Current price or null if failed
 */
async function getPrice() {
  try {
    const response = await axios.get(`${BASE_URL}${config.symbol}/`, {
      headers: HEADERS,
      timeout: 8000,
    });

    // Debug: Uncomment to see full API response structure
    // console.log("API Response:", response.data);

    // Fixed: Proper parentheses and type checking
    const price = Number(response.data?.mark_price);
    if (isNaN(price)) {
      throw new Error(`Invalid price format: ${response.data?.mark_price}`);
    }

    return price;
  } catch (error) {
    console.error(`❌ Price fetch failed:`, error.message);
    return null;
  }
}

/**
 * Simulates a trade in demo mode with balance checks
 * @param {string} action - 'buy' or 'sell'
 * @param {number} price - Validated current price
 */
function executeTrade(action, price) {
  try {
    // Calculate trade amount with safety checks
    const amount =
      action === "buy"
        ? Math.min(config.tradeAmount, portfolio.usd / price) // Never overspend
        : Math.min(portfolio.crypto, config.tradeAmount); // Never oversell

    // Validate trade viability
    if (amount <= 0) {
      console.log(
        `⚠️ Skipped ${action}: Insufficient ${action === "buy" ? "USD" : "BTC"}`
      );
      return;
    }

    // Update portfolio
    if (action === "buy") {
      portfolio.usd -= amount * price;
      portfolio.crypto += amount;
    } else {
      portfolio.usd += amount * price;
      portfolio.crypto -= amount;
    }

    portfolio.lastPrice = price;
    portfolio.trades.push({
      action,
      price,
      amount,
      timestamp: new Date(),
      portfolioValue: portfolio.usd + portfolio.crypto * price,
    });

    console.log(
      `[${
        config.demoMode ? "DEMO" : "LIVE"
      }] ${action.toUpperCase()} ${amount.toFixed(6)} ${config.symbol}`,
      `@ $${price.toFixed(config.priceDecimalPlaces)}`,
      `| USD: $${portfolio.usd.toFixed(2)}`,
      `| ${config.symbol.replace("USD", "")}: ${portfolio.crypto.toFixed(6)}`
    );
  } catch (error) {
    console.error(`❌ Trade simulation failed:`, error.message);
  }
}

/**
 * Runs trading strategy with price validation
 */
async function runStrategy() {
  const price = await getPrice();

  // Skip if price fetch failed
  if (price === null || typeof price !== "number") {
    console.log("⏭️ Skipping strategy due to invalid price");
    return;
  }

  console.log(
    `\n📊 ${config.symbol}: $${price.toFixed(config.priceDecimalPlaces)}`
  );

  // Initialize on first run
  if (portfolio.lastPrice === null) {
    portfolio.lastPrice = price;
    return;
  }

  // Calculate price change percentage
  const priceChange =
    ((price - portfolio.lastPrice) / portfolio.lastPrice) * 100;
  console.log(`Price Change: ${priceChange.toFixed(2)}%`);

  // Strategy execution
  if (priceChange <= config.buyThreshold) {
    executeTrade("buy", price);
  } else if (priceChange >= config.sellThreshold && portfolio.crypto > 0) {
    executeTrade("sell", price);
  }
}

// Initialize
console.log(`🚀 Starting ${config.demoMode ? "DEMO" : "LIVE"} Trading`);
console.log(`- Symbol: ${config.symbol}`);
console.log(`- Initial USD: $${portfolio.usd.toFixed(2)}`);
console.log(
  `- Strategy: Buy ${config.buyThreshold}% ↓ | Sell ${config.sellThreshold}% ↑`
);
console.log(`- Interval: ${config.checkInterval / 1000} seconds\n`);

// Immediate first run
runStrategy();

// Periodic execution with cleanup
const interval = setInterval(runStrategy, config.checkInterval);
process.on("SIGINT", () => {
  clearInterval(interval);
  console.log("\n💼 Final Portfolio Summary:");
  console.log(`- USD Balance: $${portfolio.usd.toFixed(2)}`);
  console.log(
    `- ${config.symbol.replace("USD", "")} Holdings: ${portfolio.crypto.toFixed(
      6
    )}`
  );
  console.log(
    `- Current Value: $${(
      portfolio.usd +
      portfolio.crypto * (portfolio.lastPrice || 0)
    ).toFixed(2)}`
  );
  console.log(`- Total Trades: ${portfolio.trades.length}`);
  process.exit(0);
});
