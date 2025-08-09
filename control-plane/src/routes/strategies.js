// /control-plane/src/routes/strategies.js (ESM)
// Lists strategies by scanning a folder and exposes single-file fetch.
// Default strategies dir resolves relative to this file: ../strategies
// You can override with STRATEGIES_DIR (absolute or relative to baseDir).
//
// Optional ENV:
//   CACHE_TTL_MS   -> number (ms) for in-memory cache TTL, default 3000
//
// Query flags:
//   ?nocache=1     -> bypass cache for this request

import fs from "fs";
import path from "path";
import { pathToFileURL, fileURLToPath } from "url";

/** @typedef {{name:string, version:string, description?:string, file:string}} StrategyMeta */

const DEFAULT_TTL = Number(process.env.CACHE_TTL_MS || 3000);

function now() { return Date.now(); }

/** Simple in-memory cache */
const cache = {
  list: { at: 0, data: null },
  items: new Map(), // key: filename -> { at, data }
  ttl: DEFAULT_TTL,
  clear() {
    this.list = { at: 0, data: null };
    this.items.clear();
  }
};

/**
 * Resolve strategies directory based on the routes folder (baseDir).
 * Defaults to ../strategies relative to /control-plane/src/routes.
 * STRATEGIES_DIR (if set) can be absolute or relative to baseDir.
 */
function resolveStrategiesDir(baseDir) {
  const envDir = process.env.STRATEGIES_DIR && process.env.STRATEGIES_DIR.trim();
  if (envDir) {
    return path.isAbsolute(envDir) ? envDir : path.resolve(baseDir, envDir);
  }
  return path.resolve(baseDir, "../strategies");
}

async function dynamicImport(filePath) {
  // Works for both ESM and CJS modules
  const mod = await import(pathToFileURL(filePath).href);
  return mod?.default ?? mod;
}

async function safeLoadStrategy(filePath) {
  try {
    const exp = await dynamicImport(filePath);
    const name = exp?.name || path.basename(filePath, ".js");
    const version = exp?.version || "1.0";
    const description = exp?.description || "";
    const payload = { name, version, description, file: path.basename(filePath) };
    // include optional safe fields if present
    if (exp?.config && typeof exp.config === "object") payload.config = exp.config;
    if (exp?.schema && typeof exp.schema === "object") payload.schema = exp.schema;
    return payload;
  } catch (e) {
    console.error("Failed loading strategy:", filePath, e?.message || e);
    return null;
  }
}

function listFromDisk(dir) {
  let files = [];
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith(".js"));
  } catch (e) {
    return { error: `Strategies dir not found: ${dir}`, list: [] };
  }
  return { list: files };
}

/**
 * Mounts routes onto the provided Express app.
 * @param {import('express').Express} app
 * @param {{ baseDir?: string }} options
 */
export default function mountStrategiesRoutes(app, { baseDir } = {}) {
  const base = baseDir || path.dirname(fileURLToPath(import.meta.url));

  app.get("/api/strategies", async (req, res) => {
    const bypass = "nocache" in req.query;
    const dir = resolveStrategiesDir(base);

    if (!bypass && cache.list.data && (now() - cache.list.at) < cache.ttl) {
      return res.json({ strategies: cache.list.data, dir, cached: true });
    }

    const { error, list: files } = listFromDisk(dir);
    if (error) return res.status(200).json({ strategies: [], error });

    const loaded = await Promise.all(files.map(f => safeLoadStrategy(path.join(dir, f))));
    const strategies = loaded
      .filter(Boolean)
      .sort((a, b) => (a.name.localeCompare(b.name) || String(a.version).localeCompare(String(b.version))));

    cache.list = { at: now(), data: strategies };
    return res.json({ strategies, dir, cached: false });
  });

  app.get("/api/strategies/:file", async (req, res) => {
    const bypass = "nocache" in req.query;
    const dir = resolveStrategiesDir(base);
    const raw = req.params.file;
    const filename = raw.endsWith(".js") ? raw : `${raw}.js`;
    const fullPath = path.join(dir, filename);

    if (!bypass) {
      const entry = cache.items.get(filename);
      if (entry && (now() - entry.at) < cache.ttl) {
        return res.json({ strategy: entry.data, dir, cached: true });
      }
    }

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: `Strategy not found: ${filename}`, dir });
    }

    const meta = await safeLoadStrategy(fullPath);
    if (!meta) return res.status(500).json({ error: `Failed to load strategy: ${filename}`, dir });

    cache.items.set(filename, { at: now(), data: meta });
    return res.json({ strategy: meta, dir, cached: false });
  });

  // Optional cache-bust endpoint
  app.post("/api/strategies/reload", (_req, res) => {
    cache.clear();
    res.json({ ok: true, message: "Cache cleared" });
  });
}
