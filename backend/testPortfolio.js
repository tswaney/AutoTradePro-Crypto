require("dotenv").config();
const axios = require("axios");
const { getAccessToken, PUBLIC_API_KEY } = require("./sessionManager");
const { signRequest } = require("./signRequest");

(async () => {
  try {
    const token     = await getAccessToken();
    const path      = "/api/v1/crypto/positions/"; // MUST MATCH!
    const url       = `https://trading.robinhood.com${path}`;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const method    = "GET";

    // For GET, payload is just: timestamp + method + path (no body)
    const signature = signRequest(
      PUBLIC_API_KEY,
      timestamp,
      path,
      method,
      null // no body for GET
    );

    // Debug: print what is being signed
    console.log("DEBUG sign args:", {
      key: PUBLIC_API_KEY,
      timestamp,
      path,
      method,
      body: null,
      signature
    });

    const headers = {
      Authorization: `Bearer ${token}`,
      "User-Agent":   "Mozilla/5.0 PowerShell/7.2.0",
      Accept:         "application/json",
      Origin:         "https://robinhood.com",
      "x-api-key":    PUBLIC_API_KEY,
      "x-timestamp":  timestamp,
      "x-signature":  signature,
    };

    // Debug: print headers
    console.log("DEBUG headers:", headers);

    const resp = await axios.get(url, { headers });
    console.log("✅ Positions response:", resp.data);
  } catch (err) {
    console.error("❌ Positions test failed:", err.message);
    if (err.response) console.error(err.response.data);
  }
})();
