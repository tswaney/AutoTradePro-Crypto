// sessionManager.js
// Persists Robinhood OAuth tokens to disk and auto-refreshes when expired.

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
  } catch (err) {
    console.error("❌ Failed to parse session file:", err.message);
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
    grant_type:    "refresh_token",
    refresh_token: refreshToken,
    client_id:     CLIENT_ID
  });

  const resp = await axios.post(
    "https://api.robinhood.com/oauth2/token/",
    form,
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept":       "application/json",
        "User-Agent":   "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)"
      }
    }
  );

  return {
    accessToken:  resp.data.access_token,
    refreshToken: resp.data.refresh_token || refreshToken,
    // Set expiresAt to now + expires_in (ms) - 1m
    expiresAt:    Date.now() + (resp.data.expires_in * 1000) - (60 * 1000)
  };
}

// Returns a valid access_token, refreshing & persisting if needed
async function getAccessToken() {
  let sess = loadSession();
  if (sess && sess.accessToken && sess.expiresAt > Date.now()) {
    console.log("🔑 Using cached access token");
    return sess.accessToken;
  }

  if (!sess || !sess.refreshToken) {
    throw new Error(
      "No session found. Please seed rh_session.json with valid tokens."
    );
  }

  console.log("🔄 Refreshing access token...");
  sess = await refreshSession(sess.refreshToken);
  saveSession(sess);
  console.log("✅ Session updated, next expiry at", new Date(sess.expiresAt));
  return sess.accessToken;
}

module.exports = { getAccessToken, PUBLIC_API_KEY };
