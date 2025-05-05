from nacl.signing import SigningKey
import base64

# Generate a *new* Ed25519 seed
signing_key = SigningKey.generate()
verify_key  = signing_key.verify_key

# Base64-encode the 32-byte seed and the public key
seed_b64   = base64.b64encode(signing_key.encode()).decode()
public_b64 = base64.b64encode(verify_key.encode()).decode()

print("ED25519_PRIVATE_KEY=", seed_b64)
print("ED25519_PUBLIC_KEY =", public_b64)
