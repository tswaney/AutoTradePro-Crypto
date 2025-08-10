// control-plane/src/routes/strategies.js (ESM)
import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const router = Router();

// Very simple parser: looks for top-of-file comments like:
// /**
//  * name: Moderate Retain Mode
//  * version: 1.0
//  * description: Grid-based trading with ATR thresholds
//  */
function parseHeaderComment(text) {
  const out = {};
  const re = /[*]\s*(name|version|description):\s*(.+)\n/gi;
  let m;
  while ((m = re.exec(text))) {
    out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

router.get('/', async (req, res) => {
  try {
    const strategiesDir = path.resolve(__dirname, '..', 'strategies');
    let files = [];
    try {
      files = await fs.readdir(strategiesDir);
    } catch {
      // dir may not exist yet
      return res.json([]);
    }

    const items = [];
    for (const f of files) {
      if (!f.endsWith('.js')) continue;
      const full = path.join(strategiesDir, f);
      const text = await fs.readFile(full, 'utf8');
      const meta = parseHeaderComment(text);
      items.push({
        file: f,
        name: meta.name || f.replace(/\.js$/, ''),
        version: meta.version || '',
        description: meta.description || ''
      });
    }
    res.json(items);
  } catch (e) {
    console.error('[strategies] error', e);
    res.status(500).json({ error: 'failed_to_read_strategies' });
  }
});

export default router;
