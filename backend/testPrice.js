require("dotenv").config();
const axios = require("axios");

const BASE_URL = "https://trading.robinhood.com/api/v1/crypto/trading/";
const HEADERS = {
  Authorization: `Bearer ${process.env.ROBINHOOD_API_KEY}`,
  "Content-Type": "application/json",
};

async function listCryptoPairs() {
  try {
    const res = await axios.get(`${BASE_URL}pairs/`, { headers: HEADERS });

    const pairs = res.data.results || [];
    console.log("✅ Available Crypto Trading Pairs:");
    pairs.forEach((p) => {
      console.log(`${p.display_symbol} — ID: ${p.id}`);
    });

    // If you want to auto-fetch BTC-USD specifically
    const btcusd = pairs.find((p) => p.display_symbol === "BTC/USD");
    if (btcusd) {
      console.log("\nFetching quote for BTC/USD...");
      const quoteRes = await axios.get(`${BASE_URL}quotes/${btcusd.id}/`, {
        headers: HEADERS,
      });
      console.log("BTC/USD Quote:");
      console.log(`Mark Price: $${quoteRes.data.mark_price}`);
      console.log(`Ask Price: $${quoteRes.data.ask_price}`);
      console.log(`Bid Price: $${quoteRes.data.bid_price}`);
    } else {
      console.error("BTC/USD not found in pairs list!");
    }
  } catch (err) {
    console.error("❌ Error:", err.response?.status || err.code, err.message);
  }
}

listCryptoPairs();
