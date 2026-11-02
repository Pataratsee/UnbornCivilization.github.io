# Resume state — round 3

Last verified commit: `d3e8a11 Add junction crosswalks, a model viewer and a monkey check`, plus the working tree described below.

## Current verified state

- `node tests/groups.mjs all`: **109 passed, 0 failed**.
- `npm test` (`tests/smoke.mjs`): **271 passed, 0 failed** as of the latest run; the new model/bark, graphics-tier and quality-persistence checks are part of it.
- `node tests/monkey.mjs`: **5 passed, 0 failed** (1,200 mixed actions, two-year simulation soak, save/reload, viewer).
- Latest screenshots: `shots/fix4-quality-low.png`, `shots/fix4-quality-ultra.png`, `shots/fix4-built-model.png`, `shots/bugfix-town.png`, `shots/an-viewer-buildings.png`.

## Test baseline

- `node tests/groups.mjs all` before the round-3 repair batch: **100 passed, 1 failed** (the old water assertion expected one mesh; highland lakes legitimately add shared-material meshes).
- `tests/smoke.mjs` covers boot, windows, camera, placement, speeds, graphics tiers and screenshots; it is not replaced by the group suite.

## Completed in this round

1. **Citizen request fulfilment** — root cause was a private `renderWindow` call in `ui-panels.js`; now `UI.renderWindow`. Test: R3-1.
2. **Research tree** — 152 new techs across eight branches (Trade, Construction, Energy, Transport, Education, Communication, Defense, Environment), 192 total, acyclic and fully reachable. Every tech has a working effect, an unlock or an era advance. Test: R3-2.
3. **Owned vehicles** — carts need a cartwright; cars need a car factory **and** a dealership plus steel and households; buses/trucks/taxis need their depot/stand. Added Car Dealership, Cartwright Workshop, Truck Yard and Taxi Stand. Test: R3-3.
4. **Wall placement** — gates, towers, bastions, barricades and spikes now place on a single real click; line walls still drag. All seven single types tested. Test: R3-4.
5. **Rain/snow coverage** — particle volumes scale with camera altitude and footprint; maximum zoom covers the whole visible map. Test: R3-5.
6. **Dropdowns close on mode change** — one `UI.closeDropdowns()` called from every build, road, wall, terrain and demolish entry point. Test: R3-6.
7. **Construction** — builds over game hours, scaffolding/builders/dust/sound, no function until complete, saved progress, completion swaps the model and moves residents in. Fixed the guard that made completion unreachable. Test: R2-14.
8. **Territory, sea-level lakes and double prices** — territory tab and foreign-build refusal, shared-material highland lakes, `PRICE_MULTIPLIER = 2` and migrated saves.
9. **Crosswalks and all wall types** — junction stripes welded into one geometry; all seven single-piece wall types and all eight dragged wall/moat types are tested with real input.
10. **Model viewer and monkey check** — `models.html` lists 258 unique building styles with orbit, night, wireframe and live geometry counts. `tests/monkey.mjs` performs 1,200 mixed actions and a two-year soak with zero errors.
11. **Missing models and trees** — bark canvases are now real textures; the frame no longer aborts at the first trunk. Verified by scene-wide texture checks, a placed building screenshot and the restored tree batches. See BUG-6.
12. **Graphics quality** — software WebGL now has four distinct tiers (resolution, shadows, trees, bushes, grass, people), the HUD Quality button changes the same setting, and the choice survives save, reload and Continue. Verified across all four tiers with screenshots. See BUG-7 and BUG-9.
13. **Bridge endpoint runs** — bridge/tunnel runs that touch the final road sample are no longer dropped; over-long spans are rejected with a real bridge span and cost. See BUG-8.

## Not finished

- Sidewalk-following pedestrian pathfinding and crossing queues (visual sidewalks exist).
- Full resource/receipt system, mining category, surveying and depletion (R2-15/16).
- Quest-driven research points and tracker (R2-17).
- Nation loans, credit and default war (R2-18).
- Ships and docks (R2-20).
- Rare disasters and their setting (R2-21).
- The 100× building / 10× people, car and animal model rebuild. A viewer exists, but geometry is still low-poly and has one LOD. No reference pictures exist; see `REFERENCES.md`.
- Rendered ten-year 20× soak; the current monkey soak advances two years directly.
- Tutorial/guide prose for every new feature and building.

## Next steps

1. Re-run `npm test` and `node tests/groups.mjs all` once more after any further edit, then commit the working tree.
2. Add tutorial entries for owned vehicles, construction stages and single-piece walls.
3. Implement sidewalk routing and crossings before claiming item 3 complete.
4. Rebuild models with references, then add the model validity test; the viewer exists but buildings are still one LOD.
5. Work through the open R2 items in `MECHANICS.md` in checklist order.
