const axios = require("axios");

async function testPublicCryptoEndpoint() {
  try {
    const res = await axios.get("https://api.robinhood.com/crypto/products/");
    console.log("✅ Success: Got data from public endpoint");
    console.log(res.data.results?.slice(0, 5)); // print first 5 entries for testing
  } catch (err) {
    console.error(
      "❌ Public request failed:",
      err.response?.status,
      err.message
    );
  }
}

testPublicCryptoEndpoint();
