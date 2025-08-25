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
const dataRoot = path.resolve(backendDir, "data");
const logsRoot = path.resolve(backendDir, "logs");
const runnerPath = path.join(backendDir, "testPrice_Dev.js");

// Legacy location used by older router (wrong base = control-plane/)
const legacyDataRoot = path.resolve(
  path.join(__dirname, "..", ".."),
  "backend",
  "data"
);

/* ---------- helpers ---------- */
async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true }).catch(() => {});
}
async function exists(p) {
  try {
    await fsp.stat(p);
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
    await ensureDir(dataRoot);
    try {
      // Try atomic rename (works if same device)
      await fsp.rename(legacy, good);
    } catch {
      // Cross-device fallback: copy then remove
      await copyDir(legacy, good);
      await fsp.rm(legacy, { recursive: true, force: true });
    }
    return good;
  }

  return good; // return where it *should* be; caller will decide if not found
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

/* ---------- in-memory process table ---------- */
const RUN = new Map(); // id -> { proc, status, startedAt }

/* ---------- router ---------- */
const router = express.Router();

/* Debug: verify paths */
router.get("/debug/runner-path", async (_req, res) => {
  res.json({
    repoRoot,
    backendDir,
    dataRoot,
    logsRoot,
    legacyDataRoot,
    runnerPath,
    exists: fs.existsSync(runnerPath),
  });
});

/* List bots (derived from backend/data; migrate any legacy dirs we find) */
router.get("/bots", async (_req, res) => {
  await ensureDir(dataRoot);

  // If legacy root exists, migrate any dirs from there
  if (await exists(legacyDataRoot)) {
    const oldDirs = await fsp
      .readdir(legacyDataRoot, { withFileTypes: true })
      .catch(() => []);
    for (const ent of oldDirs) {
      if (ent.isDirectory()) {
        const id = ent.name;
        const target = path.join(dataRoot, id);
        const source = path.join(legacyDataRoot, id);
        if (!(await exists(target))) {
          try {
            await fsp.rename(source, target);
          } catch {
            await copyDir(source, target);
            await fsp.rm(source, { recursive: true, force: true });
          }
        }
      }
    }
  }

  const entries = await fsp
    .readdir(dataRoot, { withFileTypes: true })
    .catch(() => []);
  const bots = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const id = ent.name;
    const metaPath = path.join(dataRoot, id, "bot.json");
    let meta = { id, name: id, status: RUN.get(id)?.status || "stopped" };
    if (await exists(metaPath)) {
      try {
        const j = JSON.parse(await fsp.readFile(metaPath, "utf8"));
        meta = {
          ...meta,
          ...j,
          status: RUN.get(id)?.status || j.status || "stopped",
        };
      } catch {}
    }
    bots.push(meta);
  }
  res.json(bots);
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
    strategyId: strategyId || "",
    createdAt: new Date().toISOString(),
    status: "stopped",
    config: config || {},
  };

  await fsp.writeFile(
    path.join(botDir, "bot.json"),
    JSON.stringify(meta, null, 2)
  );

  const sumPath = path.join(botDir, "summary.json");
  if (!(await exists(sumPath)))
    await fsp.writeFile(sumPath, JSON.stringify(defaultSummary(), null, 2));

  const holdingsPath = path.join(botDir, "cryptoHoldings.json");
  if (!(await exists(holdingsPath)))
    await fsp.writeFile(holdingsPath, JSON.stringify({}, null, 2));

  const logFile = path.join(botDir, "testPrice_output.txt");
  if (!(await exists(logFile))) await fsp.writeFile(logFile, "");

  res.json({ ok: true, id, status: "stopped", name });
});

/* Summary -> reads backend/data/<id>/summary.json (with migration) */
router.get("/bots/:id/summary", async (req, res) => {
  const { id } = req.params;
  const botDir = await resolveBotDir(id);
  if (!(await exists(botDir)))
    return res.status(404).json({ error: `bot '${id}' not found` });

  const metaPath = path.join(botDir, "bot.json");
  const sumPath = path.join(botDir, "summary.json");

  let status = RUN.get(id)?.status || "stopped";
  try {
    if (await exists(metaPath)) {
      const j = JSON.parse(await fsp.readFile(metaPath, "utf8"));
      status = RUN.get(id)?.status || j.status || status;
    }
  } catch {}

  let summary = defaultSummary();
  if (await exists(sumPath)) {
    try {
      summary = JSON.parse(await fsp.readFile(sumPath, "utf8"));
    } catch {}
  }

  res.json({ id, name: id, status, summary });
});

/* Logs -> tail (with migration) */
router.get("/bots/:id/logs", async (req, res) => {
  const { id } = req.params;
  const botDir = await resolveBotDir(id);
  const logFile = path.join(botDir, "testPrice_output.txt");
  if (!(await exists(logFile))) return res.json({ lines: [] });
  try {
    const text = await fsp.readFile(logFile, "utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    const limit = Math.max(
      0,
      Math.min(parseInt(req.query.limit || "200", 10), 2000)
    );
    res.json({ lines: lines.slice(-limit) });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/* Start -> spawn backend/testPrice_Dev.js (with migration) */
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

  const env = {
    ...process.env,
    BOT_ID: id,
    DATA_DIR: botDir,
    HOLDINGS_FILE: path.join(botDir, "cryptoHoldings.json"),
    LOG_FILE: "testPrice_output.txt",
    LOG_PATH: logPath,
    ...(meta?.config && typeof meta.config === "object"
      ? Object.fromEntries(
          Object.entries(meta.config).map(([k, v]) => [
            String(k).toUpperCase(),
            String(v),
          ])
        )
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

    child.on("exit", async (code, sig) => {
      RUN.set(id, { proc: null, status: "stopped", startedAt: null });
      await writeMetaStatus(botDir, "stopped");
      try {
        fs.appendFileSync(
          logPath,
          `\n[runner] exited (code=${code ?? "null"} sig=${sig ?? "null"})\n`
        );
      } catch {}
    });

    child.on("error", async (err) => {
      RUN.set(id, { proc: null, status: "stopped", startedAt: null });
      await writeMetaStatus(botDir, "stopped");
      try {
        fs.appendFileSync(
          logPath,
          `\n[runner] spawn error: ${String((err && err.message) || err)}\n`
        );
      } catch {}
    });

    return res.json({ ok: true, id, status: "running" });
  } catch (err) {
    try {
      fs.appendFileSync(
        path.join(botDir, "testPrice_output.txt"),
        `\n[runner] failed: ${String(err?.message || err)}\n`
      );
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

/* Delete -> stop if running, remove data dir */
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
