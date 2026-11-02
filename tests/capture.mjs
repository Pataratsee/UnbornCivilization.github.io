import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots', 'session');
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.HM_BASE || 'http://localhost:8000';
function chromiumPath() {
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
  for (const d of fs.readdirSync(cache).filter((x) => x.startsWith('chromium-'))) {
    const p = path.join(cache, d, 'chrome-linux', 'chrome');
    if (fs.existsSync(p)) return p;
  }
}
const browser = await chromium.launch({ headless: true, executablePath: chromiumPath(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-gpu-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e && e.stack || e)));
await page.goto(BASE + '/', { waitUntil: 'load' });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 30000 });
await page.screenshot({ path: path.join(OUT, 'step-menu.png') });
await page.click('[data-action="menu-new"]');
await page.waitForSelector('#newgame:not(.hidden)');
await page.click('[data-action="ng-start"]');
await page.waitForFunction(() => window.HM && HM.main.inGame === true, null, { timeout: 180000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(OUT, 'step-default.png') });
const info = await page.evaluate(() => ({
  seed: HM.state.worldSeed, spawn: HM.world.spawn, spawnH: HM.world.heightAt(HM.world.spawn.x, HM.world.spawn.z),
  time: HM.state.time, fps: HM.main.fps, gpu: HM.gfx.gpuName, profile: HM.gfx.fallbackProfile,
  quality: HM.gfx.quality, chunks: HM.gfx.terrainGroup.children.length,
  trees: HM.world.trees.length, displayedTrees: HM.gfx.trees.length,
  sanity: HM.gfx.renderSanity, draw: HM.gfx.drawInfo(),
  slope: HM.world.slopeAt(HM.world.spawn.x, HM.world.spawn.z),
  land: (() => { let land = 0, build = 0, steep = 0, mountain = 0, maxSlope = 0; const N = 513; for (let i = 0; i < N * N; i++) { const x = (i % N) / (N - 1) * HM.world.size - HM.world.half; const z = Math.floor(i / N) / (N - 1) * HM.world.size - HM.world.half; const h = HM.world.heights[i]; if (h > 0.5) { land++; const s = HM.world.slopeAt(x, z); if (s <= 0.62) build++; else steep++; if (h > 60) mountain++; if (s > maxSlope) maxSlope = s; } } return { land, build, steep, mountain, maxSlope, buildFrac: build / land, steepFrac: steep / land }; })()
}));
console.log(JSON.stringify(info, null, 2));
await page.evaluate(() => { HM.state.time.totalHours = 22; HM.sim.calendar(HM.state); HM.gfx.applyEnvironment(HM.state); });
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT, 'step-night.png') });
await page.evaluate(() => { HM.main.debug.tiltMax(); });
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(OUT, 'step-maxtilt.png') });
console.log('errors', JSON.stringify(errors, null, 2));
await browser.close();
