import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import expressWs from 'express-ws';
import dotenv from 'dotenv';
dotenv.config();

import { requireAuth, requireRole } from './auth.js';
import { listBots, getBot, patchBot } from './bots.js';
import * as local from './localRunner.js';

const app = express();
expressWs(app);
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (_,res)=>res.send('ok'));

// === Authenticated API ===
app.use(requireAuth);

// List bots, overriding status with real local process state
app.get('/bots', (req,res)=> {
  const bots = listBots().map(b => ({ ...b, status: local.isRunning(b.botId) ? 'running' : 'stopped' }));
  res.json(bots);
});

app.get('/bots/:id', (req,res)=> {
  const b = getBot(req.params.id);
  if (!b) return res.status(404).send('Not found');
  return res.json({ ...b, status: local.isRunning(b.botId) ? 'running' : 'stopped' });
});

app.post('/bots/:id/start', requireRole('bots.write'), (req,res)=> {
  const b = getBot(req.params.id); if (!b) return res.status(404).send('Not found');
  const r = local.start(b.botId);
  if (!r.ok) return res.status(409).json(r);
  return res.json(r);
});

app.post('/bots/:id/stop', requireRole('bots.write'), async (req,res)=> {
  const b = getBot(req.params.id); if (!b) return res.status(404).send('Not found');
  const r = await local.stop(b.botId);
  if (!r.ok) return res.status(409).json(r);
  return res.json(r);
});

app.post('/bots/:id/restart', requireRole('bots.write'), async (req,res)=> {
  const b = getBot(req.params.id); if (!b) return res.status(404).send('Not found');
  const r = await local.restart(b.botId);
  if (!r.ok) return res.status(409).json(r);
  return res.json(r);
});

// === WebSocket: live logs from local DATA_DIR/testPrice_output.txt ===
app.ws('/bots/:id/logs/stream', (ws, req) => {
  const id = req.params.id;
  const b = getBot(id);
  if (!b) { ws.close(); return; }

  ws.send(JSON.stringify({ ts: Date.now(), level:'info', msg:`Connected to ${id}`, botId: id }));

  const stop = local.streamLogs(id, (line) => {
    try { ws.send(JSON.stringify({ ts: Date.now(), level:'info', msg: line, botId: id })); } catch {}
  });

  ws.on('close', () => { stop(); });
  ws.on('error', () => { stop(); });
});

const port = process.env.PORT || 4000;
app.listen(port, ()=> console.log(`Control-plane on http://localhost:${port}`));
