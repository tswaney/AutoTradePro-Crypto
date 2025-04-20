require("dotenv").config();
const axios = require("axios");

const HEADERS = {
  Authorization: `Bearer ${process.env.ROBINHOOD_API_KEY}`,
  "Content-Type": "application/json",
};

async function listCryptoProducts() {
  try {
    const res = await axios.get("https://api.robinhood.com/crypto/products/", {
      headers: HEADERS,
    });

    const products = res.data.results || [];

    products.forEach((p) => {
      console.log(
        `${p.name} (${p.id}) — Tradable: ${p.tradeable}, Symbol: ${p.asset_currency.code}`
      );
    });
  } catch (err) {
    console.error("❌ Error:", err.response?.status || err.code, err.message);
  }
}

listCryptoProducts();
