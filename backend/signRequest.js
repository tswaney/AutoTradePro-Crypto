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
  // 1. Print all inputs
  console.log("=== SIGN REQUEST INPUTS ===");
  console.log("apiKey:      ", apiKey);
  console.log("timestamp:   ", timestamp);
  console.log("path:        ", path);
  console.log("method:      ", method);
  console.log("body:        ", typeof body === "string" ? body : JSON.stringify(body));

  // 2. Build the message
  let message = apiKey + timestamp + path + method.toUpperCase();
  if (body) {
    message += typeof body === "string" ? body : JSON.stringify(body);
  }

  // 3. Print the final message string and its hex/bytes
  console.log("\n=== DEBUG SIGNING MESSAGE (string) ===\n", message);
  console.log("\n=== DEBUG SIGNING MESSAGE (hex) ===\n", Buffer.from(message, 'utf8').toString('hex'));
  console.log("=== DEBUG SIGNING MESSAGE (length) ===", Buffer.from(message, 'utf8').length);

  // 4. Generate and print the signature
  const msgBytes = util.decodeUTF8(message);
  const sigBytes = nacl.sign.detached(msgBytes, keyPair.secretKey);
  const sigBase64 = util.encodeBase64(sigBytes);
  console.log("=== DEBUG SIGNATURE (base64) ===", sigBase64);

  return sigBase64;
}

module.exports = { signRequest };
