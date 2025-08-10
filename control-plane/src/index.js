// control-plane/src/index.js (ESM)
// Your package.json has `"type":"module"`, so we use ESM imports here.
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import strategiesRouter from './routes/strategies.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

app.use(cors());
app.use(express.json());

// --- In-memory demo bot state + logs ----------------------------------------
const demoBotId = 'local-test';
let botStatus   = 'stopped'; // 'running' | 'stopped'
let mode        = 'demo';
let strategy    = 'moderateRetainMode_v4.js';
let symbols     = ['BTCUSD', 'SOLUSD'];

// simple log ring buffer
const LOG_MAX = 1000;
let logs = [];
let cursorCounter = 0;
const now = () => new Date().toISOString();

function pushLog(line) {
  const item = `${now()}  ${line}`;
  logs.push(item);
  if (logs.length > LOG_MAX) logs.splice(0, logs.length - LOG_MAX);
  cursorCounter += 1;
}

// heartbeat to generate logs when running
setInterval(() => {
  if (botStatus === 'running') {
    pushLog(`[${demoBotId}] heartbeat running…`);
  }
}, 2000);

// --- Bots API ----------------------------------------------------------------
app.get('/bots', (req, res) => {
  const list = [{
    id: demoBotId,
    name: demoBotId,
    status: botStatus,
    mode,
    strategy,
    symbols
  }];
  console.log('[BOT] list');
  res.json(list);
});

app.get('/bots/:id', (req, res) => {
  if (req.params.id !== demoBotId) return res.status(404).json({ error: 'not found' });
  res.json({
    id: demoBotId,
    name: demoBotId,
    status: botStatus,
    mode,
    strategy,
    symbols
  });
});

app.post('/bots/:id/start', (req, res) => {
  console.log('[BOT] start', req.params.id, req.body || {});
  if (req.params.id !== demoBotId) return res.status(404).json({ error: 'not found' });
  if (botStatus !== 'running') {
    botStatus = 'running';
    pushLog(`[${demoBotId}] started`);
  }
  res.json({ ok: true, status: botStatus });
});

app.post('/bots/:id/stop', (req, res) => {
  console.log('[BOT] stop', req.params.id, req.body || {});
  if (req.params.id !== demoBotId) return res.status(404).json({ error: 'not found' });
  if (botStatus !== 'stopped') {
    botStatus = 'stopped';
    pushLog(`[${demoBotId}] stopped`);
  }
  res.json({ ok: true, status: botStatus });
});

app.post('/bots/:id/restart', (req, res) => {
  console.log('[BOT] restart', req.params.id, req.body || {});
  if (req.params.id !== demoBotId) return res.status(404).json({ error: 'not found' });
  botStatus = 'running';
  pushLog(`[${demoBotId}] restarted`);
  res.json({ ok: true, status: botStatus });
});

// Logs polling endpoint: GET /bots/:id/logs?cursor=<n>
// Returns { lines: string[], cursor: string }
app.get('/bots/:id/logs', (req, res) => {
  if (req.params.id !== demoBotId) return res.status(404).json({ error: 'not found' });
  const since = Number(req.query.cursor || 0);
  const lines = logs.slice(-200); // return last 200 lines at most
  res.json({ lines, cursor: String(cursorCounter) });
});

// --- Auth stubs so Sign out never 404s --------------------------------------
app.post('/auth/logout', (req, res) => res.json({ ok: true }));
app.post('/auth/signout', (req, res) => res.json({ ok: true }));
app.get('/auth/signout', (req, res) => res.json({ ok: true }));

// --- Strategies API ----------------------------------------------------------
app.use('/api/strategies', strategiesRouter);

// --- Start -------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Control-plane API listening on :${PORT}`);
});
