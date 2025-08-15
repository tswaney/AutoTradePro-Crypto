// control-plane/src/index.js – Complete local demo: multi-bot + logs + stats + 24h P/L
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const ROLLOVER_HOUR = Number(process.env.PL_DAY_START_HOUR ?? '9');

app.use(cors());
app.use(express.json());

const strategies = [
  { id: 'moderate-retain-v1', name: 'Moderate Retain Mode', version: 'v1.0', description: 'Grid strategy with moderate profit locking and cash reserve.' },
  { id: 'momentum-rider-v2', name: 'Momentum Rider', version: 'v2.0', description: 'Trend-following with momentum filters.' },
  { id: 'risk-adjusted-rebalancer', name: 'Risk-Adjusted Rebalancer', version: 'v1.0', description: 'Periodic rebalancing optimized for risk-adjusted returns.' },
  { id: 'dynamic-core', name: 'Dynamic Core', version: 'v1.0', description: 'Baseline + rolling rebalance.' }
];

const bots = {};

const nowIso = () => new Date().toISOString();
function pushLog(bot, line) {
  const entry = `${nowIso()}  ${line}`;
  bot.logs.push(entry);
  if (bot.logs.length > 5000) bot.logs.splice(0, bot.logs.length - 5000);
  bot.cursor += 1;
}

function ensureHeartbeat(bot) {
  if (bot.heartbeat) return;
  bot.heartbeat = setInterval(() => {
    if (bot.status !== 'running') return;
    bot.buys += Math.random() < 0.05 ? 1 : 0;
    bot.sells += Math.random() < 0.05 ? 1 : 0;
    const delta = (Math.random() - 0.5) * 5;
    bot.totalPL += delta;
    bot.cash += delta * 0.5;
    bot.cryptoMkt += delta * 0.5;
    pushLog(bot, `[${bot.id}] heartbeat • P/L $${delta.toFixed(2)}`);
  }, 2000);
}

function stopHeartbeat(bot) {
  if (bot.heartbeat) { clearInterval(bot.heartbeat); bot.heartbeat = undefined; }
}

function computePl24h(bot) {
  const now = new Date();
  const anchor = new Date(now);
  anchor.setHours(ROLLOVER_HOUR, 0, 0, 0);
  if (anchor > now) anchor.setDate(anchor.getDate() - 1);
  let sum = 0;
  for (const line of bot.logs) {
    const m = /^([^\s]+)\s+(.+)$/.exec(line);
    if (!m) continue;
    const when = new Date(m[1]);
    if (!isFinite(when.getTime()) || when < anchor) continue;
    const mm = /P\/L\s*\$([0-9.,-]+)/i.exec(line);
    if (mm) {
      const val = parseFloat(mm[1].replace(/,/g, ''));
      if (!Number.isNaN(val)) sum += val;
    }
  }
  return { pl24h: sum, windowStart: anchor.toISOString() };
}

const r = express.Router();

r.get('/strategies', (req, res) => res.json(strategies));

r.get('/bots', (req, res) => {
  res.json(Object.values(bots).map(b => ({
    id: b.id, name: b.name, status: b.status, strategyId: b.strategyId, symbols: b.symbols
  })));
});

r.post('/bots', (req, res) => {
  const { name, strategyId, symbols } = req.body || {};
  if (!name || !strategyId) return res.status(400).json({ error: 'name and strategyId required' });
  const id = name.toLowerCase().replace(/\s+/g, '-');
  if (bots[id]) return res.status(409).json({ error: 'bot id already exists' });
  bots[id] = { id, name, status: 'stopped', strategyId, symbols: Array.isArray(symbols)?symbols:[], logs: [], cursor: 0, buys: 0, sells: 0, cash: 10000, cryptoMkt: 0, locked: 0, totalPL: 0 };
  pushLog(bots[id], `[${id}] created: strategy=${strategyId}, symbols=${bots[id].symbols.join(',')}`);
  res.json({ id });
});

r.get('/bots/:id', (req, res) => {
  const b = bots[req.params.id]; if (!b) return res.status(404).json({ error: 'not_found' });
  res.json({ id: b.id, name: b.name, status: b.status, strategyId: b.strategyId, symbols: b.symbols });
});

r.delete('/bots/:id', (req, res) => {
  const b = bots[req.params.id]; if (!b) return res.status(404).json({ error: 'not_found' });
  stopHeartbeat(b);
  delete bots[req.params.id];
  res.json({ ok: true });
});

r.get('/bots/:id/status', (req, res) => {
  const b = bots[req.params.id]; if (!b) return res.status(404).json({ error: 'not_found' });
  res.json({ status: b.status });
});

r.post('/bots/:id/start', (req, res) => {
  const b = bots[req.params.id]; if (!b) return res.status(404).json({ error: 'not_found' });
  if (b.status !== 'running') {
    b.status = 'running';
    pushLog(b, `[${b.id}] started`);
    ensureHeartbeat(b);
  }
  res.json({ ok: true, status: b.status });
});

r.post('/bots/:id/stop', (req, res) => {
  const b = bots[req.params.id]; if (!b) return res.status(404).json({ error: 'not_found' });
  if (b.status !== 'stopped') {
    b.status = 'stopped';
    pushLog(b, `[${b.id}] stopped`);
    stopHeartbeat(b);
  }
  res.json({ ok: true, status: b.status });
});

r.get('/bots/:id/logs', (req, res) => {
  const b = bots[req.params.id]; if (!b) return res.status(404).json({ error: 'not_found' });
  const since = Number(req.query.cursor || 0);
  const lines = since ? b.logs.slice(Math.max(0, since)) : b.logs.slice(-200);
  res.json({ lines, cursor: String(b.cursor) });
});

r.get('/bots/:id/stats', (req, res) => {
  const b = bots[req.params.id]; if (!b) return res.status(404).json({ error: 'not_found' });
  const p = computePl24h(b);
  res.json({
    id: b.id, status: b.status,
    beginningPortfolioValue: 10000,
    duration: '—',
    buys: b.buys, sells: b.sells,
    totalPL: b.totalPL,
    cash: b.cash, cryptoMkt: b.cryptoMkt, locked: b.locked,
    ...p
  });
});

app.use('/', r);
app.use('/api', r);

// --- Auth endpoints (dev stub) ---
function authOk(req, res) { res.json({ ok: true }); }
app.post('/auth/login', authOk);
app.post('/auth/signin', authOk);
app.post('/auth/logout', authOk);
app.post('/auth/signout', authOk);
app.get('/auth/signout', authOk);

app.listen(PORT, () => {
  console.log(`Control-plane API listening on :${PORT}`);
  const id = 'sample-bot';
  bots[id] = { id, name: 'Sample Bot', status: 'stopped', strategyId: strategies[0].id, symbols: ['BTCUSD','SOLUSD'], logs: [], cursor: 0, buys: 0, sells: 0, cash: 10000, cryptoMkt: 0, locked: 0, totalPL: 0 };
  pushLog(bots[id], `[${id}] created (seed)`);
});
