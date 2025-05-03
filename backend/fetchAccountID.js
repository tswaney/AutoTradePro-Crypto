// scripts/fetchAccountID.js
require("dotenv").config();
const axios = require("axios");

async function fetchAccountID() {
  try {
    const res = await axios.get("https://api.robinhood.com/accounts/", {
      headers: {
        Authorization: `Bearer ${process.env.ROBINHOOD_API_KEY}`,
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PowerShell/7.2.0",
        Origin: "https://robinhood.com",
      },
    });
    const acct = res.data.results[0];
    // Extract the UUID from the 'url' field:
    const uuid = acct.url.split("/").slice(-2, -1)[0];
    console.log("Account UUID:", uuid);
    console.log("Human account number (for reference):", acct.account_number);
  } catch (err) {
    console.error(
      "Failed to fetch accounts:",
      err.response?.data || err.message
    );
    process.exit(1);
  }
}

fetchAccountID();
