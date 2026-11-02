#!/usr/bin/env node
/* Fixed-seed mechanics monkey and short soak.
   Real Chromium, real windows and actions; fails on any console error,
   page exception or non-finite simulation value. Run: node tests/monkey.mjs */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.HM_MONKEY_PORT || 8139);
const BASE = `http://localhost:${PORT}`;
const errors = [];
let server, browser;
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('PASS  ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')); }
};
function chromiumPath() {
  if (process.env.HM_CHROMIUM) return process.env.HM_CHROMIUM;
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
  for (const d of fs.existsSync(cache) ? fs.readdirSync(cache).filter((x) => x.startsWith('chromium-')) : []) {
    const p = path.join(cache, d, 'chrome-linux', 'chrome');
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

await (async () => {
  server = spawn(process.execPath, ['server.mjs', '--port', String(PORT), '--no-open'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/index.html')).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 100)); }
  browser = await chromium.launch({ headless: true, executablePath: chromiumPath(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-gpu-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e.stack || e)));
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForSelector('#menu:not(.hidden)');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#menu:not(.hidden)');
  await page.click('[data-action="menu-new"]');
  await page.waitForSelector('#newgame:not(.hidden)');
  await page.click('[data-action="ng-start"]');
  await page.waitForFunction(() => window.HM && HM.main && HM.main.inGame, null, { timeout: 150000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    document.querySelector('#tutorial-offer [data-action="tutorial-skip"]')?.click();
    HM.ui.closeAllWindows(true);
    HM.sim.setSpeed(HM.state, 4);
    HM.state.money = 500000;
    HM.state.era = 6;
    for (const id in HM.data.TECH) HM.state.research.completed[id] = true;
    HM.state.resources.steel = 500; HM.state.resources.wood = 500; HM.state.resources.stone = 500;
    const sp = HM.world.spawn;
    for (let i = 0; i < 8; i++) {
      const b = HM.sim.addBuilding(HM.state, ['cottage', 'farm', 'market', 'workshop'][i % 4], sp.x + 16 + i * 7, sp.z + 40 + (i % 3) * 8, 0);
      if (b) {
        b.buildProgress = 1; HM.gfx.addBuilding(b);
        if (i === 0) for (let k = 0; k < 12; k++) HM.sim.addCitizen(HM.state, b, true);
      }
    }
    HM.sim.assignJobs(HM.state);
  });
  await page.waitForTimeout(700);

  const R = rng(424242);
  const kinds = ['window', 'speed', 'weather', 'tool', 'window', 'speed', 'place', 'demolish'];
  const failures = [];
  for (let i = 0; i < 1200; i++) {
    const kind = kinds[Math.floor(R() * kinds.length)];
    try {
      if (kind === 'window') {
        const id = await page.evaluate((r) => {
          const ids = Object.keys(HM.ui.windowSpecs);
          return ids[Math.floor(r * ids.length)];
        }, R());
        await page.evaluate((wid) => { HM.ui.closeAllWindows(true); HM.ui.openWindow(wid); }, id);
        await page.waitForTimeout(3);
      } else if (kind === 'speed') {
        await page.evaluate((idx) => HM.sim.setSpeed(HM.state, idx), Math.floor(R() * 12));
      } else if (kind === 'weather') {
        const weather = ['clear', 'overcast', 'rain', 'storm', 'snow', 'fog'][Math.floor(R() * 6)];
        await page.evaluate((w) => HM.main.debug.setWeather(w), weather);
      } else if (kind === 'tool') {
        const t = ['select', 'road', 'demolish', 'flatten', 'place'][Math.floor(R() * 5)];
        if (t === 'place') {
          const id = await page.evaluate((r) => { const list = HM.data.BUILDINGS.filter((b) => !b.wall); return list[Math.floor(r * list.length)].id; }, R());
          await page.evaluate((defId) => { HM.state.money = 500000; HM.game.beginPlacement(defId); }, id);
        } else if (t === 'road') await page.evaluate(() => HM.game.beginRoad('gravel'));
        else await page.evaluate((tool) => HM.game.setTool(tool), t);
        await page.mouse.move(700 + R() * 200, 480 + R() * 160);
        await page.mouse.click(700 + R() * 200, 480 + R() * 160);
        await page.keyboard.press('Escape');
      } else if (kind === 'place') {
        const res = await page.evaluate((r) => {
          const sp = HM.world.spawn;
          const ang = r * 6.283, dist = 20 + (r * 997 % 80);
          const x = sp.x + Math.cos(ang) * dist, z = sp.z + Math.sin(ang) * dist;
          if (!HM.world.inBounds(x, z) || HM.world.isWater(x, z)) return null;
          const def = HM.data.BUILDINGS[Math.floor(r * 733) % HM.data.BUILDINGS.length];
          HM.state.money = 500000;
          const b = HM.sim.addBuilding(HM.state, def.id, x, z, 0);
          if (b) HM.gfx.addBuilding(b);
          return b ? b.uid : null;
        }, R());
        if (res == null) continue;
      } else if (kind === 'demolish') {
        const uid = await page.evaluate((r) => {
          const list = HM.state.buildings;
          if (!list.length) return null;
          return list[Math.floor(r * list.length) % list.length].uid;
        }, R());
        if (uid != null) await page.evaluate((id) => HM.game.demolish(id), uid);
      }
    } catch (e) { failures.push({ i, kind, error: String(e && e.message || e) }); }
    if (i % 60 === 0) {
      const bad = await page.evaluate(() => {
        const s = HM.state;
        const vals = [s.money, s.happiness, s.time.totalHours, s.cache.powerCap, s.cache.foodProd, s.cache.armyTotal];
        return vals.filter((v) => !Number.isFinite(v));
      });
      if (bad.length) errors.push(`non-finite simulation values at step ${i}: ${bad}`);
    }
  }
  await page.evaluate(() => { HM.ui.closeAllWindows(true); HM.sim.setSpeed(HM.state, 0); });
  ok('1200 mixed real-UI actions complete with no console errors', errors.length === 0 && failures.length === 0, JSON.stringify({ errors: errors.slice(0, 4), failures: failures.slice(0, 4) }));

  // Two simulated years of hourly ticks, with the town already populated.
  const soak = await page.evaluate(() => {
    const s = HM.state;
    HM.gfx.clearGhost && HM.gfx.clearGhost();
    if (!s.citizens.length) {
      const home = s.buildings.find((b) => HM.data.getBuilding(b.defId)?.homes) || s.buildings[0];
      if (home) for (let k = 0; k < 10; k++) { home.builtProgress = 1; HM.sim.addCitizen(s, home, true); }
      HM.sim.assignJobs(s);
    }
    for (let h = 0; h < 5760; h++) HM.sim.advanceHours(s, 1);
    const values = {
      money: s.money, happiness: s.happiness, hours: s.time.totalHours,
      citizens: s.citizens.length, buildings: s.buildings.length,
      power: s.cache.powerCap, water: s.cache.waterCap, food: s.cache.foodProd,
      army: s.cache.armyTotal
    };
    const bad = Object.entries(values).filter(([, v]) => typeof v === 'number' && !Number.isFinite(v)).map(([k]) => k);
    return { values, bad, errors: [] };
  });
  ok('two simulated years advance without non-finite values', soak.bad.length === 0, JSON.stringify(soak.values));

  await page.evaluate(() => HM.game.save(true));
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#menu:not(.hidden)');
  await page.click('[data-action="menu-continue"]');
  await page.waitForFunction(() => window.HM && HM.main && HM.main.inGame, null, { timeout: 180000 });
  await page.waitForTimeout(800);
  const loaded = await page.evaluate(() => ({ inGame: HM.main.inGame, buildings: (HM.state.buildings || []).length, vehicles: HM.sim.vehicleFleet(HM.state).total }));
  ok('the monkeyed save reloads into a running settlement', loaded.inGame && loaded.buildings >= 0, JSON.stringify(loaded));
  await page.screenshot({ path: 'shots/r3-monkey-loaded.png' });
  ok('reload adds no console errors', errors.length === 0, JSON.stringify(errors.slice(0, 5)));

  const viewer = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const viewerErrors = [];
  viewer.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text())) viewerErrors.push(m.text()); });
  viewer.on('pageerror', (e) => viewerErrors.push(String(e.stack || e)));
  await viewer.goto(BASE + '/models.html', { waitUntil: 'load' });
  await viewer.waitForTimeout(1800);
  const v = await viewer.evaluate(() => ({ canvas: !!document.querySelector('#stage canvas'), buttons: document.querySelectorAll('#model-list button').length, name: document.getElementById('model-name').textContent, stats: document.getElementById('stats').textContent, error: document.getElementById('viewer-error').hidden }));
  await viewer.screenshot({ path: 'shots/r3-model-viewer.png' });
  ok('the model viewer renders the catalogue with live geometry counts', v.canvas && v.buttons > 200 && !!v.name && /triangles/.test(v.stats) && v.error && viewerErrors.length === 0, JSON.stringify({ v, viewerErrors }));
})();

await browser?.close();
server?.kill('SIGTERM');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
