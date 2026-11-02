#!/usr/bin/env node
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path'; import os from 'node:os'; import fs from 'node:fs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const PORT = Number(process.env.HM_PROBE_PORT || 8165);
const BASE = `http://localhost:${PORT}`;
function cp() { const c = path.join(os.homedir(), '.cache', 'ms-playwright'); for (const d of fs.readdirSync(c).filter((x) => x.startsWith('chromium-'))) { const p = path.join(c, d, 'chrome-linux', 'chrome'); if (fs.existsSync(p)) return p; } }
const server = spawn(process.execPath, ['server.mjs', '--port', String(PORT), '--no-open'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
server.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/index.html')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
const browser = await chromium.launch({ headless: true, executablePath: cp() });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e && e.stack || e)));
await page.goto(BASE + '/', { waitUntil: 'load' });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 30000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('#menu:not(.hidden)');
await page.click('[data-action="menu-new"]');
await page.waitForSelector('#newgame:not(.hidden)');
await page.click('[data-action="ng-start"]');
await page.waitForFunction(() => window.HM && HM.main && HM.main.inGame, null, { timeout: 180000 });
await page.waitForTimeout(1500);
const report = await page.evaluate(() => {
  HM.sim.setSpeed(HM.state, 0);
  HM.ui.closeAllWindows(true);
  const g = HM.gfx;
  const parts = g.animalParts || {};
  let instances = 0;
  for (const k in parts) instances += parts[k].body.count;
  const batches = (g.vegBatches || []).map((b) => ({ sp: b.species, near: b.near.length, far: b.far.length }));
  return {
    animals: HM.state.animals.length,
    species: Object.keys(parts).length,
    instances,
    animalChildren: g.animalGroup ? g.animalGroup.children.length : 0,
    animalStats: HM.nature.stats,
    treesDrawn: g.vegStats && g.vegStats.drawnTrees,
    batches,
    grass: g.grassStats,
    leafKeys: Object.keys(g.leafMatsBySpecies || {}),
    bushMeshes: (g.bushMeshes || []).length,
    flowers: (HM.nature._flowerBatches || []).length,
    snow: (HM.nature._snowBatches || []).length,
    treeTrisPine: (() => { const p = HM.nature.treeParts(); return { near: p.pine.index.count / 3, far: p.far.pine.index.count / 3 }; })(),
    fallback: g.fallbackProfile
  };
});
await page.screenshot({ path: path.join(ROOT, 'shots', 'an-probe-game.png') });
console.log(JSON.stringify({ errors, report }, null, 1));
await browser.close(); server.kill('SIGTERM');
process.exit(errors.length ? 1 : 0);
