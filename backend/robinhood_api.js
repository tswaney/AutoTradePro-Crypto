// backend/robinhood_api.js

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { refreshAccessTokenIfNeeded } = require("./auth");

// Base URL for trading quotes/orders
const BASE_URL = "https://trading.robinhood.com/api/v1/crypto/trading/";
// Paths to your local demo-mode files
const portfolioFile = path.join(__dirname, "portfolio.json");
const tradesFile = path.join(__dirname, "trades.json");

/**
 * Always call this helper at the top of any real Robinhood API call
 * to get a valid Bearer token.
 */
async function getAuthHeaders() {
  const token = await refreshAccessTokenIfNeeded();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

// 🔍 Get current price for a given symbol (e.g., BTCUSD)
async function getPrice(symbol) {
  const headers = await getAuthHeaders();
  const res = await axios.get(
    `${BASE_URL}quotes/${symbol}/`,
    { headers }
  );
  return parseFloat(res.data.mark_price);
}

// ⚠️ Place a real crypto order via Robinhood
async function placeOrder(symbol, side, amount) {
  const headers = await getAuthHeaders();
  const order = {
    symbol,
    side,
    quantity: amount,
    type: "market",
    time_in_force: "gtc",
  };
  const res = await axios.post(
    `${BASE_URL}orders/`,
    order,
    { headers }
  );
  return res.data;
}

// ✅ ... your existing demo-mode and utility functions below ...

async function simulateTrade(symbol, side, amount) {
  // … unchanged …
}

function get24HourTradeCount() {
  // … unchanged …
}

function getAllTrades() {
  // … unchanged …
}

module.exports = {
  getPrice,
  placeOrder,
  simulateTrade,
  getAllTrades,
  get24HourTradeCount,
};
