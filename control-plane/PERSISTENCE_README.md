# Control-plane persistence (meta.json)

This adds **per-bot persistence** so lifetime metrics survive control-plane restarts.

- Each bot stores a `meta.json` at: `BOT_DATA_ROOT/<botId>/meta.json`
- Stored fields: id, name, strategyId, symbols, config, beginningPortfolioValue, bornAt, buys, sells, cash, cryptoMkt, locked, totalPL, lastSavedAt.
- On startup, the control-plane **loads** any existing `meta.json` files and advertises those bots in `/bots` (status defaults to `stopped`).
- The file is saved on **create**, **start**, **stop**, **process exit**, and opportunistically on **/bots/:id/stats** calls.

## Install / Run
```bash
cd control-plane
npm i express cors dotenv
# package.json should include: { "type": "module" }
node src/index.js
```

## Notes
- Strategy list is dynamic: `/strategies` scans `STRATEGIES_DIR` (or sibling `strategies/` next to `BOT_SCRIPT_PATH`) on every call.
- `STRATEGY_CHOICE` (1..N) is resolved at start time based on current directory contents, matching `testPrice_dev.js` expectations.
- To change data location, set `BOT_DATA_ROOT` in your `.env`.
