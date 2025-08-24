// control-plane/src/index.js
import express from "express";
import cors from "cors";

import strategiesRouter from "./routes/strategies.js";
import botsRouter from "./routes/bots.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Mount API routers
app.use("/api", strategiesRouter);
app.use("/api", botsRouter);

// Minimal root
app.get("/", (_req, res) => {
  res.type("text/plain").send("control-plane API is running");
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`control-plane API listening on :${PORT}`);
});
