// backend/summary-writer.js
const fs = require("fs");
const path = require("path");

function safe(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function writeSummary(dir, s) {
  try {
    const p = path.join(dir, "summary.json");
    const safeSummary = {
      beginningPortfolioValue: s.beginningPortfolioValue ?? null,
      duration: s.duration ?? null,
      buys: Math.max(0, Number(s.buys || 0)),
      sells: Math.max(0, Number(s.sells || 0)),
      totalPL: safe(s.totalPL),
      cash: s.cash == null ? null : safe(s.cash),
      cryptoMkt: s.cryptoMkt == null ? null : safe(s.cryptoMkt),
      locked: s.locked == null ? null : safe(s.locked),
      currentValue: safe(s.currentValue),
      dayPL: safe(s.dayPL),
      // NEW: trailing 24h metrics
      pl24h: safe(s.pl24h || 0),
      pl24hAvg: safe(s.pl24hAvg || 0),
    };
    fs.writeFileSync(p, JSON.stringify(safeSummary, null, 2));
  } catch {}
}

function finalizeSummary(dir, s) {
  writeSummary(dir, s);
}

// ---- 24h P/L support (snapshots) ----
// We keep a small rolling history in JSONL: one point per cycle.
const HISTORY_FILE = "history.jsonl";

/**
 * Update the given summary with trailing 24h P/L (total and average per hour).
 * - Reads/updates <dir>/history.jsonl (JSON lines: {t, v})
 * - Mutates and returns the same summary object with pl24h & pl24hAvg set.
 */
function updateWithPl24h(dir, summary) {
  try {
    const p = path.join(dir, HISTORY_FILE);
    const now = Date.now();
    const nowPoint = { t: now, v: Number(summary.currentValue) || 0 };

    // Load existing points
    let pts = [];
    if (fs.existsSync(p)) {
      const lines = fs.readFileSync(p, "utf8").split(/\r?\n/).filter(Boolean);
      pts = lines
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    }

    // Append current and trim to ~24h window (plus a small 5m buffer for baseline)
    pts.push(nowPoint);
    const cutoff = now - 24 * 60 * 60 * 1000;
    const trimmed = pts.filter((pt) => pt.t >= cutoff - 5 * 60 * 1000);

    // Persist back
    fs.writeFileSync(p, trimmed.map((pt) => JSON.stringify(pt)).join("\n"));

    // Baseline at (or just before) 24h ago
    let baseline = null;
    for (let i = trimmed.length - 1; i >= 0; i--) {
      if (trimmed[i].t <= cutoff) {
        baseline = trimmed[i].v;
        break;
      }
    }
    if (baseline == null) baseline = trimmed.length ? trimmed[0].v : nowPoint.v;

    const total = (Number(summary.currentValue) || 0) - (Number(baseline) || 0);

    // Average per hour across the covered window (≤ 24h)
    const spanMs = trimmed.length
      ? trimmed[trimmed.length - 1].t - trimmed[0].t
      : 0;
    const hoursCovered = Math.max(1, Math.min(24, spanMs / 3600000));
    const avgPerHour = total / hoursCovered;

    summary.pl24h = total;
    summary.pl24hAvg = avgPerHour;
  } catch {
    summary.pl24h = 0;
    summary.pl24hAvg = 0;
  }
  return summary;
}

module.exports = { writeSummary, finalizeSummary, updateWithPl24h };
