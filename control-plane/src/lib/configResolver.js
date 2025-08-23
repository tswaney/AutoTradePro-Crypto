// control-plane/src/lib/configResolver.js (ESM)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

/* ---------- paths ---------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PROJECT_ROOT = path.resolve(
  path.join(__dirname, "..", "..", "..")
);
export const STRATEGIES_DIR =
  process.env.STRATEGIES_DIR ||
  path.join(PROJECT_ROOT, "backend", "strategies");
export const STRATEGY_OPTIONS_JSON = path.join(
  PROJECT_ROOT,
  "mobile",
  "src",
  "strategyOptions.json"
);
export const BACKEND_ENV = path.join(PROJECT_ROOT, "backend", ".env");
export const BOT_DATA_ROOT =
  process.env.DATA_ROOT || path.join(PROJECT_ROOT, "backend", "data");

/* ---------- fs helpers ---------- */
const safeRead = (p) => {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
};
const fileExists = (p) => {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
};

const prettyId = (id) =>
  String(id)
    .replace(/[_\-\.\s]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

const labelize = (k) =>
  String(k)
    .replace(/__/g, "_")
    .replace(/[_\-\.\s]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .trim();

function stripInlineComment(v) {
  // remove trailing inline # or ; comments (values already unquoted)
  return String(v)
    .replace(/\s*(#|;).*$/, "")
    .trim();
}

function inferTypeDefault(vRaw) {
  const v = String(vRaw)
    .trim()
    .replace(/^["']|["']$/g, "");
  const low = v.toLowerCase();
  // time like 01:00 stays text (UI can render a time input if desired)
  if (/^\d{1,2}:\d{2}$/.test(v)) return { type: "text", default: v };
  if (/^-?\d+(\.\d+)?$/.test(v)) return { type: "number", default: Number(v) };
  if (low === "true" || low === "false")
    return { type: "boolean", default: low === "true" };
  return { type: "text", default: v };
}

/* ---------- strategies list & meta ---------- */
function extractMetaFromSource(srcText, id) {
  let name = null,
    description = null,
    version = null;
  const obj = srcText.match(
    /(?:export\s+default|module\.exports\s*=\s*)\s*{[\s\S]*?}/
  );
  if (obj) {
    const grab = (k) => {
      const re = new RegExp(`${k}\\s*:\\s*["'\`]([^"'\\\`]+)["'\`]`, "i");
      const m = obj[0].match(re);
      return m ? m[1].trim() : null;
    };
    name = grab("name");
    description = grab("description");
    version = grab("version");
  }
  if (!description) {
    const m = srcText.match(/\/\*\*([\s\S]*?)\*\//);
    if (m) description = m[1].trim().split("\n")[0].trim();
  }
  return {
    id,
    name: name || id,
    description: description || prettyId(id),
    version: version || null,
  };
}

export function listStrategies() {
  let entries = [];
  try {
    entries = fs
      .readdirSync(STRATEGIES_DIR, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith(".js"));
  } catch {
    /* ignore */
  }

  const list = entries.map((d) => {
    const id = path.basename(d.name, ".js");
    const meta = extractMetaFromSource(
      safeRead(path.join(STRATEGIES_DIR, d.name)),
      id
    );
    return {
      id: meta.id,
      name: meta.name,
      description: meta.description,
      version: meta.version,
    };
  });
  return list.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

/* ---------- config in strategy source / mobile JSON ---------- */
function objectLiteralBody(snippet) {
  const m = snippet && snippet.match(/{([\s\S]*?)}/);
  return m ? m[1] : null;
}
function parseObjectToKeyVals(snippet) {
  const body = objectLiteralBody(snippet);
  if (!body) return [];
  const pairs = [];
  body.split(/\n|,/).forEach((line) => {
    const mm = line.match(/^\s*([A-Za-z0-9_\-]+)\s*:\s*([^\n,]+)\s*$/);
    if (mm) {
      const key = mm[1].trim();
      let val = mm[2].trim().replace(/^['"`](.*)['"`]$/, "$1");
      pairs.push([key, val]);
    }
  });
  return pairs;
}

function fieldsFromStrategySource(srcText) {
  const candidates =
    srcText.match(/config(?:Schema)?\s*:\s*{[\s\S]*?}/i) ||
    srcText.match(/options\s*:\s*{[\s\S]*?}/i) ||
    srcText.match(
      /(?:const|let)\s+(configSchema|options|fields|params)\s*=\s*{[\s\S]*?}/i
    );

  if (!candidates) return null;
  const kvs = parseObjectToKeyVals(candidates[0]);
  if (!kvs.length) return null;

  return kvs.map(([k, v]) => {
    const { type, default: def } = inferTypeDefault(v);
    return { id: k, key: k, label: labelize(k), type, default: def };
  });
}

function safeJSON(p) {
  try {
    return JSON.parse(safeRead(p) || "");
  } catch {
    return null;
  }
}

function readOptionsFromMobileJSON(idLower) {
  if (!fileExists(STRATEGY_OPTIONS_JSON)) return null;
  const data = safeJSON(STRATEGY_OPTIONS_JSON);
  if (!data) return null;

  if (Array.isArray(data)) {
    const entry = data.find((s) => String(s.id).toLowerCase() === idLower);
    return entry
      ? entry.options || entry.fields || entry.configFields || null
      : null;
  }
  if (typeof data === "object") {
    for (const [k, v] of Object.entries(data)) {
      if (String(k).toLowerCase() === idLower) return v?.options || null;
    }
  }
  return null;
}

function optionsToFields(options = {}) {
  const fields = [];
  for (const [k, specRaw] of Object.entries(options)) {
    const spec = specRaw || {};
    const guess = (spec.type || "").toLowerCase();
    const type = ["number", "boolean", "text"].includes(guess)
      ? guess
      : typeof spec.default === "number"
      ? "number"
      : typeof spec.default === "boolean"
      ? "boolean"
      : "text";

    const f = {
      id: k,
      key: k,
      label: spec.label ? String(spec.label) : labelize(k),
      type,
      default: spec.default,
    };
    for (const hint of ["min", "max", "step", "unit", "placeholder", "help"]) {
      if (spec[hint] !== undefined) f[hint] = spec[hint];
    }
    fields.push(f);
  }
  return fields;
}

/* ---------- ENV parsing with section support ---------- */
function loadEnvRaw() {
  try {
    return fs.readFileSync(BACKEND_ENV, "utf8");
  } catch {
    return "";
  }
}

function normalizeTokens(s) {
  return String(s)
    .replace(/(Strategy|Bot)$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-\.\s]+/g, " ")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

// Parse .env into:
//  - prefixed: dotenv.parse result (COMMON__/ID__ etc.)
//  - sections: { "SECTION TITLE": { KEY: value } } using lines between ======= [ title ] ======= markers
//  - unsectioned: unprefixed keys outside any section (treated as COMMON defaults, with reserved keys filtered)
function parseEnvWithSections() {
  const text = loadEnvRaw();
  // Let dotenv parse *all* simple KEY=VAL lines into prefixed map; we'll still do our
  // own section parsing below. We won't rely on dotenv for section-scoped keys.
  const prefixed = (() => {
    try {
      return dotenv.parse(text);
    } catch {
      return {};
    }
  })();

  const lines = text.split(/\r?\n/);
  const sections = {};
  let current = null;
  const unsectioned = {};

  // Accept headers with or without leading '#'
  const SECTION_RE = /^\s*#?\s*={3,}\s*\[\s*([^\]]+?)\s*\]\s*={3,}\s*$/;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Section header?
    const sec = line.match(SECTION_RE);
    if (sec) {
      current = sec[1].trim();
      if (!sections[current]) sections[current] = {};
      continue;
    }

    // KEY=VALUE line?
    const kv = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!kv) continue;

    const key = kv[1].trim();
    let val = kv[2].trim().replace(/^['"]|['"]$/g, "");

    // Strip inline comments after the value
    val = stripInlineComment(val);

    // IMPORTANT: Only skip *double-underscore* explicit prefixes here (COMMON__/ID__).
    // We DO NOT skip single-underscore keys (e.g., PROFIT_LOCK_ENABLE) so they can live
    // inside sections (your chosen style).
    if (/^[A-Z0-9]+__/.test(key)) {
      // skip from section/unsectioned maps; these remain available via `prefixed`
      continue;
    }

    // Store in the active section or the unsectioned area
    if (current) sections[current][key] = val;
    else unsectioned[key] = val;
  }

  return { prefixed, sections, unsectioned };
}

// generate MANY plausible prefixes for .env keys
function idToEnvPrefixes(id) {
  let base = String(id).trim();

  const tokensNoSuffix = base
    .replace(/(Strategy|Bot)$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-\.\s]+/g, " ")
    .trim()
    .split(/\s+/);

  const tokensWithStrategy = base
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-\.\s]+/g, " ")
    .trim()
    .split(/\s+/);

  const toSnake = (arr) => arr.join("_");
  const toCollapsed = (arr) => arr.join("");
  const acronym = (arr) =>
    arr
      .map((t) => t[0])
      .join("")
      .toUpperCase();

  const snakes = [
    toSnake(tokensNoSuffix).toUpperCase(),
    toSnake(tokensWithStrategy).toUpperCase(),
  ];
  const collapsed = [
    toCollapsed(tokensNoSuffix).toUpperCase(),
    toCollapsed(tokensWithStrategy).toUpperCase(),
  ];
  const directs = [
    base.toUpperCase(),
    base.replace(/(Strategy|Bot)$/i, "").toUpperCase(),
  ];

  const versionize = (s) => [
    s.replace(/V(\d+)\.(\d+)/i, "V$1_$2"),
    s.replace(/[\._]/g, "").replace(/V(\d+)\.(\d+)/i, "V$1$2"),
  ];

  const variants = [
    ...directs,
    ...snakes.flatMap(versionize),
    ...collapsed.flatMap(versionize),
    acronym(tokensWithStrategy),
    acronym(tokensNoSuffix),
    acronym(tokensWithStrategy).replace(/S$/, ""),
    acronym(tokensNoSuffix).replace(/S$/, ""),
  ];

  const seen = new Set();
  const out = [];
  for (const v of variants)
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  return out;
}

const RESERVED_GLOBAL_KEYS = new Set([
  // Avoid polluting strategy forms with infra keys
  "PORT",
  "NODE_ENV",
  "LOG_LEVEL",
  "CONTROL_PLANE_PORT",
  "BACKEND_PORT",
]);

function fieldsFromEnvOnly(id, debug = null) {
  const { prefixed, sections, unsectioned } = parseEnvWithSections();
  const prefixes = idToEnvPrefixes(id);
  const fields = [];
  const matchedKeys = [];

  const add = (rawKey, rawVal) => {
    const cleaned = stripInlineComment(rawVal);
    const { type, default: def } = inferTypeDefault(cleaned);
    fields.push({
      id: rawKey,
      key: rawKey,
      label: labelize(rawKey),
      type,
      default: def,
    });
  };

  // 1) COMMON__*
  for (const [k, v] of Object.entries(prefixed)) {
    const m = k.match(/^COMMON__([A-Za-z0-9_]+)$/);
    if (m) {
      add(m[1], v);
      matchedKeys.push(k);
    }
  }

  // 2) Strategy‑prefixed keys
  for (const pref of prefixes) {
    const reDouble = new RegExp(`^${pref}__([A-Za-z0-9_]+)$`);
    const reSingle = new RegExp(`^${pref}_([A-Za-z0-9_]+)$`);
    for (const [k, v] of Object.entries(prefixed)) {
      let mm = k.match(reDouble);
      if (mm) {
        add(mm[1], v);
        matchedKeys.push(k);
        continue;
      }
      mm = k.match(reSingle);
      if (mm) {
        add(mm[1], v);
        matchedKeys.push(k);
      }
    }
  }

  // 3) Best‑match section (token overlap)
  const idTokens = new Set(normalizeTokens(id));
  let bestSection = null,
    bestScore = 0;

  for (const [title, kvs] of Object.entries(sections)) {
    const tks = normalizeTokens(title);
    const overlap = tks.filter((t) => idTokens.has(t)).length;
    if (overlap > bestScore) {
      bestScore = overlap;
      bestSection = { title, kvs, tks };
    }
  }

  if (bestSection && bestScore > 0) {
    for (const [k, v] of Object.entries(bestSection.kvs)) {
      add(k, v);
      matchedKeys.push(`${bestSection.title}::${k}`);
    }
  }

  // 4) Unsectioned → COMMON defaults (skip infra keys)
  for (const [k, v] of Object.entries(unsectioned)) {
    if (RESERVED_GLOBAL_KEYS.has(k)) continue;
    add(k, v);
    matchedKeys.push(`COMMON(unprefixed)::${k}`);
  }

  if (debug) {
    debug.envPrefixesTried = prefixes;
    debug.envSectionChosen = bestSection ? bestSection.title : null;
    debug.envKeysMatched = matchedKeys;
  }

  const map = new Map();
  for (const f of fields) map.set(f.key, f);
  return Array.from(map.values());
}

export function mergeEnvIntoFields(id, baseFields, debug = null) {
  const envFields = fieldsFromEnvOnly(id, debug);
  if (!envFields.length) return baseFields;

  const byKey = new Map(
    baseFields.map((f) => [String(f.key || f.id), { ...f }])
  );
  for (const ef of envFields) {
    const key = String(ef.key);
    if (byKey.has(key)) {
      const cur = byKey.get(key);
      byKey.set(key, { ...cur, default: ef.default ?? cur.default });
    } else {
      byKey.set(key, ef);
    }
  }
  return Array.from(byKey.values());
}

/* ---------- top-level helpers used by routes ---------- */
export function loadStrategyConfigShapes(
  id,
  { includeEnv = true, debug = false } = {}
) {
  const dbg = debug ? {} : null;
  const idLower = String(id).toLowerCase();

  // 1) strategy source
  const srcPath = path.join(STRATEGIES_DIR, `${id}.js`);
  let fields = null;
  if (fileExists(srcPath)) {
    const fromSrc = fieldsFromStrategySource(safeRead(srcPath));
    if (fromSrc?.length) fields = fromSrc;
  }

  // 2) mobile JSON
  if (!fields || !fields.length) {
    const opts = readOptionsFromMobileJSON(idLower);
    if (opts && typeof opts === "object") fields = optionsToFields(opts);
  }

  // 3) env
  if (includeEnv) {
    fields = mergeEnvIntoFields(id, fields || [], dbg);
  } else {
    fields = fields || [];
  }

  // mirror as options object
  const options = {};
  for (const f of fields) {
    const base = { type: f.type, default: f.default };
    for (const k of [
      "min",
      "max",
      "step",
      "unit",
      "placeholder",
      "help",
      "label",
    ]) {
      if (f[k] !== undefined) base[k] = f[k];
    }
    options[String(f.key || f.id)] = base;
  }

  const payload = { id, fields, configFields: fields, options };
  if (dbg) payload.debug = dbg;
  return payload;
}

/* ---------- per‑bot meta helpers ---------- */
export function readBotMeta(botId) {
  try {
    const p = path.join(BOT_DATA_ROOT, botId, "meta.json");
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}
export function writeBotMeta(botId, meta) {
  const dir = path.join(BOT_DATA_ROOT, botId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
}

/* Resolve FINAL params for a bot = schema defaults -> env -> meta.params */
export function resolveBotParams(strategyId, botParams) {
  const base = loadStrategyConfigShapes(strategyId, {
    includeEnv: true,
    debug: false,
  }).fields;
  const byKey = new Map(base.map((f) => [String(f.key || f.id), { ...f }]));
  for (const [k, v] of Object.entries(botParams || {})) {
    const key = String(k);
    if (byKey.has(key)) {
      const f = byKey.get(key);
      byKey.set(key, { ...f, default: v });
    } else {
      byKey.set(key, {
        id: key,
        key,
        label: labelize(key),
        type: typeof v,
        default: v,
      });
    }
  }
  const out = {};
  for (const f of byKey.values()) out[String(f.key || f.id)] = f.default;
  return out;
}
