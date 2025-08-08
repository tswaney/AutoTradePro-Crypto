# AutoTradePro Control-Plane API – Starter

Node/Express API that manages bots and exposes endpoints for the mobile app.
- REST endpoints: list bots, start/stop/restart, patch settings, metrics
- WebSocket: real-time log stream per bot (wss://.../bots/{id}/logs/stream)
- Local dev: reads a sample bots.json; stubs lifecycle calls

## Quick start
```bash
npm install
npm run dev
```
Default port: 4000.

## Env (.env)
```
PORT=4000
JWT_ISSUER=https://<your-b2c-tenant>.b2clogin.com/<guid>/v2.0/
JWT_AUDIENCE=<api-app-id-uri or client id>
ALLOW_INSECURE_DEV=true
```

Replace with your B2C values and set `ALLOW_INSECURE_DEV=false` for production.
