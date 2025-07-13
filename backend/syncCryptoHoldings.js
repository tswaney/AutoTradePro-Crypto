// syncCryptoHoldings.js - fetch using trading endpoint
require("dotenv").config();
const axios = require("axios");
const { getAccessToken } = require("./sessionManager");

const TRADING_API = "https://trading.robinhood.com";
const USER_AGENT = "Mozilla/5.0 PowerShell/7.2.0";

async function fetchCryptoPositions() {
  const token = await getAccessToken();
  const url = `${TRADING_API}/api/v1/crypto/positions/`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "User-Agent": USER_AGENT,
    Accept: "application/json",
    Origin: "https://robinhood.com",
  };

  const resp = await axios.get(url, { headers });
  return resp.data.results;
}

(async () => {
  try {
    console.log("🔄 Fetching all crypto positions from Robinhood...");
    const positions = await fetchCryptoPositions();
    positions.forEach(pos => {
      if (parseFloat(pos.quantity) > 0) {
        console.log(`${pos.currency_pair_id}: ${pos.quantity}`);
      }
    });
    // (Optionally: match currency_pair_id to symbols)
    // (Optionally: fetch prices for each symbol)
  } catch (err) {
    console.error("❌ Error syncing positions:", err.message);
  }
})();
