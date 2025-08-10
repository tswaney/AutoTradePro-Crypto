// /control-plane/src/routes/bots.js
import express from "express";

const router = express.Router();

// In-memory bots registry
/** @type {Record<string, any>} */
const bots = {};

function ensureBot(id) {
  if (!bots[id]) {
    bots[id] = {
      botId: id,
      status: "stopped",
      mode: "demo",
      aiEnabled: false,
      strategyFile: null,
      symbols: [],
      updatedAt: new Date().toISOString(),
    };
  }
  return bots[id];
}

// GET /bots
router.get("/", (_req, res) => {
  console.log("[BOT] list");
  res.json(Object.values(bots));
});

// GET /bots/:id
router.get("/:id", (req, res) => {
  const id = req.params.id;
  console.log("[BOT] get", id);
  const bot = bots[id] || null;
  if (!bot) return res.status(404).json({ error: "Not found" });
  res.json(bot);
});

// POST /bots/:id/start
router.post("/:id/start", (req, res) => {
  const id = req.params.id;
  console.log("[BOT] start", id, req.body || {});
  const bot = ensureBot(id);
  const { strategyFile, symbols, mode, aiEnabled } = req.body || {};
  if (strategyFile !== undefined) bot.strategyFile = strategyFile;
  if (Array.isArray(symbols)) bot.symbols = symbols.map(String);
  if (mode !== undefined) bot.mode = mode;
  if (aiEnabled !== undefined) bot.aiEnabled = !!aiEnabled;

  const was = bot.status;
  if (bot.status !== "running") {
    bot.status = "running";
    bot.updatedAt = new Date().toISOString();
    return res.json({ ok: true, changed: true, bot });
  } else {
    return res.json({ ok: true, changed: false, message: "Already running", bot });
  }
});

// POST /bots/:id/stop
router.post("/:id/stop", (req, res) => {
  const id = req.params.id;
  console.log("[BOT] stop", id);
  const bot = ensureBot(id);
  if (bot.status !== "stopped") {
    bot.status = "stopped";
    bot.updatedAt = new Date().toISOString();
    return res.json({ ok: true, changed: true, bot });
  } else {
    return res.json({ ok: true, changed: false, message: "Already stopped", bot });
  }
});

// POST /bots/:id/restart
router.post("/:id/restart", (req, res) => {
  const id = req.params.id;
  console.log("[BOT] restart", id);
  const bot = ensureBot(id);
  bot.status = "running";
  bot.updatedAt = new Date().toISOString();
  res.json({ ok: true, changed: true, bot });
});

// PATCH /bots/:id
router.patch("/:id", (req, res) => {
  const id = req.params.id;
  console.log("[BOT] patch", id, req.body || {});
  const bot = ensureBot(id);
  const { strategyFile, symbols, mode, aiEnabled, status } = req.body || {};
  if (strategyFile !== undefined) bot.strategyFile = strategyFile;
  if (Array.isArray(symbols)) bot.symbols = symbols.map(String);
  if (mode !== undefined) bot.mode = mode;
  if (aiEnabled !== undefined) bot.aiEnabled = !!aiEnabled;
  if (status !== undefined) bot.status = status;
  bot.updatedAt = new Date().toISOString();
  res.json({ ok: true, bot });
});

// GET /bots/:id/logs (dummy logs)
router.get("/:id/logs", (req, res) => {
  const id = req.params.id;
  const n = Math.max(1, Math.min(parseInt(req.query.n, 10) || 10, 200));
  const logs = [];
  for (let i = 0; i < n; i++) {
    logs.push(`[${new Date().toISOString()}] ${id} • Log line ${i + 1}`);
  }
  res.json({ logs });
});

export default router;
