// liveTestBonk.js
// Smoke-test: Buy & sell $0.05 BONK-USD using persisted session tokens and Ed25519 signing

require("dotenv").config();
const axios = require("axios");
const { getAccessToken, PUBLIC_API_KEY } = require("./sessionManager");
const { signRequest } = require("./signRequest");
const { randomUUID } = require("crypto");

// --- CONFIGURATION ---
const TRADE_USD = 0.05; // USD per trade
const QUOTE_SYMBOL = "BONKUSD"; // Price lookup symbol
const MARKETDATA_API = "https://api.robinhood.com";
const TRADING_API = "https://trading.robinhood.com";
const USER_AGENT = "Mozilla/5.0 PowerShell/7.2.0";

/**
 * Fetch current mark price for QUOTE_SYMBOL
 */
async function fetchPrice(token) {
  const url = `${MARKETDATA_API}/marketdata/forex/quotes/${QUOTE_SYMBOL}/`;
  const resp = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      Origin: "https://robinhood.com",
    },
  });
  return parseFloat(resp.data.mark_price);
}

/**
 * Place market order via Trading API
 */
async function placeOrder(token, side, qty) {
  const path = "/api/v1/crypto/trading/orders/";
  const url = `${TRADING_API}${path}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = {
    client_order_id: randomUUID(),
    symbol: QUOTE_SYMBOL.replace("USD", "-USD"),
    side,
    type: "market",
    market_order_config: { asset_quantity: qty.toString() },
  };

  // Sign request
  const signature = signRequest(PUBLIC_API_KEY, timestamp, path, "POST", body);

  const headers = {
    Authorization: `Bearer ${token}`,
    "User-Agent": USER_AGENT,
    Accept: "application/json",
    Origin: "https://robinhood.com",
    "Content-Type": "application/json",
    "x-api-key": PUBLIC_API_KEY,
    "x-timestamp": timestamp,
    "x-signature": signature,
  };

  console.log(`🚀 ${side.toUpperCase()} ${qty} ${body.symbol}`);
  const resp = await axios.post(url, body, { headers });
  return resp.data.id;
}

// --- Orchestrator ---
(async () => {
  console.log("=== Node Session-Persistent BONK Smoke Test ===");
  try {
    const token = await getAccessToken();
    const price = await fetchPrice(token);
    console.log(`🔄 Current price (${QUOTE_SYMBOL}): $${price}`);

    // Compute and round down quantity to nearest whole unit
    const rawQty = TRADE_USD / price;
    const qty = Math.floor(rawQty);
    if (qty < 1) {
      console.error("❌ Computed quantity < 1, cannot place order");
      process.exit(1);
    }
    console.log(`📊 Qty for $${TRADE_USD.toFixed(2)} (rounded down): ${qty}`);

    // BUY
    const buyId = await placeOrder(token, "buy", qty);
    console.log("✅ BUY accepted:", buyId);

    // Wait
    await new Promise((r) => setTimeout(r, 5000));

    // SELL
    const sellId = await placeOrder(token, "sell", qty);
    console.log("✅ SELL accepted:", sellId);

    console.log("🏁 Smoke test complete.");
  } catch (err) {
    console.error("❌ Smoke test failed:", err.response?.data || err.message);
    process.exit(1);
  }
})();
