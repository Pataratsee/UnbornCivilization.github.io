#!/usr/bin/env node
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path'; import os from 'node:os'; import fs from 'node:fs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const PORT = 8170; const BASE = `http://localhost:${PORT}`;
function cp() { const c = path.join(os.homedir(), '.cache', 'ms-playwright'); for (const d of fs.readdirSync(c).filter((x) => x.startsWith('chromium-'))) { const p = path.join(c, d, 'chrome-linux', 'chrome'); if (fs.existsSync(p)) return p; } }
const server = spawn(process.execPath, ['server.mjs', '--port', String(PORT), '--no-open'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/models.html')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
const browser = await chromium.launch({ headless: true, executablePath: cp() });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e && e.stack || e)));
await page.goto(BASE + '/models.html', { waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(ROOT, 'shots', 'an-viewer-buildings.png') });
await page.click('#scope-bar button[data-scope="nature"]');
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(ROOT, 'shots', 'an-viewer-nature.png') });
// pick deer
await page.evaluate(() => { const btns = [...document.querySelectorAll('#model-list button')]; const b = btns.find((x) => x.textContent.startsWith('Red deer')); b && b.click(); });
await page.waitForTimeout(900);
await page.screenshot({ path: path.join(ROOT, 'shots', 'an-viewer-deer.png') });
// horse
await page.evaluate(() => { const btns = [...document.querySelectorAll('#model-list button')]; const b = btns.find((x) => x.textContent.startsWith('Wild horse')); b && b.click(); });
await page.waitForTimeout(900);
await page.screenshot({ path: path.join(ROOT, 'shots', 'an-viewer-horse.png') });
// pine
await page.evaluate(() => { const btns = [...document.querySelectorAll('#model-list button')]; const b = btns.find((x) => x.textContent.startsWith('Scots pine')); b && b.click(); });
await page.waitForTimeout(900);
await page.screenshot({ path: path.join(ROOT, 'shots', 'an-viewer-pine.png') });
// lineup
await page.click('#lineup');
await page.waitForTimeout(1400);
await page.screenshot({ path: path.join(ROOT, 'shots', 'an-lineup.png') });
const info = await page.evaluate(() => ({ name: document.getElementById('model-name').textContent, stats: document.getElementById('stats').textContent, meta: document.getElementById('meta').textContent, errors: [] }));
console.log(JSON.stringify({ errors, info }, null, 1));
await browser.close(); server.kill('SIGTERM');
process.exit(errors.length ? 1 : 0);
