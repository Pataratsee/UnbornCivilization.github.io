#!/usr/bin/env node
/* Quick runtime probe for the nature/wildlife module. Not part of the final
   suite: it prints geometry facts and any console errors so model bugs can be
   caught before the full visual pass. */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 8161;
const BASE = `http://localhost:${PORT}`;
function chromiumPath() {
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
  try {
    for (const d of fs.readdirSync(cache).filter((x) => x.startsWith('chromium-'))) {
      const p = path.join(cache, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  } catch { /* default */ }
  return undefined;
}
const server = spawn(process.execPath, ['server.mjs', '--port', String(PORT), '--no-open'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
server.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
for (let i = 0; i < 80; i++) {
  try { if ((await fetch(BASE + '/models.html')).ok) break; } catch { /* wait */ }
  await new Promise((r) => setTimeout(r, 100));
}
const browser = await chromium.launch({ headless: true, executablePath: chromiumPath() });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e && e.stack || e)));
await page.goto(BASE + '/models.html', { waitUntil: 'load' });
await page.waitForTimeout(800);
const report = await page.evaluate(() => {
  const N = HM.nature;
  const out = { entries: N.viewerEntries().length, stats: {}, errors: [] };
  try { N.materials(); N.treeParts(); N.animalModels(); } catch (e) { out.errors.push(String(e && e.stack || e)); }
  for (const e of N.viewerEntries()) {
    try { out.stats[e.id] = N.viewerStats(e.id); } catch (err) { out.errors.push(e.id + ': ' + String(err && err.stack || err)); }
  }
  const parts = N.treeParts();
  out.trees = {};
  for (const sp of ['pine', 'oak', 'birch', 'palm', 'scrub', 'cactus']) {
    const tri = (g) => g ? (g.index ? g.index.count / 3 : g.attributes.position.count / 3) : 0;
    out.trees[sp] = { near: tri(parts[sp]) + tri(parts[sp + 'Trunk']), far: tri(parts.far[sp]) + tri(parts.farTrunk[sp]) };
  }
  out.animals = {};
  for (const sp of N.ANIMAL_ORDER) {
    const m = N.animalModels()[sp];
    if (!m) { out.animals[sp] = null; continue; }
    out.animals[sp] = { tris: m.tris, parts: Object.keys(m.partMeta), farParts: m.far.attributes.position.count, height: (() => { const b = new THREE.Box3().setFromObject(N.viewerBuild('animal:' + sp)); return +(b.max.y - b.min.y).toFixed(2); })() };
  }
  out.materials = Object.keys(N.MATERIALS);
  return out;
});
console.log(JSON.stringify({ errors, report }, null, 1));
await browser.close();
server.kill('SIGTERM');
process.exit(errors.length || (report.errors && report.errors.length) ? 1 : 0);
