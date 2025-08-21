// control-plane/src/routes/bots.js
import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { buildSummary } from "../logParser.js"; // use the robust parser I shared

const router = express.Router();

// ---------- Paths & helpers ----------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DATA_DIR =
  process.env.DATA_DIR || path.join(REPO_ROOT, "backend", "data");
const LOGS_DIR =
  process.env.LOGS_DIR || path.join(REPO_ROOT, "backend", "logs");

function ts() {
  return new Date().toISOString();
}

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function firstExisting(paths) {
  for (const p of paths) if (p && exists(p)) return p;
  return null;
}

function resolveBotLogFile(id) {
  const cands = [
    path.join(DATA_DIR, id, "latest.log"),
    path.join(DATA_DIR, id, "testPrice_output.txt"),
    path.join(DATA_DIR, `${id}.log`),
    path.join(LOGS_DIR, `${id}.log`),
    path.join(LOGS_DIR, "latest.log"),
    path.join(DATA_DIR, "latest.log"),
  ];
  const found = firstExisting(cands);
  if (!found) {
    console.log(
      `[logs] ${ts()} no log file found for ${id}; candidates=`,
      cands
    );
  } else {
    // console.log(`[logs] ${ts()} using log file for ${id}: ${found}`);
  }
  return found;
}

function ensureBot(id) {
  if (!bots[id]) {
    bots[id] = {
      id,
      name: id,
      status: "stopped",
      strategyId: null,
      symbols: [],
      config: {},
      updatedAt: ts(),
    };
  }
  return bots[id];
}

// ---------- In-memory bots registry ----------
/** @type {Record<string, any>} */
const bots = {};

// ---------- Routes ----------

// Create bot
// POST /api/bots
router.post("/", (req, res) => {
  try {
    const { name, strategyId, symbols, config } = req.body || {};
    const id = String(name || `bot-${Math.random().toString(36).slice(2, 6)}`);
    console.log(
      `[/api/bots] ${ts()} POST body:`,
      JSON.stringify({ name, strategyId, symbols, config })
    );
    const bot = ensureBot(id);
    bot.name = id;
    bot.strategyId = strategyId || null;
    bot.symbols = Array.isArray(symbols) ? symbols.map(String) : [];
    bot.config = config || {};
    bot.updatedAt = ts();
    return res.json({ ok: true, id });
  } catch (e) {
    console.error(`[/api/bots] ${ts()} create error:`, e);
    return res.status(500).json({ error: "Create failed" });
  }
});

// List bots
// GET /api/bots
router.get("/", (_req, res) => {
  console.log(`[BOT] list`);
  res.json(Object.values(bots));
});

// Bot meta
// GET /api/bots/:id
router.get("/:id", (req, res) => {
  const id = req.params.id;
  console.log("[BOT] get", id);
  const bot = bots[id] || null;
  if (!bot) return res.status(404).json({ error: "Not found" });
  res.json(bot);
});

// Start
// POST /api/bots/:id/start
router.post("/:id/start", (req, res) => {
  const id = req.params.id;
  console.log("[BOT] start", id, req.body || {});
  const bot = ensureBot(id);
  const { strategyId, symbols, config } = req.body || {};
  if (strategyId !== undefined) bot.strategyId = strategyId;
  if (Array.isArray(symbols)) bot.symbols = symbols.map(String);
  if (config && typeof config === "object") bot.config = config;
  if (bot.status !== "running") {
    bot.status = "running";
    bot.updatedAt = ts();
    return res.json({ ok: true, changed: true, bot });
  }
  return res.json({
    ok: true,
    changed: false,
    message: "Already running",
    bot,
  });
});

// Stop
// POST /api/bots/:id/stop
router.post("/:id/stop", (req, res) => {
  const id = req.params.id;
  console.log("[BOT] stop", id);
  const bot = ensureBot(id);
  if (bot.status !== "stopped") {
    bot.status = "stopped";
    bot.updatedAt = ts();
    return res.json({ ok: true, changed: true, bot });
  }
  return res.json({
    ok: true,
    changed: false,
    message: "Already stopped",
    bot,
  });
});

// Delete
// DELETE /api/bots/:id
router.delete("/:id", (req, res) => {
  const id = req.params.id;
  console.log("[BOT] delete", id);
  if (bots[id]) {
    delete bots[id];
  }
  return res.json({ ok: true });
});

// Summary (numbers for the mobile card)
// GET /api/bots/:id/summary
router.get("/:id/summary", (req, res) => {
  const id = req.params.id;
  try {
    const logFile = resolveBotLogFile(id);
    let text = "";
    if (logFile && exists(logFile)) {
      try {
        text = fs.readFileSync(logFile, "utf8");
      } catch (e) {
        console.warn(`[summary] ${ts()} read error for ${id}:`, e.message);
      }
    }
    const summary = buildSummary(text || "");
    // also report status if we have it
    const bot = bots[id] || {};
    res.json({
      id,
      status: bot.status || "unknown",
      ...summary,
    });
  } catch (e) {
    console.error(`[summary] ${ts()} error for ${id}:`, e);
    res.status(500).json({ error: "Failed to build summary" });
  }
});

// Tail logs with cursor (byte offset)
// GET /api/bots/:id/logs?cursor=0&limit=32768
router.get("/:id/logs", (req, res) => {
  const id = req.params.id;
  const cursor = Math.max(0, parseInt(req.query.cursor, 10) || 0);
  const limit = Math.max(
    1024,
    Math.min(parseInt(req.query.limit, 10) || 64 * 1024, 2 * 1024 * 1024)
  );

  const logFile = resolveBotLogFile(id);
  if (!logFile || !exists(logFile)) {
    return res.json({ lines: [], cursor });
  }

  try {
    const stats = fs.statSync(logFile);
    const size = stats.size;

    // If no cursor supplied, tail last chunk
    const start =
      cursor === 0 ? Math.max(0, size - limit) : Math.min(cursor, size);
    const end = size;

    const fd = fs.openSync(logFile, "r");
    const len = end - start;
    const buffer = Buffer.alloc(len);
    fs.readSync(fd, buffer, 0, len, start);
    fs.closeSync(fd);

    const text = buffer.toString("utf8");
    // Split into lines (keep it simple; UI formats)
    const lines = text.length ? text.split(/\r?\n/).filter(Boolean) : [];

    const nextCursor = end; // byte position for the next poll
    return res.json({ lines, cursor: nextCursor });
  } catch (e) {
    console.error(`[logs] ${ts()} error for ${id}:`, e);
    return res
      .status(500)
      .json({ error: "Failed to read logs", lines: [], cursor });
  }
});

export default router;
