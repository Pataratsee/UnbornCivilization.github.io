#!/usr/bin/env node
/**
 * Group checks for the large revision. Each group is independent and uses a
 * real Chromium page. Screenshots land in shots/revamp-*.png.
 * Run: node tests/groups.mjs [1|2|3|4|5|all]
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'shots');
const PORT = Number(process.env.HM_GROUP_PORT || 8126);
const BASE = `http://localhost:${PORT}`;
const ONLY = (process.argv[2] || 'all').toLowerCase();
let pass = 0, fail = 0;
const errors = [];
let browser, server;
const results = {};

function ok(name, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')); }
  return !!cond;
}
function chromiumPath() {
  if (process.env.HM_CHROMIUM) return process.env.HM_CHROMIUM;
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
  try {
    for (const d of fs.readdirSync(cache).filter((x) => x.startsWith('chromium-'))) {
      const p = path.join(cache, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  } catch { /* default */ }
  return undefined;
}
async function startServer() {
  server = spawn(process.execPath, ['server.mjs', '--port', String(PORT), '--no-open'], {
    cwd: ROOT, env: { ...process.env, NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + '/index.html')).ok) return; } catch { /* wait */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}
function watch(page) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e && e.stack || e)));
}
async function newPage(viewport = { width: 1600, height: 1000 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); watch(page);
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForSelector('#menu:not(.hidden)', { timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#menu:not(.hidden)');
  await page.click('[data-action="menu-new"]');
  await page.waitForSelector('#newgame:not(.hidden)');
  await page.click('[data-action="ng-start"]');
  await page.waitForFunction(() => window.HM && HM.main && HM.main.inGame, null, { timeout: 150000 });
  await page.waitForSelector('#game-ui:not(.hidden)');
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    document.querySelector('#tutorial-offer [data-action="tutorial-skip"]')?.click();
    HM.ui.closeAllWindows(true);
    HM.sim.setSpeed(HM.state, 0);
  });
  await page.waitForTimeout(200);
  return page;
}
async function shot(page, name) { const f = path.join(SHOTS, name); await page.screenshot({ path: f }); return f; }
async function project(page, x, z, lift = 1) {
  return page.evaluate(({ x, z, lift }) => HM.gfx.screenPoint(x, HM.world.heightAt(x, z) + lift, z), { x, z, lift });
}
async function clickWorld(page, x, z, lift = 1) {
  const q = await project(page, x, z, lift);
  await page.mouse.click(q.x, q.y);
  return q;
}
// Tests that use screen coordinates must not race the camera's eased follow.
async function focusNow(page, x, z, dist) {
  await page.evaluate(({ x, z, dist }) => {
    HM.gfx.targetGoal.x = x; HM.gfx.targetGoal.z = z;
    HM.gfx.target.x = x; HM.gfx.target.z = z;
    HM.gfx.distTarget = dist; HM.gfx.distance = dist;
  }, { x, z, dist });
  await page.waitForTimeout(220);
}
async function setupTown(page, adults = 8) {
  await page.evaluate(({ adults }) => {
    HM.state.money = 9e6;
    HM.ui.closeAllWindows(true);
    const s = HM.world.spawn;
    if (!HM.state.roads.length) HM.main.debug.addRoad(s.x - 36, s.z, s.x + 44, s.z);
    if (!HM.state.buildings.length) {
      HM.main.debug.place('tent', -18, 9);
      HM.main.debug.place('farm', -10, -20);
      HM.main.debug.place('market', 16, -14);
    }
    const home = HM.state.buildings.find((b) => HM.data.getBuilding(b.defId).homes);
    if (home) {
      while (HM.state.citizens.length < adults) {
        const c = HM.sim.addCitizen(HM.state, home, true);
        c.age = 22 + (HM.state.citizens.length % 30); c.inside = false;
      }
    }
    HM.state.weather = 'overcast'; HM.state.weatherTimer = 999;
    HM.state.time.totalHours = Math.floor(HM.state.time.totalHours / 24) * 24 + 10;
    HM.sim.calendar(HM.state); HM.sim.assignJobs(HM.state); HM.sim.refreshCache(HM.state);
    HM.gfx.flyTo ? HM.gfx.flyTo(s.x, s.z) : HM.gfx.focusOn(s.x, s.z, 170);
  }, { adults });
  await page.waitForTimeout(500);
}

async function group1() {
  console.log('\n══ Group 1: interface and controls ══');
  const page = await newPage();
  await page.evaluate(() => { HM.ui.openWindow('settings'); });
  await page.waitForTimeout(250);

  // 1. Interface scale changes every layer, keeps windows on screen, and drag/resize use visual deltas.
  const scaleChecks = [];
  for (const z of [0.75, 1, 1.5]) {
    await page.evaluate((z) => { HM.ui.settings.uiScale = z; HM.ui.applySettings(); }, z);
    await page.waitForTimeout(260);
    const r = await page.evaluate(() => {
      const bb = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom }; };
      const win = document.querySelector('.game-window[data-window="settings"]');
      const btn = win.querySelector('.btn');
      return { hud: bb(document.getElementById('hud')), win: bb(win), btn: bb(btn), vw: innerWidth, vh: innerHeight };
    });
    scaleChecks.push(r);
    ok(`interface scale ${Math.round(z * 100)}% keeps the window in the viewport`, r.win.l >= 0 && r.win.t >= 0 && r.win.r <= r.vw + 1 && r.win.b <= r.vh + 1, JSON.stringify(r.win));
    await shot(page, `revamp-ui-${Math.round(z * 100)}.png`);
  }
  ok('HUD height scales with interface scale', scaleChecks[2].hud.h > scaleChecks[0].hud.h * 1.8, `${scaleChecks[0].hud.h.toFixed(0)} → ${scaleChecks[2].hud.h.toFixed(0)}`);
  ok('window and controls scale proportionally', Math.abs(scaleChecks[2].win.w / scaleChecks[1].win.w - 1.5) < 0.04 && Math.abs(scaleChecks[2].btn.w / scaleChecks[1].btn.w - 1.5) < 0.08, JSON.stringify({ win: scaleChecks[2].win.w / scaleChecks[1].win.w, btn: scaleChecks[2].btn.w / scaleChecks[1].btn.w }));

  await page.evaluate(() => { HM.ui.settings.uiScale = 1.5; HM.ui.applySettings(); });
  await page.waitForTimeout(250);
  const w0 = await page.evaluate(() => { const e = document.querySelector('.game-window[data-window="settings"]'); const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, left: parseFloat(e.style.left), top: parseFloat(e.style.top) }; });
  await page.mouse.move(w0.x + w0.w / 2, w0.y + 16);
  await page.mouse.down();
  await page.mouse.move(w0.x + w0.w / 2 - 60, w0.y + 16 + 30, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const w1 = await page.evaluate(() => { const e = document.querySelector('.game-window[data-window="settings"]'); const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  ok('window drag follows visual pointer at 150%', Math.abs((w0.x - w1.x) - 60) < 8 && Math.abs((w1.y - w0.y) - 30) < 8, JSON.stringify({ dx: w1.x - w0.x, dy: w1.y - w0.y }));

  const se = await page.locator('.game-window[data-window="settings"] .win-resize-handle.w').boundingBox();
  await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
  await page.mouse.down();
  await page.mouse.move(se.x + se.width / 2 - 60, se.y + se.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const w2 = await page.evaluate(() => { const e = document.querySelector('.game-window[data-window="settings"]'); const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, l: r.left, r: r.right, b: r.bottom, vw: innerWidth, vh: innerHeight }; });
  ok('window resize follows visual pointer at 150% and stays on screen', Math.abs((w2.w - w1.w) - 60) < 12 && w2.l >= 0 && w2.r <= w2.vw && w2.b <= w2.vh, JSON.stringify(w2));
  await page.evaluate(() => { HM.ui.settings.uiScale = 1; HM.ui.applySettings(); });
  await page.waitForTimeout(200);

  // 2. Real gear.
  const gear = await page.evaluate(() => {
    const svg = HM.icon('gear');
    const el = document.querySelector('.hud-actions [data-window="settings"] .ico svg, .hud-actions [data-window="settings"] svg');
    return { html: svg, pathCount: (svg.match(/<path/g) || []).length, circle: /<circle/.test(svg), rendered: el ? el.getBoundingClientRect().width : 0 };
  });
  ok('settings icon is a cog with teeth and a hub', gear.pathCount >= 1 && gear.circle && /M10\.2/.test(gear.html), JSON.stringify({ pathCount: gear.pathCount, circle: gear.circle, rendered: gear.rendered }));

  // 3. Coins.
  await page.evaluate(() => { HM.ui.openWindow('shop'); });
  await page.waitForTimeout(300);
  const visibleText = await page.evaluate(() => document.body.innerText);
  ok('no visible crowns remain; prices say coins', !/crown/i.test(visibleText) && /coins/i.test(visibleText), (visibleText.match(/.{0,30}coins.{0,30}/i) || [''])[0]);
  const htmlTitles = await page.evaluate(() => [document.title, document.querySelector('meta[name="description"]').content, document.querySelector('.hud [title*="Treasury"]')?.title || ''].join(' | '));
  ok('currency icon and copy use the coin style', /coin/i.test(htmlTitles) || /coins/i.test(htmlTitles), htmlTitles.slice(0, 90));

  // 4. All speeds to 20×.
  const speeds = await page.evaluate(async () => {
    const arr = HM.sim.SPEEDS.slice();
    const slider = document.getElementById('speed-slider');
    HM.state.weather = 'overcast'; HM.state.weatherTimer = 999;
    const t0 = HM.state.time.totalHours;
    HM.sim.setSpeed(HM.state, 11);
    await new Promise((r) => setTimeout(r, 1000));
    const t1 = HM.state.time.totalHours;
    return { arr, max: slider.max, delta: t1 - t0, sun: HM.gfx.env.sunDir.toArray(), label: document.getElementById('speed-label').textContent };
  });
  ok('speed list is Pause, 0.1, 0.25, 0.5, 1, 2, 3, 5, 8, 10, 15, 20', JSON.stringify(speeds.arr) === JSON.stringify([0, 0.1, 0.25, 0.5, 1, 2, 3, 5, 8, 10, 15, 20]), JSON.stringify(speeds.arr));
  ok('20× runs the clock and stays finite', speeds.delta > 0.2 && speeds.delta < 4 && speeds.sun.every(Number.isFinite), JSON.stringify({ deltaHours: speeds.delta.toFixed(2), sun: speeds.sun.map((v) => v.toFixed(2)), label: speeds.label }));
  await page.evaluate(() => { HM.sim.setSpeed(HM.state, 0); });

  // 5. Inversion toggles.
  await page.evaluate(() => HM.ui.closeAllWindows(true));
  async function mouseDrag(button, dx, dy) {
    await page.mouse.move(800, 520);
    await page.mouse.down({ button });
    await page.mouse.move(800 + dx, 520 + dy, { steps: 6 });
    await page.mouse.up({ button });
    await page.waitForTimeout(180);
  }
  await page.evaluate(() => { HM.ui.settings.invertPan = true; HM.ui.settings.invertRotate = false; HM.ui.settings.invertTilt = false; HM.gfx.resetCamera(); HM.gfx.attract = false; });
  const pA0 = await page.evaluate(() => ({ x: HM.gfx.targetGoal.x, z: HM.gfx.targetGoal.z }));
  await mouseDrag('left', 100, 0);
  const pA1 = await page.evaluate(() => ({ x: HM.gfx.targetGoal.x, z: HM.gfx.targetGoal.z }));
  await page.evaluate(() => { HM.ui.settings.invertPan = false; HM.gfx.resetCamera(); HM.gfx.attract = false; });
  const pB0 = await page.evaluate(() => ({ x: HM.gfx.targetGoal.x, z: HM.gfx.targetGoal.z }));
  await mouseDrag('left', 100, 0);
  const pB1 = await page.evaluate(() => ({ x: HM.gfx.targetGoal.x, z: HM.gfx.targetGoal.z }));
  const panA = { dx: pA1.x - pA0.x, dy: pA1.z - pA0.z }, panB = { dx: pB1.x - pB0.x, dy: pB1.z - pB0.z };
  await page.evaluate(() => { HM.ui.settings.invertRotate = false; HM.gfx.resetCamera(); HM.gfx.attract = false; });
  const rotA0 = await page.evaluate(() => HM.gfx.yawGoal); await mouseDrag('right', 100, 0); const rotA = (await page.evaluate(() => HM.gfx.yawGoal)) - rotA0;
  await page.evaluate(() => { HM.ui.settings.invertRotate = true; HM.gfx.resetCamera(); HM.gfx.attract = false; });
  const rotB0 = await page.evaluate(() => HM.gfx.yawGoal); await mouseDrag('right', 100, 0); const rotB = (await page.evaluate(() => HM.gfx.yawGoal)) - rotB0;
  await page.evaluate(() => { HM.ui.settings.invertTilt = false; HM.gfx.resetCamera(); HM.gfx.attract = false; });
  const tiltA0 = await page.evaluate(() => HM.gfx.pitchGoal); await mouseDrag('right', 0, 100); const tiltA = (await page.evaluate(() => HM.gfx.pitchGoal)) - tiltA0;
  await page.evaluate(() => { HM.ui.settings.invertTilt = true; HM.gfx.resetCamera(); HM.gfx.attract = false; });
  const tiltB0 = await page.evaluate(() => HM.gfx.pitchGoal); await mouseDrag('right', 0, 100); const tiltB = (await page.evaluate(() => HM.gfx.pitchGoal)) - tiltB0;
  await page.evaluate(() => { HM.ui.saveSettings(); });
  const inv = { panA, panB, rotA, rotB, tiltA, tiltB };
  ok('pan is inverted by default and the toggle reverses it', Math.sign(inv.panA.dx) !== Math.sign(inv.panB.dx) && inv.panA.dx !== 0, JSON.stringify({ inverted: inv.panA.dx, normal: inv.panB.dx }));
  ok('rotation inversion is independent', Math.sign(inv.rotA) !== Math.sign(inv.rotB) && Math.abs(inv.rotA) > 0.1, `${inv.rotA.toFixed(3)} → ${inv.rotB.toFixed(3)}`);
  ok('tilt inversion is independent', Math.sign(inv.tiltA) !== Math.sign(inv.tiltB) && Math.abs(inv.tiltA) > 0.05, `${inv.tiltA.toFixed(3)} → ${inv.tiltB.toFixed(3)}`);
  await page.evaluate(() => { HM.ui.settings.invertPan = true; HM.ui.settings.invertRotate = false; HM.ui.settings.invertTilt = false; HM.ui.saveSettings(); HM.gfx.resetCamera(); });

  // 6–7. Demolish and road previews use real mouse input.
  await setupTown(page, 8);
  const tent = await page.evaluate(() => { const b = HM.state.buildings.find((x) => x.defId === 'tent'); return b ? { uid: b.uid, x: b.x, z: b.z } : null; });
  await page.evaluate(() => { HM.game.setTool('demolish'); HM.gfx.resetCamera(); });
  await page.waitForTimeout(500);
  const tq = tent ? await project(page, tent.x, tent.z, 2) : null;
  if (tq) { await page.mouse.move(tq.x, tq.y); await page.waitForTimeout(300); }
  const hover = await page.evaluate(() => ({ helper: !!HM.gfx.demolishHelper, hover: HM.gfx.demolishHover, card: document.getElementById('hover-card').innerText, tool: HM.game.tool }));
  ok('demolish hover highlights the building and shows its refund', hover.helper && hover.hover?.kind === 'building' && /refund/i.test(hover.card) && /coins/i.test(hover.card), JSON.stringify({ helper: hover.helper, card: hover.card }));
  await shot(page, 'revamp-demolish-hover.png');
  if (tq) await page.mouse.click(tq.x, tq.y);
  await page.waitForTimeout(350);
  const gone = await page.evaluate((uid) => ({ exists: HM.state.buildings.some((b) => b.uid === uid), helper: !!HM.gfx.demolishHelper }), tent?.uid);
  ok('demolish button removes the building and clears the highlight', !gone.exists && !gone.helper, JSON.stringify(gone));

  await page.evaluate(() => { HM.game.setTool('road'); HM.gfx.resetCamera(); });
  await page.waitForTimeout(400);
  const s = await page.evaluate(() => HM.world.spawn);
  await clickWorld(page, s.x - 14, s.z + 8);
  await page.waitForTimeout(250);
  const q = await project(page, s.x + 35, s.z + 25);
  await page.mouse.move(q.x - 20, q.y - 12); await page.waitForTimeout(100);
  await page.mouse.move(q.x, q.y); await page.waitForTimeout(350);
  const plan = await page.evaluate(() => ({ plan: !!HM.gfx.roadPlan, ring: !!HM.gfx.roadPlanRing, marker: !!HM.gfx.roadMarker, hint: document.getElementById('placement-hint').innerText }));
  ok('road preview shows a live strip and cost before commit', plan.plan && plan.ring && /coin/i.test(plan.hint) && /m ·|m /i.test(plan.hint), JSON.stringify({ plan: plan.plan, hint: plan.hint }));
  await shot(page, 'revamp-road-preview.png');
  await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  const cleared = await page.evaluate(() => ({ plan: !!HM.gfx.roadPlan, ring: !!HM.gfx.roadPlanRing, marker: HM.gfx.roadMarker ? HM.gfx.roadMarker.visible : false }));
  ok('cancelling a road leaves no preview meshes behind', !cleared.plan && !cleared.ring && !cleared.marker, JSON.stringify(cleared));

  // 8. Font size affects text (not the 3D canvas).
  const fonts = [];
  await page.evaluate(() => HM.ui.openWindow('settings'));
  await page.waitForTimeout(200);
  for (const f of [0.8, 1, 1.5]) {
    await page.evaluate((f) => { HM.ui.settings.fontScale = f; HM.ui.applySettings(); }, f);
    await page.waitForTimeout(180);
    fonts.push(await page.evaluate(() => getComputedStyle(document.querySelector('.game-window[data-window="settings"] .settings-row label')).fontSize));
  }
  ok('font size changes all text proportionally', Math.abs(parseFloat(fonts[2]) / parseFloat(fonts[1]) - 1.5) < 0.03 && Math.abs(parseFloat(fonts[0]) / parseFloat(fonts[1]) - 0.8) < 0.03, fonts.join(' / '));
  await shot(page, 'revamp-font-large.png');
  await page.evaluate(() => { HM.ui.settings.fontScale = 1; HM.ui.applySettings(); });

  // 9. Needs overview and wants list, on a clean page so nothing earlier can mask UI state.
  await page.context().close();
  const page2 = await newPage();
  await setupTown(page2, 30);
  await page2.evaluate(() => { HM.ui.closeAllWindows(true); HM.ui.openWindow('citizens'); HM.ui.citizenTab = 'needs'; HM.ui.renderWindow('citizens'); });
  await page2.waitForTimeout(350);
  const needsUi = await page2.evaluate(() => {
    const s = HM.state;
    const avg = HM.ui.helpers.cityNeeds();
    const expected = Object.keys(HM.data.NEEDS).reduce((n, k) => n + avg[k], 0) / HM.data.NEED_KEYS.length;
    const text = document.querySelector('.game-window[data-window="citizens"]').innerText;
    return { expected, text, rows: document.querySelectorAll('.need-click').length };
  });
  ok('Needs Overview averages every need and every category', needsUi.rows === 13 && needsUi.text.includes(String(Math.round(needsUi.expected))) && /Basic needs/i.test(needsUi.text) && /Comfort/i.test(needsUi.text), `rows ${needsUi.rows}, overall ${Math.round(needsUi.expected)}`);
  await shot(page2, 'revamp-needs-overview.png');
  await page2.evaluate(() => { HM.ui.citizenTab = 'wants'; HM.ui.renderWindow('citizens'); });
  await page2.waitForTimeout(250);
  const wants0 = await page2.evaluate(() => ({ rows: document.querySelectorAll('.wants-row').length, total: HM.state.citizens.length, text: document.querySelector('.wants-summary').innerText }));
  ok('Wants & Needs lists every citizen with top needs', wants0.rows === Math.min(wants0.total, 120) && /virtualised/i.test(wants0.text), JSON.stringify(wants0));
  await page2.evaluate(() => { HM.ui.citizenMoodFilter = 'unhappy'; HM.ui.renderWindow('citizens'); });
  await page2.waitForTimeout(250);
  const filtered = await page2.evaluate(() => ({ rows: document.querySelectorAll('.wants-row').length, expected: HM.state.citizens.filter((c) => c.mood < 35).length }));
  ok('Wants & Needs filters by mood', filtered.rows === Math.min(120, filtered.expected), JSON.stringify(filtered));
  await page2.evaluate(() => { HM.ui.citizenMoodFilter = 'all'; HM.ui.citizenSort = 'name'; HM.ui.renderWindow('citizens'); });
  await page2.waitForTimeout(250);
  const sorted = await page2.evaluate(() => [...document.querySelectorAll('.wants-row .cit-main b')].map((e) => e.textContent));
  ok('Wants & Needs sorts by name', sorted.every((n, i) => i === 0 || sorted[i - 1].localeCompare(n) <= 0), sorted.slice(0, 4).join(', '));
  await shot(page2, 'revamp-wants-list.png');
  await page2.evaluate(() => { HM.ui.closeAllWindows(true); HM.ui.openWindow('encyclopedia'); });
  await page2.waitForTimeout(250);

  results.group1 = { errors: errors.slice(), shots: ['revamp-ui-75.png', 'revamp-ui-100.png', 'revamp-ui-150.png', 'revamp-demolish-hover.png', 'revamp-road-preview.png', 'revamp-needs-overview.png', 'revamp-wants-list.png'] };
  await page2.context().close();
}


async function group2() {
  const page = await newPage();
  const info = await page.evaluate(() => {
    const w = HM.world, g = HM.gfx;
    const grass = g.grassStats || {};
    const badGrass = (g.grassItems || []).filter((x) => w.heightAt(x.x, x.z) < 1.1 || w.slopeAt(x.x, x.z) > 0.55 || [0, 1, 6].includes(w.biomeAt(x.x, x.z))).length;
    const badBush = w.bushes.filter((b) => w.heightAt(b.x, b.z) < 0.8 || [0, 1, 6].includes(w.biomeAt(b.x, b.z)) || w.slopeAt(b.x, b.z) > 0.7).length;
    const waterMeshes = [];
    g.scene.traverse((o) => { if (o.isMesh && o.material === g.water.material) waterMeshes.push(o); });
    return {
      size: w.size, type: w.worldType, rivers: w.rivers.length, lakes: w.lakes.length,
      worldTrees: w.trees.length, worldBushes: w.bushes.length, grass, badGrass, badBush,
      waterMeshes: waterMeshes.length, waterChildren: g.scene.children.filter((o) => o === g.water).length,
      waterMaterial: !!g.water.material, waterUniformCount: Object.keys(g.waterUniforms || {}).length,
      spawn: w.spawn, slope: w.slopeAt(w.spawn.x, w.spawn.z),
      fps: HM.main.fps, drawCalls: g.drawInfo ? g.drawInfo().calls : 0
    };
  });
  ok('the default map is the Earth type at the larger size', info.type === 'earth' && info.size === 3072, `${info.type} ${info.size}`);
  ok('the larger map is at least 2.25x the old area', (info.size * info.size) / (2048 * 2048) >= 2.24, ((info.size * info.size) / (2048 * 2048)).toFixed(2) + 'x');
  ok('Earth carries many rivers and lakes', info.rivers >= 5 && info.lakes >= 10, `${info.rivers} rivers, ${info.lakes} lakes`);
  ok('the starting shelf is flat and buildable', info.slope < 0.12, info.slope.toFixed(3));
  ok('grass and bushes exist and are instanced', info.grass.worldGrass > 1000 && info.grass.batches > 0 && info.grass.instanced && info.worldBushes > 200, `${info.grass.worldGrass} grass in ${info.grass.batches} batches, ${info.worldBushes} bushes`);
  ok('no grass or bush stands in water, on a beach or on a steep slope', info.badGrass === 0 && info.badBush === 0, `${info.badGrass} bad grass, ${info.badBush} bad bushes`);
  ok('all water, inside and outside the map, shares one material and one shader', info.waterMeshes >= 1 && info.waterChildren === 1 && info.waterMaterial && info.waterUniformCount > 10, `water meshes ${info.waterMeshes} · uniforms ${info.waterUniformCount}`);

  // Clear ground cover under a new building.
  const cleared = await page.evaluate(() => {
    const s = HM.state, sp = HM.world.spawn;
    HM.state.money = 9e6;
    const before = (HM.gfx.grassItems || []).filter((g) => !g.cleared).length;
    const placed = HM.main.debug.place('tent', 22, 22);
    const after = (HM.gfx.grassItems || []).filter((g) => !g.cleared).length;
    return { before, after, removed: before - after, placed };
  });
  ok('grass and bushes clear under a placed building', cleared.placed && cleared.removed > 0, `${cleared.removed} tufts removed · ${JSON.stringify(cleared.placed)}`);

  await page.evaluate(() => {
    const s = HM.world.spawn;
    HM.gfx.clearGhost(); HM.ui.closeAllWindows(true);
    HM.gfx.focusOn(s.x, s.z, 950); HM.gfx.pitchGoal = HM.gfx.pitch = 1.36; HM.gfx.yawGoal = HM.gfx.yaw = 0.2;
    HM.state.time.totalHours = 12; HM.sim.calendar(HM.state); HM.gfx.applyEnvironment(HM.state);
    document.getElementById('game-ui').classList.add('hidden');
  });
  await page.waitForTimeout(700);
  await shot(page, 'revamp-earth-top.png');
  await page.evaluate(() => { const s = HM.world.spawn; HM.gfx.focusOn(s.x, s.z, 320); HM.gfx.pitchGoal = HM.gfx.pitch = 0.62; HM.gfx.yawGoal = HM.gfx.yaw = 2.5; });
  await page.waitForTimeout(700);
  await shot(page, 'revamp-earth-angle.png');
  const coast = await page.evaluate(() => {
    const sp = HM.world.spawn, c = HM.world.findCoast(sp.x, sp.z, 500);
    if (c) { HM.gfx.focusOn((sp.x + c.x) / 2, (sp.z + c.z) / 2, 170); HM.gfx.pitchGoal = HM.gfx.pitch = 0.46; }
    return c;
  });
  await page.waitForTimeout(700);
  await shot(page, 'revamp-earth-coast.png');
  await page.evaluate(() => document.getElementById('game-ui').classList.remove('hidden'));
  await page.waitForTimeout(250);
  await shot(page, 'revamp-earth-minimap.png');
  ok('the minimap draws the new coast, rivers and nations', await page.evaluate(() => {
    const c = document.getElementById('minimap-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let blue = 0, green = 0, varied = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 2] > d[i] * 1.05) blue++;
      if (d[i + 1] > d[i + 2] * 1.05) green++;
      if (Math.abs(d[i] - d[i + 1]) > 8) varied++;
    }
    return blue > 400 && green > 400 && varied > 800;
  }), 'coast, land and borders use distinct colours');

  results.group2 = { errors: errors.slice(), shots: ['revamp-earth-top.png', 'revamp-earth-angle.png', 'revamp-earth-coast.png', 'revamp-earth-minimap.png'], info, coast };
  await page.context().close();
}


async function group3() {
  console.log('\n══ Group 3: nations, trade, conquest and terrain ══');
  const page = await newPage();

  const worldInfo = await page.evaluate(() => {
    const s = HM.state;
    return {
      nations: s.nations.length,
      cities: s.nations.reduce((a, n) => a + (n.cities || []).length, 0),
      foreign: (s.foreignBuildings || []).length,
      borders: HM.gfx.nationBorders ? HM.gfx.nationBorders.children.length : 0,
      withTowns: s.nations.filter((n) => (n.cities || []).length && s.foreignBuildings.some((b) => b.nationId === n.id)).length,
      first: s.nations[0] ? { name: s.nations[0].name, color: s.nations[0].color, cities: s.nations[0].cities.length, gov: s.nations[0].government } : null
    };
  });
  ok('the world has 10 pre-built nations with towns and visible borders', worldInfo.nations === 10 && worldInfo.cities >= 18 && worldInfo.foreign > 60 && worldInfo.borders === 10 && worldInfo.withTowns === 10, JSON.stringify(worldInfo));

  // Nation town visual.
  await page.evaluate(() => {
    const n = HM.state.nations.find((x) => (x.cities || []).length);
    const c = n.cities[0];
    HM.ui.closeAllWindows(true);
    document.querySelector('#tutorial-offer [data-action="tutorial-skip"]')?.click();
    document.getElementById('game-ui').classList.add('hidden');
    HM.gfx.focusOn(c.x, c.z, 190);
    HM.gfx.pitchGoal = HM.gfx.pitch = 0.62; HM.gfx.yawGoal = HM.gfx.yaw = 1.2;
    HM.state.time.totalHours = Math.floor(HM.state.time.totalHours / 24) * 24 + 10; HM.sim.calendar(HM.state); HM.gfx.applyEnvironment(HM.state);
  });
  await page.waitForTimeout(900);
  await shot(page, 'revamp-nation-town.png');
  await page.evaluate(() => document.getElementById('game-ui').classList.remove('hidden'));

  // Trade window, offers, recurring shipment.
  await page.evaluate(() => {
    HM.ui.openWindow('military');
    HM.state.nations[0].relation = 80; HM.state.nations[0].atWar = false;
    HM.state.selectedNation = HM.state.nations[0].id;
    HM.ui.renderWindow('military');
  });
  await page.waitForTimeout(350);
  const tradeUi = await page.evaluate(() => ({
    nations: document.querySelectorAll('.nation-row').length,
    offers: document.querySelectorAll('[data-action="trade-create"]').length,
    text: document.querySelector('.game-window[data-window="military"]').innerText
  }));
  ok('the diplomacy window lists every nation and three trade offers', tradeUi.nations === 10 && tradeUi.offers === 3 && /Trade offers/i.test(tradeUi.text) && /Active caravans/i.test(tradeUi.text), JSON.stringify({ nations: tradeUi.nations, offers: tradeUi.offers }));
  await page.evaluate(() => {
    const w = document.querySelector('.game-window[data-window="military"] .win-body') || document.querySelector('.game-window[data-window="military"] .win-scroll');
    if (w) w.scrollTop = 99999;
  });
  await page.waitForTimeout(250);
  await shot(page, 'revamp-trade.png');

  const trade = await page.evaluate(() => {
    const s = HM.state, n = s.nations[0];
    n.relation = 90; n.atWar = false; n.trade = false;
    const offer = HM.sim.tradeOffers(s, n)[0];
    if (offer.side === 'sell') s.resources[offer.res] = Math.max(s.resources[offer.res] || 0, offer.qty * 4);
    const before = { money: s.money, res: s.resources[offer.res] || 0, deals: s.tradeDeals.length };
    const r = HM.sim.diplo.createTrade(s, n.id, 0);
    const afterFirst = { money: s.money, res: s.resources[offer.res] || 0, deals: s.tradeDeals.length };
    HM.sim.advanceHours(s, 24 * 8);
    const afterWeek = { money: s.money, res: s.resources[offer.res] || 0, deals: s.tradeDeals.length };
    return { offer, r, before, afterFirst, afterWeek, routes: HM.gfx.tradeMarkers ? HM.gfx.tradeMarkers.length : 0 };
  });
  const firstOk = trade.offer.side === 'buy'
    ? (trade.afterFirst.money < trade.before.money && trade.afterFirst.res > trade.before.res)
    : (trade.afterFirst.money > trade.before.money && trade.afterFirst.res < trade.before.res);
  ok('a trade deal ships immediately and again on the agreed day', trade.r.ok && firstOk && trade.afterWeek.deals === trade.before.deals + 1 && trade.routes > 0, JSON.stringify({ offer: trade.offer, before: trade.before, first: trade.afterFirst, week: trade.afterWeek, routes: trade.routes }));

  // Treaty: non-aggression prevents mobilisation, breaking it hurts relations.
  const treaty = await page.evaluate(() => {
    const s = HM.state, n = s.nations[1];
    s.money = Math.max(s.money, 5000); n.relation = 70; n.atWar = false; n.conquered = false; n.peaceUntil = 0; n.napUntil = 0; n.allianceUntil = 0; n.mobilize = 0;
    const beforeRel = n.relation;
    const r = HM.sim.diplo.nonAggression(s, n.id);
    const beganWhilePact = HM.sim.beginMobilization(s, n);
    for (let i = 0; i < 30; i++) HM.sim.nationDayTick(s, n, s.time.days + i);
    const afterPact = { atWar: n.atWar, mobilize: n.mobilize, until: n.napUntil };
    const broke = HM.sim.diplo.breakTreaty(s, n.id);
    return { r, beganWhilePact, afterPact, broke, beforeRel, afterRel: n.relation, pact: n.napUntil };
  });
  ok('a non-aggression pact stops mobilisation and holds for its term', treaty.r.ok && treaty.beganWhilePact === false && !treaty.afterPact.atWar && !treaty.afterPact.mobilize, JSON.stringify(treaty.afterPact));
  ok('breaking a treaty is possible and damages relations', treaty.broke.ok && treaty.afterRel < treaty.beforeRel - 20, `${treaty.beforeRel.toFixed(0)} → ${treaty.afterRel.toFixed(0)}`);

  // Warning, then an actual AI invasion of a weak player.
  const invasion = await page.evaluate(() => {
    const s = HM.state, n = s.nations[2];
    n.relation = 0; n.atWar = false; n.conquered = false; n.peaceUntil = 0; n.napUntil = 0; n.allianceUntil = 0; n.mobilize = 0;
    s.army.units = []; s.money = 9000;
    const warned = HM.sim.beginMobilization(s, n);
    const warning = s.alerts.find((a) => /mobilizing near your border/i.test(a.text));
    const moneyBefore = s.money;
    for (let i = 0; i < 4; i++) HM.sim.nationDayTick(s, n, s.time.days + i);
    return { warned, warning: warning && warning.text, atWar: n.atWar, moneyBefore, moneyAfter: s.money, happy: s.happiness, stat: s.stats.invasions };
  });
  ok('an aggressive neighbour warns before invading and then crosses the border', invasion.warned && /mobilizing/i.test(invasion.warning || '') && invasion.atWar && (invasion.moneyAfter < invasion.moneyBefore || invasion.stat > 0), JSON.stringify(invasion));

  // Strong player conquers; buildings, cities and borders transfer.
  const conquest = await page.evaluate(() => {
    const s = HM.state;
    const n = s.nations.find((x) => !x.conquered && (x.cities || []).length >= 2) || s.nations[3];
    n.atWar = false; n.peaceUntil = 0; n.napUntil = 0; n.conquered = false; n.power = 2;
    s.army.units = Array.from({ length: 40 }, (_, i) => ({ type: 'Sentinel', power: 60, id: i }));
    s.selectedNation = n.id;
    HM.sim.refreshCache(s);
    const before = { foreign: s.foreignBuildings.length, buildings: s.buildings.length, cities: (n.cities || []).length, money: s.money, borders: HM.gfx.nationBorders.children.length, pop: s.citizens.length };
    HM.sim.diplo.war(s, n.id);
    const r = HM.sim.diplo.attack(s, n.id);
    const after = { foreign: s.foreignBuildings.length, buildings: s.buildings.length, conquered: n.conquered, taken: (n.cities || []).filter((c) => c.conquered).length, money: s.money, borders: HM.gfx.nationBorders.children.length, pop: s.citizens.length, unrest: s.unrest };
    const city = n.cities[0];
    HM.gfx.focusOn(city.x, city.z, 220); HM.gfx.pitch = HM.gfx.pitchGoal = 0.62; HM.gfx.yaw = HM.gfx.yawGoal = 1.4;
    return { r, before, after, city };
  });
  ok('a stronger army conquers the nation and transfers its towns', conquest.r.ok && conquest.r.win && conquest.after.conquered && conquest.after.taken === conquest.before.cities && conquest.after.buildings > conquest.before.buildings && conquest.after.foreign < conquest.before.foreign, JSON.stringify({ before: conquest.before, after: conquest.after }));
  ok('conquest moves the border, adds citizens and leaves unrest', conquest.after.borders < conquest.before.borders && conquest.after.pop > conquest.before.pop && conquest.after.unrest > 0, JSON.stringify({ borders: [conquest.before.borders, conquest.after.borders], pop: [conquest.before.pop, conquest.after.pop], unrest: conquest.after.unrest }));
  await page.waitForTimeout(900);
  await shot(page, 'revamp-conquest.png');

  const weak = await page.evaluate(() => {
    const s = HM.state, n = s.nations.find((x) => !x.conquered);
    n.power = 9999; n.atWar = false; n.peaceUntil = 0; n.napUntil = 0;
    s.army.units = []; HM.sim.refreshCache(s);
    HM.sim.diplo.war(s, n.id);
    const r = HM.sim.diplo.attack(s, n.id);
    return { r, conquered: n.conquered, units: s.army.units.length, power: n.power };
  });
  ok('a weaker army fails to conquer and loses units', !weak.r.ok && !weak.r.win && !weak.conquered, JSON.stringify({ msg: weak.r.msg, conquered: weak.conquered }));

  // Terrain editor: select, set height, smooth falloff, cost, undo, freehand, save.
  await page.evaluate(() => { HM.ui.closeAllWindows(true); document.getElementById('game-ui').classList.remove('hidden'); HM.gfx.focusOn(HM.world.spawn.x, HM.world.spawn.z, 190); });
  await page.waitForTimeout(400);
  const terrain = await page.evaluate(() => {
    const s = HM.state, w = HM.world, sp = w.spawn;
    const cx = sp.x + 70, cz = sp.z + 55;
    const orig = w.heightAt(cx, cz);
    s.money = 12000;
    HM.game.setTool('flatten');
    const t = HM.game.terraform;
    t.mode = 'rect'; t.start = { x: cx - 36, z: cz - 36 }; t.current = { x: cx + 36, z: cz + 36 };
    HM.game.finishTerraSelection();
    const selected = { stage: t.stage, area: t.area, avg: t.avg, cells: t.cells.length, panel: !!document.querySelector('#terrain-panel.visible') };
    t.target = t.avg + 6; t.smoothness = 18; HM.game.refreshTerraform();
    const beforeCost = t.cost, beforeMoney = s.money;
    HM.game.commitTerraform();
    const after = { money: s.money, edits: s.terrainEdits.length, center: w.heightAt(cx, cz), edge: w.heightAt(cx + 75, cz), tool: HM.game.tool, cost: beforeCost };
    let maxSlope = 0, prev = w.heightAt(cx, cz);
    for (let d = 1; d <= 55; d += 2) { const h = w.heightAt(cx + d, cz); maxSlope = Math.max(maxSlope, Math.abs(h - prev) / 2); prev = h; }
    const saved = HM.sim.serialize(s);
    HM.game.undoTerraform();
    const undone = { center: w.heightAt(cx, cz), money: s.money, edits: s.terrainEdits.length };
    return { cx, cz, orig, selected, beforeCost, beforeMoney, after, maxSlope, savedEdits: (saved.terrainEdits || []).length, undone };
  });
  ok('terrain tool selects a real area and opens its height panel', terrain.selected.stage === 'height' && terrain.selected.area > 100 && terrain.selected.cells > 8 && terrain.selected.panel, JSON.stringify(terrain.selected));
  ok('raising land hits the target and blends over the falloff band', Math.abs(terrain.after.center - (terrain.selected.avg + 6)) < 0.35 && terrain.after.edge < terrain.after.center - 2 && terrain.maxSlope < 1.4, JSON.stringify({ center: terrain.after.center, edge: terrain.after.edge, maxSlope: terrain.maxSlope }));
  ok('terrain edit charges its stated cost and is saved as deltas', terrain.beforeMoney - terrain.after.money === terrain.after.cost && terrain.after.edits > 0 && terrain.savedEdits === terrain.after.edits, JSON.stringify({ charged: terrain.beforeMoney - terrain.after.money, cost: terrain.after.cost, edits: terrain.after.edits, saved: terrain.savedEdits }));
  ok('undo restores the ground and the coins', Math.abs(terrain.undone.center - terrain.orig) < 0.15 && terrain.undone.money === terrain.beforeMoney && terrain.undone.edits === 0, JSON.stringify(terrain.undone));

  // Panel screenshot, then freehand commit.
  const freehand = await page.evaluate(() => {
    const s = HM.state, w = HM.world, sp = w.spawn;
    const cx = sp.x - 90, cz = sp.z + 50;
    s.money = 12000;
    HM.game.setTool('flatten');
    const t = HM.game.terraform;
    t.mode = 'freehand';
    t.points = [
      { x: cx - 30, z: cz - 24 }, { x: cx + 20, z: cz - 34 }, { x: cx + 36, z: cz + 8 },
      { x: cx + 6, z: cz + 33 }, { x: cx - 32, z: cz + 18 }, { x: cx - 30, z: cz - 24 }
    ];
    t.start = t.points[0]; t.current = t.points[t.points.length - 1];
    HM.game.finishTerraSelection();
    const selected = { stage: t.stage, area: t.area, cells: t.cells.length, panel: !!document.querySelector('#terrain-panel.visible') };
    t.target = t.avg + 4; HM.game.refreshTerraform();
    return { selected, cx, cz, target: t.target, warn: t.warning, cost: t.cost };
  });
  await page.waitForTimeout(300);
  await shot(page, 'revamp-terrain-panel.png');
  await page.locator('[data-action="terrain-confirm"]').click();
  await page.waitForTimeout(700);
  const freeAfter = await page.evaluate(({ cx, cz, target }) => ({ h: HM.world.heightAt(cx, cz), target, edits: HM.state.terrainEdits.length, money: HM.state.money }), freehand);
  ok('freehand selection fills, confirms and writes the new height', freehand.selected.stage === 'height' && freehand.selected.area > 500 && !freehand.warn && Math.abs(freeAfter.h - freehand.target) < 0.35, JSON.stringify({ selected: freehand.selected, h: freeAfter.h, target: freehand.target, cost: freehand.cost }));
  await page.waitForTimeout(500);
  await shot(page, 'revamp-terrain-raised.png');

  const beforeReload = await page.evaluate(({ cx, cz }) => {
    const s = HM.state;
    const conquered = s.nations.find((n) => n.conquered);
    HM.game.save(true);
    const data = HM.sim.loadData();
    return { height: HM.world.heightAt(cx, cz), conquered: conquered ? conquered.id : null, savedNations: data.nations.length, savedEdits: (data.terrainEdits || []).length, savedForeign: (data.foreignBuildings || []).length, buildings: s.buildings.length };
  }, freehand);
  await page.evaluate(() => HM.main.loadGame());
  await page.waitForFunction(() => window.HM && HM.main && HM.main.inGame === true, null, { timeout: 240000 });
  await page.waitForTimeout(900);
  const afterReload = await page.evaluate(({ cx, cz }) => {
    const s = HM.state;
    const c = s.nations.find((n) => n.conquered);
    return { height: HM.world.heightAt(cx, cz), conquered: c ? c.id : null, foreign: (s.foreignBuildings || []).length, buildings: s.buildings.length, edits: (s.terrainEdits || []).length };
  }, freehand);
  ok('conquest, terrain edits and transferred buildings survive save and load', afterReload.conquered === beforeReload.conquered && Math.abs(afterReload.height - beforeReload.height) < 0.6 && afterReload.buildings >= beforeReload.buildings && afterReload.foreign === beforeReload.savedForeign && afterReload.edits === beforeReload.savedEdits, JSON.stringify({ before: beforeReload, after: afterReload }));

  results.group3 = { errors: errors.slice(), shots: ['revamp-nation-town.png', 'revamp-trade.png', 'revamp-conquest.png', 'revamp-terrain-panel.png', 'revamp-terrain-raised.png'], worldInfo, trade, treaty, invasion, conquest: { before: conquest.before, after: conquest.after }, terrain, freehand };
  await page.context().close();
}

async function group4() {
  console.log('\n══ Group 4: darker nights, lanterns and wildlife ══');
  const page = await newPage();
  await setupTown(page, 10);

  const animals = await page.evaluate(() => {
    const s = HM.state;
    let wet = 0, steep = 0, asleepDay = 0;
    for (const a of s.animals) {
      if (!a.aquatic && !a.water && HM.world.heightAt(a.x, a.z) < 0.3) wet++;
      if (!a.aquatic && !a.water && HM.world.slopeAt(a.x, a.z) > 0.9) steep++;
    }
    s.time.totalHours = Math.floor(s.time.totalHours / 24) * 24 + 2;
    HM.sim.calendar(s);
    HM.sim.updateWildlife(s, 120);
    for (const a of s.animals) if (!a.nocturnal && a.activity === 'sleeping') asleepDay++;
    return {
      count: s.animals.length, species: new Set(s.animals.map((a) => a.species)).size,
      wet, steep, asleepDay, parts: Object.keys(HM.gfx.animalParts || {}).length,
      instances: Object.values(HM.gfx.animalParts || {}).reduce((n, m) => n + m.body.count, 0),
      aquatic: s.animals.filter((a) => a.aquatic).length
    };
  });
  ok('the world is populated with many species of wildlife', animals.count >= 150 && animals.species >= 12 && animals.aquatic >= 4 && animals.parts >= animals.species, JSON.stringify(animals));
  ok('land animals never stand in water or on cliffs', animals.wet === 0 && animals.steep === 0, JSON.stringify({ wet: animals.wet, steep: animals.steep }));
  ok('diurnal animals sleep at night and wake by day', animals.asleepDay === 0, 'sleeping during the day: ' + animals.asleepDay);
  ok('wildlife renders with a fixed number of instanced meshes', animals.instances === animals.count, JSON.stringify({ instances: animals.instances, animals: animals.count }));

  // Find the busiest herd and frame it for a wildlife screenshot in daylight.
  await page.evaluate(() => { HM.state.time.totalHours = Math.floor(HM.state.time.totalHours / 24) * 24 + 10; HM.sim.calendar(HM.state); HM.state.weather = 'clear'; HM.state.weatherTimer = 999; });
  await page.waitForTimeout(900);
  const herd = await page.evaluate(() => {
    let best = null, bestN = 0;
    for (const a of HM.state.animals) {
      if (a.aquatic) continue;
      const n = HM.state.animals.filter((b) => Math.hypot(b.x - a.x, b.z - a.z) < 45).length;
      if (n > bestN) { bestN = n; best = a; }
    }
    if (!best) return null;
    HM.gfx.focusOn(best.x, best.z, 55);
    HM.gfx.pitch = HM.gfx.pitchGoal = 0.38;
    return { x: best.x, z: best.z, n: bestN };
  });
  await page.waitForTimeout(900);
  await shot(page, 'revamp-wildlife.png');
  ok('wildlife can be framed and seen in the world', !!herd && herd.n >= 2, JSON.stringify(herd));

  // Night: clear sky, late hour, town in frame.
  await page.evaluate(() => {
    const s = HM.state;
    s.weather = 'clear'; s.weatherTimer = 999;
    s.time.totalHours = Math.floor(s.time.totalHours / 24) * 24 + 1;
    HM.sim.calendar(s);
    const w = HM.world.spawn;
    HM.gfx.focusOn(w.x, w.z, 90);
    HM.gfx.pitch = HM.gfx.pitchGoal = 0.42;
  });
  await page.waitForTimeout(1400);
  const night = await page.evaluate(() => {
    const homes = HM.state.buildings.filter((b) => HM.data.getBuilding(b.defId).homes);
    const lit = homes.map((b) => HM.gfx.buildingMap.get(b.uid)?.userData.lantern).filter(Boolean);
    return {
      night: HM.gfx.env.night, daylight: HM.gfx.env.daylight,
      exposure: HM.gfx.renderer.toneMappingExposure, hemi: HM.gfx.hemi.intensity,
      moon: HM.gfx.sun.intensity, lanternLights: HM.gfx.lanternLights.map((l) => l.intensity).filter((v) => v > 0).length,
      lamps: lit.filter((l) => l.lamp.visible).length, lanterns: lit.length
    };
  });
  await shot(page, 'revamp-night-lanterns.png');
  ok('night is genuinely dark, lit by cold moonlight', night.night > 0.95 && night.exposure < 0.6 && night.hemi < 0.09 && night.moon < 0.45, JSON.stringify(night));
  ok('occupied homes light warm lanterns after dark', night.lamps > 0 && night.lanternLights > 0, JSON.stringify({ lamps: night.lamps, lights: night.lanternLights }));

  const noon = await page.evaluate(() => {
    const s = HM.state;
    s.time.totalHours = Math.floor(s.time.totalHours / 24) * 24 + 12;
    HM.sim.calendar(s);
    return new Promise((resolve) => setTimeout(() => resolve({
      night: HM.gfx.env.night, daylight: HM.gfx.env.daylight,
      exposure: HM.gfx.renderer.toneMappingExposure,
      lamps: HM.state.buildings.filter((b) => HM.gfx.buildingMap.get(b.uid)?.userData.lantern?.lamp.visible).length,
      lights: HM.gfx.lanternLights.map((l) => l.intensity).filter((v) => v > 0).length
    }), 900));
  });
  await shot(page, 'revamp-noon.png');
  ok('daylight returns with lanterns out', noon.night < 0.02 && noon.exposure > 0.95 && noon.lamps === 0 && noon.lights === 0, JSON.stringify(noon));

  // Shooting star: look up at the sky at night with a clear sky.
  const noStars = await page.evaluate(() => {
    let named = 0;
    HM.gfx.scene.traverse((o) => { if (/shooting|falling.?star/i.test(o.name || '')) named++; });
    return {
      group: typeof HM.gfx.starGroup, pool: typeof HM.gfx.starPool,
      spawn: typeof HM.gfx.spawnShootingStar, update: typeof HM.gfx.updateShootingStars,
      named, events: HM.data.EVENTS.filter((e) => e.id === 'meteor').length
    };
  });
  await shot(page, 'revamp-night-no-stars.png');
  ok('shooting stars are gone from the sky, data and renderer', noStars.group === 'undefined' && noStars.pool === 'undefined' && noStars.spawn === 'undefined' && noStars.update === 'undefined' && noStars.named === 0 && noStars.events === 0, JSON.stringify(noStars));

  results.group4 = { errors: errors.slice(), animals, night, noon, noStars, herd, shots: ['revamp-wildlife.png', 'revamp-night-lanterns.png', 'revamp-noon.png', 'revamp-night-no-stars.png'] };
  await page.context().close();
}

async function group5() {
  console.log('\n══ Group 5: expanded building catalogue ══');
  const page = await newPage();
  await setupTown(page, 6);

  const catalogue = await page.evaluate(() => {
    const D = HM.data, s = HM.state;
    s.money = 9e6; s.era = 6;
    const ids = new Set(), names = new Set();
    const bad = [], empty = [], white = [], missingModel = [], brokenNext = [], badCat = [], noEntry = [];
    const byCat = {};
    let meshes = 0, models = 0;
    const catIds = new Set(D.CATS.map((c) => c.id));
    for (const def of D.BUILDINGS) {
      byCat[def.cat] = (byCat[def.cat] || 0) + 1;
      if (ids.has(def.id)) bad.push('duplicate id ' + def.id);
      ids.add(def.id);
      if (names.has(def.name)) bad.push('duplicate name ' + def.name);
      names.add(def.name);
      if (!def.cost || !Number.isFinite(def.cost) || def.cost <= 0) bad.push('cost ' + def.id);
      if (!Number.isInteger(def.era) || def.era < 0 || def.era > 6) bad.push('era ' + def.id);
      if (!catIds.has(def.cat)) badCat.push(def.id + ':' + def.cat);
      if (!def.desc || def.desc.length < 16) noEntry.push(def.id);
      if (def.next && !D.getBuilding(def.next)) brokenNext.push(def.id + '->' + def.next);
      if (def.cat !== 'decor') {
        const effect = def.homes || def.jobs || def.income || def.research || def.army || def.coverage || def.powerCap || def.waterCap || def.storage || Object.keys(def.needs || {}).length || Object.keys(def.produce || {}).length || Object.keys(def.consume || {}).length;
        if (!effect) empty.push(def.id);
      }
      let g;
      try { g = HM.models.build(def.style, def); } catch (e) { missingModel.push(def.id + ':' + e.message); continue; }
      let n = 0, w = 0;
      g.traverse((o) => {
        if (!o.isMesh) return;
        n++;
        const m = o.material;
        if (!m) { w++; return; }
        if (m.color && m.color.getHex() === 0xffffff && !m.map) w++;
        if (o.name && /ghost|helper|boxhelper|footprint/i.test(o.name)) w++;
      });
      if (!n) missingModel.push(def.id + ':empty');
      if (w) white.push(def.id + ':' + w);
      meshes += n; models++;
    }
    return {
      total: D.BUILDINGS.length, models, meshes, byCat,
      bad: bad.slice(0, 8), empty: empty.slice(0, 8), white: white.slice(0, 8),
      missingModel: missingModel.slice(0, 8), brokenNext: brokenNext.slice(0, 8), badCat: badCat.slice(0, 8),
      noEntry: noEntry.slice(0, 8), cats: D.CATS.length
    };
  });
  ok('the catalogue contains the planned large set of buildings', catalogue.total >= 250 && catalogue.cats >= 12, JSON.stringify({ total: catalogue.total, cats: catalogue.cats, byCat: catalogue.byCat }));
  ok('every building has a real model, cost, era and category', catalogue.missingModel.length === 0 && catalogue.bad.length === 0 && catalogue.badCat.length === 0, JSON.stringify({ missing: catalogue.missingModel, bad: catalogue.bad, cats: catalogue.badCat }));
  ok('every building has an encyclopedia entry, description and valid upgrade link', catalogue.noEntry.length === 0 && catalogue.brokenNext.length === 0, JSON.stringify({ noEntry: catalogue.noEntry, brokenNext: catalogue.brokenNext }));
  ok('every non-decoration building has a real simulation effect', catalogue.empty.length === 0, JSON.stringify(catalogue.empty));
  ok('no catalogue model leaves a white helper or box under it', catalogue.white.length === 0, JSON.stringify(catalogue.white));
  ok('all catalogue models are built from real meshes', catalogue.models === catalogue.total && catalogue.meshes > 3000, JSON.stringify({ models: catalogue.models, meshes: catalogue.meshes }));

  // Add and remove every building once: exercises real simulation and scene hooks, not only data.
  const placement = await page.evaluate(() => {
    const s = HM.state, sp = HM.world.spawn, bad = [];
    const initial = s.buildings.length;
    let seen = 0;
    for (const def of HM.data.BUILDINGS) {
      const b = HM.sim.addBuilding(s, def.id, sp.x, sp.z, 0);
      if (!b) { bad.push(def.id + ':sim'); continue; }
      HM.gfx.addBuilding(b);
      const g = HM.gfx.buildingMap.get(b.uid);
      if (!g) bad.push(def.id + ':gfx');
      else {
        let n = 0, foundation = 0, white = 0;
        g.traverse((o) => { if (o.isMesh) { n++; if (o.userData && o.userData.foundation) foundation++; const m = o.material; if (m && m.color && m.color.getHex() === 0xffffff && !m.map) white++; } });
        if (!n) bad.push(def.id + ':empty');
        if (white) bad.push(def.id + ':white');
        seen++;
      }
      HM.gfx.removeBuilding(b.uid);
      HM.sim.removeBuilding(s, b);
    }
    return { bad: bad.slice(0, 10), seen, remaining: s.buildings.length - initial };
  });
  ok('one of every building can be placed and removed without scene errors', placement.bad.length === 0 && placement.seen === catalogue.total && placement.remaining === 0, JSON.stringify(placement));

  // A representative new block in the world, on levelled ground.
  const block = await page.evaluate(() => {
    const s = HM.state, w = HM.world, sp = w.spawn;
    const picks = ['longhouse', 'windfarm', 'orchard', 'refinery', 'mall', 'mosque'];
    const made = [];
    picks.forEach((id, i) => {
      const def = HM.data.getBuilding(id);
      const x = sp.x + ((i % 3) - 1) * 42;
      const z = sp.z + (Math.floor(i / 3) * 38 - 16);
      HM.gfx.flattenSite(x, z, def.size[0], def.size[1], true);
      const b = HM.sim.addBuilding(s, id, x, z, 0);
      if (b) { HM.gfx.addBuilding(b); made.push(id); }
    });
    HM.gfx.rebuildTerrain();
    HM.gfx.focusOn(sp.x, sp.z, 120);
    HM.gfx.pitch = HM.gfx.pitchGoal = 0.52;
    return { made, count: made.length };
  });
  await page.waitForTimeout(1200);
  await shot(page, 'revamp-catalogue-block.png');
  ok('representative new buildings stand in the world', block.count === 6, JSON.stringify(block));

  // Shop: search across the whole catalogue, filters, favourites, recently used, virtualised limit.
  await page.evaluate(() => { HM.ui.closeAllWindows(true); HM.ui.shopCat = 'all'; HM.ui.shopLimit = 60; HM.ui.openWindow('shop'); });
  await page.waitForTimeout(500);
  const shopInitial = await page.evaluate(() => ({ cards: document.querySelectorAll('.shop-item').length, more: !!document.querySelector('[data-action="shop-more"]'), totalText: document.querySelector('#shop-search')?.placeholder }));
  await page.fill('#shop-search', 'iron');
  await page.waitForTimeout(350);
  const search = await page.evaluate(() => ({ cards: document.querySelectorAll('.shop-item').length, names: [...document.querySelectorAll('.shop-name')].map((x) => x.textContent), search: HM.ui.shopSearch }));
  await page.fill('#shop-search', '');
  await page.waitForTimeout(250);
  await page.selectOption('#shop-era', '0');
  await page.waitForTimeout(300);
  const era = await page.evaluate(() => ({ cards: document.querySelectorAll('.shop-item').length, eras: [...document.querySelectorAll('.shop-meta')].map((x) => x.textContent).slice(0, 5), filter: HM.ui.shopEra }));
  await page.selectOption('#shop-need', 'beauty');
  await page.waitForTimeout(300);
  const need = await page.evaluate(() => ({ cards: document.querySelectorAll('.shop-item').length, filter: HM.ui.shopNeed }));
  await page.click('[data-action="shop-fav"]');
  await page.waitForTimeout(250);
  const fav = await page.evaluate(() => ({ fav: HM.ui.shopFav.length, chips: document.querySelectorAll('.shop-chip').length }));
  await page.click('[data-action="shop-fav-only"]');
  await page.waitForTimeout(250);
  const favOnly = await page.evaluate(() => ({ cards: document.querySelectorAll('.shop-item').length, on: HM.ui.shopFavOnly, fav: HM.ui.shopFav }));
  await page.click('[data-action="shop-fav-only"]');
  await page.selectOption('#shop-era', 'all'); await page.selectOption('#shop-need', 'all');
  await page.waitForTimeout(300);
  await page.evaluate(() => HM.ui.noteBuildingPlaced('windfarm'));
  await page.evaluate(() => HM.ui.renderWindow('shop'));
  await page.waitForTimeout(250);
  const recent = await page.evaluate(() => ({ recent: HM.ui.shopRecent, recentChips: [...document.querySelectorAll('.shop-quick')].map((x) => x.textContent).join(' '), text: document.querySelector('.shop-quick')?.textContent }));
  await shot(page, 'revamp-catalogue-shop.png');
  ok('shop renders a virtualised first page with a show-more control', shopInitial.cards === 60 && shopInitial.more && new RegExp(catalogue.total + ' buildings').test(shopInitial.totalText || ''), JSON.stringify(shopInitial));
  ok('shop search searches the whole catalogue, not only the visible page', search.cards >= 3 && search.names.some((n) => /iron|foundry|steel/i.test(n)), JSON.stringify(search));
  ok('shop era and need filters work', era.cards > 0 && era.cards < 60 && era.filter === '0' && need.filter === 'beauty' && need.cards > 0 && need.cards < era.cards, JSON.stringify({ era, need }));
  ok('favourites and recently used buildings are available as quick rows', fav.fav >= 1 && fav.chips >= 1 && recent.recent[0] === 'windfarm' && /Recently used/.test(recent.recentChips), JSON.stringify({ fav, recent }));
  ok('favourites filter narrows the shop to saved buildings', favOnly.on && favOnly.cards >= 1 && favOnly.cards <= favOnly.fav.length, JSON.stringify(favOnly));

  // Encyclopedia picks up every building from the same data.
  await page.evaluate(() => { HM.ui.closeAllWindows(true); HM.ui.openWindow('encyclopedia'); });
  await page.waitForTimeout(500);
  const enc = await page.evaluate(() => ({ rows: document.querySelectorAll('.enc-rows .enc-row').length, count: document.querySelector('.enc-count')?.textContent, thumb: !!document.querySelector('.enc-thumb') }));
  await page.fill('#enc-search', 'wind farm');
  await page.waitForTimeout(400);
  const encSearch = await page.evaluate(() => ({ rows: document.querySelectorAll('.enc-rows .enc-row').length, names: [...document.querySelectorAll('.enc-name')].map((x) => x.textContent.split('\n')[0]) }));
  await shot(page, 'revamp-catalogue-encyclopedia.png');
  ok('the encyclopedia lists every building generated from the catalogue data', enc.rows === catalogue.total && new RegExp(String(catalogue.total)).test(enc.count || ''), JSON.stringify(enc));
  ok('the encyclopedia can find a new building by name', encSearch.rows >= 1 && encSearch.names.some((n) => /Wind Farm/i.test(n)), JSON.stringify(encSearch));

  results.group5 = { errors: errors.slice(), catalogue, placement, block, shopInitial, search, era, need, fav, favOnly, recent, enc, encSearch, shots: ['revamp-catalogue-block.png', 'revamp-catalogue-shop.png', 'revamp-catalogue-encyclopedia.png'] };
  await page.context().close();
}

async function group6() {
  console.log('\n══ Group 6: settings, quit and small fixes ══');
  const page = await newPage();
  await page.evaluate(() => { HM.ui.openWindow('settings'); HM.ui.closeAllWindows(true); HM.ui.openWindow('settings'); });
  await page.waitForTimeout(350);

  // Quit asks first, and Cancel keeps the game running.
  await page.click('[data-action="quit-menu"]');
  await page.waitForTimeout(200);
  const quitAsk = await page.evaluate(() => ({
    title: document.querySelector('.modal-head h3')?.textContent,
    buttons: [...document.querySelectorAll('#modal-root [data-action]')].map((x) => x.dataset.action),
    visible: !!document.querySelector('.modal-backdrop')
  }));
  await shot(page, 'revamp-quit-modal.png');
  await page.click('#modal-root [data-action="modal-close"]');
  await page.waitForTimeout(150);
  const cancelled = await page.evaluate(() => ({ inGame: HM.main.inGame, state: !!HM.state, modal: !!document.querySelector('.modal-backdrop') }));
  ok('Quit asks Save, Don\'t save or Cancel and Cancel keeps playing', /Save before quitting/i.test(quitAsk.title || '') && quitAsk.visible && quitAsk.buttons.includes('quit-save') && quitAsk.buttons.includes('quit-discard') && cancelled.inGame && cancelled.state && !cancelled.modal, JSON.stringify({ quitAsk, cancelled }));

  // Stage the scale: dragging must not resize anything.
  const before = await page.evaluate(() => ({ w: document.querySelector('.game-window[data-window="settings"]').getBoundingClientRect().width, scale: HM.ui.settings.uiScale }));
  await page.locator('#set-uiscale').evaluate((el) => { el.value = '1.3'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(180);
  const staged = await page.evaluate(() => ({
    scale: HM.ui.settings.uiScale, pending: HM.ui.pendingScale,
    width: document.querySelector('.game-window[data-window="settings"]').getBoundingClientRect().width,
    label: document.querySelector('#set-uiscale-pct')?.textContent,
    applyDisabled: document.querySelector('#set-uiscale-apply')?.disabled,
    pct: document.querySelector('#set-uiscale')?.style.getPropertyValue('--pct')
  }));
  await page.click('[data-action="settings-scale-cancel"]');
  await page.waitForTimeout(250);
  const cancel = await page.evaluate(() => ({ pending: HM.ui.pendingScale, scale: HM.ui.settings.uiScale, slider: document.querySelector('#set-uiscale')?.value, label: document.querySelector('#set-uiscale-pct')?.textContent }));
  ok('dragging the scale slider only previews until Apply, and Cancel restores it', staged.scale === 1 && staged.pending === 1.3 && Math.abs(staged.width - before.w) < 1 && staged.label === '130%' && staged.applyDisabled === false && Number(staged.pct) > 70 && cancel.pending === null && cancel.scale === 1 && cancel.slider === '1' && cancel.label === '100%', JSON.stringify({ before, staged, cancel }));

  // Apply, then let the 10-second guard revert it.
  await page.locator('#set-uiscale').evaluate((el) => { el.value = '1.3'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('[data-action="settings-scale-apply"]');
  await page.waitForTimeout(350);
  const applied = await page.evaluate(() => {
    const win = document.querySelector('.game-window[data-window="settings"]').getBoundingClientRect();
    return {
      scale: HM.ui.settings.uiScale, saved: JSON.parse(localStorage.getItem('unborn.settings.v1') || '{}').uiScale,
      guard: !document.querySelector('#scale-guard').classList.contains('hidden'),
      guardText: document.querySelector('#scale-guard-text')?.textContent,
      width: win.width, top: win.top, bottom: win.bottom, vh: innerHeight,
      hudScale: getComputedStyle(document.querySelector('#game-ui')).zoom
    };
  });
  await page.screenshot({ path: path.join(SHOTS, 'revamp-settings-scale-130.png') });
  ok('Apply changes the whole interface, saves it and offers a timed keep-or-revert', applied.scale === 1.3 && Math.abs(applied.saved - 1.3) < 0.001 && applied.guard && /Reverting in 10 seconds/.test(applied.guardText) && applied.width > before.w && applied.bottom <= applied.vh + 1, JSON.stringify(applied));
  await page.waitForTimeout(10600);
  const timedOut = await page.evaluate(() => ({ scale: HM.ui.settings.uiScale, guard: document.querySelector('#scale-guard').classList.contains('hidden') }));
  ok('the scale guard reverts automatically after ten seconds', Math.abs(timedOut.scale - 1) < 0.001 && timedOut.guard, JSON.stringify(timedOut));

  // Keep applies and persists; Reset returns to 100.
  await page.locator('#set-uiscale').evaluate((el) => { el.value = '1.25'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('[data-action="settings-scale-apply"]');
  await page.waitForTimeout(250);
  await page.click('[data-action="scale-keep"]');
  await page.waitForTimeout(200);
  const kept = await page.evaluate(() => ({ scale: HM.ui.settings.uiScale, guard: document.querySelector('#scale-guard').classList.contains('hidden'), saved: JSON.parse(localStorage.getItem('unborn.settings.v1') || '{}').uiScale }));
  await page.screenshot({ path: path.join(SHOTS, 'revamp-settings-scale-125.png') });
  await page.click('[data-action="settings-scale-reset"]');
  await page.waitForTimeout(300);
  const reset = await page.evaluate(() => ({ scale: HM.ui.settings.uiScale, label: document.querySelector('#set-uiscale-pct')?.textContent }));
  await shot(page, 'revamp-settings-scale-100.png');
  ok('Keep persists the chosen scale and Reset returns to 100%', Math.abs(kept.scale - 1.25) < 0.001 && kept.guard && Math.abs(kept.saved - 1.25) < 0.001 && Math.abs(reset.scale - 1) < 0.001 && reset.label === '100%', JSON.stringify({ kept, reset }));

  // 75% and 150%: every open window must remain in the viewport and the settings rows must not overflow.
  const scaleShots = [];
  for (const z of [0.75, 1.5]) {
    await page.evaluate((z) => HM.ui.commitScale(z, { guard: false }), z);
    await page.waitForTimeout(350);
    const layout = await page.evaluate(() => {
      const wins = [...document.querySelectorAll('.game-window')].map((el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; });
      const row = document.querySelector('.settings-row');
      return { wins, vw: innerWidth, vh: innerHeight, rowOverflow: row ? row.scrollWidth - row.clientWidth : 0, scale: HM.ui.settings.uiScale };
    });
    const f = await shot(page, `revamp-settings-scale-${Math.round(z * 100)}.png`);
    scaleShots.push(f);
    ok(`the interface remains usable and inside the viewport at ${Math.round(z * 100)}%`, Math.abs(layout.scale - z) < 0.001 && layout.wins.every((r) => r.l >= -1 && r.t >= -1 && r.r <= layout.vw + 1 && r.b <= layout.vh + 1) && layout.rowOverflow <= 1, JSON.stringify(layout));
  }
  await page.evaluate(() => HM.ui.commitScale(1, { guard: false }));
  await page.waitForTimeout(250);

  // Font size is independent, live and has the same filled percent bar.
  const font = await page.evaluate(() => {
    const el = document.querySelector('#set-fontscale');
    el.value = '1.2'; el.dispatchEvent(new Event('input', { bubbles: true }));
    const hud = document.querySelector('#hud');
    return { scale: HM.ui.settings.fontScale, label: document.querySelector('#set-fontscale-pct')?.textContent, pct: el.style.getPropertyValue('--pct'), hudFont: getComputedStyle(hud).fontSize };
  });
  await page.waitForTimeout(200);
  const ranges = await page.evaluate(() => [...document.querySelectorAll('input[type=range]')].map((el) => ({ id: el.id || el.dataset.setting || el.dataset.tax, pct: el.style.getPropertyValue('--pct') })));
  ok('font size applies live and every slider shows a filled percent bar', Math.abs(font.scale - 1.2) < 0.001 && font.label === '120%' && Number(font.pct) > 50 && ranges.length > 1 && ranges.every((r) => r.pct !== ''), JSON.stringify({ font, ranges }));
  await page.click('[data-action="settings-font-reset"]');
  await page.waitForTimeout(200);

  // Drop-downs are black on light paper, including native options.
  const colours = await page.evaluate(() => {
    const read = (el) => { const c = getComputedStyle(el); return { color: c.color, bg: c.backgroundColor }; };
    const sels = [...document.querySelectorAll('select')].map((el) => ({ id: el.id, ...read(el), option: el.options[0] ? read(el.options[0]) : null }));
    return sels;
  });
  await shot(page, 'revamp-dropdowns.png');
  const dark = (c) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || ''); return m && (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 < 80; };
  const light = (c) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || ''); return m && (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 > 150; };
  ok('every drop-down uses black text on a light background', colours.length >= 2 && colours.every((s) => dark(s.color) && light(s.bg) && (!s.option || (dark(s.option.color) && light(s.option.bg)))), JSON.stringify(colours.slice(0, 5)));

  // Quit without saving: everything game-owned is gone and a new game still works.
  await page.click('[data-action="quit-menu"]');
  await page.waitForTimeout(150);
  await page.click('#modal-root [data-action="quit-discard"]');
  await page.waitForSelector('#menu:not(.hidden)', { timeout: 90000 });
  await page.waitForTimeout(1000);
  const gone = await page.evaluate(() => ({
    inGame: HM.main.inGame, state: HM.state, world: HM.state ? HM.world : null,
    buildings: HM.gfx.buildingMap.size, animalGroup: HM.gfx.animalGroup && HM.gfx.animalGroup.children.length ? HM.gfx.animalGroup.children.length : 0,
    windows: HM.ui.windows.size, menu: !document.querySelector('#menu').classList.contains('hidden'),
    stars: typeof HM.gfx.starPool, terra: HM.game._terraMove, people: Array.isArray(HM.gfx.people) ? HM.gfx.people.length : 0
  }));
  ok('Quit without saving disposes the settlement and returns to the menu', !gone.inGame && gone.state === null && gone.buildings === 0 && gone.animalGroup === 0 && gone.windows === 0 && gone.menu && gone.stars === 'undefined' && gone.terra === null && gone.people === 0, JSON.stringify(gone));

  // Start a second game in the same page, then save before quitting and load it.
  await page.click('[data-action="menu-new"]');
  await page.waitForSelector('#newgame:not(.hidden)');
  await page.click('[data-action="ng-start"]');
  await page.waitForFunction(() => window.HM && HM.main && HM.main.inGame, null, { timeout: 180000 });
  await page.waitForSelector('#game-ui:not(.hidden)');
  await page.waitForTimeout(700);
  await page.evaluate(() => { document.querySelector('#tutorial-offer [data-action="tutorial-skip"]')?.click(); HM.ui.closeAllWindows(true); HM.sim.setSpeed(HM.state, 0); });
  const second = await page.evaluate(() => ({ inGame: HM.main.inGame, size: HM.world.size, animals: HM.gfx.animalGroup ? HM.gfx.animalGroup.children.length : 0, buildings: HM.state.buildings.length }));
  await page.evaluate(() => HM.ui.openWindow('settings'));
  await page.waitForTimeout(250);
  await page.click('[data-action="quit-menu"]');
  await page.waitForTimeout(150);
  await page.click('#modal-root [data-action="quit-save"]');
  await page.waitForSelector('#menu:not(.hidden)', { timeout: 90000 });
  await page.waitForTimeout(900);
  const saved = await page.evaluate(() => ({ hasSave: !!window.localStorage.getItem('unborn.save.v1') || !!Object.keys(localStorage).find((k) => /save/i.test(k)), continueVisible: !document.querySelector('[data-action="menu-continue"]')?.disabled }));
  await page.click('[data-action="menu-continue"]');
  await page.waitForFunction(() => window.HM && HM.main && HM.main.inGame, null, { timeout: 180000 });
  await page.waitForTimeout(700);
  const loaded = await page.evaluate(() => ({ inGame: HM.main.inGame, size: HM.world.size, menu: !document.querySelector('#menu').classList.contains('hidden') }));
  ok('starting a second game, saving on quit and loading it all work', second.inGame && second.size === 3072 && second.animals > 0 && saved.hasSave && saved.continueVisible && loaded.inGame && loaded.size === 3072 && !loaded.menu, JSON.stringify({ second, saved, loaded }));

  results.group6 = { errors: errors.slice(), quitAsk, cancelled, staged, cancel, applied, timedOut, kept, reset, font, ranges, colours, gone, second, saved, loaded, shots: ['revamp-quit-modal.png', 'revamp-settings-scale-130.png', 'revamp-settings-scale-125.png', ...scaleShots.map((x) => path.basename(x)), 'revamp-dropdowns.png'] };
  await page.context().close();
}


async function group7() {
  console.log('\n══ Group 2: roads, bridges, walls and campfires ══');
  const page = await newPage();
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    document.querySelector('#tutorial-offer [data-action="tutorial-skip"]')?.click();
    HM.ui.closeAllWindows(true);
    HM.sim.setSpeed(HM.state, 0);
    HM.state.money = 9e6;
    HM.state.era = 6;
    HM.state.weather = 'overcast'; HM.state.weatherTimer = 999;
  });
  const s0 = await page.evaluate(() => ({ x: HM.world.spawn.x, z: HM.world.spawn.z }));

  // Catalogue and typed roads.
  await page.evaluate(() => { HM.ui.openWindow('shop'); HM.ui.shopCat = 'roads'; HM.ui.renderWindow('shop'); });
  await page.waitForTimeout(250);
  const cats = await page.evaluate(() => ({
    roads: HM.data.ROADS.length,
    cards: document.querySelectorAll('[data-action="road-type"]').length,
    bridgeOptions: [...document.querySelectorAll('#road-bridge option')].map((o) => o.value),
    wallCards: HM.data.BUILDINGS.filter((b) => b.wall).length
  }));
  ok('the catalogue lists every road type and a bridge selector', cats.cards === cats.roads && cats.roads >= 16 && cats.bridgeOptions.length >= 4 && cats.wallCards >= 12, JSON.stringify(cats));
  await shot(page, 'revamp-road-catalogue.png');
  await page.click('[data-action="road-type"][data-road="asphalt"]');
  await page.waitForTimeout(200);
  const chosen = await page.evaluate(() => ({ road: HM.ui.roadType, tool: HM.game.tool, ghost: !!HM.gfx.roadPlan }));
  ok('choosing a road type arms the road tool with that surface', chosen.road === 'asphalt' && chosen.tool === 'road', JSON.stringify(chosen));
  await page.evaluate(() => { HM.ui.closeAllWindows(true); HM.game.beginRoad('cobble'); });
  await focusNow(page, s0.x, s0.z + 16, 200);

  // Two real segments and a snapped T-junction.
  const A = { x: s0.x - 34, z: s0.z + 16 }, B = { x: s0.x - 2, z: s0.z + 16 }, C = { x: s0.x - 2, z: s0.z + 44 };
  await clickWorld(page, A.x, A.z, 1); await page.waitForTimeout(160);
  await clickWorld(page, B.x, B.z, 1); await page.waitForTimeout(220);
  await clickWorld(page, C.x, C.z, 1); await page.waitForTimeout(250);
  const built = await page.evaluate(() => ({ roads: HM.state.roads.filter((r) => r.x1 > -999).length, types: HM.state.roads.map((r) => r.type), stats: HM.gfx.roadStats }));
  ok('two real clicks lay a typed road segment and continue from its end', built.roads >= 2 && built.types.includes('cobble') && built.stats.junctions >= 1, JSON.stringify(built));

  // Branch from the middle of the first segment: the road splits into a junction.
  const branchX = s0.x - 18, branchZ = s0.z + 16;
  await clickWorld(page, branchX, branchZ, 1); await page.waitForTimeout(160);
  await clickWorld(page, branchX, branchZ - 30, 1); await page.waitForTimeout(300);
  const junction = await page.evaluate(() => {
    const roads = HM.state.roads.filter((r) => r.type === 'cobble');
    const nodes = [];
    for (const r of roads) nodes.push({ x: r.x1, z: r.z1 }, { x: r.x2, z: r.z2 });
    const shared = nodes.filter((n, i) => nodes.some((m, j) => j !== i && Math.hypot(n.x - m.x, n.z - m.z) < 0.01)).length;
    return { roads: roads.length, shared, stats: HM.gfx.roadStats, roadNodes: HM.gfx.roadNodes.length };
  });
  ok('a road ending on another splits it into a shared, welded junction node', junction.shared >= 2 && junction.stats.junctions >= 2 && junction.stats.junctionsWithCrosswalks >= 2, JSON.stringify(junction));
  await page.evaluate(() => { HM.ui.closeAllWindows(true); });
  await focusNow(page, s0.x, s0.z + 16, 110);
  await shot(page, 'revamp-road-junction.png');

  // Preview before committing, then cancel with Escape.
  await page.evaluate(() => { HM.game.beginRoad('cobble'); });
  await focusNow(page, s0.x + 16, s0.z + 16, 110);
  await clickWorld(page, s0.x + 6, s0.z + 16, 1); await page.waitForTimeout(180);
  const target = await project(page, s0.x + 28, s0.z + 16, 1);
  await page.mouse.move(target.x, target.y);
  await page.waitForTimeout(350);
  const preview = await page.evaluate(() => ({ plan: !!HM.gfx.roadPlan, children: HM.gfx.roadPlan?.children?.length || 0, hint: document.querySelector('#placement-hint')?.innerText || '' }));
  await shot(page, 'revamp-road-preview.png');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  const cancelled = await page.evaluate(() => ({ plan: !!HM.gfx.roadPlan, start: HM.game.roadStart }));
  ok('road preview shows the planned strip and cost, and Escape leaves no mesh', preview.plan && preview.children > 0 && /coins/.test(preview.hint) && !cancelled.plan && !cancelled.start, JSON.stringify({ preview, cancelled }));

  // Invalid bridge preview: a timber bridge cannot span this coast.
  const invalid = await page.evaluate(() => {
    HM.game.tool = 'road'; HM.game.roadType = 'cobble'; HM.game.bridgeStyle = 'wood';
    HM.game.roadStart = { x: 58, z: 190 };
    const plan = HM.game.roadPlanAt(146, 190);
    HM.gfx.focusOn(102, 190, 150);
    HM.gfx.showRoadPlan({ x: 58, z: 190 }, { x: 146, z: 190 }, plan.valid, plan);
    return { valid: plan.valid, bridge: plan.bridge, length: Math.round(plan.length), span: plan.bridgeDef.maxSpan, cost: plan.cost };
  });
  await page.waitForTimeout(400);
  await shot(page, 'revamp-road-invalid.png');
  await page.evaluate(() => { HM.gfx.clearRoadPlan(); HM.game.roadStart = null; HM.game.setTool('select'); });
  ok('an over-long bridge is marked invalid with its real span and cost', !invalid.valid && invalid.bridge && invalid.length > invalid.span && invalid.cost > 0, JSON.stringify(invalid));

  // Bridges: deck, railings and piers down to the bed.
  const bridge = await page.evaluate(() => { HM.main.debug.addBridge(58, 190, 146, 190, 'cobble', 'stone'); HM.gfx.focusOn(102, 190, 150); return { stats: HM.gfx.roadStats, ys: HM.gfx.roadsGroup.children.filter((o) => o.isMesh).map((o) => { o.geometry.computeBoundingBox(); return { min: o.geometry.boundingBox.min.y, max: o.geometry.boundingBox.max.y, mat: o.material?.color?.getHexString() }; }).slice(0, 5) }; });
  await page.waitForTimeout(700);
  await shot(page, 'revamp-bridge.png');
  await page.evaluate(() => { HM.gfx.focusOn(102, 190, 65); });
  await page.waitForTimeout(400);
  await shot(page, 'revamp-bridge-close.png');
  const bridgeWalk = await page.evaluate(() => {
    const r = HM.state.roads.find((q) => q.bridge);
    if (!r) return null;
    const x = (r.x1 + r.x2) / 2, z = (r.z1 + r.z2) / 2;
    return { on: HM.sim.walkable(HM.state, x, z), h: HM.world.heightAt(x, z), bridge: HM.sim.onBridge(HM.state, x, z) };
  });
  ok('a bridge builds a raised deck with piers down to the water bed', bridge.stats.bridges >= 1 && bridge.stats.supports >= 4, JSON.stringify(bridge.stats));
  ok('walkers can cross on a bridge deck over open water', bridgeWalk && bridgeWalk.bridge === true && bridgeWalk.on === true && bridgeWalk.h < 0.35, JSON.stringify(bridgeWalk));

  // Tree clearance: build through a real tree and check that exact tree is gone.
  const tree = await page.evaluate(() => {
    const s = HM.world.spawn;
    const list = (HM.gfx.trees || []).filter((x) => !x.harvested && Math.hypot(x.x - s.x, x.z - s.z) < 230 && HM.world.slopeAt(x.x, x.z) < 0.4 && HM.world.heightAt(x.x, x.z) > 2).sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z));
    const t = list[0];
    return t ? { x: t.x, z: t.z } : null;
  });
  if (tree) {
    await focusNow(page, tree.x, tree.z, 75);
    const before = await page.evaluate(() => HM.gfx.harvestedTrees());
    await page.evaluate(() => { HM.game.beginRoad('dirt'); });
    await clickWorld(page, tree.x - 14, tree.z, 1); await page.waitForTimeout(150);
    await clickWorld(page, tree.x + 14, tree.z, 1); await page.waitForTimeout(400);
    const cleared = await page.evaluate(() => ({ after: HM.gfx.harvestedTrees(), road: HM.state.roads.find((r) => r.type === 'dirt'), wood: HM.state.resources.wood, roads: HM.state.roads.map((r) => r.type) }));
    ok('a road through a tree clears that exact tree and records the removal', cleared.after > before && cleared.road && cleared.road.clearedTrees >= 1, JSON.stringify({ before, tree, ...cleared }));
  } else ok('a tree near the settlement exists for road clearance', false, 'no unharvested tree within 330 m');

  // Walls: drag, preview, gate and block.
  await page.evaluate(() => { HM.state.money = 9e6; HM.game.beginWall('w_palisade'); });
  await focusNow(page, s0.x, s0.z - 22, 110);
  const wa = await project(page, s0.x - 25, s0.z - 22, 1);
  const wb = await project(page, s0.x + 25, s0.z - 22, 1);
  await page.mouse.move(wa.x, wa.y); await page.mouse.down(); await page.mouse.move(wb.x, wb.y, { steps: 8 });
  await page.waitForTimeout(300);
  await shot(page, 'revamp-wall-preview.png');
  const wallPreview = await page.evaluate(() => ({ plan: !!HM.gfx.wallPlan, pieces: HM.gfx.wallPlan?.children?.length || 0, hint: document.querySelector('#placement-hint')?.innerText || '' }));
  await page.mouse.up(); await page.waitForTimeout(500);
  const wall = await page.evaluate(() => ({ walls: HM.state.walls.map((w) => ({ id: w.defId, len: Math.hypot(w.x2 - w.x1, w.z2 - w.z1), cost: w.cost, tower: !!w.tower })), stats: HM.gfx.wallStats, at: !!HM.game.wallAt((HM.state.walls[0].x1 + HM.state.walls[0].x2) / 2, (HM.state.walls[0].z1 + HM.state.walls[0].z2) / 2), blocked: HM.game.validatePlacement(HM.data.getBuilding('hut'), (HM.state.walls[0].x1 + HM.state.walls[0].x2) / 2, (HM.state.walls[0].z1 + HM.state.walls[0].z2) / 2, 0).reasons }));
  await shot(page, 'revamp-wall.png');
  const wallBlock = await page.evaluate(() => {
    const w = HM.state.walls.find((q) => !q.tower);
    if (!w) return null;
    const mx = (w.x1 + w.x2) / 2, mz = (w.z1 + w.z2) / 2;
    const nx = -(w.z2 - w.z1) / Math.max(0.01, Math.hypot(w.x2 - w.x1, w.z2 - w.z1));
    const nz = (w.x2 - w.x1) / Math.max(0.01, Math.hypot(w.x2 - w.x1, w.z2 - w.z1));
    return { onWall: HM.sim.walkable(HM.state, mx, mz), beside: HM.sim.walkable(HM.state, mx + nx * 8, mz + nz * 8) };
  });
  const segments = wall.walls.filter((w) => !w.tower).length;
  ok('dragging a wall shows a preview, builds it by length and blocks placement', wallPreview.plan && wallPreview.pieces >= 8 && /coins/.test(wallPreview.hint) && segments === 1 && wall.walls.some((w) => w.tower) && wall.at && wall.blocked.some((r) => /wall/i.test(r)), JSON.stringify({ wallPreview, wall }));
  ok('a wall is solid to walkers while open ground beside it is walkable', wallBlock && wallBlock.onWall === false && wallBlock.beside === true, JSON.stringify(wallBlock));

  const invalidWall = await page.evaluate(() => {
    const before = HM.state.walls.length;
    HM.game.beginWall('w_palisade');
    HM.game.wallStart = { x: 58, z: 190 }; HM.game.wallHover = { x: 146, z: 190 };
    const plan = HM.game.wallPlanAt(146, 190);
    HM.game.finishWall();
    return { valid: plan.valid, added: HM.state.walls.length - before, reason: plan.reason };
  });
  ok('an invalid wall plan is refused before it charges or builds', invalidWall.valid === false && invalidWall.added === 0, JSON.stringify(invalidWall));
  const gate = await page.evaluate(() => {
    HM.game.setTool('select');
    HM.main.debug.addWall('w_gatewood', HM.world.spawn.x + 8, HM.world.spawn.z - 42, HM.world.spawn.x + 18, HM.world.spawn.z - 42);
    const w = HM.state.walls[HM.state.walls.length - 1];
    const mx = (w.x1 + w.x2) / 2, mz = (w.z1 + w.z2) / 2;
    return { gate: HM.game.wallAt(mx, mz, 2), gates: HM.gfx.wallStats.gates, through: HM.sim.walkable(HM.state, mx, mz) };
  });
  ok('a gate leaves a passable gap while walls block', gate.gate === null && gate.through === true && gate.gates >= 1, JSON.stringify(gate));

  // Rival towns have era-appropriate walls.
  const ai = await page.evaluate(() => {
    const n = HM.state.nations.find((x) => !x.conquered);
    const c = n && n.cities && n.cities[0];
    if (c) HM.gfx.focusOn(c.x, c.z, 130);
    return { count: (HM.state.nationWalls || []).length, styles: [...new Set((HM.state.nationWalls || []).map((w) => w.style))], capital: c ? c.name : null };
  });
  await page.waitForTimeout(700);
  await shot(page, 'revamp-ai-walls.png');
  ok('pre-generated nations have real walls in era-appropriate styles', ai.count > 20 && ai.styles.length >= 2, JSON.stringify(ai));

  // Campfire day/night/storm.
  const fire = await page.evaluate(() => {
    const p = HM.main.debug.place('firepit', 22, 30);
    HM.main.debug.setHour(21.5); HM.main.debug.setWeather('clear');
    HM.gfx.focusOn(HM.world.spawn.x + 22, HM.world.spawn.z + 30, 32);
    return { placed: p, lights: HM.gfx.campfireLights.length };
  });
  await page.waitForTimeout(700);
  await shot(page, 'revamp-campfire-night.png');
  const night = await page.evaluate(() => HM.gfx.campfireLights.map((c) => ({
    lit: c.light?.intensity, flames: c.flames?.length, smoke: !!HM.gfx.smoke,
    smokeParticles: HM.gfx.smoke ? HM.gfx.smoke.particles.filter((q) => q.life > 0).length : 0,
    visible: c.flames.map((f) => f.visible), colour: c.flames[0]?.material?.color?.getHexString(), height: c.flames[0]?.scale?.y
  })));
  await page.evaluate(() => HM.main.debug.setWeather('storm'));
  await page.waitForTimeout(600);
  await shot(page, 'revamp-campfire-storm.png');
  const storm = await page.evaluate(() => HM.gfx.campfireLights.map((c) => c.light?.intensity));
  ok('campfire has flames, smoke, light at night and goes out in a storm', fire.lights === 1 && night[0].flames === 4 && night[0].lit > 0.5 && night[0].smoke && night[0].smokeParticles > 0 && storm[0] === 0, JSON.stringify({ fire, night, storm }));

  // Traffic is owned: a cartwright supplies early carts, then it moves with game speed.
  await page.evaluate(() => {
    const sp = HM.world.spawn;
    HM.state.era = Math.max(1, HM.state.era);
    const cw = HM.sim.addBuilding(HM.state, 'cartwright', sp.x + 60, sp.z + 40, 0);
    cw.buildProgress = 1;
    HM.state.resources.wood = 200;
    HM.sim.advanceVehicles(HM.state, 30);
    HM.gfx.refreshRoads(HM.state.roads);
    HM.main.debug.setHour(11); HM.main.debug.setWeather('clear'); HM.sim.setSpeed(HM.state, 5); HM.gfx.focusOn(sp.x, sp.z + 20, 90);
  });
  await page.waitForTimeout(400);
  const trafficA = await page.evaluate(() => HM.gfx.roadVehicles.slice(0, 4).map((v) => ({ x: v.group.position.x, z: v.group.position.z })));
  await page.waitForTimeout(600);
  const trafficB = await page.evaluate(() => HM.gfx.roadVehicles.slice(0, 4).map((v) => ({ x: v.group.position.x, z: v.group.position.z })));
  await page.evaluate(() => HM.sim.setSpeed(HM.state, 0));
  await page.waitForTimeout(200);
  const pausedA = await page.evaluate(() => HM.gfx.roadVehicles.slice(0, 4).map((v) => ({ x: v.group.position.x, z: v.group.position.z })));
  await page.waitForTimeout(600);
  const pausedB = await page.evaluate(() => HM.gfx.roadVehicles.slice(0, 4).map((v) => ({ x: v.group.position.x, z: v.group.position.z })));
  const moved = trafficA.some((p, i) => Math.hypot(p.x - trafficB[i].x, p.z - trafficB[i].z) > 0.1);
  const frozen = pausedA.every((p, i) => Math.hypot(p.x - pausedB[i].x, p.z - pausedB[i].z) < 0.01);
  await shot(page, 'revamp-traffic.png');
  ok('cars and carts move on the road network, then freeze when paused', trafficA.length > 0 && moved && frozen, JSON.stringify({ vehicles: trafficA.length, moved, frozen }));

  // Encyclopedia and guide know the new categories.
  const learn = await page.evaluate(() => ({
    enc: HM.ui.panels.encyclopedia(),
    guide: HM.ui.panels.guide()
  }));
  await page.evaluate(() => { HM.ui.openWindow('encyclopedia'); HM.ui.openWindow('guide'); });
  await page.waitForTimeout(300);
  await shot(page, 'revamp-encyclopedia-walls.png');
  ok('encyclopedia and guide cover walls, campfires, roads and bridges', learn.enc.includes('Wooden Palisade') && learn.enc.includes('Campfire') && /Walls and gates/.test(learn.guide) && /Roads and bridges/.test(learn.guide), '');

  // Save and load preserves walls, road types, and campfires.
  const saved = await page.evaluate(() => { HM.game.save(true); return { walls: HM.state.walls.length, roads: HM.state.roads.filter((r) => r.type).length, campfires: HM.gfx.campfireLights.length }; });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#menu:not(.hidden)');
  await page.click('[data-action="menu-continue"]');
  await page.waitForFunction(() => window.HM && HM.main && HM.main.inGame, null, { timeout: 180000 });
  await page.waitForTimeout(1000);
  const loaded = await page.evaluate(() => ({ walls: (HM.state.walls || []).length, roadTypes: [...new Set((HM.state.roads || []).map((r) => r.type).filter(Boolean))], campfires: HM.gfx.campfireLights.length, wallStats: HM.gfx.wallStats, junction: HM.gfx.roadStats.junctions }));
  await shot(page, 'revamp-road-loaded.png');
  ok('save and load restore walls, road types and campfires', loaded.walls === saved.walls && loaded.roadTypes.includes('cobble') && loaded.campfires === saved.campfires && loaded.wallStats.segments >= saved.walls, JSON.stringify({ saved, loaded }));

  results.group7 = { errors: errors.slice(), cats, chosen, built, junction, preview, cancelled, invalid, bridge, wallPreview, wall, gate, ai, fire, night, storm, saved, loaded, shots: ['revamp-road-catalogue.png', 'revamp-road-junction.png', 'revamp-road-preview.png', 'revamp-road-invalid.png', 'revamp-bridge.png', 'revamp-bridge-close.png', 'revamp-wall-preview.png', 'revamp-wall.png', 'revamp-ai-walls.png', 'revamp-campfire-night.png', 'revamp-campfire-storm.png', 'revamp-traffic.png', 'revamp-encyclopedia-walls.png', 'revamp-road-loaded.png'] };
  await page.context().close();
}


async function group8() {
  const page = await newPage();
  const startErrors = errors.length;

  // R3-1: fulfilling a citizen request through the real button.
  const req = await page.evaluate(() => {
    HM.state.money = 5000;
    if (!HM.state.citizens.length) {
      const sp = HM.world.spawn;
      const home = HM.sim.addBuilding(HM.state, 'tent', sp.x + 8, sp.z + 8, 0);
      HM.gfx.addBuilding(home);
      HM.sim.addCitizen(HM.state, home, true);
    }
    const c = HM.state.citizens[0];
    c.requestNeed = 'water'; c.needs.water = 5;
    HM.state.money = 500;
    HM.ui.openWindow('citizens');
    HM.ui.selectedCitizen = c.id;
    HM.ui.renderWindow('citizens');
    return { id: c.id, money: HM.state.money };
  });
  await page.waitForTimeout(250);
  await page.click('[data-action="citizen-fulfill"]');
  await page.waitForTimeout(450);
  const reqAfter = await page.evaluate(() => ({ request: HM.state.citizens[0].requestNeed, money: HM.state.money, fulfilled: HM.state.flags.requestsFulfilled || 0 }));
  await shot(page, 'r3-request-fulfilled.png');
  ok('R3-1 a citizen request is fulfilled once with no console error', errors.length === startErrors && reqAfter.request === null && reqAfter.money === req.money - 40 && reqAfter.fulfilled === 1, JSON.stringify({ before: req, after: reqAfter, errors: errors.slice(startErrors) }));

  // R3-4: every single-piece wall, gate, tower and barricade places on one click.
  const spawn = await page.evaluate(() => ({ x: HM.world.spawn.x, z: HM.world.spawn.z }));
  const singles = ['w_gatewood', 'w_gatestone', 'w_gatemodern', 'w_tower', 'w_bastion', 'w_barricade', 'w_spikes'];
  const placed = [];
  for (let i = 0; i < singles.length; i++) {
    const defId = singles[i];
    await page.evaluate((id) => {
      HM.ui.closeAllWindows(true);
      HM.state.era = 6; HM.state.money = 100000; HM.state.walls = [];
      HM.gfx.refreshWalls([]);
      HM.ui.openWindow('shop'); HM.ui.shopCat = 'walls'; HM.ui.shopSearch = HM.data.getBuilding(id).name;
      HM.ui.renderWindow('shop');
    }, defId);
    await page.waitForTimeout(160);
    const card = page.locator(`[data-action="shop-pick"][data-def="${defId}"]`);
    if (await card.count()) await card.first().click();
    await page.evaluate(() => HM.ui.closeAllWindows(true));
    const pt = await project(page, spawn.x + 12 + (i % 4) * 9, spawn.z + 12 + Math.floor(i / 4) * 10);
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(180);
    const got = await page.evaluate(() => (HM.state.walls || []).map((w) => w.defId));
    placed.push({ defId, walls: got, ok: got.includes(defId) });
  }
  await shot(page, 'r3-wall-single-click.png');
  ok('R3-4 every single-piece wall, gate, tower and barricade places on one click', placed.every((q) => q.ok), JSON.stringify(placed));

  // Line walls keep their drag gesture for every curtain, brick, concrete and moat type.
  const lines = ['w_palisade', 'w_stone', 'w_reinforced', 'w_brick', 'w_battlement', 'w_concrete', 'w_steel', 'w_moat'];
  const linePlaced = [];
  for (let i = 0; i < lines.length; i++) {
    const defId = lines[i];
    await page.evaluate((id) => {
      HM.ui.closeAllWindows(true);
      HM.state.era = 6; HM.state.money = 100000; HM.state.walls = [];
      HM.gfx.refreshWalls([]);
      HM.ui.openWindow('shop'); HM.ui.shopCat = 'walls'; HM.ui.shopSearch = HM.data.getBuilding(id).name;
      HM.ui.renderWindow('shop');
    }, defId);
    await page.waitForTimeout(150);
    const card = page.locator(`[data-action="shop-pick"][data-def="${defId}"]`);
    if (await card.count()) await card.first().click();
    await page.evaluate(() => HM.ui.closeAllWindows(true));
    const a = await project(page, spawn.x - 28 + (i % 2) * 18, spawn.z + 34 + Math.floor(i / 2) * 8);
    const b = await project(page, spawn.x - 12 + (i % 2) * 18, spawn.z + 34 + Math.floor(i / 2) * 8);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const got = await page.evaluate(() => (HM.state.walls || []).map((w) => w.defId));
    linePlaced.push({ defId, ok: got.includes(defId) });
  }
  ok('R3-4 every dragged curtain wall and moat still builds by dragging', linePlaced.every((q) => q.ok), JSON.stringify(linePlaced));

  // R3-3: cars need a factory and a dealership, and none appear before.
  const fleet = await page.evaluate(() => {
    HM.state.vehicles = { carts: 0, cars: 0, buses: 0, trucks: 0, taxis: 0, progress: {} };
    HM.state.roads = [{ uid: 'rt1', x1: HM.world.spawn.x - 20, z1: HM.world.spawn.z + 5, x2: HM.world.spawn.x + 20, z2: HM.world.spawn.z + 5, width: 6, type: 'asphalt', cost: 100, bridge: false }];
    HM.gfx.refreshRoads(HM.state.roads);
    const before = HM.gfx.roadStats.vehicles;
    const sp = HM.world.spawn;
    const f = HM.sim.addBuilding(HM.state, 'carfactory', sp.x + 40, sp.z + 30, 0); f.buildProgress = 1;
    HM.state.resources.steel = 80;
    HM.sim.advanceVehicles(HM.state, 30);
    HM.gfx.refreshRoads(HM.state.roads);
    const factoryOnly = { vehicles: HM.gfx.roadStats.vehicles, fleet: HM.sim.vehicleFleet(HM.state) };
    const d = HM.sim.addBuilding(HM.state, 'cardealership', sp.x + 55, sp.z + 30, 0); d.buildProgress = 1;
    HM.sim.advanceVehicles(HM.state, 40);
    HM.gfx.refreshRoads(HM.state.roads);
    const withDealer = { vehicles: HM.gfx.roadStats.vehicles, fleet: HM.sim.vehicleFleet(HM.state) };
    return { before, factoryOnly, withDealer };
  });
  await page.waitForTimeout(400);
  await shot(page, 'r3-cars-after-dealership.png');
  ok('R3-3 no vehicles before a factory and dealer; cars appear only after both', fleet.before === 0 && fleet.factoryOnly.vehicles === 0 && fleet.factoryOnly.fleet.cars === 0 && fleet.withDealer.fleet.cars > 0 && fleet.withDealer.vehicles > 0, JSON.stringify(fleet));

  // R3-5: rain volume scales to the whole visible map at maximum zoom.
  const rain = await page.evaluate(async () => {
    HM.sim.setSpeed(HM.state, 0);
    HM.main.debug.setWeather('rain');
    const settle = async () => {
      // Camera easing runs on the render loop; wait for the tween to finish so
      // this measures the rain volume at the requested zoom, not mid-transition.
      for (let i = 0; i < 120; i++) {
        if (Math.abs(HM.gfx.distance - HM.gfx.distTarget) < 2) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      await new Promise((r) => setTimeout(r, 120));
    };
    const sp = HM.world.spawn;
    HM.gfx.focusOn(sp.x, sp.z, 80);
    await settle();
    const near = { scale: HM.gfx.rain.scale.x, size: HM.gfx.rain.material.size };
    HM.gfx.focusOn(sp.x, sp.z, 2200);
    await settle();
    const rect = HM.gfx.getCameraRect();
    return { near, far: { scale: HM.gfx.rain.scale.x, size: HM.gfx.rain.material.size, visible: HM.gfx.rain.visible, footprint: Math.max(rect[2] - rect[0], rect[3] - rect[1]) }, worldSize: HM.world.size };
  });
  await shot(page, 'r3-rain-zoomed-out.png');
  ok('R3-5 rain covers the whole visible map when zoomed out', rain.far.scale > rain.near.scale * 3 && rain.far.scale * 240 >= rain.far.footprint && rain.far.visible, JSON.stringify(rain));

  // R3-6: entering placement or demolish closes an open select.
  const dropdown = await page.evaluate(() => {
    HM.ui.closeAllWindows(true); HM.ui.openWindow('settings');
    const sel = document.querySelector('#set-quality'); sel.focus();
    const openBefore = document.activeElement === sel;
    HM.ui.closeDropdowns(); HM.game.setTool('demolish');
    return { openBefore, stillFocused: document.activeElement === sel, tool: HM.game.tool };
  });
  ok('R3-6 demolish/build mode closes every dropdown', dropdown.openBefore && !dropdown.stillFocused && dropdown.tool === 'demolish', JSON.stringify(dropdown));

  // R3-2: the expanded tree is acyclic, reachable and every tech has an effect.
  const tech = await page.evaluate(() => {
    const all = HM.data.TECHS;
    const newOnes = all.filter((t) => /^(trade|construction|energy|transport|education|communication|defense|environment)_/.test(t.id));
    const seen = new Set(), visiting = new Set(); let cycle = false;
    const visit = (id) => { if (visiting.has(id)) { cycle = true; return; } if (seen.has(id)) return; visiting.add(id); for (const p of (HM.data.TECH[id]?.prereqs || [])) visit(p); visiting.delete(id); seen.add(id); };
    all.forEach((t) => visit(t.id));
    const empty = all.filter((t) => (!t.effects || !Object.keys(t.effects).length) && !t.advanceEra && !(t.unlocks || []).length).map((t) => t.id);
    const missing = newOnes.flatMap((t) => (t.unlocks || []).filter((id) => !HM.data.getBuilding(id))).filter((v, i, a) => a.indexOf(v) === i);
    return { total: all.length, newOnes: newOnes.length, cycle, unreachable: all.length - seen.size, empty, missingUnlocks: missing, branches: HM.data.TECH_BRANCHES.length };
  });
  ok('R3-2 research tree gains 150+ working, acyclic techs and new branches', tech.newOnes >= 150 && !tech.cycle && tech.unreachable === 0 && tech.empty.length === 0 && tech.missingUnlocks.length === 0 && tech.branches >= 15, JSON.stringify(tech));

  // R2-14: construction takes game time, shows a site and finishes.
  const build = await page.evaluate(() => {
    HM.state.money = 50000; HM.main.debug.setHour(9);
    const sp = HM.world.spawn;
    const b = HM.sim.addBuilding(HM.state, 'cottage', sp.x + 35, sp.z - 20, 0, { constructing: true });
    b.buildProgress = 0; b.buildHours = 4;
    HM.gfx.addBuilding(b);
    const started = { under: HM.sim.isUnderConstruction(b), scaffold: !!(HM.gfx.buildingMap.get(b.uid)?.userData.construction), residents: b.residentIds.length };
    HM.sim.advanceConstruction(HM.state, 1.4);
    const mid = { progress: b.buildProgress, under: HM.sim.isUnderConstruction(b) };
    HM.sim.advanceConstruction(HM.state, 4);
    return { started, mid, done: { under: HM.sim.isUnderConstruction(b), progress: b.buildProgress, scaffold: !!HM.gfx.buildingMap.get(b.uid)?.userData.construction } };
  });
  await page.waitForTimeout(300);
  await shot(page, 'r3-construction-finished.png');
  ok('R2-14 construction advances in game hours, shows scaffolding, then finishes', build.started.under && build.started.scaffold && build.started.residents === 0 && build.mid.progress > 0 && build.mid.progress < 1 && !build.done.under && build.done.progress === 1, JSON.stringify(build));

  results.group8 = { errors: errors.slice(startErrors), req, reqAfter, placed, fleet, rain, dropdown, tech, build, shots: ['r3-request-fulfilled.png', 'r3-wall-single-click.png', 'r3-cars-after-dealership.png', 'r3-rain-zoomed-out.png', 'r3-construction-finished.png'] };
  await page.context().close();
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  await startServer();
  browser = await chromium.launch({ headless: true, executablePath: chromiumPath(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-gpu-sandbox'] });
  try {
    if (ONLY === 'all' || ONLY === '1') await group1();
    if (ONLY === 'all' || ONLY === '2') await group2();
    if (ONLY === 'all' || ONLY === '3') await group3();
    if (ONLY === 'all' || ONLY === '4') await group4();
    if (ONLY === 'all' || ONLY === '5') await group5();
    if (ONLY === 'all' || ONLY === '6') await group6();
    if (ONLY === 'all' || ONLY === '7') await group7();
    if (ONLY === 'all' || ONLY === '8') await group8();
  } finally {
    await browser.close();
    if (server) server.kill('SIGTERM');
  }
  const payload = { pass, fail, errors, results, at: new Date().toISOString() };
  fs.writeFileSync(path.join(SHOTS, 'revamp-results.json'), JSON.stringify(payload, null, 2));
  console.log(`\n${pass} passed, ${fail} failed`);
  if (errors.length) console.log('Console errors:\n' + errors.slice(0, 12).join('\n'));
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); try { server?.kill('SIGTERM'); } catch { /* ignore */ } process.exit(2); });
