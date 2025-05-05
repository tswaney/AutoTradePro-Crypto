// fetchAuthToken.js
//
// Fully automated OAuth login with push-based MFA for Robinhood using Axios & tough-cookie

(async () => {
  require("dotenv").config();
  const axios = require("axios");
  const tough = require("tough-cookie");
  const qs = require("querystring");
  const readline = require("readline");

  // Dynamically import axios-cookiejar-support to add cookie support
  const cookieJarSupportModule = await import("axios-cookiejar-support");
  const wrapper = cookieJarSupportModule.wrapper;
  wrapper(axios);

  const { ROBINHOOD_USERNAME, ROBINHOOD_PASSWORD, ROBINHOOD_CLIENT_ID } =
    process.env;
  if (!ROBINHOOD_USERNAME || !ROBINHOOD_PASSWORD) {
    console.error("❌ Set ROBINHOOD_USERNAME and ROBINHOOD_PASSWORD in .env");
    process.exit(1);
  }
  const CLIENT_ID =
    ROBINHOOD_CLIENT_ID || "c82SH0WZOsabOXGP2sxqcj34FxkvfnWRZBKlBjFS";
  const USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)";

  // Create axios instance with cookie jar
  const jar = new tough.CookieJar();
  const client = axios.create({ jar, withCredentials: true });

  // Readline for user prompt
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // 1) Seed cookies to get device_id
    await client.get("https://robinhood.com/login", {
      headers: { "User-Agent": USER_AGENT },
    });
    const cookies = await jar.getCookies("https://robinhood.com");
    const deviceCookie = cookies.find((c) => c.key === "device_id");
    if (!deviceCookie) throw new Error("Missing device_id cookie");
    const deviceToken = deviceCookie.value;

    const commonHeaders = {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    };

    // 2) Initial password grant -> triggers push MFA
    let verificationWorkflow;
    try {
      await client.post(
        "https://api.robinhood.com/oauth2/token/",
        qs.stringify({
          grant_type: "password",
          username: ROBINHOOD_USERNAME,
          password: ROBINHOOD_PASSWORD,
          scope: "internal",
          client_id: CLIENT_ID,
          device_token: deviceToken,
        }),
        { headers: commonHeaders }
      );
      console.log("✅ Logged in without MFA");
      process.exit(0);
    } catch (err) {
      const body = err.response?.data;
      if (!body?.verification_workflow?.id) {
        console.error("❌ Unexpected error:", body || err.message);
        process.exit(1);
      }
      verificationWorkflow = body.verification_workflow;
    }

    // 3) Prompt user to approve push in the app
    await new Promise((resolve) =>
      rl.question(
        `✔️ Push challenge sent (id=${verificationWorkflow.id}). Approve in your Robinhood app and press Enter…`,
        () => {
          rl.close();
          resolve();
        }
      )
    );

    // 4) Retry token grant with challenge-response header until success
    process.stdout.write("⏳ Completing authentication");
    let tokenData;
    const payload = {
      grant_type: "password",
      username: ROBINHOOD_USERNAME,
      password: ROBINHOOD_PASSWORD,
      scope: "internal",
      client_id: CLIENT_ID,
      device_token: deviceToken,
    };
    while (true) {
      try {
        const resp = await client.post(
          "https://api.robinhood.com/oauth2/token/",
          qs.stringify(payload),
          {
            headers: {
              ...commonHeaders,
              "X-ROBINHOOD-CHALLENGE-RESPONSE-ID": verificationWorkflow.id,
            },
          }
        );
        tokenData = resp.data;
        break;
      } catch (retryErr) {
        const retryBody = retryErr.response?.data;
        // If still pending, wait and retry
        if (
          retryBody?.verification_workflow?.workflow_status ===
          "workflow_status_internal_pending"
        ) {
          process.stdout.write(".");
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        console.error(
          "\n❌ Error completing MFA:",
          retryBody || retryErr.message
        );
        process.exit(1);
      }
    }

    // 5) Print tokens and exit
    console.log("\n✅ access_token:", tokenData.access_token);
    console.log("✅ refresh_token:", tokenData.refresh_token);
    process.exit(0);
  } catch (e) {
    console.error(
      "❌ Authentication flow failed:",
      e.response?.data || e.message
    );
    process.exit(1);
  }
})();
