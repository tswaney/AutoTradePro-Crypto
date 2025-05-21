// backend/sessionManager.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");

// 1) Load your session token (if used)
let sessionToken = process.env.ROBINHOOD_SESSION_TOKEN;
if (!sessionToken) {
  // fallback: maybe load from rh_session.json
  const sessPath = path.resolve(__dirname, "rh_session.json");
  if (fs.existsSync(sessPath)) {
    sessionToken = JSON.parse(fs.readFileSync(sessPath, "utf8")).token;
  }
}
if (!sessionToken) {
  console.error("❌ Missing ROBINHOOD_SESSION_TOKEN");
  process.exit(1);
}

// 2) Load your registered API key
const PUBLIC_API_KEY = process.env.ROBINHOOD_API_KEY;
if (!PUBLIC_API_KEY) {
  console.error("❌ Missing ROBINHOOD_API_KEY (your dev API key)");
  process.exit(1);
}

async function getAccessToken() {
  // If Robinhood Crypto truly uses the API key as bearer, return PUBLIC_API_KEY here
  // Otherwise return your sessionToken:
  return sessionToken;
}

module.exports = {
  getAccessToken,
  PUBLIC_API_KEY,
};
