import express from "express";
import { promises as fsp } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// monorepo root = three levels up from control-plane/src/routes
const repoRoot = path.resolve(__dirname, "..", "..", "..");

const DATA_ROOT =
  process.env.DATA_ROOT || path.join(repoRoot, "backend", "data");
const LOG_DIR = process.env.LOG_DIR || path.join(repoRoot, "backend", "logs");

// ---------- helpers ----------
const sanitizeId = (v = "") => v.replace(/^\/+/, "").replace(/\/+$/, "");
const normId = (id) => {
  const clean = sanitizeId(id);
  return clean.startsWith("bot-") ? clean : `bot-${clean}`;
};

const botDir = (id) => path.join(DATA_ROOT, normId(id));
const metaPath = (id) => path.join(botDir(id), "meta.json");
const logPath = (id) => path.join(LOG_DIR, `${normId(id)}.log`);

async function ensureBotDir(id) {
  await fsp.mkdir(botDir(id), { recursive: true });
}
async function ensureLogDir() {
  await fsp.mkdir(LOG_DIR, { recursive: true });
}

async function readJSON(file, fallback = null) {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}
async function writeJSON(file, obj) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(obj, null, 2), "utf8");
}
async function tailFileLines(file, limit = 1000) {
  try {
    const content = await fsp.readFile(file, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    const n = Math.max(0, parseInt(limit, 10) || 0);
    return n ? lines.slice(-n) : lines;
  } catch {
    return [];
  }
}
const rand = (n = 4) =>
  Math.random()
    .toString(36)
    .slice(2, 2 + n);

// camelCase → UPPER_SNAKE (engine-style)
const toUpperSnake = (k) =>
  k
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/__/g, "_")
    .toUpperCase();

function toArrayCSV(v) {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  return String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Convert UI config (camelCase) to engine config (UPPER_SNAKE)
function toEngineConfig(cfg = {}) {
  const out = {};
  for (const [k, v] of Object.entries(cfg)) {
    let val = v;
    // coerce numeric-like fields
    if (
      k.toLowerCase().match(/threshold|slippage|risk|cap|brake|length|ticks/)
    ) {
      const num = Number(v);
      val = Number.isFinite(num) ? num : v;
    }
    // priorityCryptos -> array
    if (
      k.toLowerCase().includes("priority") &&
      k.toLowerCase().includes("crypto")
    ) {
      val = toArrayCSV(v);
    }
    out[toUpperSnake(k)] = val;
  }
  return out;
}

function initialSummary() {
  return {
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
}

// ---------- CREATE ----------
async function handleCreate(req, res) {
  try {
    const body = req.body || {};
    const inputId = body.id || body.name || `bot-${rand()}`;
    const id = normId(inputId);

    const symbols = Array.isArray(body.symbols)
      ? body.symbols.map((s) => String(s).trim()).filter(Boolean)
      : toArrayCSV(body.symbols).map((s) => s.toUpperCase());

    const strategyId = String(body.strategyId || body.strategy || "").trim();
    const strategyName = body.strategyName || strategyId || undefined;

    const uiConfig = body.config || body.params || {};
    const engineConfig = toEngineConfig(uiConfig);

    await ensureBotDir(id);
    await ensureLogDir();

    const meta = {
      id,
      name: id,
      status: "stopped",
      createdAt: new Date().toISOString(),
      symbols,
      strategyId: strategyId || undefined,
      strategyName: strategyName || undefined,
      config: uiConfig,
      engineConfig,
      summary: initialSummary(),
    };

    await writeJSON(metaPath(id), meta);

    // seed a small log line
    const seed = `[${new Date().toISOString()}] created ${id} strategy=${strategyId}\n`;
    await fsp.appendFile(logPath(id), seed, "utf8");

    res
      .status(201)
      .json({ ok: true, id, status: meta.status, name: meta.name });
  } catch (e) {
    res.status(500).json({ error: e?.message || "create failed" });
  }
}

// POST /api/bots (main entry point for “Create Bot”)
router.post("/bots", handleCreate);
// Back-compat: /api/bots/create
router.post("/bots/create", handleCreate);

// ---------- READ SUMMARY ----------
router.get("/bots/:id/summary", async (req, res) => {
  const id = sanitizeId(req.params.id);
  const meta = (await readJSON(metaPath(id), {})) || {};
  const summary = meta.summary || {};
  res.json({
    id: normId(id),
    name: meta.name || normId(id),
    status: meta.status || "stopped",
    strategyId:
      meta.strategyId || meta.strategyName || meta.strategy || undefined,
    strategyName:
      meta.strategyName || meta.strategyId || meta.strategy || undefined,
    summary: {
      beginningPortfolioValue: summary.beginningPortfolioValue ?? null,
      duration: summary.duration ?? null,
      buys: summary.buys ?? 0,
      sells: summary.sells ?? 0,
      totalPL: summary.totalPL ?? 0,
      cash: summary.cash ?? null,
      cryptoMkt: summary.cryptoMkt ?? null,
      locked: summary.locked ?? null,
      currentValue: summary.currentValue ?? 0,
      dayPL: summary.dayPL ?? 0,
    },
  });
});

// ---------- LOGS ----------
router.get("/bots/:id/logs", async (req, res) => {
  const id = sanitizeId(req.params.id);
  const limit = Number(req.query.limit || 1000);
  const lines = await tailFileLines(logPath(id), limit);
  res.json({ lines });
});

// ---------- START ----------
router.post("/bots/:id/start", async (req, res) => {
  const id = sanitizeId(req.params.id);
  await ensureBotDir(id);
  const meta = (await readJSON(metaPath(id), {})) || {};
  meta.status = "running";
  meta.startedAt = new Date().toISOString();
  await writeJSON(metaPath(id), meta);
  res.json({ ok: true, id: normId(id), status: meta.status });
});

// ---------- STOP ----------
router.post("/bots/:id/stop", async (req, res) => {
  const id = sanitizeId(req.params.id);
  await ensureBotDir(id);
  const meta = (await readJSON(metaPath(id), {})) || {};
  meta.status = "stopped";
  meta.stoppedAt = new Date().toISOString();
  await writeJSON(metaPath(id), meta);
  res.json({ ok: true, id: normId(id), status: meta.status });
});

// ---------- DELETE (POST variant) ----------
router.post("/bots/:id/delete", async (req, res) => {
  const id = sanitizeId(req.params.id);
  try {
    await fsp.rm(botDir(id), { recursive: true, force: true });
    res.json({ ok: true, id: normId(id) });
  } catch (e) {
    res.status(500).json({ error: e.message || "delete failed" });
  }
});

// ---------- DELETE (HTTP DELETE) ----------
router.delete("/bots/:id", async (req, res) => {
  const id = sanitizeId(req.params.id);
  try {
    await fsp.rm(botDir(id), { recursive: true, force: true });
    res.json({ ok: true, id: normId(id) });
  } catch (e) {
    res.status(500).json({ error: e.message || "delete failed" });
  }
});

export default router;
