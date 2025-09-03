// control-plane/src/index.js
import express from "express";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import strategiesRouter from "./routes/strategies.js";
import botsRouter from "./routes/bots.js";
import mountLogs from "./routes/logs.js";

const app = express();
const PORT = process.env.PORT || 4000;

// ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve repo root and canonical backend/data path (to match bots.js)
const repoRoot = path.resolve(__dirname, "..", "..");
const backendDir = path.join(repoRoot, "backend");
const DATA_ROOT = path.join(backendDir, "data");

// Helpers consistent with bots.js layout
async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}
async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
async function readJSON(p, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    return fallback;
  }
}
async function writeJSON(p, obj) {
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, JSON.stringify(obj, null, 2), "utf8");
}
function botDir(id) {
  return path.join(DATA_ROOT, id);
}
function botMetaPath(id) {
  return path.join(botDir(id), "bot.json");
}

// Middleware
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Health
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Routers
app.use("/api", strategiesRouter);
app.use("/api", botsRouter);

// Logs (SSE/plain)
mountLogs(app);

// ---------------------------
// GET /api/bots/:id  (exact meta from backend/data/<id>/bot.json)
// ---------------------------
app.get("/api/bots/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const metaFile = botMetaPath(id);
    if (!(await exists(metaFile)))
      return res.status(404).json({ error: "Bot not found", id });
    const meta = await readJSON(metaFile, null);
    if (!meta) return res.status(500).json({ error: "Corrupt bot.json", id });
    return res.json(meta);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------
// PATCH /api/bots/:id  (merge into backend/data/<id>/bot.json)
// ---------------------------
app.patch("/api/bots/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const patchBody = req.body || {};
    const dir = botDir(id);
    const metaFile = botMetaPath(id);

    if (!(await exists(dir)))
      return res.status(404).json({ error: "Bot not found", id });

    const current = (await readJSON(metaFile, {})) || {};
    const merged = {
      ...current,
      ...patchBody,
      config: { ...(current.config || {}), ...(patchBody.config || {}) },
    };

    // Mirror strategyId → STRATEGY_NAME if not already present
    if (patchBody.strategyId && !merged.config?.STRATEGY_NAME) {
      merged.config = {
        ...(merged.config || {}),
        STRATEGY_NAME: String(patchBody.strategyId),
      };
    }

    await writeJSON(metaFile, merged);
    return res.json(merged);
  } catch (err) {
    return next(err);
  }
});

// Minimal root
app.get("/", (_req, res) => {
  res.type("text/plain").send("control-plane API is running");
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: "Not found", path: req.originalUrl });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res
    .status(500)
    .json({
      error: "Internal Server Error",
      detail: String(err?.message || err),
    });
});

app.listen(PORT, () => {
  console.log(`control-plane API listening on :${PORT}`);
  console.log(`DATA_ROOT => ${DATA_ROOT}`);
});
