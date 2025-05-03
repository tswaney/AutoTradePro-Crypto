// liveTestBonk.js
// One-off script: SELL $0.01 BONK, then BUY $0.01 BONK
// – Uses stock-API token for price quotes
// – Uses Nummus crypto token for currency_pairs lookup & orders

require("dotenv").config();
const axios = require("axios");
const { randomUUID } = require("crypto");

// —––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––
// Pull these from your .env (no < >):
const STOCK_TOKEN = process.env.ROBINHOOD_API_KEY; // stock-API OAuth token
const CRYPTO_TOKEN = process.env.ROBINHOOD_CRYPTO_TOKEN; // Nummus crypto bearer token
const ACCOUNT_ID = process.env.ROBINHOOD_ACCOUNT_ID; // MUST be the UUID, e.g. "3d961844-d360-45fc-989b-f6fca761d511"
const SYMBOL = "BONKUSD";
const PAIR_SYMBOL = "BONK-USD";
const USD_AMOUNT = 0.01; // $0.01 worth

// Quick UUID format sanity check
if (
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    ACCOUNT_ID
  )
) {
  console.error(
    `❌ ROBINHOOD_ACCOUNT_ID (“${ACCOUNT_ID}”) does not look like a UUID.`
  );
  console.error(
    "   Make sure you set it to the account *UUID*, not the human account number."
  );
  process.exit(1);
}

// —––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––
// Endpoints:
const QUOTE_URL = `https://api.robinhood.com/marketdata/forex/quotes/${SYMBOL}/`;
const CURRENCY_PAIR_URL = `https://nummus.robinhood.com/currency_pairs/?symbol=${PAIR_SYMBOL}`;
const CRYPTO_ORDERS = "https://nummus.robinhood.com/orders/";

// —––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––
// Headers:
const STOCK_HEADERS = {
  Authorization: `Bearer ${STOCK_TOKEN}`,
  "Content-Type": "application/json",
  Accept: "application/json",
  Origin: "https://robinhood.com",
};

const CRYPTO_HEADERS = {
  Authorization: `Bearer ${CRYPTO_TOKEN}`,
  "X-Robinhood-API-Key": "c82SH0WZOsabOXGP2sxqcj34FxkvfnWRZBKlBjFS",
  "Content-Type": "application/json",
  Accept: "application/json",
  Origin: "https://robinhood.com",
};

// —––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––
async function getPrice() {
  const res = await axios.get(QUOTE_URL, { headers: STOCK_HEADERS });
  return parseFloat(res.data.mark_price);
}

async function getCurrencyPairId() {
  const res = await axios.get(CURRENCY_PAIR_URL, { headers: CRYPTO_HEADERS });
  const list = res.data.results;
  if (!Array.isArray(list) || !list.length) {
    console.error(
      "❌ Could not find currency_pairs entry:",
      JSON.stringify(res.data, null, 2)
    );
    process.exit(1);
  }
  return list[0].id;
}

async function placeCryptoOrder(side, quantity, pairId) {
  const body = {
    account_id: ACCOUNT_ID,
    currency_pair_id: pairId,
    side, // 'buy' or 'sell'
    type: "market",
    time_in_force: "gfd",
    quantity: quantity.toFixed(8),
    ref_id: randomUUID(), // proper v4 UUID
  };
  const res = await axios.post(CRYPTO_ORDERS, body, {
    headers: CRYPTO_HEADERS,
  });
  return res.data;
}

(async () => {
  try {
    // 1) Fetch price & compute qty
    console.log("→ Fetching BONKUSD price...");
    const price = await getPrice();
    console.log(`  Current price: $${price.toFixed(8)}`);
    const qty = USD_AMOUNT / price;
    console.log(`  Qty for $${USD_AMOUNT}: ${qty.toFixed(8)} BONK`);

    // 2) Lookup currency_pair_id
    console.log("→ Fetching currency_pair_id for BONK-USD...");
    const pairId = await getCurrencyPairId();
    console.log(`  currency_pair_id: ${pairId}`);

    // 3) SELL
    console.log(`\n→ SELL $${USD_AMOUNT} BONK (qty ${qty.toFixed(8)})…`);
    const sellResp = await placeCryptoOrder("sell", qty, pairId);
    console.log("  SELL response:", sellResp);

    // 4) BUY
    console.log(`\n→ BUY  $${USD_AMOUNT} BONK (qty ${qty.toFixed(8)})…`);
    const buyResp = await placeCryptoOrder("buy", qty, pairId);
    console.log("  BUY response:", buyResp);

    console.log("\n✅ Done. Exiting.");
    process.exit(0);
  } catch (err) {
    console.error("⚠️  Live test error:", err.response?.data || err.message);
    process.exit(1);
  }
})();
