// fetchAuthToken.js (interactive MFA flow)
//
// Authenticates with Robinhood to retrieve an OAuth2 access token,
// prompting interactively for 2FA codes when required.
//
// Usage:
//   1. In .env, set:
//        ROBINHOOD_USERNAME=<your email>
//        ROBINHOOD_PASSWORD=<your password>
//        ROBINHOOD_CLIENT_ID=<client ID, default if omitted>
//   2. npm install axios dotenv readline
//   3. node fetchAuthToken.js

require("dotenv").config();
const axios = require("axios");
const readline = require("readline");

const { ROBINHOOD_USERNAME, ROBINHOOD_PASSWORD, ROBINHOOD_CLIENT_ID } =
  process.env;

if (!ROBINHOOD_USERNAME || !ROBINHOOD_PASSWORD) {
  console.error(
    "❌ Please set ROBINHOOD_USERNAME and ROBINHOOD_PASSWORD in your .env"
  );
  process.exit(1);
}

const CLIENT_ID =
  ROBINHOOD_CLIENT_ID || "c82SH0WZOsabOXGP2sxqcj34FxkvfnWRZBKlBjFS";
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function requestToken(grantType, extra = {}) {
  const payload = {
    grant_type: grantType,
    username: ROBINHOOD_USERNAME,
    password: ROBINHOOD_PASSWORD,
    scope: "internal",
    client_id: CLIENT_ID,
    device_token: extra.device_token || "",
    ...extra,
  };
  try {
    const resp = await axios.post(
      "https://api.robinhood.com/oauth2/token/",
      payload,
      { headers: { "Content-Type": "application/json" } }
    );
    return resp.data;
  } catch (err) {
    return err.response?.data || { error: err.message };
  }
}

(async () => {
  console.log("=== Fetch Robinhood Access Token ===");

  // 1) Initial password grant
  const auth = await requestToken("password");
  if (auth.access_token) {
    console.log("✅ access_token:", auth.access_token);
    rl.close();
    return;
  }

  // 2) Handle MFA workflow
  const wf = auth.verification_workflow;
  if (wf && wf.id) {
    console.log("🔐 2FA required. Workflow ID:", wf.id);
    rl.question("Enter the 2FA code you received: ", async (code) => {
      // Respond to challenge
      await axios.post(
        `https://api.robinhood.com/challenge/${wf.id}/respond/`,
        { response: code },
        { headers: { "Content-Type": "application/json" } }
      );
      // Retry token request
      const retry = await requestToken("password");
      if (retry.access_token) {
        console.log("✅ access_token:", retry.access_token);
      } else {
        console.error("❌ Failed after 2FA:", retry);
      }
      rl.close();
    });
  } else {
    console.error("❌ Unexpected auth response:", auth);
    rl.close();
  }
})();
