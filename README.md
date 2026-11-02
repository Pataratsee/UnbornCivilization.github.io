# Unborn Civilization

A seeded, single-page civilization and city-builder that runs entirely in the browser. No framework, no bundler, no build step. Three.js r128 is vendored in `vendor/`, so the game also works from a static host with no network access.

![Unborn Civilization after founding a settlement](shots/04-load-proof.png)

## Run it locally — one command

Requirements: **Node.js 18 or newer**. Nothing to install and nothing to build.

From the workspace root:

```bash
cd hollowmere
npm start
```

If you are already inside this folder (the one with `package.json`), just run `npm start`.

That serves the game on **http://localhost:8000** and opens it in your default browser. Press `Ctrl+C` in the terminal to stop it.

The same thing is available as a plain shell script:

```bash
cd hollowmere
./run.sh
```

If your desktop blocks the automatic browser opener, leave the server running and open **http://localhost:8000** yourself. To use a different port:

```bash
npm start -- --port 8001
# or
./run.sh --port 8001
```

`npm install` is **not** required to play: the runtime server uses only Node's built-in modules, and Three.js and the fonts are vendored. The `devDependencies` are only for optional browser testing.

## Publish it as a static site

The game is plain HTML, CSS, JavaScript and vendored fonts. The project folder is still named `hollowmere`; publish the **contents of this folder** — not the parent folder — with no build command.

### GitHub Pages

1. Put the contents of this folder in the root of a GitHub repository (or in `docs/`).
2. Commit and push to the `main` branch.
3. Open the repository's **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**, branch `main`, folder **/(root)** (or `/docs` if you used that folder).
5. Save. GitHub Pages will publish at `https://<user>.github.io/<repository>/`.

All asset paths are relative, so it works from a repository subpath. No `base` setting or routing rewrite is needed.

### Netlify

1. Go to <https://app.netlify.com/drop>.
2. Drag this folder onto the page.
3. Netlify publishes it immediately; no build command or environment variables are needed.


## What the town does now

- **Construction takes time.** A placed building starts as a scaffold with two builders, dust and hammering. It takes game hours (pausing with the game, speeding up with the time warp) before it houses, employs or produces anything. Progress is saved.
- **Traffic is owned, not ambient.** Carts need a Cartwright Workshop. Cars need a Car Factory and a Car Dealership, steel in stock and households; buses, trucks and taxis need their own depot or stand. Roads alone carry pedestrians.
- **Research has 192 technologies across 15 branches**, from Stone Age fire-keeping to fusion engineering. Every technology carries a working bonus, a building unlock or an era advance.
- **Territory is explicit.** The Territory tab (off by default) shows town borders. Building, roads, walls and terrain edits are refused inside another nation's land until the town is captured.
- **Walls, gates and towers are real.** Line walls drag; gates, towers, bastions, barricades and spikes place with one click. Walls block walkers and armies; gates leave a passage.
- **Weather covers the map.** Rain and snow scale with camera altitude, so the whole visible map is wet at maximum zoom rather than a patch around the old camera position.

A standalone model viewer is at [models.html](models.html) and from the `?debug` HUD. It lists every generated building style with orbit, zoom, turntable, night lighting, wireframe and live triangle/material counts. The viewer deliberately states that models still use one LOD and that no reference pictures exist in the repository.

## Controls

| Input | Action |
| --- | --- |
| Left drag / `WASD` / arrows | Pan the camera |
| Right or middle drag / `Q` `E` | Rotate and tilt |
| Wheel / pinch | Zoom toward the cursor |
| `Space` | Pause or resume |
| `-` / `+` and `1`–`6` | Step through speeds from 0.1× to 20× |
| `R` | Rotate a building preview |
| `Esc` | Cancel a tool or close a modal |
| `B` `T` `C` `Y` `G` `M` `H` | Build, Research, Citizens, Economy, Government, Military, Statistics |
| `P` | Photo mode |
| `Ctrl+S` | Save |

Every simulation system — time, day/night, weather, citizens, production, research and AI nations — runs from one game clock. The default `1×` speed advances 0.025 game hours per real second; the full range is Pause, 0.1×, 0.25×, 0.5×, 1×, 2×, 3×, 5×, 8×, 10×, 15× and 20×.

## Project layout

```
index.html          markup and script order
css/style.css       the whole game interface theme
js/util.js          seeded RNG, noise, formatting helpers
js/icons.js         inline SVG icon set
js/data.js          buildings, eras, research, policies, events
js/world.js         seeded continents, biomes, resources, minimap
js/models.js        procedural buildings, trees, people and props
js/gfx.js           renderer, sky, water, terrain, camera, weather
js/state.js         simulation, economy, needs, diplomacy, save/load
js/game.js          placement, roads, selection, upgrades, demolition
js/ui.js            delegated actions, HUD, windows, shop, audio
js/ui-panels.js     remaining windows and their actions
js/main.js          boot, real loading steps, main loop, new/load/quit
vendor/             Three.js r128 and post-processing (MIT)
shots/              captured verification screenshots
```

The game uses one delegated click handler registered on `document`. UI controls declare a `data-action` (and optional `data-window`, `data-def`, `data-id`, etc.), and `js/ui.js` maps every action name to a function. On startup the interface checks that every rendered `data-action` has a handler and reports missing ones in the console and on screen.

## Development notes

- The world generator never uses `Math.random`; every seed reproduces the same coast, biomes, resources and starting site. The seed is shown in the new-world screen and stored in saves.
- Save data lives in `localStorage` under `unborn.save.v1`. Window positions are stored separately under `unborn.layout.v1`. Saves and layouts written under the pre-rename `hollowmere.*` keys are migrated automatically on first load.
- `?debug` adds an FPS/tile/citizen readout and prints generation timings.
- The loading bar is driven by real generation steps and starts the render loop before it hides.
- If WebGL cannot start, the boot screen shows the actual error and stack instead of remaining on a fake loader.

## Verification

The page, New Game flow and real loading pipeline were checked in a Chromium-based browser at 1440×900: boot completed with **0 console errors, 0 unhandled exceptions, 0 failed requests**, the loader reached 100% and dismissed, 64 terrain tiles rendered, the minimap produced pixels, and the frame loop rendered at interactive frame rates on the test machine. Automated checks cover the world generator (`node tests/world.mjs`) and the full interface/camera/render flow (`npm test`).

A second pointer pass opened Research, Build and Settings, changed the simulation speed and sound state, selected the Hide Tent, and placed it on the terrain. The placement charged 90 coins, added the building model and raised the housing meter — with no console errors. See [`shots/05-controls-proof.png`](shots/05-controls-proof.png).
