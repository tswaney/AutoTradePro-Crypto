/**
 * liveTestBonk.js
 *
 * Smoke-test script for AutoTradePro Crypto using Robinhood’s private API:
 *  - Buys $0.05 worth of BONKUSD
 *  - Immediately sells that same quantity
 *
 * Prerequisites:
 *  1. In your `.env`, set:
 *       ROBINHOOD_API_KEY=<your Bearer token (from PowerShell auth)>
 *       PUBLIC_API_KEY=<your Robinhood public API key>
 *       PRIVATE_KEY_PATH=./rh-keypair   // Path to your RSA private key (PEM PKCS#1)
 *  2. Upload the matching public key in Robinhood’s Crypto API portal.
 *  3. Install dependencies:
 *       npm install axios dotenv
 */

require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { createSign, randomUUID } = require("crypto");

// Configuration
const TRADE_AMOUNT_USD = 0.05;
const QUOTE_SYMBOL = "BONKUSD";
const BEARER_TOKEN = process.env.ROBINHOOD_API_KEY; // Bearer token from PowerShell auth
const PUBLIC_API_KEY = process.env.PUBLIC_API_KEY;
const PRIVATE_KEY_PATH = process.env.PRIVATE_KEY_PATH;

if (!BEARER_TOKEN || !PUBLIC_API_KEY || !PRIVATE_KEY_PATH) {
  console.error(
    "❌ .env must include ROBINHOOD_API_KEY, PUBLIC_API_KEY, and PRIVATE_KEY_PATH"
  );
  process.exit(1);
}

// Load RSA private key (PEM PKCS#1 format)
const privateKey = fs.readFileSync(path.resolve(PRIVATE_KEY_PATH), "utf8");

// Common headers from testPrice.js (using Bearer token)
const HEADERS = {
  Authorization: `Bearer ${BEARER_TOKEN}`,
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 PowerShell/7.2.0",
  Accept: "application/json",
  Origin: "https://robinhood.com",
};

/** Fetch current mark price for QUOTE_SYMBOL */
async function fetchPrice() {
  const url = `https://api.robinhood.com/marketdata/forex/quotes/${QUOTE_SYMBOL}/`;
  try {
    const resp = await axios.get(url, { headers: HEADERS });
    const price = parseFloat(resp.data.mark_price);
    console.log(`🔄 Current price (${QUOTE_SYMBOL}): $${price}`);
    return price;
  } catch (err) {
    console.error(
      "❌ Error fetching market price:",
      err.response?.data || err.message
    );
    process.exit(1);
  }
}

/** Place a signed RSA-SHA256 market order */
async function placeOrder(side, qty) {
  const apiPath = "/api/v1/crypto/trading/orders/";
  const method = "POST";
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const payload = {
    client_order_id: randomUUID(),
    symbol: QUOTE_SYMBOL.replace("USD", "-USD"),
    side: side,
    type: "market",
    market_order_config: { asset_quantity: qty.toString() },
  };

  // Message to sign: timestamp + method + path + JSON body
  const message = timestamp + method + apiPath + JSON.stringify(payload);
  const signer = createSign("sha256");
  signer.update(message);
  // const signature = signer.sign(privateKey, "base64");
  const raw = signer.sign(privateKey); // Buffer
  let signature = raw
    .toString("base64") // standard Base64
    .replace(/\+/g, "-") // 62nd char
    .replace(/\//g, "_") // 63rd char
    .replace(/=+$/, ""); // trim padding

  // Merge HEADERS with signed order headers
  // const orderHeaders = {
  //   ...HEADERS,
  //   "x-api-key": PUBLIC_API_KEY,
  //   "x-timestamp": timestamp,
  //   "x-signature": signature,
  // };
  const orderHeaders = {
    ...HEADERS,
    "x-api-key": PUBLIC_API_KEY,
    "x-timestamp": timestamp,
    "x-signature": signature,
  };

  console.log(
    `🚀 ${side.toUpperCase()} ${qty} ${payload.symbol} (sig ${signature.slice(
      0,
      8
    )}...)`
  );
  try {
    const { data } = await axios.post(
      `https://trading.robinhood.com${apiPath}`,
      payload,
      { headers: orderHeaders }
    );
    console.log(`✅ ${side} order accepted. Order ID: ${data.id}`);
    return data;
  } catch (err) {
    console.error(
      `❌ Error placing ${side} order:`,
      err.response?.data || err.message
    );
    process.exit(1);
  }
}

(async () => {
  console.log("=== liveTestBonk.js Smoke Test ===");

  // 1) Fetch price
  const price = await fetchPrice();

  // 2) Calculate quantity
  let qty = TRADE_AMOUNT_USD / price;
  qty = parseFloat(qty.toFixed(8));
  console.log(`📊 Qty for $${TRADE_AMOUNT_USD}: ${qty}`);

  // 3) Execute buy then sell
  await placeOrder("buy", qty);
  console.log("⏳ Waiting 5s for buy fill...");
  await new Promise((res) => setTimeout(res, 5000));
  await placeOrder("sell", qty);

  console.log("🏁 Smoke test complete.");
})();
