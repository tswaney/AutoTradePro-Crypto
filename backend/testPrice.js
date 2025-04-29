// Load environment variables from .env file
require("dotenv").config();
const axios = require("axios");

// ==============================================
// API Configuration (PowerShell-style)
// ==============================================
const BASE_URL = "https://api.robinhood.com/marketdata/forex/quotes/";
const HEADERS = {
  Authorization: `Bearer ${process.env.ROBINHOOD_API_KEY}`,
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PowerShell/7.2.0", // Critical for API access
  Accept: "application/json",
  Origin: "https://robinhood.com",
};

// ==============================================
// Trading Configuration (Moderate-Moderate Retain)
// ==============================================
const config = {
  symbol: "BONKUSD",
  demoMode: true,
  initialBalance: 1000, // Starting cash ($1000)
  maxTradePercent: 0.5, // 50% of cash reserve cap
  profitLockPercent: 0.2, // 20% of profits locked
  minTradeAmount: 0.01, // $0.01 minimum trade
  cashReservePercent: 0.15, // 15% cash reserve
  buyThreshold: -1.5, // 1.5x ATR buy trigger
  sellThreshold: 1.5, // 1.5x ATR sell trigger
  checkInterval: 30000, // 30 second intervals
  priceDecimalPlaces: 8, // 8 decimals for micro-prices
};

// ==============================================
// Portfolio Tracker (Strategy Implementation)
// ==============================================
let portfolio = {
  cashReserve: config.initialBalance * (1 - config.cashReservePercent), // 85% of initial
  lockedCash: 0, // Locked profits
  crypto: 0, // BONK holdings
  lastPrice: null, // Last traded price
  trades: [], // Trade history
  atr: 0.0000025, // Average True Range for BONKUSD
  dailyTradeCount: 0, // Daily trade counter
  startingValue: config.initialBalance, // Track initial portfolio value
};

// ==============================================
// Core Functions
// ==============================================

/**
 * Formats micro-prices with proper decimal handling
 * @param {number} price - Raw price
 * @returns {string} Formatted price string
 */
function formatPrice(price) {
  const formatted = price.toFixed(config.priceDecimalPlaces);
  return formatted.replace(/(\..*?)0+$/, "$1").replace(/\.$/, ""); // Trim trailing zeros
}

/**
 * Gets current price using PowerShell-style connection
 * @returns {Promise<number|null>} Current price or null if failed
 */
async function getPrice() {
  try {
    const response = await axios.get(`${BASE_URL}${config.symbol}/`, {
      headers: HEADERS,
      timeout: 10000,
    });

    const price = Number(response.data?.mark_price);
    if (isNaN(price) || price <= 0) throw new Error("Invalid price data");

    console.log(`✅ ${config.symbol} Price: $${formatPrice(price)}`);
    return price;
  } catch (error) {
    console.error(`❌ Price fetch failed:`, {
      status: error.response?.status,
      message: error.message,
    });
    return null;
  }
}

/**
 * Calculates current portfolio value
 * @param {number} currentPrice - Current BONK price
 * @returns {object} Portfolio value breakdown
 */
function getPortfolioValue(currentPrice) {
  const cryptoValue = portfolio.crypto * currentPrice;
  const totalValue = portfolio.cashReserve + portfolio.lockedCash + cryptoValue;
  const valueChange = totalValue - portfolio.startingValue;
  const changePercent = (valueChange / portfolio.startingValue) * 100;

  return {
    total: totalValue,
    crypto: cryptoValue,
    change: valueChange,
    changePercent: changePercent,
  };
}

/**
 * Executes trades with full strategy compliance
 * @param {string} action - 'buy' or 'sell'
 * @param {number} price - Execution price
 * @param {number} priceChange - Percentage price change
 */
function executeTrade(action, price, priceChange) {
  try {
    // Calculate trade size (capped at 50% of cash reserve, min $0.01)
    const maxTradeAmount = portfolio.cashReserve * config.maxTradePercent;
    const amountUSD = Math.min(
      maxTradeAmount,
      Math.max(config.minTradeAmount, maxTradeAmount * 0.75) // $75-$100 equivalent
    );
    const amount = amountUSD / price;

    // Get pre-trade values for comparison
    const preTradeValue = getPortfolioValue(price);

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
    const postTradeValue = getPortfolioValue(price);
    const trade = {
      action,
      price,
      amount,
      amountUSD,
      priceChange,
      timestamp: new Date(),
      portfolioValue: postTradeValue.total,
      cryptoValue: postTradeValue.crypto,
      valueChange: postTradeValue.change,
      valueChangePercent: postTradeValue.changePercent,
    };
    portfolio.trades.push(trade);
    portfolio.dailyTradeCount++;

    // Display trade execution
    console.log(`
    ${"=".repeat(60)}
    [${
      config.demoMode ? "DEMO" : "LIVE"
    }] ${action.toUpperCase()} ${amount.toFixed(0)} ${config.symbol}
    @ $${formatPrice(price)} ($${amountUSD.toFixed(2)})
    Δ ${priceChange.toFixed(2)}%
    ${"-".repeat(40)}
    Portfolio Impact:
    ├─ BONK Qty: ${portfolio.crypto.toFixed(0)}
    ├─ BONK USD Value: $${postTradeValue.crypto.toFixed(2)}
    ├─ Total Value: $${postTradeValue.total.toFixed(2)}
    └─ P/L: ${
      postTradeValue.change >= 0 ? "+" : ""
    }${postTradeValue.change.toFixed(
      2
    )} (${postTradeValue.changePercent.toFixed(2)}%)
    ${"=".repeat(60)}`);
  } catch (error) {
    console.error(`❌ Trade execution failed:`, error.message);
  }
}

/**
 * Runs trading strategy with ATR-based thresholds
 */
async function runStrategy() {
  // Check daily trade limit
  if (portfolio.dailyTradeCount >= 50) {
    console.log("⚠️ Daily trade limit reached (50 trades)");
    return;
  }

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
  console.log(
    `📈 Price Change: ${priceChange.toFixed(2)}% (ATR: ${formatPrice(
      portfolio.atr
    )})`
  );

  // Strategy execution
  if (
    priceChange <= config.buyThreshold * portfolio.atr &&
    portfolio.cashReserve > config.minTradeAmount
  ) {
    executeTrade("buy", price, priceChange);
  } else if (
    priceChange >= config.sellThreshold * portfolio.atr &&
    portfolio.crypto > 0
  ) {
    executeTrade("sell", price, priceChange);
  }

  portfolio.lastPrice = price;
}

// ==============================================
// Execution
// ==============================================
console.log(`
${"*".repeat(60)}
🚀 Starting ${config.symbol} Trading (PowerShell Connection)
${"-".repeat(60)}
│ Initial Balance: $${config.initialBalance.toFixed(2)}
│ Cash Reserve: $${portfolio.cashReserve.toFixed(2)} (${
  (1 - config.cashReservePercent) * 100
}%)
│ Trade Settings:
│ ├─ Max Trade: $${(portfolio.cashReserve * config.maxTradePercent).toFixed(
  2
)} (${config.maxTradePercent * 100}%)
│ ├─ Profit Lock: ${config.profitLockPercent * 100}%
│ └─ Min Trade: $${config.minTradeAmount.toFixed(2)}
${"*".repeat(60)}`);

// Initial run
runStrategy();

// Periodic execution
const interval = setInterval(runStrategy, config.checkInterval);

// ==============================================
// Enhanced Shutdown Handler
// ==============================================
process.on("SIGINT", () => {
  clearInterval(interval);

  const finalValue = getPortfolioValue(portfolio.lastPrice || 0);
  const totalTrades = portfolio.trades.length;

  console.log(`
  ${"*".repeat(60)}
  💼 FINAL PORTFOLIO SUMMARY
  ${"-".repeat(60)}
  │ Total Trades: ${totalTrades}
  │ Cash Reserve: $${portfolio.cashReserve.toFixed(2)}
  │ Locked Profit: $${portfolio.lockedCash.toFixed(2)}
  │ ${config.symbol.replace("USD", "")} Holdings: ${portfolio.crypto.toFixed(0)}
  │ ${config.symbol.replace("USD", "")} Value: $${finalValue.crypto.toFixed(2)}
  │ Total Value: $${finalValue.total.toFixed(2)}
  │ P/L: ${finalValue.change >= 0 ? "+" : ""}${finalValue.change.toFixed(
    2
  )} (${finalValue.changePercent.toFixed(2)}%)
  ${"-".repeat(60)}`);

  // Trade History
  console.log(`
  ${"*".repeat(60)}
  📜 TRADE HISTORY (${totalTrades} Executed)
  ${"*".repeat(60)}`);

  if (totalTrades > 0) {
    portfolio.trades.forEach((trade, i) => {
      console.log(`
      ${"-".repeat(50)}
      Trade #${i + 1} - ${trade.timestamp.toLocaleString()}
      [${trade.action.toUpperCase()}] ${trade.amount.toFixed(0)} ${
        config.symbol
      }
      @ $${formatPrice(trade.price)} ($${trade.amountUSD.toFixed(2)})
      Δ ${trade.priceChange.toFixed(2)}%
      ${"-".repeat(20)}
      Portfolio Snapshot:
      ├─ BONK Qty: ${portfolio.crypto.toFixed(0)}
      ├─ BONK Value: $${trade.cryptoValue.toFixed(2)}
      ├─ Total Value: $${trade.portfolioValue.toFixed(2)}
      └─ P/L: ${trade.valueChange >= 0 ? "+" : ""}${trade.valueChange.toFixed(
        2
      )} (${trade.valueChangePercent.toFixed(2)}%)
      ${"-".repeat(50)}`);
    });
  } else {
    console.log("\n      No trades executed this session");
  }

  console.log(`
  ${"*".repeat(60)}
  🏁 Session Ended - ${totalTrades} Trades Executed
  ${"*".repeat(60)}`);

  process.exit(0);
});
