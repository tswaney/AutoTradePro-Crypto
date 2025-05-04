// fetchPairID.js

require("dotenv").config();
const axios = require("axios");

async function main() {
  if (!process.env.ROBINHOOD_API_KEY) {
    console.error("❌ Set ROBINHOOD_API_KEY in your .env");
    process.exit(1);
  }

  try {
    const resp = await axios.get(
      "https://nummus.robinhood.com/currency_pairs/?limit=200",
      { headers: { Authorization: `Bearer ${process.env.ROBINHOOD_API_KEY}` } }
    );

    // find the BONK-USD entry
    const pair = resp.data.results.find((p) => p.symbol === "BONK-USD");
    if (!pair) {
      console.error("❌ Could not find BONK-USD in the returned pairs");
      process.exit(1);
    }

    console.log("✅ BONK-USD pair-ID is:", pair.id);
    console.log("Add this to your .env as BONK_QUOTE_ID");
  } catch (err) {
    console.error(
      "❌ Error fetching currency_pairs:",
      err.response?.data || err.message
    );
    process.exit(1);
  }
}

main();
