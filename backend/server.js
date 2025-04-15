// backend/server.js

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// 📦 Import trading and crypto functions from robinhood_api.js
const {
  getPrice,
  placeOrder,
  simulateTrade,
  getAllTrades,
  get24HourTradeCount,
  refreshAvailableCryptos,
  getCachedCryptoList,
} = require("./robinhood_api");

// 📦 Trade endpoint for both live and demo modes
app.post("/trade", async (req, res) => {
  const { symbol, side, amount, mode } = req.body;
  try {
    const result =
      mode === "demo"
        ? await simulateTrade(symbol, side, amount) // 🔁 Demo trade
        : await placeOrder(symbol, side, amount); // 💸 Real trade (requires approval)
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 📊 Show trade activity in the past 24 hours (Robinhood transfer limit = 50)
app.get("/trades/summary", (req, res) => {
  try {
    const summary = get24HourTradeCount();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 📜 Optional: view full trade history
app.get("/trades", (req, res) => {
  try {
    const trades = getAllTrades();
    res.json(trades);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🪙 List cached crypto trading pairs (e.g., BTCUSD, ETHUSD)
app.get("/cryptos", (req, res) => {
  try {
    const list = getCachedCryptoList();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔄 Manually refresh available cryptos from Robinhood
app.get("/cryptos/refresh", async (req, res) => {
  try {
    const list = await refreshAvailableCryptos();
    res.json({ updated: true, symbols: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ⏱ Optional: auto-refresh crypto list every 5 minutes
setInterval(() => {
  refreshAvailableCryptos();
}, 5 * 60 * 1000); // 5 mins

// 🚀 Start the server
app.listen(PORT, () => {
  console.log(`AutoTradePro Crypto API running on port ${PORT}`);
});
