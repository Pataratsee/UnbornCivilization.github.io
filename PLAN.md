# UNBORN CIVILIZATION — build plan

A gloomy, cinematic civilization / city-builder for the browser. Static site, no build step.
All simulation is seeded and deterministic; one game-time clock drives every system.

## Architecture (classic scripts, load order)

| File | Responsibility |
| --- | --- |
| `vendor/three.min.js` + postprocessing | Three.js r128, vendored (works offline) |
| `js/util.js` | Seeded RNG, value noise/fBm, math, canvas texture factory, DOM helpers |
| `js/icons.js` | One inline-SVG icon set (same grid + stroke) |
| `js/data.js` | Eras, need definitions, building catalogue, research tree, policies, names |
| `js/world.js` | Continent/height/biome/resource generation, height sampling, tile data |
| `js/models.js` | Procedural buildings (era-aware), trees, rocks, people, props |
| `js/gfx.js` | Renderer, sky, water, sun/moon, shadows, post FX, terrain tiles, camera, particles |
| `js/state.js` | Game state, clock/calendar, economy, needs, citizens, research, nations, save/load |
| `js/game.js` | Placement, roads, selection, upgrades, simulation ticks, events, AI |
| `js/ui.js` | HUD, movable windows, shop, panels, minimap, tooltips, audio, notifications |
| `js/main.js` | Boot order, menu/world creation, loading steps, error handling, frame loop |

## Coordinate + generation model

- World is a square on XZ. Default 2048 u, options 2048 / 3072 / 4096. Sea at y = 0 (settings shift it).
- Height field: 513² seeded fBm heightmap + continent blob mask + coastal falloff. Bilinear sampling is
  used for placement/camera so simulation and meshes agree exactly.
- Tiles: 256 u square, 8×8 to 16×16 tiles, 32×32 grid each. All tiles share the same vertex spacing so
  seams cannot crack. Tiles are built progressively: a 5-tile radius first, rest in idle slices.
- No scene fog. Depth solved with logarithmic depth buffer, dynamic near/far, and camera-relative water.

## Simulation

- Speeds: pause, 0.1×, 0.25×, 0.5×, 1×, 2×, 3×, 5×, 8×, 10×, 15×, 20×. 1× = 0.025 game-hours / real second.
- One `gameHours` delta drives weather, needs, citizens, production, research, construction, AI.
- Citizens are real households in real homes. Visible walkers are a rendering of that data: they pick
  a destination for their lowest unmet need, A* along the road graph, enter the door, wait, return.
- Buildings attach to the nearest road node. Neighbourhood services work by radius. City-wide water and
  power are capacity-vs-demand budgets; deficits show warnings and lower happiness.
- Economy: taxes, upkeep, trade of surplus resources, production chains (wood→planks, ore+coal→steel…).
- Eras advance by research; housing/industry/services unlock progressively.

## Visual direction

Muted, overcast, naturalistic. Slate sky, moss and umber terrain, dull sand, cold grey-blue water.
ACES tone mapping, PBR materials, hand-generated tiling albedo/bump textures, PCF soft shadows,
procedural sky with clouds/stars, animated water with shoreline foam, instanced trees/rocks/people,
subtle bloom at night, vignette, grain, desaturation. The UI is engraved slate + parchment + brass,
using Cinzel and Alegreya Sans (vendored, OFL), one icon grid and one easing curve.

## Stages & tests

1. Boot/loading/terrain/camera/day-night/time/build/roads/windows/HUD + smoke test.
2. Building models, shop previews/upgrade tree, citizens, needs, requests, revolt, economy.
3. Sky/water/vegetation, weather, research, diplomacy, events, save/load, polish.

Every stage is checked with `node tests/smoke.mjs` (Playwright, SwiftShader): zero console errors,
New Game completes, terrain pixels exist, max tilt, placement, all speeds, every window dragged,
every registered action clicked. Screenshots saved to `shots/`.

Verification is honest: anything not exercised is listed in the final report.
