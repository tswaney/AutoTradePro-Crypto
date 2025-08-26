// control-plane/src/routes/bots.js
import express from "express";
import path from "path";
import fsp from "fs/promises";
import fs from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

/* ---------- resolve repo paths (three levels up from control-plane/src/routes) ---------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// <repo>/
const repoRoot = path.resolve(__dirname, "..", "..", "..");

// Correct locations
const backendDir = path.resolve(repoRoot, "backend");
const routesDir = path.resolve(repoRoot, "control-plane", "src", "routes");

// New canonical data root
const dataRoot = path.resolve(backendDir, "data");
// Legacy (old) location we still migrate from if found
const legacyDataRoot = path.resolve(backendDir, "default");

// Logs folder (source of seed holdings file)
const logsRoot = path.resolve(backendDir, "logs");

// Runner we spawn
const runnerPath = path.resolve(backendDir, "testPrice_Dev.js");

/* ---------- utils ---------- */

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

function defaultSummary() {
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

async function writeMetaStatus(botDir, status) {
  try {
    const metaPath = path.join(botDir, "bot.json");
    const meta = JSON.parse(await fsp.readFile(metaPath, "utf8"));
    meta.status = status;
    await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2));
  } catch {}
}

async function readMeta(botDir) {
  try {
    return JSON.parse(
      await fsp.readFile(path.join(botDir, "bot.json"), "utf8")
    );
  } catch {
    return null;
  }
}

/** Ensure the correct bot dir exists; if it only exists in legacy path, migrate it. */
async function resolveBotDir(id) {
  const good = path.join(dataRoot, id);
  const legacy = path.join(legacyDataRoot, id);

  if (await exists(good)) return good;

  // migrate from legacy if present
  if (await exists(legacy)) {
    await ensureDir(path.dirname(good));
    try {
      await fsp.rename(legacy, good);
    } catch {
      // Cross-device fallback: copy then remove
      await copyDir(legacy, good);
      await fsp.rm(legacy, { recursive: true, force: true });
    }
    return good;
  }

  return good; // return where it should be; caller decides if not found
}

async function copyDir(src, dest) {
  await ensureDir(dest);
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const ent of entries) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) await copyDir(s, d);
    else if (ent.isFile()) await fsp.copyFile(s, d);
  }
}

/** Parse "Auto-selected strategy: ..." from log if present */
async function parseStrategyFromLog(logPath) {
  try {
    const buf = await fsp.readFile(logPath, "utf8");
    // search from the end (cheap-ish) for the last occurrence
    const m = buf.match(/Auto-selected strategy:\s*(.+)$/im);
    if (m && m[1]) return m[1].trim();
  } catch {}
  return null;
}

/* ---------- in-memory process table ---------- */
const RUN = new Map(); // id -> { proc, status, startedAt }

/* ---------- router ---------- */
const router = express.Router();

/* Debug: verify paths */
router.get("/debug/runner-path", async (_req, res) => {
  res.json({
    repoRoot,
    backendDir,
    runnerPath,
    exists: fs.existsSync(runnerPath),
  });
});

/* List bots: ids are directories under backend/data */
router.get("/bots", async (_req, res) => {
  try {
    await ensureDir(dataRoot);
    const dirs = await fsp.readdir(dataRoot, { withFileTypes: true });
    const items = [];
    for (const ent of dirs) {
      if (!ent.isDirectory()) continue;
      const id = ent.name;
      const dir = path.join(dataRoot, id);
      let status = "stopped";
      const meta = await readMeta(dir);
      if (meta?.status) status = meta.status;
      const run = RUN.get(id);
      if (run?.status) status = run.status;
      items.push({ id, name: id, status });
    }
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/* Create bot -> ensure /backend/data/<id>/ with seed files */
router.post("/bots", async (req, res) => {
  const { name, symbols, strategyId, config } = req.body || {};
  if (!name || typeof name !== "string")
    return res.status(400).json({ error: "name required" });

  const id = name;
  const botDir = path.join(dataRoot, id);
  await ensureDir(botDir);
  await ensureDir(logsRoot);

  const meta = {
    id,
    name,
    symbols: symbols || "",
    strategyId: strategyId || "", // keep as record; runner reads env instead
    createdAt: new Date().toISOString(),
    status: "stopped",
    // keep any other config but do not overwrite STRATEGY_NAME if caller already set it
    config: {
      ...(config || {}),
      // If UI only sent strategyId, also mirror it as STRATEGY_NAME for the runner
      ...(strategyId && !config?.STRATEGY_NAME
        ? { STRATEGY_NAME: strategyId }
        : {}),
    },
  };

  await fsp.writeFile(
    path.join(botDir, "bot.json"),
    JSON.stringify(meta, null, 2)
  );

  const sumPath = path.join(botDir, "summary.json");
  if (!(await exists(sumPath)))
    await fsp.writeFile(sumPath, JSON.stringify(defaultSummary(), null, 2));

  // Seed holdings: if /backend/data/<id>/cryptoHoldings.json missing, copy from /backend/logs/cryptoHoldings.json
  const holdingsDest = path.join(botDir, "cryptoHoldings.json");
  if (!(await exists(holdingsDest))) {
    const holdingsSrc = path.join(logsRoot, "cryptoHoldings.json");
    if (await exists(holdingsSrc)) {
      try {
        await fsp.copyFile(holdingsSrc, holdingsDest);
      } catch {}
    }
  }

  res.json({ ok: true, id, status: "stopped" });
});

/* Summary -> merge live status + file summary and add 'strategy' when we can */
router.get("/bots/:id/summary", async (req, res) => {
  const { id } = req.params;
  const botDir = await resolveBotDir(id);
  const sumPath = path.join(botDir, "summary.json");
  const logPath = path.join(botDir, "testPrice_output.txt");

  let status = "stopped";
  try {
    const j = await readMeta(botDir);
    if (j?.status) status = j.status;
    const rec = RUN.get(id);
    if (rec?.status) status = rec.status;
  } catch {}

  let summary = defaultSummary();
  if (await exists(sumPath)) {
    try {
      summary = JSON.parse(await fsp.readFile(sumPath, "utf8"));
    } catch {}
  }

  // Attach 'strategy' if we can infer it
  let strategy = summary.strategy || null;
  if (!strategy) {
    // 1) try last "Auto-selected strategy" from log
    strategy = await parseStrategyFromLog(logPath);
  }
  if (!strategy) {
    // 2) fall back to requested strategyId from meta (UI’s selection)
    const meta = await readMeta(botDir);
    if (meta?.strategyId) strategy = meta.strategyId;
  }
  summary.strategy = strategy || null;

  res.json({ id, name: id, status, summary });
});

/* Logs -> JSON lines; fallback to text route exists for RN caller that wants plain text */
router.get("/bots/:id/logs", async (req, res) => {
  const { id } = req.params;
  const { limit = 200 } = req.query;
  const botDir = await resolveBotDir(id);
  const logPath = path.join(botDir, "testPrice_output.txt");
  try {
    const n = Math.max(1, Math.min(2000, Number(limit) || 200));
    const text = await fsp.readFile(logPath, "utf8").catch(() => "");
    const lines = text.split(/\r?\n/).filter(Boolean);
    res.json({ id, lines: lines.slice(-n) });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

router.get("/bots/:id/log", async (req, res) => {
  const { id } = req.params;
  const { tail = 200 } = req.query;
  const botDir = await resolveBotDir(id);
  const logPath = path.join(botDir, "testPrice_output.txt");
  try {
    const n = Math.max(1, Math.min(2000, Number(tail) || 200));
    const text = await fsp.readFile(logPath, "utf8").catch(() => "");
    const lines = text.split(/\r?\n/).filter(Boolean);
    res.type("text/plain").send(lines.slice(-n).join("\n"));
  } catch (e) {
    res
      .status(500)
      .type("text/plain")
      .send(String(e?.message || e));
  }
});

/* Start -> spawn backend/testPrice_Dev.js */
router.post("/bots/:id/start", async (req, res) => {
  const { id } = req.params;
  const botDir = await resolveBotDir(id);
  if (!(await exists(botDir)))
    return res.status(404).json({ error: `bot '${id}' not found` });

  // already running?
  const prev = RUN.get(id);
  if (prev?.status === "running" && prev?.proc && !prev.proc.killed) {
    return res.json({ ok: true, id, status: "running" });
  }

  if (!fs.existsSync(runnerPath)) {
    return res.status(500).json({
      error: `Strategy runner not found`,
      expected: path.relative(repoRoot, runnerPath),
      tip: "Ensure the file exists at this path relative to repo root.",
    });
  }

  const meta = (await readMeta(botDir)) || {};
  const logPath = path.join(botDir, "testPrice_output.txt");

  // Build env; include meta.config (uppercased keys) AND pass STRATEGY_NAME if meta.strategyId exists.
  const env = {
    ...process.env,
    BOT_ID: id,
    DATA_DIR: botDir,
    HOLDINGS_FILE: path.join(botDir, "cryptoHoldings.json"),
    LOG_FILE: "testPrice_output.txt",
    LOG_PATH: logPath,

    // Prefer explicit config first…
    ...(meta?.config && typeof meta.config === "object"
      ? Object.fromEntries(
          Object.entries(meta.config).map(([k, v]) => [
            String(k).toUpperCase(),
            String(v),
          ])
        )
      : {}),

    // …but if only 'strategyId' was stored, expose it as STRATEGY_NAME too
    ...(meta?.strategyId && !meta?.config?.STRATEGY_NAME
      ? { STRATEGY_NAME: String(meta.strategyId) }
      : {}),
  };

  try {
    const child = spawn(process.execPath, [runnerPath], {
      cwd: backendDir, // run inside /backend
      env,
      stdio: ["ignore", "ignore", "ignore"], // script writes its own log file
      detached: false,
    });

    RUN.set(id, { proc: child, status: "running", startedAt: Date.now() });
    await writeMetaStatus(botDir, "running");

    child.on("exit", async (_code, _sig) => {
      RUN.set(id, { proc: null, status: "stopped", startedAt: null });
      await writeMetaStatus(botDir, "stopped").catch(() => {});
    });

    res.json({ ok: true, id, status: "running" });
  } catch (err) {
    try {
      RUN.set(id, { proc: null, status: "stopped", startedAt: null });
      await writeMetaStatus(botDir, "stopped").catch(() => {});
    } catch {}
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

/* Stop -> send SIGINT, fall back to SIGKILL after timeout */
router.post("/bots/:id/stop", async (req, res) => {
  const { id } = req.params;
  const rec = RUN.get(id);
  const botDir = await resolveBotDir(id);

  if (!rec?.proc || rec.proc.killed) {
    RUN.set(id, { proc: null, status: "stopped", startedAt: null });
    await writeMetaStatus(botDir, "stopped").catch(() => {});
    return res.json({ ok: true, id, status: "stopped" });
  }

  try {
    rec.proc.kill("SIGINT");
  } catch {}
  setTimeout(() => {
    try {
      !rec.proc.killed && rec.proc.kill("SIGKILL");
    } catch {}
  }, 5000);

  RUN.set(id, { proc: null, status: "stopped", startedAt: null });
  await writeMetaStatus(botDir, "stopped").catch(() => {});
  res.json({ ok: true, id, status: "stopped" });
});

/* Delete -> stop if running then remove folder */
router.post("/bots/:id/delete", async (req, res) => {
  const { id } = req.params;
  const rec = RUN.get(id);
  if (rec?.proc && !rec.proc.killed) {
    try {
      rec.proc.kill("SIGINT");
    } catch {}
  }
  RUN.delete(id);
  const botDir = await resolveBotDir(id);
  if (await exists(botDir))
    await fsp.rm(botDir, { recursive: true, force: true });
  res.json({ ok: true, id });
});

export default router;
