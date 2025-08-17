// control-plane/src/index.js (v3.7)
import express from "express";
import cors from "cors";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { createRequire } from "module";
import { pathToFileURL } from "url";
import { loadAllBotsFromDisk, saveBotMeta, ensureDir } from "./persistence.js";

dotenv.config();
const require = createRequire(import.meta.url);

function loadEnvIfExists(p) {
  try {
    if (p && fs.existsSync(p)) {
      dotenv.config({ path: p, override: false });
      console.log(`[env] merged: ${p}`);
    }
  } catch {}
}

const PORT = Number(process.env.PORT || 4000);
const ROLLOVER_HOUR = Number(process.env.PL_DAY_START_HOUR ?? "9");

const BOT_SCRIPT_PATH =
  process.env.BOT_SCRIPT_PATH ||
  path.resolve(process.cwd(), "testPrice_Dev.js");

const STRATEGIES_DIR =
  process.env.STRATEGIES_DIR ||
  path.join(path.dirname(path.resolve(BOT_SCRIPT_PATH)), "strategies");

const BACKEND_DIR = path.dirname(path.resolve(BOT_SCRIPT_PATH));
loadEnvIfExists(path.join(path.dirname(path.resolve(STRATEGIES_DIR)), ".env"));
if (process.env.ENV_INCLUDE_FILES) {
  for (const p of String(process.env.ENV_INCLUDE_FILES).split(","))
    loadEnvIfExists(p.trim());
}

const BOT_DATA_ROOT =
  process.env.BOT_DATA_ROOT || path.resolve(process.cwd(), "data");

const app = express();
app.use(cors());
app.use(express.json());

// ------------------- Strategy discovery -------------------
function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
}
function normalizeMeta(mod) {
  const x = (mod && (mod.default ?? mod)) || {};
  for (const c of [x, x.meta, x.strategy, x.info, x.Strategy]) {
    if (!c) continue;
    const n = c.name || c.strategyName || c.title;
    const v = c.version || c.ver || c.v || c.strategyVersion;
    const d = c.description || c.desc || "";
    if (n && v) return { name: n, version: String(v), description: d };
  }
  return null;
}
function parseMetaFromSource(src) {
  const head = String(src || "").slice(0, 2048);
  const n = /name\s*:\s*['"`]([^'"`]+)['"`]/.exec(head);
  const v = /version\s*:\s*['"`]?([0-9A-Za-z._-]+)['"`]?/.exec(head);
  const d = /description\s*:\s*['"`]([^'"`]+)['"`]/.exec(head);
  if (n)
    return {
      name: n[1],
      version: v ? v[1] : "1.0",
      description: d ? d[1] : "",
    };
  return null;
}
async function loadStrategyMeta(fileAbs) {
  try {
    const m = normalizeMeta(require(fileAbs));
    if (m) return m;
  } catch {}
  try {
    const m = normalizeMeta(
      await import(pathToFileURL(fileAbs).href + `?t=${Date.now()}`)
    );
    if (m) return m;
  } catch {}
  try {
    const m = parseMetaFromSource(fs.readFileSync(fileAbs, "utf8"));
    if (m) return m;
  } catch {}
  return null;
}
async function scanStrategies() {
  const out = [];
  try {
    const abs = path.resolve(STRATEGIES_DIR);
    const files = fs
      .readdirSync(abs)
      .filter((f) => f.endsWith(".js"))
      .sort();
    for (let i = 0; i < files.length; i++) {
      const fileAbs = path.join(abs, files[i]);
      let meta = await loadStrategyMeta(fileAbs);
      if (!meta) {
        const base = path.basename(files[i], ".js");
        meta = { name: base, version: "1.0", description: "" };
      }
      const id = `${slug(meta.name)}-${slug(String(meta.version))}`;
      out.push({
        id,
        name: meta.name,
        version: String(meta.version),
        description: meta.description,
        file: files[i],
        choiceIndex: i + 1,
      });
    }
  } catch (e) {
    console.warn(
      `[strategies] scan failed for ${STRATEGIES_DIR}:`,
      e?.message || e
    );
  }
  return out;
}
app.get("/strategies", async (_req, res) => res.json(await scanStrategies()));
async function resolveChoiceIndexById(id) {
  const list = await scanStrategies();
  return list.find((s) => s.id === id)?.choiceIndex;
}

// ------------------- Config defaults (from .env) -------------------
const FAMILIES = {
  "dynamic-regime-switching-1-0": [
    /^DYNAMIC_/,
    /^REGIME_/,
    /^CONFIRM_TICKS$/,
    /^DCA_/,
    /^GRID_/,
    /^ACCUM(ULATE)?_/i,
    /^ATR_/,
  ],
  "dynamic-regime-switching-profit-lock-2-0": [
    /^DYNAMIC_/,
    /^REGIME_/,
    /^CONFIRM_TICKS$/,
    /^DCA_/,
    /^GRID_/,
    /^ACCUM(ULATE)?_/i,
    /^ATR_/,
    /^PROFIT_LOCK_/,
  ],
  "moderate-retain-mode-1-1": [
    /^GRID_/,
    /^ATR_/,
    /^CONFIRM_TICKS$/,
    /^MIN_HOLD_AMOUNT$/,
  ],
  "moderate-retain-mode-2-1": [
    /^GRID_/,
    /^ATR_/,
    /^CONFIRM_TICKS$/,
    /^WEIGHTED_/,
  ],
  "moderate-retain-mode-3-0": [
    /^GRID_/,
    /^ATR_/,
    /^CONFIRM_TICKS$/,
    /^LEVELS?$/i,
  ],
  "moderate-retain-mode-4-0": [
    /^GRID_/,
    /^ATR_/,
    /^CONFIRM_TICKS$/,
    /^PULLBACK_/,
    /^FLAT_PROFIT_/,
  ],
  "simple-buy-low-sell-high-1-1": [/^SIMPLE_/, /^defaultSlippage$/],
  "super-adaptive-strategy-1-0": [
    /^SUPER_/,
    /^SMA_/,
    /^EMA_/,
    /^VWAP_/,
    /^RSI_/,
    /^ATR_/,
    /^PROFIT_LOCK_/,
  ],
  "ultimate-safety-profit-strategy-1-0": [
    /^ULTIMATE_/,
    /^RISK_/,
    /^REINVESTMENT_/,
    /^DRAW_DOWN_BRAKE$/,
    /^CONFIRM_TICKS$/,
    /^ATR_/,
    /^PROFIT_LOCK_/,
  ],
  "ultimate-safety-profit-strategy-2-0": [
    /^ULTIMATE_/,
    /^RISK_/,
    /^REINVESTMENT_/,
    /^DRAW_DOWN_BRAKE$/,
    /^CONFIRM_TICKS$/,
    /^ATR_/,
    /^PROFIT_LOCK_/,
    /^AUTO_TUNE_/,
  ],
};
function getStrategyDefaults(strategyId) {
  const out = {};
  const upper = String(strategyId)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "_");
  const stratPrefix = `STRAT_${upper}_`;
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("BOTCFG_")) out[k.substring("BOTCFG_".length)] = v;
    else if (k.startsWith(stratPrefix))
      out[k.substring(stratPrefix.length)] = v;
  }
  const fam = FAMILIES[strategyId] || [];
  if (fam.length) {
    for (const [k, v] of Object.entries(process.env)) {
      if (!/KEY|TOKEN|SECRET|PASSWORD/i.test(k) && fam.some((re) => re.test(k)))
        out[k] = v;
    }
  }
  if (Object.keys(out).length === 0) {
    const GEN = [
      /^(SIMPLE_|GRID_|ATR_|PROFIT_LOCK_|SUPER_|ULTIMATE_|RISK_|REINVESTMENT_|DRAW_DOWN_BRAKE|CONFIRM_TICKS|MIN_HOLD_AMOUNT|defaultSlippage)/,
    ];
    for (const [k, v] of Object.entries(process.env)) {
      if (/KEY|TOKEN|SECRET|PASSWORD/i.test(k)) continue;
      if (GEN.some((re) => re.test(k))) out[k] = v;
    }
  }
  return out;
}
app.get("/strategies/:id/config", (req, res) =>
  res.json({
    strategyId: req.params.id,
    defaults: getStrategyDefaults(req.params.id),
  })
);

// ------------------- Bots registry -------------------
/**
 * @type {Record<string, {
 *  id:string, name:string, status:'running'|'stopped'|'starting'|'stopping',
 *  strategyId:string, symbols:string[], config?:Record<string,any>,
 *  child?:import('child_process').ChildProcess, _sim?:any,
 *  logs:string[], cursor:number,
 *  buys:number, sells:number, cash:number, cryptoMkt:number, locked:number, totalPL:number,
 *  beginningPortfolioValue?:number, bpvSource?:'initial'|'log',
 *  startedAt?:number, bornAt:number
 * }>}
 */
const bots = loadAllBotsFromDisk(BOT_DATA_ROOT);

const nowIso = () => new Date().toISOString();
function pushLog(bot, line) {
  const entry = `${nowIso()}  ${line}`;
  bot.logs.push(entry);
  if (bot.logs.length > 12000) bot.logs.splice(0, bot.logs.length - 12000);
  bot.cursor += 1;
  try {
    const dir = path.join(BOT_DATA_ROOT, bot.id);
    ensureDir(dir);
    fs.appendFileSync(path.join(dir, "latest.log"), entry + "\n");
  } catch {}
}
function readMeta(b) {
  try {
    const p = path.join(BOT_DATA_ROOT, b.id, "meta.json");
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      return j || {};
    }
  } catch {}
  return {};
}
function computePl24h(bot) {
  const now = new Date();
  const anchor = new Date(now);
  anchor.setHours(ROLLOVER_HOUR, 0, 0, 0);
  if (anchor > now) anchor.setDate(anchor.getDate() - 1);
  let sum = 0;
  for (const line of bot.logs) {
    const t = /^([^\s]+)\s+/.exec(line)?.[1];
    if (!t) continue;
    const when = new Date(t);
    if (!isFinite(when.getTime()) || when < anchor) continue;
    const mm = /P\/L\s*\$([0-9.,-]+)/i.exec(line);
    if (mm) {
      const v = parseFloat(mm[1].replace(/,/g, ""));
      if (!Number.isNaN(v)) sum += v;
    }
  }
  return { pl24h: sum, windowStart: anchor.toISOString() };
}
function durationString(bot) {
  if (!bot.startedAt) return "—";
  const ms = Date.now() - bot.startedAt;
  const h = Math.floor(ms / 3600000),
    m = Math.floor((ms % 3600000) / 60000),
    s = Math.floor((ms % 60000) / 1000);
  return `${h}h ${m}m ${s}s`;
}
function lifetimePlAveragePerDay(bot) {
  const now = Date.now();
  const days = Math.max((now - (bot.bornAt || now)) / 86400000, 1 / 24);
  return bot.totalPL / days;
}
function toNum(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[$, \t]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function parseRuntimeMetrics(bot, ln) {
  const mBegin = /Beginning Portfolio Value\s*[:=]\s*\$?([0-9.,-]+)/i.exec(ln);
  if (mBegin) {
    const v = toNum(mBegin[1]);
    if (v !== null) {
      bot.beginningPortfolioValue = v;
      bot.bpvSource = "log";
      saveBotMeta(BOT_DATA_ROOT, bot);
    }
  }
  const triple =
    /Cash\s*[:=]\s*\$?([0-9.,-]+)\s*,\s*Crypto\s*[:=]\s*\$?([0-9.,-]+)\s*,\s*Locked\s*[:=]\s*\$?([0-9.,-]+)/i.exec(
      ln
    );
  if (triple) {
    const c = toNum(triple[1]);
    if (c !== null) bot.cash = c;
    const m = toNum(triple[2]);
    if (m !== null) bot.cryptoMkt = m;
    const l = toNum(triple[3]);
    if (l !== null) bot.locked = l;
  }
  const mCash = /(^|\b)Cash\s*[:=]\s*\$?([0-9.,-]+)/i.exec(ln);
  if (mCash) {
    const v = toNum(mCash[2]);
    if (v !== null) bot.cash = v;
  }
  const mCrypto = /(^|\b)Crypto(?:\s*\(mkt\))?\s*[:=]\s*\$?([0-9.,-]+)/i.exec(
    ln
  );
  if (mCrypto) {
    const v = toNum(mCrypto[2]);
    if (v !== null) bot.cryptoMkt = v;
  }
  const mLocked = /(^|\b)Locked\s*[:=]\s*\$?([0-9.,-]+)/i.exec(ln);
  if (mLocked) {
    const v = toNum(mLocked[2]);
    if (v !== null) bot.locked = v;
  }
  const sellLocked = /SELL executed.*Locked\s*[:=]\s*\$?([0-9.,-]+)/i.exec(ln);
  if (sellLocked) {
    const v = toNum(sellLocked[1]);
    if (v !== null && v >= 0) bot.locked = Number(bot.locked || 0) + v;
  }
  const mTotal =
    /(Total P\/L|Total PL|P\/L total)\s*[:=]\s*\$?([0-9.,-]+)/i.exec(ln);
  if (mTotal) {
    const v = toNum(mTotal[2]);
    if (v !== null) bot.totalPL = v;
  }
  if (
    (!bot.beginningPortfolioValue || bot.beginningPortfolioValue === 0) &&
    typeof bot.cash === "number" &&
    typeof bot.cryptoMkt === "number"
  ) {
    const inferred = bot.cash + bot.cryptoMkt + (bot.locked || 0);
    if (Number.isFinite(inferred) && inferred > 0)
      bot.beginningPortfolioValue = inferred;
  }
  if (/(BUY executed|🟢\s*BUY|\bBUY\b)/i.test(ln)) bot.buys += 1;
  if (/(SELL executed|🔴\s*SELL|\bSELL\b)/i.test(ln)) bot.sells += 1;
}

// ------------------- Spawn real script -------------------
async function resolveChoiceIndexByIdSafe(id) {
  try {
    return await resolveChoiceIndexById(id);
  } catch {
    return undefined;
  }
}
async function spawnReal(bot) {
  const dataDir = path.join(BOT_DATA_ROOT, bot.id);
  ensureDir(dataDir);

  // Seed only once
  try {
    const seededFlag = path.join(dataDir, "seeded.flag");
    if (!fs.existsSync(seededFlag)) {
      const dest = path.join(dataDir, "cryptoHoldings.json");
      const tmpl =
        process.env.TEMPLATE_HOLDINGS_FILE ||
        path.join(BACKEND_DIR, "data", "default", "cryptoHoldings.json");
      if (!fs.existsSync(dest) && fs.existsSync(tmpl)) {
        fs.copyFileSync(tmpl, dest);
        pushLog(bot, `[${bot.id}] seeded holdings from ${tmpl}`);
      }
      fs.writeFileSync(seededFlag, nowIso());
    }
  } catch (e) {
    pushLog(
      bot,
      `[${bot.id}] WARNING: holdings seed failed: ${e?.message || e}`
    );
  }

  const cleanConfig = {};
  for (const [k, v] of Object.entries(bot.config || {})) {
    const stripped = k
      .replace(/^BOTCFG_/, "")
      .replace(/^STRAT_[A-Z0-9_]+_/, "");
    cleanConfig[stripped] = v;
  }
  const choiceIndex = await resolveChoiceIndexByIdSafe(bot.strategyId);
  const env = {
    ...process.env,
    BOT_ID: bot.id,
    DATA_DIR: dataDir,
    STRATEGY_CHOICE: choiceIndex,
    ...cleanConfig,
  };

  try {
    if (!fs.existsSync(BOT_SCRIPT_PATH))
      throw new Error(`BOT_SCRIPT_PATH not found: ${BOT_SCRIPT_PATH}`);
    pushLog(bot, `[${bot.id}] SPAWN: ${BOT_SCRIPT_PATH} (cwd=${BACKEND_DIR})`);
    const child = spawn(process.execPath, [BOT_SCRIPT_PATH], {
      env,
      cwd: BACKEND_DIR,
    });
    bot.child = child;
    child.stdout.on("data", (buf) => {
      const lines = buf.toString("utf8").split(/\r?\n/).filter(Boolean);
      for (const ln of lines) {
        pushLog(bot, ln);
        parseRuntimeMetrics(bot, ln);
      }
    });
    child.stderr.on("data", (buf) => {
      const lines = buf.toString("utf8").split(/\r?\n/).filter(Boolean);
      for (const ln of lines) pushLog(bot, `[stderr] ${ln}`);
    });
    child.on("exit", (code, sig) => {
      pushLog(bot, `[${bot.id}] exited code=${code} sig=${sig || ""}`);
      bot.status = "stopped";
      bot.child = undefined;
      saveBotMeta(BOT_DATA_ROOT, bot);
    });
  } catch (e) {
    pushLog(
      bot,
      `[${bot.id}] WARN: ${e?.message || e}. Falling back to simulator.`
    );
    bot._sim = setInterval(() => {
      if (bot.status !== "running") return;
      const d = (Math.random() - 0.5) * 5;
      bot.totalPL += d;
      bot.cash = (bot.cash || 0) + d * 0.5;
      bot.cryptoMkt = (bot.cryptoMkt || 0) + d * 0.5;
      pushLog(
        bot,
        `💤 Strategy decision for BTCUSD: HOLD @ $${(
          10000 +
          Math.random() * 200
        ).toFixed(2)}`
      );
      pushLog(
        bot,
        `[DEBUG][BTCUSD] price=${(10000 + Math.random() * 200).toFixed(
          6
        )}, costBasis=10000, trend=rangebound, delta=n/a, atr=1.05`
      );
      pushLog(
        bot,
        `Cash: $${(bot.cash || 0).toFixed(2)}, Crypto: $${(
          bot.cryptoMkt || 0
        ).toFixed(2)}, Locked: $${(bot.locked || 0).toFixed(2)}`
      );
      pushLog(bot, `P/L $${d.toFixed(2)}`);
    }, 2000);
  }
}

// ------------------- Routes -------------------
const r = express.Router();

r.get("/strategies", async (_req, res) => res.json(await scanStrategies()));
r.get("/strategies/:id/config", (req, res) =>
  res.json({
    strategyId: req.params.id,
    defaults: getStrategyDefaults(req.params.id),
  })
);

// list + snapshots (single call for list screen)
r.get("/bots", (_req, res) =>
  res.json(
    Object.values(bots).map((b) => ({
      id: b.id,
      name: b.name,
      status: b.status,
      strategyId: b.strategyId,
      symbols: b.symbols,
      config: b.config || {},
    }))
  )
);
r.get("/bots/snapshots", (_req, res) =>
  res.json(Object.values(bots).map((b) => buildStats(b)))
);

r.get("/bots/:id", (req, res) => {
  const b = bots[req.params.id];
  if (!b) return res.status(404).json({ error: "not_found" });
  res.json({
    id: b.id,
    name: b.name,
    status: b.status,
    strategyId: b.strategyId,
    symbols: b.symbols,
    config: b.config || {},
  });
});

r.post("/bots", (req, res) => {
  const { name, strategyId, symbols, config } = req.body || {};
  if (!name || !strategyId)
    return res.status(400).json({ error: "name and strategyId required" });
  const id = String(name).toLowerCase().replace(/\s+/g, "-");
  if (bots[id]) return res.status(409).json({ error: "bot id already exists" });
  const beginning = Number(process.env.INITIAL_BALANCE || 0) || 0;
  const bot = {
    id,
    name,
    strategyId,
    symbols: Array.isArray(symbols) ? symbols : [],
    config: config || {},
    status: "stopped",
    logs: [],
    cursor: 0,
    buys: 0,
    sells: 0,
    cash: beginning,
    cryptoMkt: 0,
    locked: 0,
    totalPL: 0,
    startedAt: undefined,
    bornAt: Date.now(),
    beginningPortfolioValue: beginning,
    bpvSource: "initial",
  };
  bots[id] = bot;
  pushLog(
    bot,
    `[${id}] created: strategy=${strategyId}, symbols=${bot.symbols.join(",")}`
  );
  ensureDir(path.join(BOT_DATA_ROOT, id));
  saveBotMeta(BOT_DATA_ROOT, bot);
  res.json({ id });
});

r.delete("/bots/:id", (req, res) => {
  const b = bots[req.params.id];
  if (!b) return res.status(404).json({ error: "not_found" });
  if (b.child) {
    try {
      b.child.kill("SIGTERM");
    } catch {}
  }
  if (b._sim) {
    clearInterval(b._sim);
    b._sim = undefined;
  }
  try {
    fs.rmSync(path.join(BOT_DATA_ROOT, b.id), { recursive: true, force: true });
  } catch {}
  delete bots[req.params.id];
  res.json({ ok: true });
});

r.get("/bots/:id/status", (req, res) => {
  const b = bots[req.params.id];
  if (!b) return res.status(404).json({ error: "not_found" });
  res.json({ status: b.status });
});

// idempotent start (won't double-start unless ?force=1)
r.post("/bots/:id/start", async (req, res) => {
  const b = bots[req.params.id];
  if (!b) return res.status(404).json({ error: "not_found" });
  if (b.status === "running" && b.child && !("force" in req.query))
    return res.json({ ok: true, alreadyRunning: true });
  b.status = "running";
  b.startedAt = Date.now();
  pushLog(b, `[${b.id}] started`);
  await spawnReal(b);
  saveBotMeta(BOT_DATA_ROOT, b);
  res.json({ ok: true, status: b.status });
});

r.post("/bots/:id/stop", (req, res) => {
  const b = bots[req.params.id];
  if (!b) return res.status(404).json({ error: "not_found" });
  if (b.status !== "stopped") {
    b.status = "stopped";
    if (b.child) {
      try {
        b.child.kill("SIGTERM");
      } catch {}
      b.child = undefined;
    }
    if (b._sim) {
      clearInterval(b._sim);
      b._sim = undefined;
    }
    pushLog(b, `[${b.id}] stopped`);
    saveBotMeta(BOT_DATA_ROOT, b);
  }
  res.json({ ok: true, status: b.status });
});

r.get("/bots/:id/logs", (req, res) => {
  const b = bots[req.params.id];
  if (!b) return res.status(404).json({ error: "not_found" });
  const since = Number(req.query.cursor || 0);
  const lines = since ? b.logs.slice(Math.max(0, since)) : b.logs.slice(-500);
  res.json({ lines, cursor: String(b.cursor) });
});
r.get("/bots/:id/logs.txt", (req, res) => {
  const b = bots[req.params.id];
  if (!b) return res.status(404).type("text/plain").send("not_found");
  res.type("text/plain").send(b.logs.join("\n"));
});

function buildStats(b) {
  // pull persisted BPV if memory doesn't have it yet
  if (
    (b.beginningPortfolioValue == null || b.beginningPortfolioValue === 0) &&
    b.id
  ) {
    const persisted = readMeta(b);
    if (persisted && persisted.beginningPortfolioValue) {
      b.beginningPortfolioValue = persisted.beginningPortfolioValue;
      b.bpvSource = b.bpvSource || persisted.bpvSource || "initial";
    }
  }
  const { pl24h } = computePl24h(b);
  const currentPortfolioValue =
    Number(b.cash || 0) + Number(b.cryptoMkt || 0) + Number(b.locked || 0);
  return {
    id: b.id,
    name: b.name,
    status: b.status,
    strategyId: b.strategyId,
    beginningPortfolioValue: b.beginningPortfolioValue || 0,
    bpvSource: b.bpvSource || "initial",
    duration: durationString(b),
    buys: b.buys,
    sells: b.sells,
    totalPL: b.totalPL,
    cash: b.cash,
    cryptoMkt: b.cryptoMkt,
    locked: b.locked,
    currentPortfolioValue,
    pl24h,
    avgDailyPL: lifetimePlAveragePerDay(b),
  };
}
r.get("/bots/:id/summary", (req, res) => {
  const b = bots[req.params.id];
  if (!b) return res.status(404).json({ error: "not_found" });
  saveBotMeta(BOT_DATA_ROOT, b);
  res.json(buildStats(b));
});
r.get("/bots/:id/stats", (req, res) => {
  const b = bots[req.params.id];
  if (!b) return res.status(404).json({ error: "not_found" });
  saveBotMeta(BOT_DATA_ROOT, b);
  res.json(buildStats(b));
});
r.get("/bots/:id/portfolio", (req, res) => {
  const b = bots[req.params.id];
  if (!b) return res.status(404).json({ error: "not_found" });
  res.json(buildStats(b));
});

app.use("/", r);
app.use("/api", r);

function persistAll() {
  try {
    for (const b of Object.values(bots)) saveBotMeta(BOT_DATA_ROOT, b);
  } catch {}
}
process.on("SIGINT", () => {
  persistAll();
  process.exit(0);
});
process.on("SIGTERM", () => {
  persistAll();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Control-plane (v3.7) listening on :${PORT}`);
  ensureDir(BOT_DATA_ROOT);
  console.log(`[strategies] DIR = ${path.resolve(STRATEGIES_DIR)}`);
  console.log(`[bot] script = ${path.resolve(BOT_SCRIPT_PATH)}`);
  console.log(`[data] root   = ${path.resolve(BOT_DATA_ROOT)}`);
});
