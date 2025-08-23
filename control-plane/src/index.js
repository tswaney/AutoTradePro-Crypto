// control-plane/src/index.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";

import strategiesRouter from "./routes/strategies.js";
import botsRouter from "./routes/bots.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

// Mount under /api
app.use("/api", strategiesRouter);
app.use("/api", botsRouter);

// Health check
app.get("/api/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`control-plane API listening on :${PORT}`);
});
