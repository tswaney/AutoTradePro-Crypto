// localRunner.js (ESM) - passes STRATEGY_CHOICE to run.sh
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..', '..');
const backendRoot = path.join(projectRoot, 'backend');
const runScript   = path.join(backendRoot, 'run.sh');
const dataRoot    = path.join(backendRoot, 'data');

const PROCS = new Map();

function getPaths(botId) {
  const dataDir = path.join(dataRoot, botId);
  const logPath = path.join(dataDir, 'testPrice_output.txt');
  return { dataDir, logPath };
}

export function isRunning(botId) {
  return PROCS.has(botId);
}

export function start(botId, opts = {}) {
  const { strategyChoice } = opts;
  if (isRunning(botId)) return { ok: false, reason: 'already_running' };
  if (!fs.existsSync(runScript)) {
    return { ok: false, reason: `run.sh not found at ${runScript}` };
  }
  const { dataDir, logPath } = getPaths(botId);
  fs.mkdirSync(dataDir, { recursive: true });

  const cmd = '/bin/bash';
  const envLine = [
    `BOT_ID=${botId}`,
    `DATA_DIR="${dataDir}"`,
    strategyChoice ? `STRATEGY_CHOICE=${strategyChoice}` : null,
  ].filter(Boolean).join(' ');

  const args = ['-lc', `${envLine} ./run.sh`];
  const env = { ...process.env, BOT_ID: botId, DATA_DIR: dataDir };
  if (strategyChoice) env.STRATEGY_CHOICE = String(strategyChoice);

  const proc = spawn(cmd, args, { cwd: backendRoot, env });

  proc.stdout.on('data', d => process.stdout.write(`[${botId}] ${d}`));
  proc.stderr.on('data', d => process.stderr.write(`[${botId}] ${d}`));
  proc.on('exit', (code, signal) => {
    PROCS.delete(botId);
    console.log(`[${botId}] exited with code=${code} signal=${signal}`);
  });

  PROCS.set(botId, { pid: proc.pid ?? -1, startedAt: Date.now(), proc, botId, dataDir, logPath });
  console.log(`[${botId}] started (pid ${proc.pid})`);
  return { ok: true, pid: proc.pid, dataDir, logPath };
}

export async function stop(botId) {
  const info = PROCS.get(botId);
  if (!info) return { ok: false, reason: 'not_running' };
  try {
    info.proc.kill('SIGINT');
    setTimeout(() => { try { info.proc.kill('SIGTERM'); } catch {} }, 5000);
    PROCS.delete(botId);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

export async function restart(botId, opts = {}) {
  await stop(botId);
  return start(botId, opts);
}

export function streamLogs(botId, onLine) {
  const { logPath } = getPaths(botId);
  let closed = false;
  let lastSize = 0;
  let poll = null;

  function sendInitial() {
    if (!fs.existsSync(logPath)) return;
    const txt = fs.readFileSync(logPath, 'utf8');
    const lines = txt.split(/\r?\n/).filter(Boolean);
    const tail = lines.slice(-200);
    tail.forEach(onLine);
  }

  function poller() {
    if (closed) return;
    try {
      if (!fs.existsSync(logPath)) return;
      const stat = fs.statSync(logPath);
      if (stat.size < lastSize) lastSize = 0;
      if (stat.size > lastSize) {
        const stream = fs.createReadStream(logPath, { start: lastSize, end: stat.size });
        let buf = '';
        stream.on('data', chunk => { buf += chunk.toString('utf8'); });
        stream.on('end', () => {
          const lines = buf.split(/\r?\n/).filter(Boolean);
          lines.forEach(onLine);
        });
        lastSize = stat.size;
      }
    } catch {}
  }

  sendInitial();
  try { lastSize = fs.statSync(logPath).size; } catch { lastSize = 0; }
  poll = setInterval(poller, 1000);
  return () => { closed = true; if (poll) clearInterval(poll); };
}
