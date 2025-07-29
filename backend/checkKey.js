require('dotenv').config();
const nacl = require("tweetnacl");
const util = require("tweetnacl-util");

try {
  const seed = util.decodeBase64(process.env.ED25519_PRIVATE_KEY);
  console.log(seed);
  console.log("Seed length:", seed.length); // should be 32
  const publicKeyBase64 = util.encodeBase64(nacl.sign.keyPair.fromSeed(seed).publicKey);
  console.log('Your public key:', publicKeyBase64);
  console.log('Expected PUBLIC_API_KEY:', process.env.PUBLIC_API_KEY);
} catch (e) {
  console.error("Invalid base64 seed!", e.message);
}
