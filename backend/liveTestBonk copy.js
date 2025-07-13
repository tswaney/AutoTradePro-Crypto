// liveTestBonk.js
// Smoke-test: Buy & sell $0.05 BONK-USD using your permanent API key + Ed25519 signing

require("dotenv").config();
const axios = require("axios");
const { getAccessToken, PUBLIC_API_KEY } = require("./sessionManager");

console.log("🚨 PUBLIC_API_KEY:", PUBLIC_API_KEY);
if (!PUBLIC_API_KEY) {
  console.error("❌ PUBLIC_API_KEY is still undefined—check your .env");
  process.exit(1);
}
const { signRequest } = require("./signRequest");
const { randomUUID }  = require("crypto");

// ─── CONFIG ─────────────────────────────────────────────────────────
const TRADE_USD      = 0.05;
const QUOTE_SYMBOL   = "BONKUSD";
const MARKETDATA_API = "https://api.robinhood.com";
const TRADING_API    = "https://trading.robinhood.com";
const USER_AGENT     = "Mozilla/5.0 PowerShell/7.2.0";

// Early check of PUBLIC_API_KEY
if (!PUBLIC_API_KEY) {
  console.error("❌ Missing PUBLIC_API_KEY in .env");
  process.exit(1);
}

// ─── FETCH LIVE PRICE ───────────────────────────────────────────────
async function fetchPrice() {
  console.log(">>> Entered fetchPrice()");
  const token = await getAccessToken(); // ← now from sessionManager
  console.log(">>> Using token in fetchPrice():", Boolean(token));

  const url = `${MARKETDATA_API}/marketdata/forex/quotes/${QUOTE_SYMBOL}/`;
  console.log(">>> fetchPrice URL:", url);

  const headers = {
    Authorization: `Bearer ${token}`,
    "User-Agent":   USER_AGENT,
    Accept:         "application/json",
    Origin:         "https://robinhood.com",
  };
  console.log(">>> fetchPrice headers:", headers);

  const resp = await axios.get(url, { headers });
  return parseFloat(resp.data.mark_price);
}

// ─── PLACE A MARKET ORDER ───────────────────────────────────────────
async function placeOrder(side, qty) {
  console.log(">>> Entered placeOrder()", { side, qty });
  const token = await getAccessToken(); // ← from sessionManager
  console.log(">>> Using token in placeOrder():", Boolean(token));

  // Path must match exactly for signature
  const path      = "/api/v1/crypto/trading/orders/";
  const url       = `${TRADING_API}${path}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();

  console.log(">>> Signing against path:", path);
  console.log(">>> Full request URL:", url);

  const body = {
    client_order_id: randomUUID(),
    symbol: QUOTE_SYMBOL.replace("USD", "-USD"), // e.g. BONK-USD
    side,
    type: "market",
    market_order_config: { asset_quantity: qty.toString() },
  };
  console.log(">>> Order body:", body);

  // Sign it
  const signature = signRequest(
    PUBLIC_API_KEY,
    timestamp,
    path,
    "POST",
    body
  );
  console.log(">>> Generated signature:", signature);

  // Exact casing for x- headers
  const headers = {
    Authorization: `Bearer ${token}`,
    "User-Agent":    USER_AGENT,
    Accept:          "application/json",
    Origin:          "https://robinhood.com",
    "Content-Type":  "application/json",
    "x-api-key":     PUBLIC_API_KEY,
    "x-timestamp":   timestamp,
    "x-signature":   signature,
  };
  console.log(">>> Final POST headers:", JSON.stringify(headers, null, 2));

  console.log(`🚀 ${side.toUpperCase()} ${qty} ${body.symbol}`);
  const resp = await axios.post(url, body, { headers });
  return resp.data.id;
}

// ─── MAIN ORCHESTRATOR ─────────────────────────────────────────────
(async () => {
  console.log("=== Node Session-Persistent BONK Smoke Test ===");
  try {
    // 1) Fetch price
    const price = await fetchPrice();
    console.log(`🔄 ${QUOTE_SYMBOL} price: $${price}`);

    // 2) Compute whole-unit qty
    const rawQty = TRADE_USD / price;
    const qty    = Math.floor(rawQty);
    if (qty < 1) throw new Error("Qty < 1 – insufficient USD");

    console.log(`📊 Qty for $${TRADE_USD.toFixed(2)}: ${qty}`);

    // 3) BUY
    const buyId = await placeOrder("buy", qty);
    console.log("✅ BUY accepted:", buyId);

    // 4) Pause then SELL
    await new Promise(r => setTimeout(r, 5000));
    const sellId = await placeOrder("sell", qty);
    console.log("✅ SELL accepted:", sellId);

    console.log("🏁 Smoke test complete.");
  } catch (err) {
    console.error(
      "❌ Smoke test failed:",
      err.response?.data || err.message
    );
    process.exit(1);
  }
})();
