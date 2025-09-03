// control-plane/src/routes/bots.js
import express from "express";
import path from "path";
import fsp from "fs/promises";
import fs from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const backendDir = path.resolve(repoRoot, "backend");
const dataRoot = path.resolve(backendDir, "data");
const legacyDataRoot = path.resolve(backendDir, "default");
const logsRoot = path.resolve(backendDir, "logs");
const runnerPath = path.resolve(backendDir, "testPrice_Dev.js");

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
function isPidAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function readJSON(p, fallback = null) {
  try {
    return JSON.parse(await fsp.readFile(p, "utf8"));
  } catch {
    return fallback;
  }
}
async function writeJSON(p, obj) {
  await ensureDir(path.dirname(p));
  await fsp.writeFile(p, JSON.stringify(obj, null, 2), "utf8");
}
async function writeMeta(dir, patch) {
  const p = path.join(dir, "bot.json");
  const cur = (await readJSON(p, {})) || {};
  const m = { ...cur, ...patch };
  await writeJSON(p, m);
  return m;
}
async function readMeta(dir) {
  return await readJSON(path.join(dir, "bot.json"), null);
}
async function resolveBotDir(id) {
  const good = path.join(dataRoot, id),
    legacy = path.join(legacyDataRoot, id);
  if (await exists(good)) return good;
  if (await exists(legacy)) {
    await ensureDir(path.dirname(good));
    try {
      await fsp.rename(legacy, good);
    } catch {
      await copyDir(legacy, good);
      await fsp.rm(legacy, { recursive: true, force: true });
    }
    return good;
  }
  return good;
}
async function copyDir(src, dest) {
  await ensureDir(dest);
  for (const ent of await fsp.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name),
      d = path.join(dest, ent.name);
    if (ent.isDirectory()) await copyDir(s, d);
    else if (ent.isFile()) await fsp.copyFile(s, d);
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
async function waitForLogGrowth(logPath, ms = 2500) {
  const start = Date.now();
  let last = -1;
  for (;;) {
    try {
      const st = await fsp.stat(logPath);
      if (last === -1) {
        if (st.size > 0) return true;
        last = st.size;
      } else if (st.size > last) {
        return true;
      }
    } catch {}
    if (Date.now() - start > ms) return false;
    await new Promise((r) => setTimeout(r, 150));
  }
}
function waitForExitOnce(child, ms = 2000) {
  // Wait up to 'ms' to see if it exits immediately
  return new Promise((res) => {
    let done = false;
    const t = setTimeout(() => {
      if (!done) {
        done = true;
        res(false);
      }
    }, ms);
    child.once("exit", () => {
      if (!done) {
        clearTimeout(t);
        done = true;
        res(true);
      }
    });
  });
}

/**
 * Normalize the summary we read from summary.json into a flat shape
 * that the mobile app can consume directly.
 *
 * We keep returning the original nested "summary" object for
 * backward-compatibility, but ALSO include a flattened set of
 * top-level fields:
 *   - descriptiveName
 *   - totalPL
 *   - locked
 *   - currentPortfolioValue
 *   - ratePerHour24h
 * (plus a couple extras that may be useful)
 */
function normalizeSummary(summary, meta) {
  const s = summary || {};
  const descriptiveName =
    s.descriptiveName ||
    s.strategy ||
    s.strategyName ||
    s.strategyLabel ||
    meta?.strategyId ||
    undefined;

  // Prefer pl24hAvgRatePerHour; fall back to overall or any other rate keys we recognize.
  const ratePerHour24h =
    s.pl24hAvgRatePerHour ??
    s.overall24hAvgRatePerHour ??
    s.ratePerHour24h ??
    s.metrics?.ratePerHour24h ??
    s.pl24hRatePerHour ??
    null;

  // Prefer currentValue; fall back to other portfolio value fields if present.
  const currentPortfolioValue =
    s.currentValue ??
    s.currentPortfolioValue ??
    s.totals?.portfolioValue ??
    s.portfolio?.value ??
    null;

  const totalPL = s.totalPL ?? s.dayPL ?? s.totals?.profit ?? null;
  const locked = s.locked ?? s.totals?.locked ?? s.cash?.locked ?? null;

  return {
    descriptiveName,
    totalPL,
    locked,
    currentPortfolioValue,
    ratePerHour24h,

    // Useful pass-throughs (not strictly required by the app now)
    beginningPortfolioValue: s.beginningPortfolioValue ?? null,
    duration: s.duration ?? null,
    durationText: s.durationText ?? null,
    buys: s.buys ?? null,
    sells: s.sells ?? null,
    pl24h: s.pl24h ?? null,
    pl24hEstimatedProfit: s.pl24hEstimatedProfit ?? null,
    cryptoMkt: s.cryptoMkt ?? null,
    cash: s.cash ?? null,
    staleCryptoMkt: s.staleCryptoMkt ?? null,
    staleSymbols: s.staleSymbols ?? null,
    priceFreshnessMs: s.priceFreshnessMs ?? null,
  };
}

const RUN = new Map(); // id -> { proc, pid, status, startedAt }
const router = express.Router();

/**
 * GET /api/bots
 * Returns a lightweight list of bots with id/name/status.
 */
router.get("/bots", async (_req, res) => {
  try {
    await ensureDir(dataRoot);
    const dirs = await fsp.readdir(dataRoot, { withFileTypes: true });
    const items = [];
    for (const ent of dirs) {
      if (!ent.isDirectory()) continue;
      const id = ent.name,
        dir = path.join(dataRoot, id);
      const meta = await readMeta(dir);
      const rec = RUN.get(id);
      const pid = rec?.pid ?? meta?.pid ?? null;
      const running = pid && isPidAlive(pid);
      items.push({
        id,
        name: id,
        status: running ? "running" : rec?.status || meta?.status || "stopped",
      });
    }
    res.set("Cache-Control", "no-store");
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * POST /api/bots
 * Create a new bot directory, write initial metadata, and seed summary.json.
 */
router.post("/bots", async (req, res) => {
  const { name, symbols, strategyId, config } = req.body || {};
  if (!name || typeof name !== "string")
    return res.status(400).json({ error: "name required" });
  const id = name,
    dir = path.join(dataRoot, id);
  await ensureDir(dir);
  await ensureDir(logsRoot);
  const meta = {
    id,
    name,
    symbols: symbols || "",
    strategyId: strategyId || "",
    createdAt: new Date().toISOString(),
    status: "stopped",
    pid: null,
    startedAt: null,
    config: {
      ...(config || {}),
      // Allow STRATEGY_NAME to be inferred from strategyId when not provided explicitly
      ...(strategyId && !config?.STRATEGY_NAME
        ? { STRATEGY_NAME: String(strategyId) }
        : {}),
    },
  };
  await writeJSON(path.join(dir, "bot.json"), meta);
  const sum = path.join(dir, "summary.json");
  if (!(await exists(sum))) await writeJSON(sum, defaultSummary());
  const holdDst = path.join(dir, "cryptoHoldings.json"),
    holdSrc = path.join(logsRoot, "cryptoHoldings.json");
  if (!(await exists(holdDst)) && (await exists(holdSrc))) {
    try {
      await fsp.copyFile(holdSrc, holdDst);
    } catch {}
  }
  res.json({ ok: true, id, status: "stopped" });
});

/**
 * GET /api/bots/:id/status
 * Returns running/stopped and pid/start time if running.
 */
router.get("/bots/:id/status", async (req, res) => {
  const { id } = req.params;
  const dir = await resolveBotDir(id);
  const meta = await readMeta(dir);
  const rec = RUN.get(id);
  const pid = rec?.pid ?? meta?.pid ?? null;
  const running = pid && isPidAlive(pid);
  res.set("Cache-Control", "no-store");
  res.json({
    id,
    status: running ? "running" : "stopped",
    pid: running ? pid : null,
    startedAt: running ? rec?.startedAt ?? meta?.startedAt ?? null : null,
  });
});

/**
 * GET /api/bots/:id/summary
 * Reads backend/data/<id>/summary.json and returns:
 *  - legacy structure: { id, name, status, summary: {...} }
 *  - PLUS a flattened, mobile-friendly view at the top level:
 *      descriptiveName, totalPL, locked, currentPortfolioValue, ratePerHour24h
 *
 * This lets the mobile UI work even if it doesn't know "summary.*" nesting.
 */
router.get("/bots/:id/summary", async (req, res) => {
  const { id } = req.params;
  const dir = await resolveBotDir(id);
  const sumPath = path.join(dir, "summary.json");
  const logPath = path.join(dir, "testPrice_output.txt");
  const meta = await readMeta(dir);
  const rec = RUN.get(id);
  const pid = rec?.pid ?? meta?.pid ?? null;
  const running = pid && isPidAlive(pid);

  // Start with a safe default
  let summary = defaultSummary();

  // Load current summary.json if present
  if (await exists(sumPath)) {
    try {
      summary = JSON.parse(await fsp.readFile(sumPath, "utf8"));
    } catch {
      // Corrupt or partial file: keep "summary" as default
    }
  }

  // If strategy name is missing, try to infer from logs or meta
  if (!summary.strategy) {
    try {
      const buf = await fsp.readFile(logPath, "utf8").catch(() => "");
      const m = buf.match(/Auto-selected strategy:\s*(.+)$/im);
      if (m && m[1]) summary.strategy = m[1].trim();
    } catch {}
    if (!summary.strategy && meta?.strategyId)
      summary.strategy = meta.strategyId;
  }

  // Build flat/mobile view
  const flat = normalizeSummary(summary, meta);

  res.set("Cache-Control", "no-store");
  res.json({
    id,
    name: id,
    status: running ? "running" : rec?.status || meta?.status || "stopped",

    // Keep original nested payload for compatibility
    summary,

    // 🔥 New, flattened fields (so the app can read directly)
    descriptiveName: flat.descriptiveName,
    totalPL: flat.totalPL,
    locked: flat.locked,
    currentPortfolioValue: flat.currentPortfolioValue,
    ratePerHour24h: flat.ratePerHour24h,

    // Optional pass-throughs (handy for other screens/debug)
    beginningPortfolioValue: flat.beginningPortfolioValue,
    duration: flat.duration,
    durationText: flat.durationText,
    buys: flat.buys,
    sells: flat.sells,
    pl24h: flat.pl24h,
    pl24hEstimatedProfit: flat.pl24hEstimatedProfit,
    cryptoMkt: flat.cryptoMkt,
    cash: flat.cash,
    staleCryptoMkt: flat.staleCryptoMkt,
    staleSymbols: flat.staleSymbols,
    priceFreshnessMs: flat.priceFreshnessMs,
  });
});

/**
 * GET /api/bots/:id/logs
 * Returns JSON: last N log lines (default 200).
 */
router.get("/bots/:id/logs", async (req, res) => {
  const { id } = req.params;
  const { limit = 200 } = req.query;
  const dir = await resolveBotDir(id);
  const logPath = path.join(dir, "testPrice_output.txt");
  try {
    const n = Math.max(1, Math.min(2000, Number(limit) || 200));
    const text = await fsp.readFile(logPath, "utf8").catch(() => "");
    const lines = text.split(/\r?\n/).filter(Boolean);
    res.set("Cache-Control", "no-store");
    res.json({ id, lines: lines.slice(-n) });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/**
 * GET /api/bots/:id/log
 * Returns plain text: last N log lines (default 200).
 */
router.get("/bots/:id/log", async (req, res) => {
  const { id } = req.params;
  const { tail = 200 } = req.query;
  const dir = await resolveBotDir(id);
  const logPath = path.join(dir, "testPrice_output.txt");
  try {
    const n = Math.max(1, Math.min(2000, Number(tail) || 200));
    const text = await fsp.readFile(logPath, "utf8").catch(() => "");
    const lines = text.split(/\r?\n/).filter(Boolean);
    res.set("Cache-Control", "no-store");
    res.type("text/plain").send(lines.slice(-n).join("\n"));
  } catch (e) {
    res
      .status(500)
      .type("text/plain")
      .send(String(e?.message || e));
  }
});

/**
 * POST /api/bots/:id/start
 * Spawns the runner (backend/testPrice_Dev.js) with environment for this bot.
 * Writes pid/status metadata and verifies early failures.
 */
router.post("/bots/:id/start", async (req, res) => {
  const { id } = req.params;
  const dir = await resolveBotDir(id);
  if (!(await exists(dir)))
    return res.status(404).json({ error: `bot '${id}' not found` });

  const meta = (await readMeta(dir)) || {};
  const prevPid = meta?.pid;
  if (prevPid && isPidAlive(prevPid)) {
    RUN.set(id, {
      proc: null,
      pid: prevPid,
      status: "running",
      startedAt: meta?.startedAt ?? null,
    });
    return res.json({ ok: true, id, status: "running", pid: prevPid });
  }

  if (!fs.existsSync(runnerPath)) {
    return res.status(500).json({
      error: "Strategy runner not found",
      expected: path.relative(repoRoot, runnerPath),
    });
  }

  const logPath = path.join(dir, "testPrice_output.txt");
  const bootErrPath = path.join(dir, "boot.err");

  const env = {
    ...process.env,
    BOT_ID: id,
    DATA_DIR: dir,
    HOLDINGS_FILE: path.join(dir, "cryptoHoldings.json"),
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
    ...(meta?.strategyId && !meta?.config?.STRATEGY_NAME
      ? { STRATEGY_NAME: String(meta.strategyId) }
      : {}),
  };

  try {
    const errFd = fs.openSync(bootErrPath, "a");
    const child = spawn(process.execPath, [runnerPath], {
      cwd: backendDir,
      env,
      stdio: ["ignore", "ignore", errFd], // stderr -> boot.err
      detached: false,
    });
    const pid = child.pid;
    const startedAt = Date.now();

    RUN.set(id, { proc: child, pid, status: "running", startedAt });
    await writeMeta(dir, { status: "running", pid, startedAt });

    // Detect instant failure and confirm log started
    const [exitedQuickly, logStarted] = await Promise.all([
      waitForExitOnce(child, 2000), // wait 2s for early crash
      waitForLogGrowth(logPath, 3000),
    ]);

    if (exitedQuickly && !logStarted) {
      let hint = "";
      try {
        hint = fs
          .readFileSync(bootErrPath, "utf8")
          .split(/\r?\n/)
          .slice(-30)
          .join("\n");
      } catch {}
      RUN.set(id, {
        proc: null,
        pid: null,
        status: "stopped",
        startedAt: null,
      });
      await writeMeta(dir, { status: "stopped", pid: null, startedAt: null });
      return res
        .status(500)
        .json({ error: "Runner exited immediately", pid, hint });
    }

    child.on("exit", async () => {
      RUN.set(id, {
        proc: null,
        pid: null,
        status: "stopped",
        startedAt: null,
      });
      await writeMeta(dir, {
        status: "stopped",
        pid: null,
        startedAt: null,
      }).catch(() => {});
    });

    return res.json({ ok: true, id, status: "running", pid });
  } catch (err) {
    RUN.set(id, { proc: null, pid: null, status: "stopped", startedAt: null });
    await writeMeta(dir, {
      status: "stopped",
      pid: null,
      startedAt: null,
    }).catch(() => {});
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

/**
 * POST /api/bots/:id/stop
 * Attempts a graceful stop, then SIGKILL fallback.
 */
router.post("/bots/:id/stop", async (req, res) => {
  const { id } = req.params;
  const rec = RUN.get(id);
  const dir = await resolveBotDir(id);
  const meta = await readMeta(dir);
  const pid = rec?.pid ?? meta?.pid ?? null;

  if (!pid || !isPidAlive(pid) || !rec?.proc) {
    RUN.set(id, { proc: null, pid: null, status: "stopped", startedAt: null });
    await writeMeta(dir, {
      status: "stopped",
      pid: null,
      startedAt: null,
    }).catch(() => {});
    return res.json({ ok: true, id, status: "stopped" });
  }

  try {
    rec.proc.kill("SIGINT");
  } catch {}
  setTimeout(() => {
    try {
      !rec.proc.killed && rec.proc.kill("SIGKILL");
    } catch {}
  }, 6000);

  RUN.set(id, { proc: null, pid: null, status: "stopped", startedAt: null });
  await writeMeta(dir, { status: "stopped", pid: null, startedAt: null }).catch(
    () => {}
  );
  res.json({ ok: true, id, status: "stopped" });
});

/**
 * POST /api/bots/:id/delete
 * Stops the process if running and removes all bot data.
 */
router.post("/bots/:id/delete", async (req, res) => {
  const { id } = req.params;
  const rec = RUN.get(id);
  if (rec?.proc && !rec.proc.killed) {
    try {
      rec.proc.kill("SIGINT");
    } catch {}
  }
  RUN.delete(id);
  const dir = await resolveBotDir(id);
  if (await exists(dir)) await fsp.rm(dir, { recursive: true, force: true });
  res.json({ ok: true, id });
});

export default router;
