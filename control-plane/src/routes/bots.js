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

const RUN = new Map(); // id -> { proc, pid, status, startedAt }
const router = express.Router();

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
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

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

router.get("/bots/:id/status", async (req, res) => {
  const { id } = req.params;
  const dir = await resolveBotDir(id);
  const meta = await readMeta(dir);
  const rec = RUN.get(id);
  const pid = rec?.pid ?? meta?.pid ?? null;
  const running = pid && isPidAlive(pid);
  res.json({
    id,
    status: running ? "running" : "stopped",
    pid: running ? pid : null,
    startedAt: running ? rec?.startedAt ?? meta?.startedAt ?? null : null,
  });
});

router.get("/bots/:id/summary", async (req, res) => {
  const { id } = req.params;
  const dir = await resolveBotDir(id);
  const sumPath = path.join(dir, "summary.json");
  const logPath = path.join(dir, "testPrice_output.txt");
  const meta = await readMeta(dir);
  const rec = RUN.get(id);
  const pid = rec?.pid ?? meta?.pid ?? null;
  const running = pid && isPidAlive(pid);
  let summary = defaultSummary();
  if (await exists(sumPath)) {
    try {
      summary = JSON.parse(await fsp.readFile(sumPath, "utf8"));
    } catch {}
  }
  // try to report strategy
  if (!summary.strategy) {
    try {
      const buf = await fsp.readFile(logPath, "utf8").catch(() => "");
      const m = buf.match(/Auto-selected strategy:\s*(.+)$/im);
      if (m && m[1]) summary.strategy = m[1].trim();
    } catch {}
    if (!summary.strategy && meta?.strategyId)
      summary.strategy = meta.strategyId;
  }
  res.json({
    id,
    name: id,
    status: running ? "running" : rec?.status || meta?.status || "stopped",
    summary,
  });
});

router.get("/bots/:id/logs", async (req, res) => {
  const { id } = req.params;
  const { limit = 200 } = req.query;
  const dir = await resolveBotDir(id);
  const logPath = path.join(dir, "testPrice_output.txt");
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
  const dir = await resolveBotDir(id);
  const logPath = path.join(dir, "testPrice_output.txt");
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
    return res
      .status(500)
      .json({
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

    // detect instant failure and confirm log started
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
