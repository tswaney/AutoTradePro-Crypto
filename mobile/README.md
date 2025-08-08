# AutoTradePro Mobile (Expo) – Starter

This is a beginner-friendly Expo (React Native) starter that:
- Signs in with **Azure AD B2C** (email + password; Auth Code + PKCE) using `expo-auth-session`.
- Stores tokens securely with **expo-secure-store**.
- Supports **Face ID / Touch ID** unlock via **expo-local-authentication**.
- Talks to a **control-plane API** (Node/Express) for bots start/stop, settings, metrics, and logs.
- Streams logs via WebSocket (placeholder URL; enable once backend is deployed).

## Prereqs
- Node 18+
- `npm i -g expo-cli` (or `npx expo`)
- An **Azure AD B2C** tenant with a **User Flow** (SignUp/SignIn) created
- Mobile App registered in B2C (Client ID), and API App registered (scope)

## Quick start (local)
```bash
npm install
# or: yarn
npx expo start
```

In `src/auth/b2c.ts`, fill in your B2C config.
In `src/config.ts`, set the `API_BASE` to your local control-plane URL (default: http://localhost:4000).

## Face ID unlock
On first successful login, tokens are stored. When you enable **Use Face ID**, subsequent app launches will prompt Face ID to unlock tokens without re-entering password.

## Notes
- This starter uses the **AuthSession proxy** during dev for easier redirects. For production builds, add native redirect URIs and disable the proxy.
- WebSocket logs are stubbed; point `WS_BASE` in `src/config.ts` to your backend and set up the `/bots/{id}/logs/stream` endpoint.
