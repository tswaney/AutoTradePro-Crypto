// localRunner.js (ESM, no TypeScript)
// Controls a local bot process by running backend/run.sh and streams its log file.

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths relative to repo root: AutoTradePro-Crypto/
const projectRoot = path.resolve(__dirname, '..', '..');   // /.../AutoTradePro-Crypto
const backendRoot = path.join(projectRoot, 'backend');     // /.../backend
const runScript   = path.join(backendRoot, 'run.sh');      // launcher
const dataRoot    = path.join(backendRoot, 'data');        // per-bot data dir

/** botId -> proc info */
const PROCS = new Map();

function getPaths(botId) {
  const dataDir = path.join(dataRoot, botId);
  const logPath = path.join(dataDir, 'testPrice_output.txt');
  return { dataDir, logPath };
}

export function isRunning(botId) {
  return PROCS.has(botId);
}

export function start(botId) {
  if (isRunning(botId)) return { ok: false, reason: 'already_running' };
  if (!fs.existsSync(runScript)) {
    return { ok: false, reason: `run.sh not found at ${runScript}` };
  }
  const { dataDir, logPath } = getPaths(botId);
  fs.mkdirSync(dataDir, { recursive: true });

  // Spawn bash to execute run.sh with the right env
  const cmd = '/bin/bash';
  const args = ['-lc', `BOT_ID=${botId} DATA_DIR="${dataDir}" ./run.sh`];
  const env = { ...process.env, BOT_ID: botId, DATA_DIR: dataDir };
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
    // fallback kill after 5s if still alive
    setTimeout(() => {
      try { info.proc.kill('SIGTERM'); } catch {}
    }, 5000);
    PROCS.delete(botId);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

export async function restart(botId) {
  await stop(botId);
  return start(botId);
}

/** Stream log tail to a callback; returns a disposer to stop */
export function streamLogs(botId, onLine) {
  const { logPath } = getPaths(botId);
  let closed = false;
  let lastSize = 0;
  let poll = null;

  function sendInitial() {
    if (!fs.existsSync(logPath)) return;
    const txt = fs.readFileSync(logPath, 'utf8');
    const lines = txt.split(/\r?\n/).filter(Boolean);
    const tail = lines.slice(-200); // last 200 lines
    tail.forEach(onLine);
  }

  function poller() {
    if (closed) return;
    try {
      if (!fs.existsSync(logPath)) return; // not yet created
      const stat = fs.statSync(logPath);
      if (stat.size < lastSize) {
        // file rotated/truncated
        lastSize = 0;
      }
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
    } catch {
      // ignore
    }
  }

  // bootstrap
  sendInitial();
  try {
    const stat = fs.statSync(logPath);
    lastSize = stat.size;
  } catch { lastSize = 0; }

  poll = setInterval(poller, 1000);

  return () => {
    closed = true;
    if (poll) clearInterval(poll);
  };
}
