/**
 * sessionManager.js
 *
 * Persists Robinhood OAuth tokens to disk and auto-refreshes when expired.
 */

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const qs = require("querystring");
require("dotenv").config();

const SESSION_FILE = path.resolve(__dirname, "rh_session.json");
const { CLIENT_ID, PUBLIC_API_KEY } = process.env;

if (!CLIENT_ID) {
  console.error("❌ Set CLIENT_ID in your .env");
  process.exit(1);
}

// Load session from disk, or return null
function loadSession() {
  if (!fs.existsSync(SESSION_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
  } catch {
    return null;
  }
}

// Save session (tokens + expiry timestamp) to disk
function saveSession(session) {
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
}

// Refresh the access_token using refresh_token grant
async function refreshSession(refreshToken) {
  const form = qs.stringify({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
    scope: "internal",
  });
  const resp = await axios.post(
    "https://api.robinhood.com/oauth2/token/",
    form,
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return {
    accessToken: resp.data.access_token,
    refreshToken: resp.data.refresh_token || refreshToken,
    // expires_in is in seconds: set an absolute expiry timestamp
    expiresAt: Date.now() + resp.data.expires_in * 1000 - 60 * 1000, // refresh 1m early
  };
}

// Returns a valid access_token, refreshing & persisting if needed
async function getAccessToken() {
  let sess = loadSession();
  if (sess && sess.accessToken && sess.expiresAt > Date.now()) {
    return sess.accessToken;
  }
  if (!sess || !sess.refreshToken) {
    throw new Error(
      "No session found. Please run your initial fetchAuthToken flow."
    );
  }
  console.log("🔄 Refreshing access token...");
  sess = await refreshSession(sess.refreshToken);
  saveSession(sess);
  return sess.accessToken;
}

module.exports = { getAccessToken, PUBLIC_API_KEY };
