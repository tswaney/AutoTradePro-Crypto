const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const privateKey = fs.readFileSync(
  path.join(__dirname, "../private.pem"),
  "utf8"
);

function decryptWithPrivateKey(base64EncryptedString) {
  const buffer = Buffer.from(base64EncryptedString, "base64");
  const decrypted = crypto.privateDecrypt(
    {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    buffer
  );
  return decrypted.toString("utf8");
}

module.exports = { decryptWithPrivateKey };
