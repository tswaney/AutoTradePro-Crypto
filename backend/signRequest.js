// signRequest.js
// Signs Robinhood crypto orders using Ed25519 and outputs a standard Base64 signature.

const nacl = require("tweetnacl");
const util = require("tweetnacl-util");
require("dotenv").config();

// Ensure the ED25519_PRIVATE_KEY env var (base64 seed) is set
if (!process.env.ED25519_PRIVATE_KEY) {
  throw new Error("Set ED25519_PRIVATE_KEY in your .env (44-char base64 seed)");
}

// Decode the base64-encoded seed into raw bytes
const privSeed = util.decodeBase64(process.env.ED25519_PRIVATE_KEY);
// Validate seed length (must be 32 bytes)
if (privSeed.length !== nacl.sign.seedLength) {
  throw new Error(
    `Invalid ED25519 seed length: ${privSeed.length} bytes (expected ${nacl.sign.seedLength})`
  );
}

// Derive the Ed25519 key pair from the 32-byte seed
const keyPair = nacl.sign.keyPair.fromSeed(privSeed);

/**
 * signRequest
 * @param {string} apiKey    — your PUBLIC_API_KEY (rh-api-…)
 * @param {string} timestamp — unix-seconds string
 * @param {string} path      — e.g. "/api/v1/crypto/trading/orders/"
 * @param {string} method    — HTTP verb, e.g. "POST"
 * @param {object} body      — the JSON body you’re sending
 * @returns {string} Base64 signature
 */
function signRequest(apiKey, timestamp, path, method, body) {
  // Construct the exact message Robinhood expects
  const message = apiKey + timestamp + path + method + JSON.stringify(body);

  // Sign using Ed25519
  const msgBytes = util.decodeUTF8(message);
  const sigBytes = nacl.sign.detached(msgBytes, keyPair.secretKey);

  // Encode signature in standard Base64
  return util.encodeBase64(sigBytes);
}

module.exports = { signRequest };
