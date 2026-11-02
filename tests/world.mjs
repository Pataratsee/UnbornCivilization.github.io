#!/usr/bin/env node
/**
 * Unborn Civilization — deterministic world-generation checks.
 *
 *   node tests/world.mjs
 *
 * Runs the real browser world generator under a tiny THREE shim (generation
 * itself never renders) and asserts the terrain contract: gentle, mostly
 * buildable land, a few real mountains, ocean at every border, fresh water and
 * a flat starting shelf.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(name, condition, detail) {
  if (condition) { pass++; console.log(`PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// ── minimal browser shim ────────────────────────────────────────────────────
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  normalize() { const l = Math.hypot(this.x, this.y, this.z) || 1; this.x /= l; this.y /= l; this.z /= l; return this; }
}
class Color {
  constructor(hex) { this.set(hex); }
  set(hex) { if (typeof hex === 'number') { this.r = ((hex >> 16) & 255) / 255; this.g = ((hex >> 8) & 255) / 255; this.b = (hex & 255) / 255; } return this; }
  clone() { const c = new Color(0); c.r = this.r; c.g = this.g; c.b = this.b; return c; }
  lerp() { return this; }
  getHexString() { return '000000'; }
}
const THREE = { Vector3, Color, CanvasTexture: class {}, RepeatWrapping: 1000, sRGBEncoding: 3001 };
const canvasStub = { width: 0, height: 0, getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, drawImage() {}, getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), fillRect() {}, fillStyle: '' }) };
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  performance,
  THREE,
  Math,
  Date,
  window: {},
  document: { createElement: () => Object.assign({}, canvasStub) }
};
sandbox.window.HM = {};
sandbox.window.THREE = THREE;
sandbox.self = sandbox.window;
vm.createContext(sandbox);
for (const f of ['js/util.js', 'js/world.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const HM = sandbox.window.HM;

// ── generate the default world exactly as the game does ─────────────────────
const seed = HM.world.DEFAULT_SEED || 'unborn';
const world = HM.world.create(seed, { size: 2048, seaLevel: 0.42, resources: 1, quality: 'medium', terrain: 'rolling' });
await world.genElevation();
await world.genBiomes();
world.findSpawn();
await world.genResources();

const N = HM.world.GRID;
let land = 0, buildable = 0, steep = 0, mountain = 0, snow = 0, beach = 0, maxSlopeLand = 0;
let borderLand = 0, borderTiles = 0;
const slopeBins = [0, 0, 0, 0];
for (let iz = 0; iz < N; iz++) {
  for (let ix = 0; ix < N; ix++) {
    const i = ix + iz * N;
    const x = ix * world.cell - world.half, z = iz * world.cell - world.half;
    const h = world.heights[i];
    const borderTile = ix < 10 || iz < 10 || ix >= N - 10 || iz >= N - 10;
    if (borderTile) { borderTiles++; if (h > 0.2) borderLand++; }
    if (h <= 0.45) continue;
    land++;
    const s = world.slopeAt(x, z);
    if (s <= 0.62) buildable++; else steep++;
    if (s > maxSlopeLand) maxSlopeLand = s;
    if (s <= 0.15) slopeBins[0]++; else if (s <= 0.3) slopeBins[1]++; else if (s <= 0.62) slopeBins[2]++; else slopeBins[3]++;
    if (h > 56) mountain++;
    if (h > 88) snow++;
    if (h >= 0.45 && h < 3.1) beach++;
  }
}
const pct = (n) => (n / Math.max(1, land) * 100).toFixed(1) + '%';
console.log(`\nland ${land} tiles · buildable ${pct(buildable)} · steep ${pct(steep)} · mountain ${pct(mountain)} · snow ${pct(snow)} · beach ${pct(beach)} · max slope ${maxSlopeLand.toFixed(2)}`);
console.log(`slope distribution ≤0.15 ${pct(slopeBins[0])} · ≤0.30 ${pct(slopeBins[1])} · ≤0.62 ${pct(slopeBins[2])} · >0.62 ${pct(slopeBins[3])}\n`);

ok('land covers a large part of the chart', land > N * N * 0.28, (land / (N * N) * 100).toFixed(1) + '% of the chart');
ok('at least 70% of land is directly buildable (slope ≤ 0.62)', buildable / land >= 0.70, pct(buildable));
ok('most land is gently rolling (slope ≤ 0.30)', (slopeBins[0] + slopeBins[1]) / land >= 0.80, pct(slopeBins[0] + slopeBins[1]));
ok('mountain ranges exist', mountain / land > 0.012, `${mountain} tiles above 56 m (${pct(mountain)})`);
ok('the highest peaks carry snow', snow > 40, `${snow} tiles above 88 m`);
ok('beaches exist along the shore', beach > land * 0.01, `${beach} beach tiles`);
ok('every border tile is ocean', borderLand === 0, `${borderLand} land tiles on the outer ring`);
ok('the default world is the Earth map', world.worldType === 'earth', world.worldType);
ok('many rivers run through the world', world.rivers.length >= 5, `${world.rivers.length} rivers`);
let badRiver = null;
for (const r of world.rivers) {
  const pts = r.points || [];
  if (pts.length < 4) { badRiver = 'short river'; break; }
  if (!(r.endH < r.sourceH)) { badRiver = `river does not descend (${r.sourceH.toFixed(1)} → ${r.endH.toFixed(1)})`; break; }
  if (r.mouth !== 'sea' && r.mouth !== 'lake') { badRiver = `river ends in ${r.mouth}`; break; }
}
ok('every river flows downhill into the sea or a lake', !badRiver, badRiver || `${world.rivers.length} rivers, ${world.rivers.filter((r) => r.mouth === 'sea').length} reach the sea`);
ok('lakes and inland seas are plentiful', world.lakes.length >= 10, `${world.lakes.length} lakes`);

// Shore slope: sample the band just above the waterline around every lake.
let shoreN = 0, shoreSum = 0, shoreMax = 0, shoreSteep = 0;
for (const lake of world.lakes) {
  const cx = lake.x * world.size - world.half, cz = lake.z * world.size - world.half, r = lake.r * world.size;
  for (let a = 0; a < 28; a++) {
    const ang = a / 28 * Math.PI * 2;
    for (const mult of [1.0, 1.3, 1.7]) {
      const x = cx + Math.cos(ang) * r * mult, z = cz + Math.sin(ang) * r * mult;
      if (world.heightAt(x, z) <= 0.5) continue;
      const s = world.slopeAt(x, z);
      shoreN++; shoreSum += s; shoreMax = Math.max(shoreMax, s);
      if (s > 0.62) shoreSteep++;
    }
  }
}
ok('lake and river shores are gentle enough to build on', shoreN > 100 && shoreSum / shoreN < 0.45 && shoreSteep / shoreN < 0.2, `${shoreN} samples · mean ${(shoreSum / shoreN).toFixed(2)} · steep ${(shoreSteep / shoreN * 100).toFixed(1)}%`);
ok('mountains are a minority of the land', mountain / land < 0.22, pct(mountain));

const sp = world.spawn;
const spawnH = world.heightAt(sp.x, sp.z);
const spawnSlope = world.slopeAt(sp.x, sp.z);
let spawnMin = Infinity, spawnMax = -Infinity;
for (let a = 0; a < 24; a++) {
  const ang = a / 24 * Math.PI * 2;
  for (const r of [30, 60, 90, 120]) {
    const h = world.heightAt(sp.x + Math.cos(ang) * r, sp.z + Math.sin(ang) * r);
    spawnMin = Math.min(spawnMin, h); spawnMax = Math.max(spawnMax, h);
  }
}
const coast = world.findCoast(sp.x, sp.z, 240);
let nearestPeak = Infinity;
for (const r of world.ranges) nearestPeak = Math.min(nearestPeak, Math.hypot(r.x * world.size - world.half - sp.x, r.z * world.size - world.half - sp.z));
console.log(`spawn (${sp.x.toFixed(0)}, ${sp.z.toFixed(0)}) h ${spawnH.toFixed(1)} slope ${spawnSlope.toFixed(3)} relief ${(spawnMax - spawnMin).toFixed(1)} m · water ${coast ? coast.d.toFixed(0) + ' m' : 'none'} · nearest range ${nearestPeak.toFixed(0)} m`);
ok('starting site is flat and buildable', spawnSlope < 0.12, `slope ${spawnSlope.toFixed(3)}`);
ok('starting shelf is broad and level', spawnMax - spawnMin < 14, `${(spawnMax - spawnMin).toFixed(1)} m over 120 m`);
ok('starting site has fresh water nearby', !!coast && coast.d < 240, coast ? `${coast.d.toFixed(0)} m` : 'none');
ok('a mountain range is visible from the starting site', nearestPeak > 180 && nearestPeak < 900, `${nearestPeak.toFixed(0)} m`);
ok('starting area carries resources', world.trees.length > 400 && world.deposits.length > 10, `${world.trees.length} trees, ${world.deposits.length} deposits`);

// determinism: the same seed must rebuild the same height field
const again = HM.world.create(seed, { size: 2048, seaLevel: 0.42, resources: 1, quality: 'medium', terrain: 'rolling' });
await again.genElevation();
let same = true;
for (let i = 0; i < world.heights.length; i += 97) if (Math.abs(world.heights[i] - again.heights[i]) > 1e-6) { same = false; break; }
ok('generation is deterministic for a seed', same);
const other = HM.world.create(seed + '-other', { size: 2048, seaLevel: 0.42, resources: 1, quality: 'medium', terrain: 'rolling' });
await other.genElevation();
let differs = 0;
for (let i = 0; i < world.heights.length; i += 997) if (Math.abs(world.heights[i] - other.heights[i]) > 1) differs++;
ok('a different seed builds a different world', differs > 100, `${differs} sampled tiles differ`);

for (const style of ['flat', 'rolling', 'hilly']) {
  const w2 = HM.world.create(seed + ':' + style, { size: 2048, seaLevel: 0.42, resources: 1, quality: 'medium', terrain: style });
  await w2.genElevation();
  let l2 = 0, b2 = 0, m2 = 0, relief = 0;
  for (let iz = 0; iz < N; iz += 2) for (let ix = 0; ix < N; ix += 2) {
    const i = ix + iz * N; const h = w2.heights[i];
    if (h <= 0.45) continue;
    l2++;
    const s = w2.slopeAt(ix * w2.cell - w2.half, iz * w2.cell - w2.half);
    if (s <= 0.62) b2++;
    if (h > 56) m2++;
    if (h > relief) relief = h;
  }
  console.log(`terrain "${style}": buildable ${(b2 / l2 * 100).toFixed(1)}% · mountains ${(m2 / l2 * 100).toFixed(1)}% · peak ${relief.toFixed(0)} m`);
  ok(`terrain preset "${style}" keeps land buildable`, b2 / l2 > 0.70, (b2 / l2 * 100).toFixed(1) + '%');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
