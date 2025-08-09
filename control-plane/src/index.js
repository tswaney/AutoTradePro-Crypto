// /control-plane/src/index.js  (ESM)
// Express entry for the control-plane (backend) using ESM syntax.
// Mounts /api/strategies so the mobile app can fetch available strategies.
//
// ENV:
//   PORT             -> port to bind (default: 4000)
//   STRATEGIES_DIR   -> absolute or relative path to strategies (optional)
//   ENV_PATH         -> optional .env path

import dotenv from "dotenv";
dotenv.config({ path: process.env.ENV_PATH || undefined });

import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";

import mountStrategiesRoutes from "./routes/strategies.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Mount routes
mountStrategiesRoutes(app, { baseDir: __dirname });

// Health
app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  const dir = (() => {
    const envDir = process.env.STRATEGIES_DIR && process.env.STRATEGIES_DIR.trim();
    if (envDir) return path.isAbsolute(envDir) ? envDir : path.resolve(__dirname, envDir);
    // default: ./strategies relative to /control-plane/src
    return path.resolve(__dirname, "./strategies");
  })();
  console.log(`Control-plane API listening on :${PORT}`);
  console.log(`Scanning strategies from: ${dir}`);
});
