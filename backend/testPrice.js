// ✅ Load environment variables (like your Robinhood API Key) from .env file
require("dotenv").config();

// ✅ Import Axios library for making HTTP requests
const axios = require("axios");

// ✅ Define the base URL for pulling market quotes
const BASE_URL = "https://api.robinhood.com/marketdata/forex/quotes/";

// ✅ Setup the HTTP headers required for authorization
const HEADERS = {
  Authorization: `Bearer ${process.env.ROBINHOOD_API_KEY}`, // Inject API key from .env
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PowerShell/7.2.0", // Fake PowerShell User-Agent
  Accept: "application/json", // Accept JSON responses
};

// ✅ Set which crypto symbol you want to fetch (example: BTCUSD)
const symbol = "BTCUSD";

// ✅ Async function to fetch and display the crypto quote
async function getCryptoQuote() {
  try {
    // 🔵 Send a GET request to Robinhood API with headers
    const response = await axios.get(`${BASE_URL}${symbol}/`, {
      headers: HEADERS,
    });

    // ✅ Successfully received a response!
    const quote = response.data;

    // ✅ Display the important parts of the quote
    console.log("✅ Live Crypto Price:");
    console.log(`- Symbol: ${symbol}`);
    console.log(`- Mark Price: ${quote.mark_price}`);
    console.log(`- Ask Price: ${quote.ask_price}`);
    console.log(`- Bid Price: ${quote.bid_price}`);
  } catch (error) {
    // ❌ Handle any errors (like wrong token, server error, etc.)
    console.error(
      "❌ Error fetching live quote:",
      error.response?.status || error.code,
      error.message
    );
  }
}

// ✅ Run the fetch function when the script is called
getCryptoQuote();
