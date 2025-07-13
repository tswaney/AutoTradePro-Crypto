// signRequest.js
const nacl = require("tweetnacl");
const util = require("tweetnacl-util");
require("dotenv").config();

if (!process.env.ED25519_PRIVATE_KEY) {
  throw new Error("Set ED25519_PRIVATE_KEY in your .env (44-char base64 seed)");
}
const privSeed = util.decodeBase64(process.env.ED25519_PRIVATE_KEY);
if (privSeed.length !== nacl.sign.seedLength) {
  throw new Error(
    `Invalid ED25519 seed length: ${privSeed.length} bytes (expected ${nacl.sign.seedLength})`
  );
}
const keyPair = nacl.sign.keyPair.fromSeed(privSeed);

/**
 * signRequest (Robinhood 2024 crypto API)
 * @param {string} apiKey    — PUBLIC_API_KEY (not used in signature message)
 * @param {string} timestamp — unix-seconds string
 * @param {string} path      — exact API path, e.g. "/api/v1/crypto/trading/orders/"
 * @param {string} method    — "GET", "POST" (uppercase)
 * @param {object|null} body — The request body object (or null/undefined for GET)
 * @returns {string} Base64 signature
 */
function signRequest(apiKey, timestamp, path, method, body) {
  let message = timestamp + method.toUpperCase() + path;
  if (body) message += JSON.stringify(body); // No body? Don't append anything.
  // Debug: print the message being signed
  console.log("DEBUG SIGNING MESSAGE:", JSON.stringify(message));
  const msgBytes = util.decodeUTF8(message);
  const sigBytes = nacl.sign.detached(msgBytes, keyPair.secretKey);
  return util.encodeBase64(sigBytes);
}

module.exports = { signRequest };
