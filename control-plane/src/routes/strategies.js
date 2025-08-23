import express from "express";
import { promises as fsp } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveStrategyConfig } from "../utils/configResolver.js";

const router = express.Router();

// __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// monorepo root = three levels up from control-plane/src/routes
// routes -> src -> control-plane -> <repo root>
const repoRoot = path.resolve(__dirname, "..", "..", "..");

// Directory containing strategies on disk (override via STRATEGIES_DIR)
const STRATEGIES_DIR =
  process.env.STRATEGIES_DIR || path.join(repoRoot, "backend", "strategies");

// Optional path to the env file with [sections] (override via ENV_FILE)
const ENV_FILE = process.env.ENV_FILE || path.join(repoRoot, "backend", ".env");

// ---------- helpers ----------
const readJSON = async (file, fallback = null) => {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
};

// Read a human description from the top of a .js file.
// - Prefer a leading /** ... */ block
// - Otherwise collect leading // lines until the first non-comment
async function extractJsDescription(filePath) {
  let text = "";
  try {
    text = await fsp.readFile(filePath, "utf8");
  } catch {
    return "";
  }

  // /** ... */ at the top
  const block = text.match(/^\s*\/\*{1,2}([\s\S]*?)\*\//);
  if (block) {
    const body = block[1]
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*\* ?/, "").trim())
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (body) return body;
  }

  // Fallback: consecutive // lines at the top
  const lines = text.split(/\r?\n/);
  const collected = [];
  for (const line of lines) {
    if (/^\s*\/\/(.*)$/.test(line)) {
      collected.push(line.replace(/^\s*\/\/ ?/, "").trim());
      continue;
    }
    if (collected.length > 0) break;
    if (line.trim() === "") continue;
    break;
  }
  return collected.join(" ").replace(/\s+/g, " ").trim();
}

async function listStrategies() {
  const out = [];
  let entries = [];
  try {
    entries = await fsp.readdir(STRATEGIES_DIR, { withFileTypes: true });
  } catch {
    return out; // dir not found -> empty list
  }

  for (const ent of entries) {
    try {
      if (ent.isDirectory()) {
        const id = ent.name;
        const meta = await readJSON(
          path.join(STRATEGIES_DIR, id, "meta.json"),
          {}
        );
        out.push({
          id,
          name: meta.name || id,
          title: meta.title || meta.name || id,
          description: meta.description || "",
        });
      } else if (ent.isFile()) {
        if (ent.name.endsWith(".json")) {
          const id = path.basename(ent.name, ".json");
          const meta = await readJSON(path.join(STRATEGIES_DIR, ent.name), {});
          out.push({
            id,
            name: meta.name || id,
            title: meta.title || meta.name || id,
            description: meta.description || "",
          });
        } else if (ent.name.endsWith(".js")) {
          const id = path.basename(ent.name, ".js");
          const desc = await extractJsDescription(
            path.join(STRATEGIES_DIR, ent.name)
          );
          out.push({
            id,
            name: id,
            title: id,
            description: desc || "",
          });
        }
      }
    } catch {
      // skip malformed entries
    }
  }

  out.sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id));
  return out;
}

// ---------- routes ----------
router.get("/strategies", async (_req, res) => {
  const items = await listStrategies();
  res.json(items);
});

router.get("/strategies/:id/config", async (req, res) => {
  const id = String(req.params.id || "").trim();
  const cfg = await resolveStrategyConfig({
    strategiesDir: STRATEGIES_DIR,
    envFile: ENV_FILE,
    strategyId: id,
  });
  res.json(cfg);
});

export default router;
