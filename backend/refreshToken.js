// refreshToken.js
require("dotenv").config();
const axios = require("axios");
const qs = require("querystring");

(async () => {
  const { REFRESH_TOKEN, CLIENT_ID } = process.env;
  if (!REFRESH_TOKEN || !CLIENT_ID) {
    console.error("❌ Missing REFRESH_TOKEN or CLIENT_ID in .env");
    process.exit(1);
  }
  const form = qs.stringify({
    grant_type: "refresh_token",
    refresh_token: REFRESH_TOKEN,
    client_id: CLIENT_ID,
    scope: "internal",
  });

  try {
    const resp = await axios.post(
      "https://api.robinhood.com/oauth2/token/",
      form,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    console.log("✅ New access_token:", resp.data.access_token);
    console.log(
      "✅ New refresh_token:",
      resp.data.refresh_token || REFRESH_TOKEN
    );
  } catch (err) {
    console.error("❌ Refresh failed:", err.response?.data || err.message);
    process.exit(1);
  }
})();
