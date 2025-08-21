// control-plane/src/index.js
// v9 — summary fixes: strict executed trade counts, profit-lock fallback, crypto(mkt) from holdings+prices

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

/* ---------------- small helpers ---------------- */
const ts = () => new Date().toISOString();
function L(tag, ...args) {
  console.log(`[${tag}] ${ts()}`, ...args);
}
function loadEnvIfExists(p) {
  try {
    if (p && fs.existsSync(p)) {
      dotenv.config({ path: p, override: false });
      L("env", "merged:", p);
    }
  } catch {}
}
const nowIso = () => new Date().toISOString();
const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
function toNum(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[$, \t]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function money(v) {
  const n = toNum(v);
  return n == null ? 0 : n;
}

/* ---------------- config & paths ---------------- */
const PORT = Number(process.env.PORT || 4000);
const ROLLOVER_HOUR = Number(process.env.PL_DAY_START_HOUR ?? "9");

const CONTROL_PLANE_DIR = path.resolve(process.cwd());
const REPO_ROOT = fs.existsSync(path.join(CONTROL_PLANE_DIR, "backend"))
  ? CONTROL_PLANE_DIR
  : path.resolve(CONTROL_PLANE_DIR, "..");

// Bot runner script (best guess + env override)
const BOT_SCRIPT_CANDIDATES = [
  process.env.BOT_SCRIPT_PATH,
  path.join(REPO_ROOT, "backend", "testPrice_Dev.js"),
  path.join(CONTROL_PLANE_DIR, "testPrice_Dev.js"),
].filter(Boolean);
let BOT_SCRIPT_PATH = BOT_SCRIPT_CANDIDATES.find((p) => p && fs.existsSync(p));
if (!BOT_SCRIPT_PATH)
  BOT_SCRIPT_PATH =
    BOT_SCRIPT_CANDIDATES[0] ||
    path.join(REPO_ROOT, "backend", "testPrice_Dev.js");
const BACKEND_DIR = path.dirname(path.resolve(BOT_SCRIPT_PATH));

// Strategy directories — includes ../backend/strategies explicitly
const STRATEGY_CANDIDATE_DIRS = Array.from(
  new Set(
    [
      process.env.STRATEGIES_DIR, // explicit override (recommended)
      path.join(BACKEND_DIR, "strategies"),
      path.join(REPO_ROOT, "backend", "strategies"), // your layout in screenshots
      path.join(CONTROL_PLANE_DIR, "backend", "strategies"),
      path.join(CONTROL_PLANE_DIR, "strategies"),
      path.join(CONTROL_PLANE_DIR, "control-plane", "strategies"),
    ]
      .filter(Boolean)
      .map((p) => path.resolve(p))
  )
);

// Pull in neighboring .env if present
loadEnvIfExists(
  path.join(path.dirname(STRATEGY_CANDIDATE_DIRS[0] || BACKEND_DIR), ".env")
);
if (process.env.ENV_INCLUDE_FILES) {
  for (const p of String(process.env.ENV_INCLUDE_FILES).split(",")) {
    loadEnvIfExists(p.trim());
  }
}

// Data root (next to backend by default, matches your tree)
const BOT_DATA_ROOT =
  process.env.BOT_DATA_ROOT || path.resolve(REPO_ROOT, "backend", "data");

/* ---------------- express ---------------- */
const app = express();
app.use(cors());
app.use(express.json());

/* ---------------- bot state helpers ---------------- */
function buildInitialBotState(meta) {
  return {
    id: meta.id,
    name: meta.name,
    strategyId: meta.strategyId,
    status: meta.status || "stopped",
    createdAt: meta.createdAt || Date.now(),
    config: meta.config || {},
    symbols: meta.symbols || [],

    logs: [],
    cursor: 0,
    buys: 0,
    sells: 0,
    cash: Number(process.env.INITIAL_BALANCE || 0) || 0,
    cryptoMkt: 0,
    locked: 0,
    totalPL: 0,
    bornAt: Date.now(),
    startedAt: undefined,
    beginningPortfolioValue: Number(process.env.INITIAL_BALANCE || 0) || 0,
    bpvSource: "initial",
  };
}

/* ---------------- strategy discovery ---------------- */
const STRAT_FILE_EXTS = [".js", ".mjs", ".cjs"];

// Known families (also used for fallback list)
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

function prettyNameFromId(id) {
  const parts = String(id).split("-");
  const ver = parts.pop() || "1.0";
  const name = parts
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
    .join(" ");
  return { name, version: ver.replace(/^v/i, "") || "1.0" };
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
  const head = String(src || "").slice(0, 4096);
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
    const src = fs.readFileSync(fileAbs, "utf8");
    const m = parseMetaFromSource(src);
    if (m) return m;
  } catch {}
  return null;
}
function listFilesSafe(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return null;
  }
}
async function scanDirForStrategies(absDir, debug = false) {
  const out = [];
  if (!absDir) return out;

  const exists = fs.existsSync(absDir);
  const files = exists ? listFilesSafe(absDir) : null;
  if (debug) {
    L(
      "strat-scan",
      `dir=${absDir} exists=${exists} files=${files ? files.length : "n/a"}`
    );
  }
  if (!exists || !files) return out;

  const stratFiles = files
    .filter((f) => STRAT_FILE_EXTS.some((ext) => f.endsWith(ext)))
    .sort();
  if (debug)
    L(
      "strat-scan",
      `dir=${absDir} candidateStrategyFiles=${JSON.stringify(stratFiles)}`
    );

  for (let i = 0; i < stratFiles.length; i++) {
    const fileAbs = path.join(absDir, stratFiles[i]);
    let meta = await loadStrategyMeta(fileAbs);
    if (!meta) {
      const base = path.basename(stratFiles[i]).replace(/\.(m?c?)?js$/i, "");
      meta = { name: base, version: "1.0", description: "" };
    }
    const id = `${slug(meta.name)}-${slug(String(meta.version))}`;
    out.push({
      id,
      name: meta.name,
      version: String(meta.version),
      description: meta.description,
      file: stratFiles[i],
      choiceIndex: i + 1,
      dir: absDir,
    });
  }
  return out;
}
const DEFAULT_STRATEGY_LIST = Object.keys(FAMILIES).map((id, idx) => {
  const p = prettyNameFromId(id);
  return {
    id,
    name: p.name,
    version: p.version,
    description: "",
    file: "(fallback)",
    choiceIndex: idx + 1,
    dir: "(fallback)",
  };
});
async function scanStrategies(debug = false) {
  const seen = new Set();
  const results = [];
  const dirsScanned = [];

  const forceFallback =
    String(process.env.STRATEGIES_FALLBACK_ONLY || "").toLowerCase() === "1";

  if (!forceFallback) {
    for (const d of STRATEGY_CANDIDATE_DIRS) {
      const abs = path.resolve(d);
      dirsScanned.push(abs);
      const items = await scanDirForStrategies(abs, debug);
      for (const s of items) {
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        results.push(s);
      }
    }
  }

  if (results.length === 0) {
    results.push(...DEFAULT_STRATEGY_LIST);
    if (debug)
      L("strat-scan", "No files found; using DEFAULT_STRATEGY_LIST fallback");
  }

  L(
    "strategies",
    `scanned dirs=${JSON.stringify(dirsScanned)} -> found=${results.length}`
  );
  return results;
}
async function resolveChoiceIndexById(id) {
  const list = await scanStrategies();
  return list.find((s) => s.id === id)?.choiceIndex;
}

/* ---------------- defaults-from-env ---------------- */
function getStrategyDefaults(strategyId) {
  const out = {};
  const upper = String(strategyId)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "_");
  const stratPrefix = `STRAT_${upper}_`;

  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("BOTCFG_")) out[k.substring(7)] = v;
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

/* ---------------- in-memory bots ---------------- */
const bots = loadAllBotsFromDisk(BOT_DATA_ROOT);

function pushLog(bot, line) {
  const entry = `${nowIso()}  ${line}`;
  bot.logs.push(entry);
  if (bot.logs.length > 12000) bot.logs.splice(0, bot.logs.length - 12000);
  bot.cursor = (bot.cursor || 0) + 1;
  try {
    const dir = path.join(BOT_DATA_ROOT, bot.id);
    ensureDir(dir);
    fs.appendFileSync(path.join(dir, "latest.log"), entry + "\n");
  } catch {}
}
function readMeta(b) {
  try {
    const p = path.join(BOT_DATA_ROOT, b.id, "meta.json");
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")) || {};
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
    // Accept both "P/L $X" and "PROFIT LOCKED: $X moved ..."
    const m1 = /P\/L\s*\$([0-9.,-]+)/i.exec(line);
    const m2 = /PROFIT LOCKED:\s*\$([0-9.,-]+)/i.exec(line);
    if (m1) sum += money(m1[1]);
    if (m2) sum += money(m2[1]);
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

/* ---------- NEW: derive numbers robustly from log + holdings ---------- */
function getBotLogText(b) {
  if (b?.logs?.length) return b.logs.join("\n");
  try {
    const p = path.join(BOT_DATA_ROOT, b.id, "latest.log");
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  } catch {}
  return "";
}
function getHoldingsAmounts(b) {
  try {
    const p = path.join(BOT_DATA_ROOT, b.id, "cryptoHoldings.json");
    if (!fs.existsSync(p)) return null;
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const out = {};
    for (const [sym, obj] of Object.entries(j || {})) {
      const amt = toNum(obj?.amount);
      if (amt != null && amt !== 0) out[sym] = amt;
    }
    return out;
  } catch {
    return null;
  }
}
function latestPricesFromLog(raw) {
  const prices = {};
  const upd = (sym, px) => {
    if (!sym || px == null) return;
    prices[sym] = px; // last writer wins
  };
  // [DEBUG][ETHUSD] price=3597.53 ...
  for (const m of raw.matchAll(
    /\[([A-Z0-9]+USDT?|[A-Z0-9]+USD)\][^\n]*?price=([0-9.]+)/g
  )) {
    upd(m[1], toNum(m[2]));
  }
  // "Strategy decision for ETHUSD ... @ $3597.53"
  for (const m of raw.matchAll(
    /Strategy decision for\s+([A-Z0-9]+USDT?|[A-Z0-9]+USD)[^\n]*?@\s*\$([0-9.]+)/g
  )) {
    upd(m[1], toNum(m[2]));
  }
  return prices;
}
function deriveFromLogAndHoldings(b) {
  const raw = getBotLogText(b);

  // Beginning Portfolio Value
  const mBPV = /Beginning Portfolio Value\s*[:=]\s*\$?([0-9.,-]+)/i.exec(raw);
  const beginningPortfolioValue = mBPV ? money(mBPV[1]) : 0;
  const bpvSource = mBPV ? "log" : b.bpvSource || "initial";

  // Count only executed trades
  const buys = (raw.match(/BUY executed:/g) || []).length;
  const sells = (raw.match(/SELL executed:/g) || []).length;

  // Total P/L from lines like "P/L $123.45" (sum)
  const totalPL = (raw.match(/P\/L\s*\$([0-9.,-]+)/g) || [])
    .map((x) => money(x.replace(/.*\$/, "")))
    .reduce((a, c) => a + c, 0);

  // Locked: prefer latest "Locked: $X"; else sum "PROFIT LOCKED: $X moved ..."
  let locked = 0;
  const lockedTotals = [
    ...raw.matchAll(/(^|\b)Locked\s*[:=]\s*\$([0-9.,-]+)/g),
  ].map((m) => money(m[2]));
  if (lockedTotals.length) {
    locked = Math.max(...lockedTotals);
  } else {
    locked = [...raw.matchAll(/PROFIT LOCKED:\s*\$([0-9.,-]+)/g)]
      .map((m) => money(m[1]))
      .reduce((a, c) => a + c, 0);
  }

  // Cash / Crypto (mkt) direct prints if present
  const cashMatch = /(^|\b)Cash\s*[:=]\s*\$([0-9.,-]+)/i.exec(raw);
  const cryptoMatch = /Crypto\s*\(mkt\)\s*[:=]\s*\$([0-9.,-]+)/i.exec(raw);
  let cash = cashMatch ? money(cashMatch[2]) : 0;
  let cryptoMkt = cryptoMatch ? money(cryptoMatch[1]) : 0;

  // If Crypto(mkt) not printed yet, derive from holdings amounts * latest prices from log
  if (!cryptoMatch) {
    const amounts = getHoldingsAmounts(b);
    if (amounts) {
      const prices = latestPricesFromLog(raw);
      let sum = 0;
      for (const [sym, amt] of Object.entries(amounts)) {
        const px = prices[sym];
        if (px != null) sum += amt * px;
      }
      if (sum > 0) cryptoMkt = sum;
    }
  }

  // Infer cash if still missing but BPV known
  if ((cash == null || cash === 0) && beginningPortfolioValue > 0) {
    const inferred = beginningPortfolioValue - (cryptoMkt || 0) - (locked || 0);
    if (Number.isFinite(inferred) && inferred >= 0) cash = inferred;
  }

  const currentPortfolioValue = (cash || 0) + (cryptoMkt || 0) + (locked || 0);

  return {
    beginningPortfolioValue: Number((beginningPortfolioValue || 0).toFixed(2)),
    bpvSource,
    buys,
    sells,
    totalPL: Number((totalPL || 0).toFixed(2)),
    cash: Number((cash || 0).toFixed(2)),
    cryptoMkt: Number((cryptoMkt || 0).toFixed(2)),
    locked: Number((locked || 0).toFixed(2)),
    currentPortfolioValue: Number((currentPortfolioValue || 0).toFixed(2)),
  };
}

/* ---------- live metric taps from streaming stdout ---------- */
function parseRuntimeMetrics(bot, ln) {
  // BPV
  const mBegin = /Beginning Portfolio Value\s*[:=]\s*\$?([0-9.,-]+)/i.exec(ln);
  if (mBegin) {
    const v = toNum(mBegin[1]);
    if (v !== null) {
      bot.beginningPortfolioValue = v;
      bot.bpvSource = "log";
      saveBotMeta(BOT_DATA_ROOT, bot);
    }
  }
  // Cash, Crypto (mkt), Locked triple or singles
  const triple =
    /Cash\s*[:=]\s*\$?([0-9.,-]+)\s*,\s*Crypto\s*\(mkt\)\s*[:=]\s*\$?([0-9.,-]+)\s*,\s*Locked\s*[:=]\s*\$?([0-9.,-]+)/i.exec(
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
  const mLockedTotal = /(^|\b)Locked\s*[:=]\s*\$?([0-9.,-]+)/i.exec(ln);
  if (mLockedTotal) {
    const v = toNum(mLockedTotal[2]);
    if (v !== null) bot.locked = v;
  }
  // NEW: Profit lock events (increment)
  const mLockEvent = /PROFIT LOCKED:\s*\$?([0-9.,-]+)/i.exec(ln);
  if (mLockEvent) {
    const v = toNum(mLockEvent[1]);
    if (v !== null && v >= 0) bot.locked = Number(bot.locked || 0) + v;
  }
  // Total P/L
  const mTotal =
    /(Total P\/L|Total PL|P\/L total)\s*[:=]\s*\$?([0-9.,-]+)/i.exec(ln);
  if (mTotal) {
    const v = toNum(mTotal[2]);
    if (v !== null) bot.totalPL = v;
  }
  // Counts: only executed trades (ignore seeding/skips/blocked)
  if (/BUY executed:/i.test(ln)) bot.buys += 1;
  if (/SELL executed:/i.test(ln)) bot.sells += 1;

  // If BPV unknown but we have pieces, infer it once
  if (
    (!bot.beginningPortfolioValue || bot.beginningPortfolioValue === 0) &&
    typeof bot.cash === "number" &&
    typeof bot.cryptoMkt === "number"
  ) {
    const inferred = bot.cash + bot.cryptoMkt + (bot.locked || 0);
    if (Number.isFinite(inferred) && inferred > 0)
      bot.beginningPortfolioValue = inferred;
  }
}

/* ---------------- spawning ---------------- */
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

  // Seed holdings once
  try {
    const seededFlag = path.join(dataDir, "seeded.flag");
    if (!fs.existsSync(seededFlag)) {
      const dest = path.join(dataDir, "cryptoHoldings.json");
      const tmpl =
        process.env.TEMPLATE_HOLDINGS_FILE ||
        path.join(
          REPO_ROOT,
          "backend",
          "data",
          "default",
          "cryptoHoldings.json"
        );
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
    // soft simulator
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

/* ---------------- router ---------------- */
const r = express.Router();

/* Health + diagnostics */
r.get("/__ping", (_req, res) => res.json({ ok: true, t: ts() }));
r.get("/debug/strategies", async (req, res) => {
  const perDir = [];
  for (const d of STRATEGY_CANDIDATE_DIRS) {
    const abs = path.resolve(d);
    const exists = fs.existsSync(abs);
    const files = exists ? listFilesSafe(abs) : null;
    perDir.push({ dir: abs, exists, files });
  }
  const list = await scanStrategies(true);
  res.json({
    candidates: STRATEGY_CANDIDATE_DIRS,
    perDir,
    returned: list.map((s) => ({ id: s.id, file: s.file, dir: s.dir })),
    count: list.length,
  });
});

/* Auth (stub) */
r.post("/auth/logout", (_req, res) => res.json({ ok: true }));

/* Strategies + defaults */
r.get("/strategies", async (req, res) => {
  try {
    const list = await scanStrategies(true);
    L(
      "strategies",
      `route hit from ${req.ip}; returning count=${list.length} ids=${list
        .slice(0, 5)
        .map((s) => s.id)
        .join(", ")}`
    );
    res.json(list);
  } catch (e) {
    console.error("strategies route failed:", e);
    res.json(DEFAULT_STRATEGY_LIST); // absolute fallback so UI never empties
  }
});
r.get("/strategies/:id/config", (req, res) =>
  res.json({
    strategyId: req.params.id,
    defaults: getStrategyDefaults(req.params.id),
  })
);

/* Bots: list + snapshots */
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

/* Bots: read one */
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

/* Bots: create (hardened) */
r.post("/bots", (req, res) => {
  try {
    L("/api/bots", "POST body:", JSON.stringify(req.body));
    const body = req.body || {};
    const suppliedId = String(body.id || "").trim();
    const name = String(
      body.name || suppliedId || `bot-${Math.random().toString(36).slice(2, 8)}`
    );
    const id = suppliedId || name.toLowerCase().replace(/\s+/g, "-");

    if (!body.strategyId)
      return res.status(400).json({ error: "strategyId required" });
    if (bots[id])
      return res.status(409).json({ error: "bot id already exists" });

    let symbols = [];
    if (Array.isArray(body.symbols)) symbols = body.symbols.map(String);
    else if (body.config?.SYMBOLS) {
      symbols = String(body.config.SYMBOLS)
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }

    const meta = {
      id,
      name,
      strategyId: String(body.strategyId),
      status: "stopped",
      createdAt: Date.now(),
      config: body.config || {},
      symbols,
    };
    const bot = buildInitialBotState(meta);
    bots[id] = bot;
    pushLog(
      bot,
      `[${id}] created: strategy=${meta.strategyId}, symbols=${symbols.join(
        ","
      )}`
    );
    ensureDir(path.join(BOT_DATA_ROOT, id));
    saveBotMeta(BOT_DATA_ROOT, bot);

    res.json({ ok: true, id });
  } catch (err) {
    console.error("Create bot failed:", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/* Bots: delete */
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

/* Bots: status + lifecycle */
r.get("/bots/:id/status", (req, res) => {
  const b = bots[req.params.id];
  if (!b) return res.status(404).json({ error: "not_found" });
  res.json({ status: b.status });
});
r.post("/bots/:id/start", async (req, res) => {
  const b = bots[req.params.id];
  if (!b) return res.status(404).json({ error: "not_found" });
  if (b.status === "running" && b.child && !("force" in req.query))
    return res.json({ ok: true, alreadyRunning: true });

  b.status = "running";
  b.startedAt = Date.now();

  // reset session metrics
  b.buys = 0;
  b.sells = 0;
  b.totalPL = 0;
  b.cash = 0;
  b.cryptoMkt = 0;
  b.locked = 0;
  b.beginningPortfolioValue = 0;
  b.bpvSource = "initial";

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

/* Bots: logs + summaries */
r.get("/bots/:id/logs", (req, res) => {
  const b = bots[req.params.id];
  if (!b) return res.status(404).json({ error: "not_found" });
  const since = Number(req.query.cursor || 0);
  const lines = since ? b.logs.slice(Math.max(0, since)) : b.logs.slice(-500);
  res.json({ lines, cursor: String(b.cursor || 0) });
});
r.get("/bots/:id/logs.txt", (req, res) => {
  const b = bots[req.params.id];
  if (!b) return res.status(404).type("text/plain").send("not_found");
  res.type("text/plain").send(b.logs.join("\n"));
});

function buildStats(b) {
  // Merge derived numbers from log/holdings with live counters
  const derived = deriveFromLogAndHoldings(b);
  const { pl24h } = computePl24h(b);

  // Prefer derived values unless live counters are better than zero
  const beginningPortfolioValue =
    derived.beginningPortfolioValue || b.beginningPortfolioValue || 0;

  const currentPortfolioValue =
    (derived.cash || b.cash || 0) +
    (derived.cryptoMkt || b.cryptoMkt || 0) +
    (derived.locked || b.locked || 0);

  return {
    id: b.id,
    name: b.name,
    status: b.status,
    strategyId: b.strategyId,

    beginningPortfolioValue,
    bpvSource: derived.bpvSource || b.bpvSource || "initial",
    duration: durationString(b),

    buys: b.buys || derived.buys || 0,
    sells: b.sells || derived.sells || 0,

    totalPL: b.totalPL || derived.totalPL || 0,
    cash: derived.cash || b.cash || 0,
    cryptoMkt: derived.cryptoMkt || b.cryptoMkt || 0,
    locked: derived.locked || b.locked || 0,

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

/* ---------------- mount & lifecycle ---------------- */
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
  console.log(`Control-plane listening on :${PORT}`);
  ensureDir(BOT_DATA_ROOT);
  L("strategies", "CANDIDATE DIRS =", JSON.stringify(STRATEGY_CANDIDATE_DIRS));
  console.log(`[bot] script = ${path.resolve(BOT_SCRIPT_PATH)}`);
  console.log(`[data] root   = ${path.resolve(BOT_DATA_ROOT)}`);
});
