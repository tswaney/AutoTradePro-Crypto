// control-plane/src/routes/logs.js
// Exposes: GET /api/bots/:id/log?tail=200  -> last N log lines (plain text)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve <repo-root>/backend/data regardless of where "node" is run from.
// You can override with DATA_ROOT if your layout is different.
const DATA_ROOT =
  process.env.DATA_ROOT || path.join(__dirname, "../../../backend/data");

export default function mountLogs(app) {
  app.get("/api/bots/:id/log", (req, res) => {
    try {
      const id = String(req.params.id || "").trim();
      const tail = Math.max(
        1,
        Math.min(parseInt(req.query.tail || "200", 10), 5000)
      );
      if (!id) {
        return res.status(400).type("text/plain").send("Missing id");
      }

      const p = path.join(DATA_ROOT, id, "testPrice_output.txt");
      if (!fs.existsSync(p)) {
        return res.status(404).type("text/plain").send("No log");
      }

      const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
      return res.type("text/plain").send(lines.slice(-tail).join("\n"));
    } catch (err) {
      return res
        .status(500)
        .type("text/plain")
        .send(`Error: ${err?.message || err}`);
    }
  });
}
