require("dotenv").config();
const axios = require("axios");
const { getAccessToken } = require("./sessionManager");

// Example: Load manual holdings
const holdings = require("./cryptoHoldings.json");

async function fetchPrice(symbol) {
  const token = await getAccessToken();
  const url = `https://api.robinhood.com/marketdata/forex/quotes/${symbol}/`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "User-Agent": "Mozilla/5.0 PowerShell/7.2.0",
    Accept: "application/json",
    Origin: "https://robinhood.com",
  };
  const resp = await axios.get(url, { headers });
  return parseFloat(resp.data.mark_price);
}

(async () => {
  for (let sym of Object.keys(holdings)) {
    const price = await fetchPrice(sym + "USD");
    console.log(`- ${sym}: ${holdings[sym].amount} @ $${price} = $${(holdings[sym].amount * price).toFixed(2)}`);
  }
})();
