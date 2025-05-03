// backend/scripts/fetchCryptoWalletId.js
require("dotenv").config();
const axios = require("axios");

async function fetchCryptoWalletId(symbol = "BONKUSD") {
  const CRYPTO_TOKEN = process.env.ROBINHOOD_CRYPTO_TOKEN;
  if (!CRYPTO_TOKEN) {
    console.error("❌ Set ROBINHOOD_CRYPTO_TOKEN in your .env");
    process.exit(1);
  }

  const CRYPTO_HEADERS = {
    Authorization: `Bearer ${CRYPTO_TOKEN}`,
    "X-Robinhood-API-Key": "c82SH0WZOsabOXGP2sxqcj34FxkvfnWRZBKlBjFS",
    "Content-Type": "application/json",
    Accept: "application/json",
    Origin: "https://robinhood.com",
  };

  try {
    console.log(`→ Fetching all crypto accounts from Nummus…`);
    const res = await axios.get("https://nummus.robinhood.com/accounts/", {
      headers: CRYPTO_HEADERS,
    });

    const wallets = res.data.results || [];
    if (!wallets.length) {
      console.error(
        "❌ No accounts returned:",
        JSON.stringify(res.data, null, 2)
      );
      process.exit(1);
    }

    // extract the currency code portion ("BONK" from "BONKUSD")
    const wantedCurrency = symbol.replace(/USD$/i, "");
    const wallet = wallets.find((w) => w.currency === wantedCurrency);

    if (!wallet) {
      console.error(
        `❌ Could not find a wallet with currency="${wantedCurrency}".`,
        "\nAvailable currencies:",
        [...new Set(wallets.map((w) => w.currency))].join(", ")
      );
      process.exit(1);
    }

    console.log(`✅ Found wallet for ${wantedCurrency}:`);
    console.log(`   • id:       ${wallet.id}`);
    console.log(`   • balance:  ${wallet.balance} ${wallet.currency}`);
    console.log(`   • account:  ${wallet.account_id}`);
  } catch (err) {
    console.error(
      "⚠️  Failed to fetch crypto accounts:",
      err.response?.data || err.message
    );
    process.exit(1);
  }
}

fetchCryptoWalletId("BONKUSD");
