# Bug log — revision round 3

Every entry below was reproduced in Chromium through the normal interface before it was fixed, and now has a named regression check in `tests/groups.mjs` group 8.

## BUG-1 — Fulfilling a citizen request threw a fatal error

**Symptom.** Pressing “Help with Water · 40 coins” (and the equivalent button for every other need) removed the request and charged the coins, then logged:

```
Action failed: citizen-fulfill ReferenceError: renderWindow is not defined
    at js/ui-panels.js:740
```

The UI treated it as a fatal action error, so the window did not re-render correctly.

**Cause.** `citizen-fulfill` called the private `renderWindow()` from `js/ui.js`, which is not in scope in `js/ui-panels.js`. Every other action in that module correctly calls `UI.renderWindow()`.

**Fix.** Call `UI.renderWindow('citizens')` after `UI.refresh()`. Rewards are still applied once, before the alert is emitted, and the request is cleared before the re-render. `tests/groups.mjs` “R3-1” clicks the real button and checks the console, the charge, the cleared request and the single fulfilment counter.

## BUG-2 — A single click on a gate, tower, bastion or barricade placed nothing

**Symptom.** Selecting a wall-category piece and clicking once produced no wall and no clear refusal. Only dragging at least four metres worked.

**Cause.** Every wall item used the line tool. `onWallPointerDown` stored a start point and waited for a drag; on pointer-up at the same spot the plan length was zero, so `finishWall` silently discarded it.

**Fix.** Single-piece definitions (`wallSingle`) now build a piece centred on the click, aligned across the view. The preview is shown on pointer-down, the same validator refuses water, steep ground, buildings and foreign territory, and the piece commits on pointer-up. Line walls (palisades, curtain walls, moats) still use drag. “R3-4” places all seven single-piece types with real mouse clicks.

## BUG-3 — Construction never completed

**Symptom.** Buildings under construction reached 100% progress but kept their scaffold, never produced, housed anyone or finished their completion alert.

**Cause.** `advanceConstruction` set `buildProgress = 1` and then called `finishConstruction`, whose first guard rejected anything that was no longer under construction. The completion code was therefore unreachable.

**Fix.** `finishConstruction` accepts `buildProgress >= 1`; the construction loop remains the only caller. Completion now swaps the scaffold model for the finished one, refreshes roads, assigns jobs and moves the first residents in. “R2-14” checks scaffolding, mid-progress, completion and scaffold removal.

## BUG-4 — Cars appeared on every new road

**Symptom.** Laying any road spawned motor traffic in the Stone Age, with no factory, dealership or households.

**Cause.** `setupTraffic` created vehicles from road segments alone; era only changed the body shape.

**Fix.** Vehicles are now an owned fleet (`state.vehicles`). Carts require a finished cartwright; cars require a finished car factory **and** a car dealership, steel in stock and households; buses, trucks and taxis require their own depot or stand. Roads with no fleet show pedestrians only. Existing saves migrate to an empty fleet without errors. “R3-3” checks zero cars before the pair, zero with the factory alone, and cars only after the dealership.

## BUG-5 — Rain only covered the old camera position when zoomed out

**Symptom.** Zooming out in rain left a small rain patch around the last ground-level camera target while the rest of the visible map was dry.

**Cause.** The rain and snow particle volumes were fixed 240 m / 220 m boxes parented to the camera target and never scaled.

**Fix.** Both volumes now scale with camera altitude and the actual camera footprint, and particle size grows with the footprint. Near ground the volume is unchanged; at maximum zoom it covers the whole visible map. “R3-5” compares near and far volume sizes and checks coverage of the camera rectangle.

## BUG-6 — No trees or buildings rendered (the whole frame aborted at the first trunk)

**Symptom.** Grass, terrain and part of the sky drew, but every tree was missing and player buildings, people and roads after the vegetation in the render list never appeared. The console showed `Cannot read properties of undefined (reading 'elements')` from `WebGLRenderer` every frame.

**Cause.** `js/nature.js` stored raw `HTMLCanvasElement` bark canvases in `TEX.bark`, and `barkMaterial()` passed those canvases directly as `material.map`. Three expects a `Texture` and reads `map.matrix` while uploading material uniforms; it throws on the canvas, aborting the remaining scene draw.

**Fix.** Wrap every bark canvas in a `CanvasTexture` (`TEX.bark[k] = canvasTexture(bark[k])`) and keep the bump path on the source canvas. Regression checks in `tests/smoke.mjs` traverse every scene material and assert `map`, `bumpMap`, `alphaMap`, `emissiveMap` and `normalMap` are real textures, then place and render a real building.

## BUG-7 — Graphics quality did nothing on software WebGL

**Symptom.** Selecting Low, Medium, High or Ultra in Settings changed the label and saved the setting, but the image, vegetation count, pixel ratio and shadows stayed identical. The HUD Quality button had the same problem.

**Cause.** `G.setQuality()` forced every `isSoftware` browser to pixel ratio 1, the same fixed vegetation caps, and shadows off regardless of the selected tier. On a machine falling back to SwiftShader, all four settings resolved to the same renderer state.

**Fix.** Software tiers now have separate internal resolutions (0.5/0.6/0.72/0.85), tree caps (700/1100/1600/2200), bush caps, grass caps, people caps and an Ultra shadow pass. Hardware keeps the full quality table. The setting still persists in localStorage. `tests/smoke.mjs` checks all four tiers apply distinct settings, that the HUD Quality button advances the same value, and saves low/ultra screenshots.

## BUG-8 — A bridge that reached the end of its segment was treated as a dry grade over water

**Symptom.** The road preview for a coastal bridge reported “Ready”, `bridge: false`, no piers and a normal earthwork cost even though most of the line crossed water.

**Cause.** `mergeRuns()` in `js/roadgrade.js` only closed a run when it saw a false sample. A bridge or tunnel run touching the last sample had no closing false sample, so it was dropped. Bridge flags were set but the run list stayed empty, `plan.bridge` became false, and the Grade path cleared the flags.

**Fix.** Flush an open run after the loop (`i1 = n`). The over-long wooden bridge is now flagged as a bridge, given a real span and rejected with the right reason; valid spans build decks and piers. The existing `tests/groups.mjs` over-long bridge and bridge-pier checks now pass.

## BUG-9 — Graphics quality reverted after save, reload and Continue

**Symptom.** Changing quality in Settings, saving and reloading restored the quality the world had been created with, not the player's current choice.

**Cause.** `loadGame()` preferred `data.opts.quality` from the save file, while changing the dropdown only updated `UI.settings.quality` in localStorage and not the live state's `opts.quality`.

**Fix.** Changing quality now also updates the live `state.opts.quality`, and loading deliberately prefers the current interface preference because graphics quality is not a property of the world. `tests/smoke.mjs` saves at High, reloads, presses Continue and asserts both the setting and renderer stay High.
