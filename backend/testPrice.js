// Load environment variables
require("dotenv").config();
const axios = require("axios");

// Define the endpoint you found working
const BASE_URL = "https://api.robinhood.com/marketdata/forex/quotes/";

// Setup API Key Header
const HEADERS = {
  Authorization: `Bearer ${process.env.ROBINHOOD_API_KEY}`,
  "Content-Type": "application/json",
};

// Define the asset you want (ex: BTCUSD)
const symbol = "BTCUSD";

async function getCryptoQuote() {
  try {
    const response = await axios.get(`${BASE_URL}${symbol}/`, {
      headers: HEADERS,
    });

    // Success! Display important fields
    const quote = response.data;
    console.log("✅ Crypto Quote Fetched Successfully:");
    console.log(`- Symbol: ${symbol}`);
    console.log(`- Mark Price: ${quote.mark_price}`);
    console.log(`- Ask Price: ${quote.ask_price}`);
    console.log(`- Bid Price: ${quote.bid_price}`);
  } catch (error) {
    console.error(
      "❌ Error fetching quote:",
      error.response?.status || error.code,
      error.message
    );
  }
}

// Run it
getCryptoQuote();
