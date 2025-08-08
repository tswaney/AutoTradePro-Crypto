import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import expressWs from 'express-ws';
import dotenv from 'dotenv';
dotenv.config();

import { requireAuth, requireRole } from './auth.js';
import { listBots, getBot, startBot, stopBot, restartBot, patchBot } from './bots.js';

const app = express();
expressWs(app);
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (_,res)=>res.send('ok'));

// === Authenticated API ===
app.use(requireAuth);

app.get('/bots', (req,res)=> res.json(listBots()));
app.get('/bots/:id', (req,res)=> {
  const b = getBot(req.params.id); if (!b) return res.status(404).send('Not found');
  return res.json(b);
});
app.post('/bots/:id/start', requireRole('bots.write'), (req,res)=> {
  return startBot(req.params.id) ? res.json({ok:true}) : res.status(404).send('Not found');
});
app.post('/bots/:id/stop', requireRole('bots.write'), (req,res)=> {
  return stopBot(req.params.id) ? res.json({ok:true}) : res.status(404).send('Not found');
});
app.post('/bots/:id/restart', requireRole('bots.write'), (req,res)=> {
  return restartBot(req.params.id) ? res.json({ok:true}) : res.status(404).send('Not found');
});
app.patch('/bots/:id', requireRole('bots.write'), (req,res)=> {
  const b = patchBot(req.params.id, req.body || {});
  return b ? res.json(b) : res.status(404).send('Not found');
});

// === WebSocket: logs (placeholder) ===
app.ws('/bots/:id/logs/stream', (ws, req) => {
  const bot = getBot(req.params.id);
  if (!bot) { ws.close(); return; }
  // In real system, tail file in bot.dataDir/testPrice_output.txt and send appended lines.
  ws.send(JSON.stringify({ ts: Date.now(), level:'info', msg:`Connected to ${bot.botId}`, botId: bot.botId }));
});

const port = process.env.PORT || 4000;
app.listen(port, ()=> console.log(`Control-plane on http://localhost:${port}`));
