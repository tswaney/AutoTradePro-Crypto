const nacl = require('tweetnacl');
const util = require('tweetnacl-util');
const fs = require('fs');

const keyPair = nacl.sign.keyPair();

const privateSeed = keyPair.secretKey.slice(0, 32); // Ed25519 seed
const publicKey = keyPair.publicKey;

console.log('ED25519_PRIVATE_KEY (base64, save this in .env!):');
console.log(util.encodeBase64(privateSeed));
console.log('\nPUBLIC_API_KEY (base64, paste in portal and .env!):');
console.log(util.encodeBase64(publicKey));

fs.writeFileSync('./ed25519_seed.txt', util.encodeBase64(privateSeed));
fs.writeFileSync('./ed25519_pub_base64.txt', util.encodeBase64(publicKey));
