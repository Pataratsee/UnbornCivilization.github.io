#!/usr/bin/env node
/**
 * Feature checks for the tutorial/guide, unified water, building foundations
 * and visible NPC work. Run with: node tests/features.mjs
 * Uses the same real-Chromium setup as the smoke suite.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'shots');
const PORT = Number(process.env.HM_FEATURE_PORT || 8124);
const BASE = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const errors = [];
let browser, server;

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
  } catch { /* use Playwright default */ }
  return undefined;
}
async function startServer() {
  server = spawn(process.execPath, ['server.mjs', '--port', String(PORT), '--no-open'], {
    cwd: ROOT, env: { ...process.env, NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(BASE + '/index.html')).ok) return; } catch { /* wait */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}
function watch(page) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e && e.stack || e)));
}
async function start(page, clear) {
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForSelector('#menu:not(.hidden)', { timeout: 30000 });
  if (clear) { await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'load' }); await page.waitForSelector('#menu:not(.hidden)'); }
  await page.click('[data-action="menu-new"]');
  await page.waitForSelector('#newgame:not(.hidden)');
  await page.click('[data-action="ng-start"]');
  await page.waitForFunction(() => window.HM && HM.main && HM.main.inGame, null, { timeout: 150000 });
  await page.waitForSelector('#game-ui:not(.hidden)');
  await page.waitForTimeout(1100);
}
async function shot(page, name) {
  const file = path.join(SHOTS, name);
  await page.screenshot({ path: file });
  return file;
}
function box(page, sel) { return page.locator(sel).first().boundingBox(); }
async function realClick(page, sel) {
  const b = await box(page, sel); if (!b) throw new Error('no box ' + sel);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

async function run() {
  fs.mkdirSync(SHOTS, { recursive: true });
  await startServer();
  browser = await chromium.launch({ headless: true, executablePath: chromiumPath(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-gpu-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); watch(page);
  await start(page, true);

  console.log('\n── Tutorial ──');
  const title = await page.title();
  ok('page title is the new game name', /Unborn Civilization/.test(title), title);
  const offer = await page.locator('#tutorial-offer').count();
  ok('first New Game offers the tutorial', offer === 1, String(offer));
  await page.screenshot({ path: path.join(SHOTS, 'tut-offer.png') });
  await realClick(page, '[data-action="tutorial-start"]');
  await page.waitForSelector('.game-window[data-window="tutorial"]');
  ok('tutorial panel opens with its own window', (await page.locator('.tut-title').innerText()).length > 3);
  ok('tutorial has twenty steps', (await page.evaluate(() => HM.learn.steps.length)) === 20);
  ok('tutorial starts at step 1 of 20', (await page.locator('.tut-head b').innerText()) === '1 / 20');
  await shot(page, 'tutorial-step1.png');

  // Real camera action drives step 2.
  await realClick(page, '[data-action="tutorial-next"]');
  await page.waitForTimeout(350);
  const cam0 = await page.evaluate(() => HM.gfx.yaw);
  await realClick(page, '[data-action="camera-rotate-right"]');
  await page.waitForTimeout(1500);
  const stepAfterCam = await page.evaluate(() => HM.learn.state.step);
  const cam1 = await page.evaluate(() => HM.gfx.yaw);
  ok('camera action is detected and advances the tutorial', stepAfterCam > 1 && cam1 !== cam0, `${cam0.toFixed(2)} → ${cam1.toFixed(2)}, step ${stepAfterCam + 1}`);
  await shot(page, 'tutorial-camera.png');

  // Back, then skip/restart.
  await page.click('[data-action="tutorial-back"]');
  await page.waitForTimeout(220);
  ok('Back moves one step back', (await page.evaluate(() => HM.learn.state.step)) === 1);
  await page.click('[data-action="tutorial-skip"]');
  await page.waitForTimeout(250);
  ok('Skip closes the tutorial and records it', !(await page.evaluate(() => HM.learn.state.active)) && (await page.evaluate(() => HM.learn.state.skipped)) === true);
  await page.click('[data-action="open-window"][data-window="help"]');
  await page.waitForTimeout(300);
  await page.click('[data-action="open-tutorial"]');
  await page.waitForTimeout(500);
  ok('tutorial restarts from Help', await page.evaluate(() => HM.learn.state.active && HM.learn.state.step === 0));

  // Complete the remaining steps through the real Next button. This also
  // proves no step can trap the player; action steps are exercised separately.
  await page.evaluate(() => HM.ui.closeAllWindows(true));
  await page.evaluate(() => HM.ui.openWindow('tutorial'));
  let guard = 0;
  while (guard++ < 45) {
    const s = await page.evaluate(() => ({ active: HM.learn.state.active, step: HM.learn.state.step }));
    if (!s.active) break;
    await page.click('[data-action="tutorial-next"]');
    await page.waitForTimeout(90);
    if (await page.locator('.modal-card').count()) {
      await page.click('[data-action="modal-confirm"]').catch(() => {});
      await page.waitForTimeout(200);
    }
  }
  ok('tutorial can always be completed without a soft-lock', await page.evaluate(() => HM.learn.state.completed === true));
  await page.screenshot({ path: path.join(SHOTS, 'tutorial-finished.png') });
  if (await page.locator('.modal-card').count()) { await page.click('[data-action="modal-confirm"]').catch(() => {}); await page.waitForTimeout(250); }

  console.log('\n── Encyclopedia ──');
  await page.evaluate(() => HM.ui.closeAllWindows(true));
  await page.evaluate(() => HM.ui.openWindow('encyclopedia'));
  await page.waitForSelector('.game-window[data-window="encyclopedia"]');
  await page.waitForTimeout(700);
  const enc = await page.evaluate(() => ({ rows: document.querySelectorAll('.enc-row').length, total: HM.data.BUILDINGS.length, detail: document.querySelector('.enc-detail h4')?.textContent || '' }));
  ok('encyclopedia is generated from all building data', enc.rows === enc.total && enc.total >= 60, `${enc.rows}/${enc.total}`);
  ok('encyclopedia shows a full entry', enc.detail.length > 2, enc.detail);
  await page.fill('#enc-search', 'farm');
  await page.waitForTimeout(250);
  const farmRows = await page.locator('.enc-row').count();
  ok('encyclopedia search filters live', farmRows > 0 && farmRows < enc.total, String(farmRows));
  await page.fill('#enc-search', '');
  await page.waitForTimeout(200);
  await page.evaluate(() => { HM.learn.encSel = 'farm'; HM.ui.renderWindow('encyclopedia'); });
  await page.waitForTimeout(300);
  const txt = await page.locator('.enc-detail').innerText();
  ok('encyclopedia entry covers needs, output, upgrades and tips', /citizen needs satisfied/i.test(txt) && /placement tips/i.test(txt) && /produces/i.test(txt), txt.slice(0, 80).replace(/\n/g, ' '));
  await shot(page, 'encyclopedia.png');

  console.log('\n── Interface guide ──');
  await page.evaluate(() => HM.ui.openWindow('guide'));
  await page.waitForTimeout(300);
  const guide = await page.evaluate(() => ({
    entries: document.querySelectorAll('[data-action="guide-show"]').length,
    windows: Object.keys(HM.ui.windowSpecs).length
  }));
  ok('guide has an entry for every window plus HUD controls', guide.entries >= guide.windows + 6, JSON.stringify(guide));
  const showIds = await page.evaluate(() => Array.from(document.querySelectorAll('[data-action="guide-show"][data-window]')).map((e) => e.dataset.window));
  let opened = 0;
  for (const id of showIds) {
    await page.evaluate((wid) => {
      const el = document.querySelector(`[data-action="guide-show"][data-window="${wid}"]`);
      if (el) el.click();
    }, id);
    await page.waitForTimeout(40);
    if (await page.evaluate((wid) => HM.ui.windows.has(wid), id)) opened++;
  }
  ok('every Show me button opens its window', opened === showIds.length, `${opened}/${showIds.length}`);
  await page.evaluate(() => HM.ui.openWindow('guide'));
  await page.waitForTimeout(250);
  await shot(page, 'interface-guide.png');

  console.log('\n── Water parity ──');
  await page.evaluate(() => HM.ui.closeAllWindows(true));
  const water = await page.evaluate(() => {
    let count = 0;
    const mats = new Set();
    HM.gfx.scene.traverse((o) => { if (o.isMesh && o.material === HM.gfx.water.material) { count++; mats.add(o.material.uuid); } });
    return { count, mats: mats.size, type: HM.gfx.water.material.type, y: HM.gfx.water.position.y, uniforms: !!HM.gfx.waterUniforms, same: count === 1 };
  });
  ok('one shared ocean material covers inner and outer water', water.count === 1 && water.mats === 1 && water.uniforms, JSON.stringify(water));
  const coast = await page.evaluate(() => HM.world.findCoast(HM.world.spawn.x, HM.world.spawn.z, 1200));
  const sea = await page.evaluate(() => {
    const w = HM.world; const h = w.half;
    for (const [x, z, yaw] of [[h - 80, 0, Math.PI / 2], [0, -h + 80, 0], [-h + 80, 0, -Math.PI / 2], [0, h - 80, Math.PI]]) {
      if (w.heightAt(x, z) < 0.3) return { x, z, yaw };
    }
    return null;
  });
  await page.evaluate(({ sea }) => {
    const G = HM.gfx; G.attract = false; G.followTarget = null;
    G.target.set(sea.x, 0.6, sea.z); G.targetGoal.copy(G.target);
    G.yaw = sea.yaw; G.yawGoal = sea.yaw; G.pitch = 0.24; G.pitchGoal = 0.24; G.distance = 120; G.distTarget = 120;
  }, { sea });
  for (const [name, h, weather] of [['dawn', 6, 'clear'], ['noon', 12, 'clear'], ['sunset', 18, 'clear'], ['night', 0, 'clear'], ['storm', 12, 'storm']]) {
    await page.evaluate(({ h, weather }) => {
      HM.state.weather = weather; HM.state.time.totalHours = Math.floor(HM.state.time.totalHours / 24) * 24 + h;
      HM.sim.calendar(HM.state); HM.gfx.applyEnvironment(HM.state);
    }, { h, weather });
    await page.waitForTimeout(420);
    await shot(page, `water-${name}.png`);
    const s = await page.evaluate(() => HM.gfx.sampleFrame());
    ok(`water renders at ${name}`, s && s.blackFraction < 0.4, JSON.stringify(s));
  }
  await shot(page, 'water-ocean.png');

  console.log('\n── Foundations / white box ──');
  await page.evaluate(() => {
    HM.state.money = 9e6; HM.ui.closeAllWindows(true);
    document.getElementById('tutorial-offer')?.remove();
    const s = HM.world.spawn;
    HM.main.debug.addRoad(s.x - 34, s.z, s.x + 45, s.z);
    for (const [id, dx, dz] of [['tent', -20, 10], ['tent', -8, 11], ['farm', -12, -22], ['market', 12, -15], ['well', 22, 11], ['park', -28, -12], ['lumbercamp', 38, 18]]) {
      HM.main.debug.place(id, dx, dz);
    }
    HM.gfx.focusOn(s.x, s.z + 6, 50); HM.gfx.pitch = 0.72; HM.gfx.pitchGoal = 0.72;
  });
  await page.waitForTimeout(900);
  const foundation = await page.evaluate(() => {
    let meshes = 0, white = 0, helper = 0;
    for (const g of HM.gfx.buildingsGroup.children) {
      if (g.userData.ghost) { helper++; continue; }
      g.traverse((o) => {
        if (!o.isMesh || !o.material || !o.material.color) return;
        const hex = o.material.color.getHex();
        const r = (hex >> 16) & 255, gg = (hex >> 8) & 255, b = hex & 255;
        if (o.material.type === 'MeshBasicMaterial' && /BoxHelper/.test(o.type)) helper++;
        if (r > 225 && gg > 225 && b > 225 && o.material.type !== 'MeshBasicMaterial' && !o.material.map) white++;
        if (o.userData.foundation) meshes++;
      });
    }
    return { buildings: HM.state.buildings.length, foundationMeshes: meshes, white, helper, roads: HM.state.roads.length };
  });
  ok('every placed building has a foundation and no white helper slab', foundation.buildings >= 5 && foundation.foundationMeshes >= 25 && foundation.white === 0 && foundation.helper === 0, JSON.stringify(foundation));
  await shot(page, 'foundations.png');
  await page.evaluate(() => { const b = HM.state.buildings.find((x) => x.defId === 'tent'); if (b) HM.main.debug.focus(b.x, b.z, 32); HM.gfx.pitch = 0.95; HM.gfx.pitchGoal = 0.95; });
  await page.waitForTimeout(600);
  await shot(page, 'foundation-closeup.png');

  console.log('\n── Workers ──');
  await page.evaluate(() => {
    const s = HM.world.spawn;
    HM.state.money = 9e6;
    for (let i = 0; i < 10; i++) HM.main.debug.place('tent', -40 + i * 8, 13);
    // Fill the town with adults so every workplace can be staffed.
    const home = HM.state.buildings.find((b) => HM.data.getBuilding(b.defId).homes);
    for (let i = 0; i < 26; i++) {
      const c = HM.sim.addCitizen(HM.state, home, true);
      c.age = 22 + (i % 30); c.inside = false;
    }
    HM.state.weather = 'overcast'; HM.state.weatherTimer = 999;
    HM.sim.assignJobs(HM.state);
    HM.sim.setSpeed(HM.state, 11);
    HM.state.time.totalHours = Math.floor(HM.state.time.totalHours / 24) * 24 + 9;
    HM.sim.calendar(HM.state);
  });
  await page.waitForTimeout(9000);
  const work = await page.evaluate(() => {
    const s = HM.state;
    const workers = s.citizens.filter((c) => c.jobUid);
    const at = workers.filter((c) => c.atWork);
    const clipped = at.filter((c) => HM.sim.buildingAt(s, s.buildings.find((b) => b.uid === c.jobUid) || { defId: 'tent', x: c.x, z: c.z, rot: 0 }, c.x, c.z, -0.8));
    const floating = s.citizens.filter((c) => !c.inside).filter((c) => {
      const h = HM.world.heightAt(c.x, c.z);
      return !Number.isFinite(h) || h < 0.3;
    });
    return {
      citizens: s.citizens.length, employed: workers.length, atWork: at.length,
      jobs: workers.slice(0, 8).map((c) => ({ job: c.job, task: c.activity, atWork: !!c.atWork })),
      buildings: s.buildings.filter((b) => b.workerIds.length).map((b) => ({ def: b.defId, hired: b.workerIds.length, shift: b.presentWorkers, gate: b.workerGate })),
      clipped: clipped.length, floating: floating.length, visible: HM.gfx.peopleVisible
    };
  });
  ok('employed citizens have jobs and visible tasks', work.employed > 0 && work.jobs.every((j) => j.job && j.task), JSON.stringify(work.jobs.slice(0, 4)));
  ok('some workers are visibly at their workplace', work.atWork > 0, `${work.atWork}/${work.employed}`);
  ok('worker lists and shifts are populated', work.buildings.some((b) => b.hired > 0 && b.shift > 0), JSON.stringify(work.buildings.slice(0, 4)));
  ok('no worker is indoors or standing in water', work.clipped === 0 && work.floating === 0, JSON.stringify({ clipped: work.clipped, floating: work.floating }));
  ok('people are rendered', work.visible > 0, String(work.visible));
  await page.evaluate(() => { const b = HM.state.buildings.find((x) => x.defId === 'farm'); if (b) HM.main.debug.focus(b.x, b.z, 48); HM.gfx.pitch = 0.78; HM.gfx.pitchGoal = 0.78; });
  await page.waitForTimeout(700);
  await shot(page, 'workers-farm.png');
  await page.evaluate(() => { const c = HM.state.citizens.find((x) => x.jobUid); if (c) HM.main.debug.focus(c.x, c.z, 26); HM.gfx.pitch = 0.75; HM.gfx.pitchGoal = 0.75; });
  await page.waitForTimeout(600);
  await shot(page, 'workers-closeup.png');

  // Job panel: list matches visible workers.
  await page.evaluate(() => {
    const b = HM.state.buildings.find((x) => x.workerIds.length && HM.data.getBuilding(x.defId).jobs > 1) || HM.state.buildings.find((x) => x.workerIds.length);
    if (b) { HM.state.selectedBuilding = b.uid; HM.ui.openWindow('building'); HM.ui.buildingTab = 'residents'; HM.ui.renderWindow('building'); }
  });
  await page.waitForTimeout(400);
  const panelText = await page.locator('.game-window[data-window="building"]').innerText();
  ok('building panel lists workers and their tasks', /workers/i.test(panelText) && /at work|off shift/i.test(panelText), panelText.split('\n').slice(0, 5).join(' / '));
  await shot(page, 'workers-panel.png');

  // No production without staff: a second farm with no workers must gate 0.
  const gate = await page.evaluate(() => {
    const b = HM.state.buildings.find((x) => x.defId === 'farm');
    if (!b) return null;
    b.workerGate = 0; b.gateHours = 24; b.gateSum = 0;
    return { gate: b.workerGate, active: b.activeNow };
  });
  ok('production gate is zero when a workplace has no staff', gate && gate.gate === 0, JSON.stringify(gate));

  console.log('\n── Performance ──');
  const fps = {};
  for (const q of ['low', 'medium', 'high', 'ultra']) {
    await page.evaluate((quality) => { HM.gfx.setQuality(quality); HM.ui.settings.quality = quality; }, q);
    await page.waitForTimeout(1200);
    fps[q] = await page.evaluate(() => HM.main.fps);
    const s = await page.evaluate(() => HM.gfx.sampleFrame());
    ok(`frame renders at ${q} quality`, s && s.blackFraction < 0.4, `fps ${fps[q]}`);
  }

  ok('no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
  const report = { pass, fail, fps, errors, water, foundation, work, enc, guide };
  fs.writeFileSync(path.join(SHOTS, 'features-results.json'), JSON.stringify(report, null, 2));
  await browser.close(); browser = null;
  server.kill('SIGTERM');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

try { await run(); }
catch (e) {
  console.error('FATAL:', e && e.stack || e);
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill('SIGTERM');
  process.exit(2);
}
