import { promises as fsp } from "fs";
import path from "path";

const DEFAULT_FIELDS = [
  {
    key: "dynamicMode",
    label: "Dynamic Mode",
    type: "enum",
    options: ["on", "off"],
    default: "on",
  },
  { key: "atrLength", label: "ATR Length", type: "number", min: 1, default: 2 },
  {
    key: "buyThresholdATR",
    label: "Buy Threshold ATR",
    type: "number",
    step: 0.01,
    default: 0.05,
  },
  {
    key: "sellThresholdATR",
    label: "Sell Threshold ATR",
    type: "number",
    step: 0.01,
    default: 0.05,
  },
  {
    key: "priorityCryptos",
    label: "Priority Cryptos",
    type: "string",
    default: "BTC,ETH,XRP,BONK,POPCAT",
  },
  {
    key: "riskSpreadPerCrypto",
    label: "Risk Spread Per Crypto",
    type: "number",
    step: 0.01,
    default: 0.33,
  },
  {
    key: "reinvestmentCap",
    label: "Reinvestment Cap",
    type: "number",
    step: 0.01,
    default: 0.2,
  },
  {
    key: "confirmTicks",
    label: "Confirm Ticks",
    type: "number",
    min: 0,
    default: 3,
  },
  {
    key: "drawDownBrake",
    label: "Draw Down Brake",
    type: "number",
    step: 0.01,
    default: 0.15,
  },
  {
    key: "slippage",
    label: "Slippage",
    type: "number",
    step: 0.0001,
    default: 0.001,
  },
];

export async function parseEnvWithSections(filePath) {
  let text = "";
  try {
    text = await fsp.readFile(filePath, "utf8");
  } catch {
    return {};
  }

  const sections = {};
  let current = "GLOBAL";

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const hdr = line.match(/^\[([^\]]+)\]$/);
    if (hdr) {
      current = hdr[1].trim();
      continue;
    }

    const kv = line.match(/^([^=]+)=(.*)$/);
    if (!kv) continue;

    let key = kv[1].trim();
    let val = kv[2].trim();
    if (key.startsWith("__")) continue;

    const hash = val.indexOf(" #");
    if (hash >= 0) val = val.slice(0, hash).trim();

    let parsed = val;
    if (/^(true|false)$/i.test(val)) parsed = /^true$/i.test(val);
    else if (/^-?\d+(\.\d+)?$/.test(val)) parsed = Number(val);
    else if (/^\[.*\]$/.test(val)) {
      try {
        parsed = JSON.parse(val);
      } catch {}
    }

    if (!sections[current]) sections[current] = {};
    sections[current][key] = parsed;
  }

  return sections;
}

function shallowMerge(base, extra) {
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(extra || {})) out[k] = v;
  return out;
}

function normalizeConfigShape({ jsonCfg, envSection }) {
  const jsonDefaults = jsonCfg?.defaults || jsonCfg || {};
  const defaults = shallowMerge(jsonDefaults, envSection || {});

  if (Array.isArray(defaults.priorityCryptos)) {
    defaults.priorityCryptos = defaults.priorityCryptos.join(",");
  }

  const fields =
    Array.isArray(jsonCfg?.fields) && jsonCfg.fields.length
      ? jsonCfg.fields
      : DEFAULT_FIELDS.map((f) => ({
          ...f,
          default: defaults[f.key] ?? f.default,
        }));

  return { defaults, fields };
}

export async function resolveStrategyConfig({
  strategiesDir,
  envFile,
  strategyId,
}) {
  const id = String(strategyId || "").trim();

  const dirPath = path.join(strategiesDir, id);
  const fileA = path.join(dirPath, "config.json");
  const fileB = path.join(strategiesDir, `${id}.json`);

  let jsonCfg = null;
  try {
    jsonCfg = JSON.parse(await fsp.readFile(fileA, "utf8"));
  } catch {}
  if (!jsonCfg) {
    try {
      jsonCfg = JSON.parse(await fsp.readFile(fileB, "utf8"));
    } catch {}
  }

  const envSections = await parseEnvWithSections(envFile);
  const envSection = envSections[id] || envSections[id.toUpperCase()] || null;

  const { defaults, fields } = normalizeConfigShape({ jsonCfg, envSection });

  return { id, defaults, fields };
}
