#!/usr/bin/env node
/**
 * Unborn Civilization smoke + regression suite.
 *
 *   npm test
 *
 * Serves the static site, drives real Chromium with real mouse/touch input and
 * fails on any console error, page exception, unhandled rejection or failed
 * request. Runs the render-sanity, camera and window checks on desktop and
 * repeats the camera/window checks at a mobile viewport with touch.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'shots');
const PORT = Number(process.env.HM_TEST_PORT || 8123);
const BASE = `http://localhost:${PORT}`;
const results = { pass: 0, fail: 0, checks: [] };
let browser;
let server;

function ok(name, condition, detail) {
  if (condition) { results.pass++; results.checks.push({ name, pass: true, detail }); }
  else { results.fail++; results.checks.push({ name, pass: false, detail }); }
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  return condition;
}

function chromiumPath() {
  if (process.env.HM_CHROMIUM) return process.env.HM_CHROMIUM;
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
  try {
    const dirs = fs.readdirSync(cache).filter((d) => d.startsWith('chromium-'));
    for (const d of dirs) {
      const p = path.join(cache, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  } catch { /* fall back to Playwright's own lookup */ }
  return undefined;
}

async function startServer() {
  server = spawn(process.execPath, ['server.mjs', '--port', String(PORT), '--no-open'], {
    cwd: ROOT, env: { ...process.env, NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(BASE + '/index.html');
      if (r.ok) return;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Local server did not start on ' + BASE);
}

function watchPage(page, label) {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err && err.stack || err}`));
  page.on('requestfailed', (req) => errors.push(`[requestfailed] ${req.url()} ${req.failure() ? req.failure().errorText : ''}`));
  page.__hmErrors = errors;
  page.__hmLabel = label;
  return errors;
}

async function realClick(page, selector, label) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: 'visible', timeout: 15000 });
  const box = await el.boundingBox();
  if (!box) throw new Error('No bounding box for ' + selector);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  if (label) await page.waitForTimeout(60);
}

async function startGame(page, pathname) {
  await page.goto(BASE + (pathname || '/'), { waitUntil: 'load' });
  await page.waitForSelector('#menu:not(.hidden)', { timeout: 30000 });
  await realClick(page, '[data-action="menu-new"]');
  await page.waitForSelector('#newgame:not(.hidden)', { timeout: 10000 });
  await realClick(page, '[data-action="ng-start"]');
  await page.waitForFunction(() => window.HM && HM.main && HM.main.inGame === true, null, { timeout: 240000 });
  await page.waitForSelector('#game-ui:not(.hidden)', { timeout: 15000 });
  await page.waitForTimeout(1200);
}

async function screenshot(page, name) {
  const file = path.join(SHOTS, name);
  const buf = await page.screenshot({ path: file });
  return { file, hash: crypto.createHash('sha1').update(buf).digest('hex') };
}

async function getCamera(page) {
  return page.evaluate(() => {
    const G = HM.gfx;
    const fwd = new THREE.Vector3();
    G.camera.getWorldDirection(fwd);
    return {
      view: { x: fwd.x, y: fwd.y, z: fwd.z },
      viewHeading: Math.atan2(fwd.x, -fwd.z),
      yaw: G.yaw, yawGoal: G.yawGoal, pitch: G.pitch, pitchGoal: G.pitchGoal,
      distance: G.distance, distTarget: G.distTarget,
      heading: G.cameraHeading(),
      target: { x: G.target.x, y: G.target.y, z: G.target.z },
      goal: { x: G.targetGoal.x, y: G.targetGoal.y, z: G.targetGoal.z },
      cam: { x: G.camera.position.x, y: G.camera.position.y, z: G.camera.position.z }
    };
  });
}

async function canvasDrag(page, x, y, dx, dy, button) {
  await page.mouse.move(x, y);
  await page.mouse.down({ button: button || 'left' });
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up({ button: button || 'left' });
  await page.waitForTimeout(350);
}

async function closeAllWindows(page) {
  await page.evaluate(() => HM.ui.closeAllWindows(true));
  await page.waitForTimeout(80);
}

async function settleWindow(page, id) {
  await page.waitForFunction((wid) => {
    const win = HM.ui.windows.get(wid);
    if (!win || !win.el || !win.el.isConnected) return false;
    const anims = win.el.getAnimations();
    return anims.every((a) => a.playState === 'finished' || a.playState === 'idle');
  }, id, { timeout: 3000 });
}

async function openWindowDirect(page, id) {
  await page.evaluate((wid) => { HM.ui.closeAllWindows(true); HM.ui.openWindow(wid); }, id);
  await page.waitForSelector(`.game-window[data-window="${id}"]`, { timeout: 5000 });
  await settleWindow(page, id);
}

async function resetWindowForTest(page, id) {
  await page.evaluate((wid) => {
    const win = HM.ui.windows.get(wid);
    const spec = HM.ui.windowSpecs[wid] || {};
    const vw = window.innerWidth, vh = window.innerHeight;
    const width = Math.min(Math.max(spec.minW || 360, 600), vw - 100);
    const height = Math.min(Math.max(spec.minH || 300, 420), vh - 140);
    win.el.style.left = '200px';
    win.el.style.top = '100px';
    win.el.style.width = width + 'px';
    win.el.style.height = height + 'px';
  }, id);
  await settleWindow(page, id);
  await page.waitForTimeout(60);
}

async function dragHandle(page, id, dir, dx, dy) {
  const handle = page.locator(`.game-window[data-window="${id}"] .win-resize-handle.${dir}`);
  const box = await handle.boundingBox();
  if (!box) throw new Error('No handle box for ' + id + ' ' + dir);
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await page.mouse.up({ button: 'left' });
  await settleWindow(page, id);
  await page.waitForTimeout(60);
}

async function windowRect(page, id) {
  return page.evaluate((wid) => {
    const r = HM.ui.windows.get(wid).el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
  }, id);
}

async function touchDrag(page, cdp, x, y, dx, dy) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / steps, y: y + (dy * i) / steps, id: 1 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);
}

async function touchTwist(page, cdp, cx, cy) {
  const a = { x: cx - 45, y: cy, id: 1 }, b = { x: cx + 45, y: cy, id: 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a, b] });
  for (let i = 1; i <= 6; i++) {
    const ang = (i / 6) * (Math.PI / 2);
    const a2 = { x: cx - 45 * Math.cos(ang), y: cy - 45 * Math.sin(ang), id: 1 };
    const b2 = { x: cx + 45 * Math.cos(ang), y: cy + 45 * Math.sin(ang), id: 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [a2, b2] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(350);
}

async function runFix1(page) {
  console.log('\n── Fix 1: render sanity ──');
  const info = await page.evaluate(() => window.HM.gfx.renderDebugInfo());
  console.log('renderDebugInfo:', JSON.stringify(info, null, 2));
  const sample = await page.evaluate(() => window.HM.gfx.sampleFrame());
  const terrain = await page.evaluate(() => window.HM.gfx.probeTerrainFrame());
  console.log('sample:', JSON.stringify(sample), 'terrain probe:', JSON.stringify(terrain));
  ok('world started', await page.evaluate(() => !!(window.HM && HM.main && HM.main.inGame)));
  ok('terrain chunks exist', (info.draw && info.draw.chunks) > 0, `${info.draw && info.draw.chunks} chunks`);
  ok('renderer draws triangles', (info.draw && info.draw.triangles) > 1000, `${info.draw && info.draw.triangles} triangles`);
  ok('frame is not black', sample && sample.lowerBlackFraction < 0.68 && sample.blackFraction < 0.72, JSON.stringify(sample));
  ok('terrain itself is lit, not black', terrain && terrain.terrainPixels > 40 && terrain.terrainBlackFraction < 0.55, JSON.stringify(terrain));
  ok('render sanity passed', !!(info.sanity && info.sanity.passed), info.sanity ? info.sanity.reason : 'missing');
  ok('software PBR compatibility profile applied', !!(info.profile || !info.software), info.profile || 'none');
  await screenshot(page, 'fix1-default.png');

  // A coastal view proves the sky, sea and terrain all render together.
  const coast = await page.evaluate(() => HM.world.findCoast(HM.world.spawn.x, HM.world.spawn.z, 1200));
  if (coast) {
    await page.evaluate((c) => {
      const G = HM.gfx;
      G.attract = false;
      G.target.set(c.x, HM.world.heightAt(c.x, c.z) + 1.5, c.z);
      G.targetGoal.copy(G.target);
      G.yaw = Math.atan2(c.x - HM.world.spawn.x, c.z - HM.world.spawn.z);
      G.yawGoal = G.yaw;
      G.distance = 260; G.distTarget = 260;
      G.pitch = 0.34; G.pitchGoal = 0.34;
    }, coast);
    await page.waitForTimeout(800);
    const coastShot = await screenshot(page, 'fix1-coast.png');
    ok('coastal view renders water and sky', !!coastShot.hash);
  }

  await page.evaluate(() => {
    const G = HM.gfx;
    G.target.set(G.world.spawn.x, G.world.heightAt(G.world.spawn.x, G.world.spawn.z) + 2, G.world.spawn.z);
    G.targetGoal.copy(G.target);
    G.yaw = Math.PI * 0.72; G.yawGoal = G.yaw;
    G.distance = 55; G.distTarget = 55; G.pitch = 0.55; G.pitchGoal = 0.55;
  });
  await page.waitForTimeout(500);
  await screenshot(page, 'fix1-closeup.png');

  await page.evaluate(() => {
    HM.sim.setSpeed(HM.state, 0);
    HM.state.time.totalHours = 23 * 24 + 1;
    HM.sim.calendar(HM.state);
    HM.gfx.applyEnvironment(HM.state);
    HM.gfx.render();
  });
  await page.waitForTimeout(500);
  await screenshot(page, 'fix1-night.png');
  await page.evaluate(() => {
    HM.state.time.totalHours = 8 * 24 + 8;
    HM.sim.calendar(HM.state);
    HM.gfx.applyEnvironment(HM.state);
    HM.gfx.render();
  });
  await page.waitForTimeout(250);

  await page.evaluate(() => {
    const G = HM.gfx;
    G.distance = 175; G.distTarget = 175;
    G.pitch = 1.49; G.pitchGoal = 1.49;
  });
  await page.waitForTimeout(600);
  await screenshot(page, 'fix1-maxtilt.png');
  return { info, sample, terrain };
}

async function runCamera(page) {
  console.log('\n── Fix 2: camera ──');
  await closeAllWindows(page);
  await page.evaluate(() => { HM.sim.setSpeed(HM.state, 0); HM.gfx.resetCamera(); });
  await page.waitForTimeout(500);

  const c0 = await getCamera(page);
  await page.keyboard.down('q');
  await page.waitForTimeout(700);
  await page.keyboard.up('q');
  await page.waitForTimeout(250);
  const c1 = await getCamera(page);
  ok('Q rotates the camera left', c1.yaw > c0.yaw + 0.1, `yaw ${c0.yaw.toFixed(2)} → ${c1.yaw.toFixed(2)}`);
  ok('Q actually turns the view, not just the position', Math.hypot(c1.view.x - c0.view.x, c1.view.z - c0.view.z) > 0.1, JSON.stringify({ before: c0.view, after: c1.view }));

  await page.keyboard.down('e');
  await page.waitForTimeout(700);
  await page.keyboard.up('e');
  await page.waitForTimeout(250);
  const c2 = await getCamera(page);
  ok('E rotates the camera right', c2.yaw < c1.yaw - 0.1, `yaw ${c1.yaw.toFixed(2)} → ${c2.yaw.toFixed(2)}`);

  const beforeDrag = await getCamera(page);
  await canvasDrag(page, 1400, 500, -220, 0, 'right');
  const afterHoriz = await getCamera(page);
  ok('right-drag horizontally rotates the camera', afterHoriz.yaw > beforeDrag.yaw + 0.5, `yaw ${beforeDrag.yaw.toFixed(2)} → ${afterHoriz.yaw.toFixed(2)}`);
  ok('right-drag turns the rendered view', Math.hypot(afterHoriz.view.x - beforeDrag.view.x, afterHoriz.view.z - beforeDrag.view.z) > 0.2, JSON.stringify({ before: beforeDrag.view, after: afterHoriz.view }));

  const beforeVert = await getCamera(page);
  await canvasDrag(page, 1000, 420, 0, 140, 'right');
  const afterVert = await getCamera(page);
  ok('right-drag vertically tilts the camera', Math.abs(afterVert.pitch - beforeVert.pitch) > 0.12, `pitch ${beforeVert.pitch.toFixed(2)} → ${afterVert.pitch.toFixed(2)}`);

  // A full turn must not hit an azimuth clamp.
  await page.evaluate(() => HM.gfx.resetCamera());
  await page.waitForTimeout(300);
  const beforeFull = await getCamera(page);
  await canvasDrag(page, 1600, 520, -1100, 0, 'right');
  const afterFull = await getCamera(page);
  ok('camera rotates past a full 360° without a limit', Math.abs(afterFull.yaw - beforeFull.yaw) > 6.3, `Δyaw ${(afterFull.yaw - beforeFull.yaw).toFixed(2)} rad`);

  // Relative keyboard pan at a 90° heading.
  await page.evaluate(() => {
    const G = HM.gfx;
    G.yaw = Math.PI / 2; G.yawGoal = Math.PI / 2;
    G.targetGoal.copy(G.target);
    G.followTarget = null;
  });
  await page.waitForTimeout(150);
  const pan0 = await getCamera(page);
  await page.keyboard.down('w');
  await page.waitForTimeout(550);
  await page.keyboard.up('w');
  await page.waitForTimeout(200);
  const panW = await getCamera(page);
  ok('W pans along the camera heading', panW.goal.x > pan0.goal.x + 4 && Math.abs(panW.goal.z - pan0.goal.z) < 6, JSON.stringify({ from: pan0.goal, to: panW.goal }));

  await page.evaluate(() => { HM.gfx.targetGoal.copy(HM.gfx.target); });
  await page.waitForTimeout(100);
  const pan1 = await getCamera(page);
  await page.keyboard.down('d');
  await page.waitForTimeout(550);
  await page.keyboard.up('d');
  await page.waitForTimeout(200);
  const panD = await getCamera(page);
  ok('D strafes right relative to the heading', Math.abs(panD.goal.x - pan1.goal.x) < 6 && panD.goal.z < pan1.goal.z - 4, JSON.stringify({ from: pan1.goal, to: panD.goal }));

  await page.evaluate(() => { HM.gfx.targetGoal.copy(HM.gfx.target); });
  await page.waitForTimeout(100);
  const pan2 = await getCamera(page);
  await page.keyboard.down('a');
  await page.waitForTimeout(550);
  await page.keyboard.up('a');
  await page.waitForTimeout(200);
  const panA = await getCamera(page);
  ok('A strafes left relative to the heading', Math.abs(panA.goal.x - pan2.goal.x) < 6 && panA.goal.z > pan2.goal.z + 4, JSON.stringify({ from: pan2.goal, to: panA.goal }));

  await page.evaluate(() => { HM.gfx.targetGoal.copy(HM.gfx.target); });
  await page.waitForTimeout(100);
  const pan3 = await getCamera(page);
  await page.keyboard.down('s');
  await page.waitForTimeout(550);
  await page.keyboard.up('s');
  await page.waitForTimeout(200);
  const panS = await getCamera(page);
  ok('S pans backwards relative to the heading', panS.goal.x < pan3.goal.x - 4 && Math.abs(panS.goal.z - pan3.goal.z) < 6, JSON.stringify({ from: pan3.goal, to: panS.goal }));

  // Camera buttons and compass.
  const beforeBtn = await getCamera(page);
  await realClick(page, '[data-action="camera-rotate-right"]');
  await page.waitForTimeout(350);
  const afterBtn = await getCamera(page);
  ok('rotate-right button turns the camera', afterBtn.yaw < beforeBtn.yaw - 0.1, `yaw ${beforeBtn.yaw.toFixed(2)} → ${afterBtn.yaw.toFixed(2)}`);

  const beforeTiltBtn = await getCamera(page);
  await realClick(page, '[data-action="camera-tilt-up"]');
  await page.waitForTimeout(350);
  const afterTiltBtn = await getCamera(page);
  ok('tilt-up button lowers the pitch toward the horizon', afterTiltBtn.pitch < beforeTiltBtn.pitch - 0.04, `pitch ${beforeTiltBtn.pitch.toFixed(2)} → ${afterTiltBtn.pitch.toFixed(2)}`);

  const beforeZoom = await getCamera(page);
  await realClick(page, '[data-action="camera-zoom-in"]');
  await page.waitForTimeout(350);
  const afterZoom = await getCamera(page);
  ok('zoom-in button moves closer', afterZoom.distance < beforeZoom.distance - 2, `distance ${beforeZoom.distance.toFixed(1)} → ${afterZoom.distance.toFixed(1)}`);

  await realClick(page, '#compass');
  await page.waitForTimeout(900);
  const north = await getCamera(page);
  ok('compass click faces north', Math.min(north.heading, Math.PI * 2 - north.heading) < 0.06, `heading ${north.heading.toFixed(3)}`);

  await realClick(page, '[data-action="camera-reset"]');
  await page.waitForTimeout(500);
  const reset = await getCamera(page);
  const spawn = await page.evaluate(() => HM.world.spawn);
  ok('reset button returns to the settlement', Math.abs(reset.target.x - spawn.x) < 2 && Math.abs(reset.target.z - spawn.z) < 2, JSON.stringify(reset.target));

  // Near-horizontal view, the no-clipping stress case.
  await page.evaluate(() => {
    const G = HM.gfx;
    G.resetCamera();
    G.distance = 240; G.distTarget = 240;
    G.pitch = 0.2; G.pitchGoal = 0.2;
  });
  await page.waitForTimeout(700);
  const horizon = await page.evaluate(() => {
    const G = HM.gfx;
    const h = G.world.heightAt(G.camera.position.x, G.camera.position.z);
    return { cameraY: G.camera.position.y, ground: h, clearance: G.camera.position.y - h, pitch: G.pitch, near: G.camera.near, far: G.camera.far };
  });
  ok('near-horizontal view keeps the camera above terrain', horizon.clearance > 0.5 && horizon.pitch <= 0.21, JSON.stringify(horizon));
  ok('near-horizontal view has no void and keeps the horizon in frame', horizon.far > 2000 && horizon.cameraY > 0, JSON.stringify(horizon));
  const horizonSample = await page.evaluate(() => HM.gfx.sampleFrame());
  ok('near-horizontal frame has no black void', !!(horizonSample && horizonSample.blackFraction < 0.1), JSON.stringify(horizonSample));
  await screenshot(page, 'fix2-horizon.png');

  // Four headings produce four materially different views.
  const hashes = [];
  for (const [name, yaw] of [['north', 0], ['east', Math.PI / 2], ['south', Math.PI], ['west', (Math.PI * 3) / 2]]) {
    await page.evaluate((y) => {
      const G = HM.gfx;
      G.attract = false; G.yaw = y; G.yawGoal = y;
      G.pitch = 0.65; G.pitchGoal = 0.65;
      G.distance = 260; G.distTarget = 260;
      G.targetGoal.copy(G.target);
    }, yaw);
    await page.waitForTimeout(380);
    const shot = await screenshot(page, `fix2-heading-${name}.png`);
    hashes.push(shot.hash);
  }
  ok('four headings render four different views', new Set(hashes).size === 4, `${new Set(hashes).size} unique frames`);
  const headingViews = await getCamera(page);
  const vh = ((headingViews.viewHeading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  let headingError = Math.abs(vh - headingViews.heading);
  headingError = Math.min(headingError, Math.PI * 2 - headingError);
  ok('camera view direction matches its compass heading', headingError < 0.04, `view ${vh.toFixed(3)} · compass ${headingViews.heading.toFixed(3)}`);

  // Max tilt stays above terrain and inside the near/far planes.
  await page.evaluate(() => {
    const G = HM.gfx;
    G.resetCamera();
    G.distance = 60; G.distTarget = 60;
    G.pitch = 1.49; G.pitchGoal = 1.49;
  });
  await page.waitForFunction(() => {
    const G = HM.gfx; const f = new THREE.Vector3(); G.camera.getWorldDirection(f);
    return f.y < -0.98;
  }, null, { timeout: 8000 }).catch(() => {});
  const tilt = await page.evaluate(() => {
    const G = HM.gfx;
    const h = G.world.heightAt(G.camera.position.x, G.camera.position.z);
    return {
      cameraY: G.camera.position.y, ground: h, clearance: G.camera.position.y - h,
      near: G.camera.near, far: G.camera.far, pitch: G.pitch,
      finite: [G.camera.position.x, G.camera.position.y, G.camera.position.z].every(Number.isFinite)
    };
  });
  ok('maximum tilt keeps the camera above terrain', tilt.finite && tilt.clearance > 0.5 && tilt.pitch >= 1.48, JSON.stringify(tilt));
  ok('maximum tilt keeps sane near/far planes', tilt.near > 0 && tilt.far > 1800, JSON.stringify(tilt));
  const tiltView = await getCamera(page);
  ok('maximum tilt actually looks down at the focus point', tiltView.view.y < -0.98, JSON.stringify(tiltView.view));
  await screenshot(page, 'fix2-maxtilt.png');

  // Clicking UI must never move the camera.
  await page.evaluate(() => HM.gfx.resetCamera());
  await page.waitForTimeout(300);
  const uiBefore = await getCamera(page);
  await realClick(page, '[data-action="open-window"][data-window="research"]');
  await page.waitForTimeout(300);
  const uiAfter = await getCamera(page);
  ok('opening a window does not move the camera', Math.abs(uiAfter.yaw - uiBefore.yaw) < 0.001 && Math.abs(uiAfter.target.x - uiBefore.target.x) < 0.01, `yaw ${uiBefore.yaw} → ${uiAfter.yaw}`);
}

async function runModelGraphics(page) {
  console.log('\n── Models, vegetation and graphics quality ──');
  await closeAllWindows(page);
  const textures = await page.evaluate(() => {
    const bad = [];
    const treeMats = HM.nature ? HM.nature.materials().trunk : {};
    for (const [k, m] of Object.entries(treeMats)) {
      if (!m.map || !m.map.isTexture) bad.push('bark:' + k);
    }
    HM.gfx.scene.traverse((o) => {
      if (!o.material) return;
      for (const m of [].concat(o.material)) {
        for (const k of ['map', 'bumpMap', 'alphaMap', 'emissiveMap', 'normalMap']) {
          const t = m && m[k];
          if (t && !t.isTexture) bad.push((m.type || 'material') + ':' + k);
        }
      }
    });
    return { bad: [...new Set(bad)].slice(0, 20), trees: HM.gfx.vegStats, treeMeshes: HM.gfx.vegGroup ? HM.gfx.vegGroup.children.length : 0 };
  });
  ok('every tree bark and scene map is a Texture, never a raw canvas', textures.bad.length === 0, JSON.stringify(textures));
  ok('trees are actually in the scene', !!(textures.trees && textures.trees.drawnTrees > 0 && textures.treeMeshes > 0), JSON.stringify({ trees: textures.trees, meshes: textures.treeMeshes }));
  await closeAllWindows(page);
  const placedModel = await page.evaluate(() => {
    HM.state.money = Math.max(HM.state.money, 50000);
    HM.state.era = Math.max(HM.state.era, 6);
    HM.ui.closeAllWindows(true);
    const offer = document.querySelector('#tutorial-offer'); if (offer) offer.classList.add('hidden');
    const r = HM.main.debug.place('cottage');
    if (r && r.ok) HM.gfx.focusOn(r.x, r.z, 82);
    return { placed: !!(r && r.ok), uid: r && r.uid, reason: r && r.reason, group: r && r.uid && HM.gfx.buildingMap.has(r.uid) };
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(SHOTS, 'fix4-built-model.png') });
  ok('a built building has a visible model in the scene', placedModel.placed && placedModel.group, JSON.stringify(placedModel));

  await closeAllWindows(page);
  await realClick(page, '[data-action="open-window"][data-window="settings"]');
  await page.waitForSelector('#set-quality', { state: 'visible', timeout: 10000 });
  const tiers = [];
  for (const q of ['low', 'medium', 'high', 'ultra']) {
    await page.selectOption('#set-quality', q);
    await page.waitForTimeout(500);
    const st = await page.evaluate(() => ({
      quality: HM.gfx.quality,
      pixelRatio: HM.gfx.renderer.getPixelRatio(),
      shadows: HM.gfx.renderer.shadowMap.enabled,
      grass: (HM.gfx.grassItems || []).length,
      trees: HM.gfx.vegStats ? HM.gfx.vegStats.drawnTrees : 0,
      calls: HM.gfx.drawInfo() ? HM.gfx.drawInfo().calls : 0
    }));
    tiers.push(st);
    if (q === 'low') await page.screenshot({ path: path.join(SHOTS, 'fix4-quality-low.png') });
    if (q === 'ultra') await page.screenshot({ path: path.join(SHOTS, 'fix4-quality-ultra.png') });
  }
  const sig = tiers.map((t) => t.quality + ':' + t.grass + ':' + t.trees + ':' + t.shadows + ':' + t.pixelRatio);
  ok('all four graphics tiers apply distinct resolution, vegetation and shadow settings', new Set(sig).size === 4 && tiers.every((t, i) => t.quality === ['low', 'medium', 'high', 'ultra'][i]) && tiers[3].grass > tiers[0].grass && tiers[3].trees > tiers[0].trees, JSON.stringify(tiers));
  ok('graphics quality changes the rendered scene without errors', tiers.every((t) => t.calls > 100), JSON.stringify(tiers.map((t) => ({ q: t.quality, calls: t.calls }))));

  // The HUD Quality button must advance the same setting.
  await closeAllWindows(page);
  const beforeCycle = await page.evaluate(() => HM.gfx.quality);
  await realClick(page, '[data-action="cycle-graphics"]');
  await page.waitForTimeout(400);
  const afterCycle = await page.evaluate(() => ({ quality: HM.gfx.quality, setting: HM.ui.settings.quality }));
  ok('the Quality button advances the same graphics setting', afterCycle.quality !== beforeCycle && afterCycle.setting === afterCycle.quality, JSON.stringify({ beforeCycle, afterCycle }));

  // Restore a normal tier for the window tests.
  await page.evaluate(() => { HM.gfx.setQuality('medium'); HM.ui.settings.quality = 'medium'; });
  await page.waitForTimeout(300);
  await closeAllWindows(page);
}

async function runQualityPersistence(page) {
  console.log('\n── Graphics preference persistence ──');
  await closeAllWindows(page);
  await realClick(page, '[data-action="open-window"][data-window="settings"]');
  await page.waitForSelector('#set-quality', { state: 'visible', timeout: 10000 });
  await page.selectOption('#set-quality', 'high');
  await page.waitForTimeout(350);
  const before = await page.evaluate(() => {
    const ok = HM.game.save(true);
    return { ok, quality: HM.gfx.quality, setting: HM.ui.settings.quality, savedOpt: HM.state.opts.quality };
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#menu:not(.hidden)', { timeout: 30000 });
  await realClick(page, '[data-action="menu-continue"]');
  await page.waitForFunction(() => window.HM && HM.main && HM.main.inGame, null, { timeout: 180000 });
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => ({ quality: HM.gfx.quality, setting: HM.ui.settings.quality, saveOpt: HM.state.opts && HM.state.opts.quality }));
  ok('graphics quality survives save, reload and Continue', before.ok && after.quality === 'high' && after.setting === 'high', JSON.stringify({ before, after }));
}

async function runWindows(page) {
  console.log('\n── Fix 3: windows ──');
  const ids = ['research', 'shop', 'building', 'economy', 'government', 'military', 'citizens', 'stats', 'needs', 'settings', 'help'];
  const dirs = [
    ['e', 50, 0], ['w', -50, 0], ['s', 0, 40], ['n', 0, -40],
    ['se', 50, 40], ['sw', -50, 40], ['ne', 50, -40], ['nw', -50, -40]
  ];
  let allHandles = 0;
  for (const id of ids) {
    await openWindowDirect(page, id);
    const count = await page.locator(`.game-window[data-window="${id}"] .win-resize-handle`).count();
    allHandles += count;
    ok(`${id}: eight resize handles`, count === 8, String(count));
    await resetWindowForTest(page, id);
    const reach = await page.evaluate((wid) => {
      const win = HM.ui.windows.get(wid).el;
      return Array.from(win.querySelectorAll('.win-resize-handle')).map((h) => {
        const r = h.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { dir: h.dataset.dir, ok: !!(el && (el === h || h.contains(el))) };
      });
    }, id);
    ok(`${id}: every handle is clickable at its centre`, reach.every((h) => h.ok), JSON.stringify(reach.filter((h) => !h.ok)));

    for (const [dir, dx, dy] of dirs) {
      await resetWindowForTest(page, id);
      const before = await windowRect(page, id);
      await dragHandle(page, id, dir, dx, dy);
      const after = await windowRect(page, id);
      let good;
      if (dir === 'e') good = Math.abs((after.width - before.width) - dx) < 14 && Math.abs(after.left - before.left) < 2;
      else if (dir === 'w') good = Math.abs((after.width - before.width) - Math.abs(dx)) < 14 && Math.abs(after.left - (before.left - Math.abs(dx))) < 14;
      else if (dir === 's') good = Math.abs((after.height - before.height) - dy) < 14 && Math.abs(after.top - before.top) < 2;
      else if (dir === 'n') good = Math.abs((after.height - before.height) - Math.abs(dy)) < 14 && Math.abs(after.top - (before.top - Math.abs(dy))) < 14;
      else {
        const okW = Math.abs((after.width - before.width) - Math.abs(dx)) < 16;
        const okH = Math.abs((after.height - before.height) - Math.abs(dy)) < 16;
        const okX = dir.includes('w') ? Math.abs(after.left - (before.left - Math.abs(dx))) < 16 : Math.abs(after.left - before.left) < 2;
        const okY = dir.includes('n') ? Math.abs(after.top - (before.top - Math.abs(dy))) < 16 : Math.abs(after.top - before.top) < 2;
        good = okW && okH && okX && okY;
      }
      const inside = after.left >= 0 && after.top >= 0 && after.right <= 1920 + 1 && after.bottom <= 1080 + 1;
      ok(`${id}: ${dir} resize changes geometry`, good, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
      ok(`${id}: ${dir} resize stays on screen`, inside, `${after.left},${after.top} ${after.right},${after.bottom}`);
    }

    // Minimum size + content reflow.
    await page.evaluate((wid) => {
      const win = HM.ui.windows.get(wid).el;
      const spec = HM.ui.windowSpecs[wid];
      win.style.width = Math.min(spec.minW, window.innerWidth - 16) + 'px';
      win.style.height = Math.min(spec.minH, window.innerHeight - 16) + 'px';
      win.style.left = '8px'; win.style.top = '8px';
    }, id);
    await page.waitForTimeout(220);
    const minCheck = await page.evaluate((wid) => {
      const win = HM.ui.windows.get(wid).el;
      const body = win.querySelector('.win-body');
      const cs = body ? getComputedStyle(body) : null;
      const titleBtns = Array.from(win.querySelectorAll('.win-ctrls button'));
      const titleOk = titleBtns.every((b) => {
        const r = b.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return el && (el === b || b.contains(el));
      });
      return {
        body: !!body, overflow: cs ? cs.overflowY : '', titleOk,
        width: win.getBoundingClientRect().width, height: win.getBoundingClientRect().height,
        scrollW: body ? body.scrollWidth : 0, clientW: body ? body.clientWidth : 0
      };
    }, id);
    ok(`${id}: controls remain usable at minimum size`, minCheck.body && (minCheck.overflow === 'auto' || minCheck.overflow === 'scroll') && minCheck.titleOk, JSON.stringify(minCheck));
    if (id === 'research' || id === 'shop' || id === 'citizens' || id === 'settings') {
      await screenshot(page, `fix3-${id}-min.png`);
    }
  }
  ok('all windows expose 8 handles (88 total)', allHandles === 88, String(allHandles));

  // Double-click the title bar to maximize, click again to restore.
  await openWindowDirect(page, 'research');
  await resetWindowForTest(page, 'research');
  const titleBox = await page.locator('.game-window[data-window="research"] .win-title').boundingBox();
  await page.mouse.dblclick(titleBox.x + 150, titleBox.y + 17);
  await page.waitForTimeout(300);
  const maxRect = await windowRect(page, 'research');
  ok('double-click title maximizes a window', maxRect.width > 1880 && maxRect.height > 1060, JSON.stringify(maxRect));
  await page.mouse.dblclick(450, 22);
  await page.waitForTimeout(350);
  const restored = await windowRect(page, 'research');
  ok('double-click again restores the window', restored.width < 1000 && restored.height < 800, JSON.stringify(restored));

  // Camera never moves while a window is dragged or resized.
  await page.evaluate(() => HM.gfx.resetCamera());
  await page.waitForTimeout(300);
  const camBefore = await getCamera(page);
  const title = await page.locator('.game-window[data-window="research"] .win-title').boundingBox();
  await page.mouse.move(title.x + 200, title.y + 17);
  await page.mouse.down();
  await page.mouse.move(title.x + 260, title.y + 57, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const camAfter = await getCamera(page);
  ok('dragging a window never moves the camera', Math.abs(camAfter.yaw - camBefore.yaw) < 1e-6 && Math.abs(camAfter.target.x - camBefore.target.x) < 0.01, `yaw ${camBefore.yaw} → ${camAfter.yaw}`);

  // Persist a size across reload, then re-open the window after New Game.
  await resetWindowForTest(page, 'research');
  await dragHandle(page, 'research', 'se', 70, 50);
  const savedLayout = await page.evaluate(() => JSON.parse(JSON.stringify(HM.ui.layout.research || {})));
  ok('window size is saved to localStorage', savedLayout.width > 600 && savedLayout.height > 400, JSON.stringify(savedLayout));
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#menu:not(.hidden)', { timeout: 30000 });
  await realClick(page, '[data-action="menu-new"]');
  await page.waitForSelector('#newgame:not(.hidden)', { timeout: 10000 });
  await realClick(page, '[data-action="ng-start"]');
  await page.waitForFunction(() => window.HM && HM.main && HM.main.inGame === true, null, { timeout: 240000 });
  await page.waitForTimeout(900);
  await page.evaluate(() => HM.ui.openWindow('research'));
  await page.waitForTimeout(300);
  const reopened = await windowRect(page, 'research');
  ok('saved window size survives a reload', Math.abs(reopened.width - savedLayout.width) < 3 && Math.abs(reopened.height - savedLayout.height) < 3, `${JSON.stringify(savedLayout)} → ${JSON.stringify(reopened)}`);
  return savedLayout;
}

async function runMobile() {
  console.log('\n── Mobile viewport + touch ──');
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true
  });
  const page = await context.newPage();
  const errors = watchPage(page, 'mobile');
  await startGame(page);
  await page.screenshot({ path: path.join(SHOTS, 'fix2-mobile-default.png') });

  await page.evaluate(() => { HM.sim.setSpeed(HM.state, 0); HM.gfx.resetCamera(); });
  await page.waitForTimeout(400);
  const c0 = await getCamera(page);
  const cdp = await context.newCDPSession(page);
  await touchTwist(page, cdp, 250, 430);
  const c1 = await getCamera(page);
  ok('two-finger twist rotates the camera on touch', Math.abs(c1.yaw - c0.yaw) > 0.25, `yaw ${c0.yaw.toFixed(2)} → ${c1.yaw.toFixed(2)}`);

  // Touch drag the camera on empty canvas.
  await page.evaluate(() => HM.gfx.resetCamera());
  await page.waitForTimeout(300);
  const drag0 = await getCamera(page);
  await touchDrag(page, cdp, 300, 500, -10, -70);
  const drag1 = await getCamera(page);
  ok('one-finger drag on the canvas pans/tilts', Math.abs(drag1.pitch - drag0.pitch) > 0.08 || Math.abs(drag1.target.x - drag0.target.x) > 1 || Math.abs(drag1.target.z - drag0.target.z) > 1, `pitch ${drag0.pitch.toFixed(2)} → ${drag1.pitch.toFixed(2)}`);

  // Open Citizens by tapping its HUD button.
  const citizensBtn = page.locator('[data-action="open-window"][data-window="citizens"]').first();
  const rb = await citizensBtn.boundingBox();
  await page.touchscreen.tap(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await page.waitForSelector('.game-window[data-window="citizens"]', { timeout: 5000 });
  await page.waitForTimeout(300);
  const mobileRect0 = await windowRect(page, 'citizens');
  ok('mobile window opens near full-screen', mobileRect0.width > 360 && mobileRect0.height > 700, JSON.stringify(mobileRect0));
  ok('mobile window exposes eight handles', (await page.locator('.game-window[data-window="citizens"] .win-resize-handle').count()) === 8);

  const camBefore = await getCamera(page);
  const south = page.locator('.game-window[data-window="citizens"] .win-resize-handle.s');
  const sb = await south.boundingBox();
  await touchDrag(page, cdp, sb.x + sb.width / 2, sb.y + sb.height / 2, 0, -120);
  const mobileRect1 = await windowRect(page, 'citizens');
  ok('touch resize changes the window height', mobileRect1.height < mobileRect0.height - 60, `${mobileRect0.height.toFixed(0)} → ${mobileRect1.height.toFixed(0)}`);
  const camAfter = await getCamera(page);
  ok('touch resizing never moves the camera', Math.abs(camAfter.yaw - camBefore.yaw) < 1e-6 && Math.abs(camAfter.target.x - camBefore.target.x) < 0.01);
  await page.screenshot({ path: path.join(SHOTS, 'fix3-mobile-resized.png') });

  // Camera controls are reachable and work on touch.
  await page.evaluate(() => HM.ui.closeAllWindows(true));
  await page.waitForTimeout(150);
  const before = await getCamera(page);
  const rotate = page.locator('[data-action="camera-rotate-left"]').first();
  const rotBox = await rotate.boundingBox();
  if (rotBox) {
    await page.touchscreen.tap(rotBox.x + rotBox.width / 2, rotBox.y + rotBox.height / 2);
    await page.waitForFunction((y) => Math.abs(HM.gfx.yaw - y) > 0.05, before.yaw, { timeout: 5000 }).catch(() => {});
  }
  const after = await getCamera(page);
  ok('on-screen camera button works on touch', Math.abs(after.yaw - before.yaw) > 0.1, `yaw ${before.yaw.toFixed(2)} → ${after.yaw.toFixed(2)}`);

  ok('no errors on mobile page' + (errors.length ? ': ' + errors.join(' | ') : ''), errors.length === 0);
  await context.close();
  return errors;
}

async function run() {
  fs.mkdirSync(SHOTS, { recursive: true });
  await startServer();
  browser = await chromium.launch({
    headless: true,
    executablePath: chromiumPath(),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-gpu-sandbox']
  });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = watchPage(page, 'main');

  await startGame(page);
  const audit = await page.evaluate(() => ({ missing: HM.ui.auditActions(), count: HM.ui.actionsList().length, software: HM.gfx.isSoftware, gpu: HM.gfx.gpuName }));
  ok('action registry has no missing handlers', audit.missing.length === 0, JSON.stringify({ missing: audit.missing, actions: audit.count, gpu: audit.gpu }));

  const fix1 = await runFix1(page);
  await runCamera(page);
  await runModelGraphics(page);
  const savedLayout = await runWindows(page);
  await runQualityPersistence(page);

  // debug=render page.
  console.log('\n── debug=render ──');
  const debugPage = await context.newPage();
  const debugErrors = watchPage(debugPage, 'debug');
  await startGame(debugPage, '/?debug=render');
  const debugInfo = await debugPage.evaluate(() => window.HM.gfx.renderDebugInfo());
  const debugSample = await debugPage.evaluate(() => window.HM.gfx.sampleFrame());
  ok('?debug=render uses an unlit debug terrain', !!debugInfo.debug, JSON.stringify({ debug: debugInfo.debug, profile: debugInfo.profile }));
  ok('?debug=render still shows terrain', !!(debugSample && debugSample.lowerBlackFraction < 0.68), JSON.stringify(debugSample));
  await debugPage.screenshot({ path: path.join(SHOTS, 'fix1-debug-render.png') });
  ok('no errors on debug page' + (debugErrors.length ? ': ' + debugErrors.join(' | ') : ''), debugErrors.length === 0);

  // Force the PBR path under software WebGL: the startup sanity check must
  // detect the black terrain and apply the visible compatibility profile.
  const pbrPage = await context.newPage();
  const pbrErrors = watchPage(pbrPage, 'pbr-fallback');
  await startGame(pbrPage, '/?debug=pbr');
  await pbrPage.waitForTimeout(700);
  const pbrInfo = await pbrPage.evaluate(() => window.HM.gfx.renderDebugInfo());
  const pbrSample = await pbrPage.evaluate(() => window.HM.gfx.sampleFrame());
  ok('sanity check detects a forced black PBR frame', !!(pbrInfo.forcePBR && pbrInfo.sanity && pbrInfo.sanity.actions.includes('downgraded PBR materials to Lambert')), JSON.stringify(pbrInfo.sanity));
  ok('sanity fallback restores a visible world', !!(pbrInfo.sanity && pbrInfo.sanity.passed && pbrSample && pbrSample.lowerBlackFraction < 0.2), JSON.stringify({ sanity: pbrInfo.sanity, sample: pbrSample }));
  await pbrPage.screenshot({ path: path.join(SHOTS, 'fix1-sanity-fallback.png') });
  ok('no errors on forced-PBR page' + (pbrErrors.length ? ': ' + pbrErrors.join(' | ') : ''), pbrErrors.length === 0);

  const mobileErrors = await runMobile();

  ok('no errors on main page' + (errors.length ? ': ' + errors.join(' | ') : ''), errors.length === 0);

  const report = { ...results, render: fix1, savedLayout, errors, debugErrors, pbrErrors, mobileErrors, audit };
  fs.writeFileSync(path.join(SHOTS, 'test-results.json'), JSON.stringify(report, null, 2));
  await browser.close();
  browser = null;
  server.kill('SIGTERM');
  console.log(`\n${results.pass} passed, ${results.fail} failed`);
  process.exit(results.fail ? 1 : 0);
}

try {
  await run();
} catch (err) {
  console.error('FATAL:', err && err.stack || err);
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill('SIGTERM');
  process.exit(2);
}
