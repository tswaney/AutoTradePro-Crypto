// backend/robinhood_api.js

const fs = require("fs");
const path = require("path");
const axios = require("axios");

// 🔐 Environment config
const API_KEY = process.env.ROBINHOOD_API_KEY;
const BASE_URL = "https://api.robinhood.com/crypto/";

// 📁 Paths to data files
const portfolioFile = path.join(__dirname, "portfolio.json");
const tradesFile = path.join(__dirname, "trades.json");
const cryptosFile = path.join(__dirname, "available_cryptos.json");

// 📦 Request headers for Robinhood API
const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

// 🔍 Get the current price for a given symbol (e.g., BTCUSD)
async function getPrice(symbol) {
  const res = await axios.get(`${BASE_URL}quotes/${symbol}/`, {
    headers: HEADERS,
  });
  return parseFloat(res.data.mark_price);
}

// ⚠️ Place a real trade (live trading) — requires approved API key
async function placeOrder(symbol, side, amount) {
  const order = {
    symbol,
    side,
    quantity: amount,
    type: "market",
    time_in_force: "gtc",
  };
  const res = await axios.post(`${BASE_URL}orders/`, order, {
    headers: HEADERS,
  });
  return res.data;
}

// ✅ Simulate a demo trade (buy/sell) and update portfolio + logs
async function simulateTrade(symbol, side, amount) {
  const price = await getPrice(symbol); // fetch real market price
  const portfolio = JSON.parse(fs.readFileSync(portfolioFile, "utf-8") || "{}");

  // Initialize the crypto entry if not present
  if (!portfolio[symbol]) {
    portfolio[symbol] = { quantity: 0, avg_buy_price: 0 };
  }

  // 🟢 BUY logic
  if (side === "buy") {
    const qty = amount / price;
    const current = portfolio[symbol];
    const totalCost = current.avg_buy_price * current.quantity + price * qty;
    const newQty = current.quantity + qty;
    const newAvg = totalCost / newQty;

    portfolio[symbol] = {
      quantity: newQty,
      avg_buy_price: newAvg,
    };
  }

  // 🔴 SELL logic
  else if (side === "sell") {
    const qty = amount / price;
    portfolio[symbol].quantity = Math.max(0, portfolio[symbol].quantity - qty);
    if (portfolio[symbol].quantity === 0) {
      portfolio[symbol].avg_buy_price = 0;
    }
  }

  // Save updated portfolio state
  fs.writeFileSync(portfolioFile, JSON.stringify(portfolio, null, 2));

  // Log this trade in trades.json
  const tradeLog = {
    symbol,
    side,
    amount,
    price,
    timestamp: new Date().toISOString(),
  };

  const trades = JSON.parse(fs.readFileSync(tradesFile, "utf-8") || "[]");
  trades.push(tradeLog);
  fs.writeFileSync(tradesFile, JSON.stringify(trades, null, 2));

  return { price, tradeLog, portfolio: portfolio[symbol] };
}

// 📊 Return number of trades in the past 24 hours
function get24HourTradeCount() {
  const trades = JSON.parse(fs.readFileSync(tradesFile, "utf8") || "[]");
  const now = new Date();
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const recentTrades = trades.filter(
    (t) => new Date(t.timestamp) > windowStart
  );

  return {
    count: recentTrades.length,
    remaining: 50 - recentTrades.length,
  };
}

// 📜 Get full list of past trades
function getAllTrades() {
  return JSON.parse(fs.readFileSync(tradesFile, "utf8") || "[]");
}

// 🪙 Refresh the available crypto trading pairs from Robinhood
async function refreshAvailableCryptos() {
  try {
    const res = await axios.get(`${BASE_URL}currencies/`, { headers: HEADERS });
    const available = res.data.results || [];

    // Filter tradable assets and format symbols like BTCUSD
    const tradablePairs = available
      .filter((c) => c.can_trade)
      .map((c) => `${c.code}USD`);

    // Cache them to disk
    fs.writeFileSync(cryptosFile, JSON.stringify(tradablePairs, null, 2));
    return tradablePairs;
  } catch (err) {
    console.error("Error fetching available cryptos:", err.message);
    return [];
  }
}

// 📥 Get the cached list of crypto symbols
function getCachedCryptoList() {
  try {
    const data = fs.readFileSync(cryptosFile, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

module.exports = {
  getPrice,
  placeOrder,
  simulateTrade,
  getAllTrades,
  get24HourTradeCount,
  refreshAvailableCryptos,
  getCachedCryptoList,
};
