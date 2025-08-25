// control-plane/src/index.js
import express from "express";
import cors from "cors";

import strategiesRouter from "./routes/strategies.js";
import botsRouter from "./routes/bots.js";

const app = express();
const PORT = process.env.PORT || 4000;

// Middlewares
app.use(cors()); // allow mobile dev & LAN
app.use(express.json({ limit: "2mb" })); // parse JSON bodies

// Health
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Mount API routers at /api
// (Routers should define paths like "/strategies", "/bots", etc.)
app.use("/api", strategiesRouter);
app.use("/api", botsRouter);

// Minimal root
app.get("/", (_req, res) => {
  res.type("text/plain").send("control-plane API is running");
});

// 404 (JSON)
app.use((req, res) => {
  res.status(404).json({ error: "Not found", path: req.originalUrl });
});

// Error handler (JSON)
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
});
