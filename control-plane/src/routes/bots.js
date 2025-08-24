// control-plane/src/routes/bots.js
import { Router } from "express";
import fs from "fs";
import { promises as fsp } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = Router();

// ----- ESM __dirname shim -----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----- Storage (bots registry) -----
const DATA_DIR =
  process.env.CONTROL_DATA_DIR || path.resolve(__dirname, "../data");
const DB_FILE = process.env.BOTS_DB_FILE || path.join(DATA_DIR, "bots.json");

async function ensureDataDir() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
}

async function readDB() {
  try {
    await ensureDataDir();
    const buf = await fsp.readFile(DB_FILE);
    const arr = JSON.parse(buf.toString());
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeDB(list) {
  await ensureDataDir();
  await fsp.writeFile(DB_FILE, JSON.stringify(list, null, 2));
}

function randSuffix(len = 4) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < len; i++)
    s += alphabet[(Math.random() * alphabet.length) | 0];
  return s;
}

function minimal(bot) {
  return {
    id: bot.id,
    name: bot.name || bot.id,
    status: bot.status || "stopped",
  };
}

function logsPathFor(botId) {
  // repo root from: control-plane/src/routes -> ../../.. (repo root)
  const repoRoot = path.resolve(__dirname, "../../..");
  return path.join(repoRoot, "backend", "logs", `${botId}.log`);
}

async function tailFile(file, limit = 200) {
  try {
    if (!fs.existsSync(file)) return [];
    const text = await fsp.readFile(file, "utf8");
    const lines = text.split(/\r?\n/);
    return limit > 0 && lines.length > limit
      ? lines.slice(lines.length - limit)
      : lines;
  } catch {
    return [];
  }
}

// ----- Core actions used by multiple routes -----
async function startBot(id) {
  const bots = await readDB();
  const idx = bots.findIndex((b) => b.id === id);
  if (idx === -1) return null;
  bots[idx].status = "running";
  bots[idx].updatedAt = new Date().toISOString();
  await writeDB(bots);
  return bots[idx];
}

async function stopBot(id) {
  const bots = await readDB();
  const idx = bots.findIndex((b) => b.id === id);
  if (idx === -1) return null;
  bots[idx].status = "stopped";
  bots[idx].updatedAt = new Date().toISOString();
  await writeDB(bots);
  return bots[idx];
}

async function deleteBot(id) {
  const bots = await readDB();
  const next = bots.filter((b) => b.id !== id);
  if (next.length === bots.length) return false;
  await writeDB(next);
  return true;
}

// ----- Routes -----
// GET /api/bots -> JSON array of {id,name,status}
router.get("/bots", async (_req, res) => {
  try {
    const list = await readDB();
    res.json(list.map(minimal));
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// POST /api/bots  { name, symbols, strategyId, config }
router.post("/bots", async (req, res) => {
  try {
    const { name, symbols, strategyId, config } = req.body || {};
    const id = (name && String(name).trim()) || `bot-${randSuffix()}`;

    const bots = await readDB();
    if (bots.some((b) => b.id === id)) {
      return res.status(409).json({ error: `Bot ${id} already exists` });
    }

    const record = {
      id,
      name: id,
      status: "stopped",
      symbols: symbols || "",
      strategyId: strategyId || "",
      config: config || {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    bots.push(record);
    await writeDB(bots);
    res.json({
      ok: true,
      id: record.id,
      status: record.status,
      name: record.name,
    });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// GET /api/bots/:id
router.get("/bots/:id", async (req, res) => {
  const { id } = req.params;
  const bots = await readDB();
  const bot = bots.find((b) => b.id === id);
  if (!bot) return res.status(404).json({ error: "Not found" });
  res.json(bot);
});

// GET /api/bots/:id/summary
router.get("/bots/:id/summary", async (req, res) => {
  const { id } = req.params;
  const bots = await readDB();
  const bot = bots.find((b) => b.id === id);
  if (!bot) return res.status(404).json({ error: "Not found" });

  const summary = {
    beginningPortfolioValue: null,
    duration: null,
    buys: 0,
    sells: 0,
    totalPL: 0,
    cash: null,
    cryptoMkt: null,
    locked: null,
    currentValue: 0,
    dayPL: 0,
  };

  res.json({
    id: bot.id,
    name: bot.name || bot.id,
    status: bot.status || "stopped",
    strategyId: bot.strategyId || "",
    strategyName: bot.strategyId || "",
    summary,
  });
});

// GET /api/bots/:id/logs?limit=200
router.get("/bots/:id/logs", async (req, res) => {
  const { id } = req.params;
  const limit = Math.max(
    0,
    parseInt(String(req.query.limit || "200"), 10) || 200
  );
  const file = logsPathFor(id);
  const lines = await tailFile(file, limit);
  res.json({ lines });
});

// POST /api/bots/:id/start
router.post("/bots/:id/start", async (req, res) => {
  const { id } = req.params;
  const bot = await startBot(id);
  if (!bot) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true, id: bot.id, status: bot.status });
});

// POST /api/bots/:id/stop
router.post("/bots/:id/stop", async (req, res) => {
  const { id } = req.params;
  const bot = await stopBot(id);
  if (!bot) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true, id: bot.id, status: bot.status });
});

// DELETE /api/bots/:id
router.delete("/bots/:id", async (req, res) => {
  const { id } = req.params;
  const ok = await deleteBot(id);
  if (!ok) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true, id });
});

// Legacy aliases kept for compatibility
router.post("/bots/:id/delete", async (req, res) => {
  const { id } = req.params;
  const ok = await deleteBot(id);
  if (!ok) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true, id });
});

// Even older singular paths used earlier:
router.post("/bot/:id/actions/start", async (req, res) => {
  const { id } = req.params;
  const bot = await startBot(id);
  if (!bot) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true, id: bot.id, status: bot.status });
});

router.post("/bot/:id/actions/stop", async (req, res) => {
  const { id } = req.params;
  const bot = await stopBot(id);
  if (!bot) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true, id: bot.id, status: bot.status });
});

router.post("/bot/:id/delete", async (req, res) => {
  const { id } = req.params;
  const ok = await deleteBot(id);
  if (!ok) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true, id });
});

export default router;
