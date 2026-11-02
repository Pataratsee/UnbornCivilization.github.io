# Mechanics inventory and error check

This is the checklist used for the round-3 mechanics pass. “Covered” names a real browser check in `tests/groups.mjs` (groups 1–8); “manual” means the feature exists but has no end-to-end assertion yet. Items marked **open** are not finished and are repeated in the final report.

| Mechanic | State | Coverage / notes |
|---|---|---|
| Camera pan, rotate, tilt, zoom, inversion toggles | Working | Group 1: pan inverted, rotation and tilt independent, max tilt screenshots |
| Time controls 0.1×–20×, pause, sub-stepping | Working | Group 1: exact list, finite clock and sun at 20×, speed-limited flag |
| Building placement, rotation, road rule, terrain rule | Working | Groups 1, 7, 8 |
| Roads, typed surfaces, junction welding, preview | Working | Group 7: 17 types, junction split, cost, invalid span |
| Bridges, deck, piers, styles, preview | Working | Group 7: span refusal, pier count, walkable deck |
| Walls, gates, single pieces, drag lines, AI walls | Working | Groups 7 and 8: preview, blocking, gate passage, seven single types, 172 AI wall pieces |
| Demolish buildings, roads, walls; hover card | Working | Group 1: real click, refund, highlight clears |
| Terrain area tool, height, cost, undo, save | Working | Group 3 (previous revision); new edits rejected inside foreign territory |
| Citizens, needs, routines, town confinement | Working | Group 1 needs tabs; town confinement checks exist in state update |
| Citizen requests | Working (BUG-1 fixed) | Group 8: real button, one reward, no console error |
| Jobs, workers, job outfits | Partial | Instanced workers and job roles exist; all 30+ roles do not yet have a unique visual |
| Animals, biomes, day/night behaviour | Working | Group 4: species, exclusions, sleep, instancing |
| Vehicles and traffic | Working, owned fleet | Group 7 movement/pause; group 8 factory+dealer rule |
| Sidewalks and pedestrian crossing priority | **Open** | Sidewalk geometry exists; pedestrians do not yet path along sidewalks or queue at crossings |
| Economy, taxes, upkeep, trade | Working | Group 3: trade offers, recurring shipment, income |
| Loans | Partial | One bank loan exists; nation offers, credit rating and default war are **open** |
| Resources, deposits, harvesting | **Open** | Nine stock resources only; full resource/receipt system from R2-15 is not implemented |
| Production chains | Working | Existing wood/planks/steel/goods chains; new industry bonus is read |
| Construction over game time, scaffolding, builders | Working (BUG-3 fixed) | Group 8; save preserves progress |
| Research tree, ages, costs, prerequisites | Working, expanded | Group 8: 192 techs, 15 branches, acyclic, all reachable, every tech has an effect/unlock/era advance |
| Research points from quests/tasks | **Open** | Points still accrue from buildings, not a quest system |
| Nations, diplomacy, trade, war, conquest | Working | Group 3: 10 nations, treaties, warning, invasion, conquest transfer |
| Territory tab and foreign-build refusal | Working | Group 3/territory checks; tab is off by default, placement and terrain refuse foreign land |
| Weather, seasons, day/night | Working | Groups 2/4/8; rain volume scales with zoom |
| Natural disasters | **Open** | Ordinary events exist, but no rare disaster system, warning buildings or setting |
| Ships and docks | **Open** | No ship system; decorative pier and lighthouse only |
| Save, load, autosave, old-save migration | Working | Groups 6 and 7; vehicles, construction, territory and lakes migrate with defaults |
| Settings: scale, font, speed, inversion, sound, quality | Working | Groups 1 and 6 |
| Tutorial, encyclopedia, guide | Partial | Auto-covers the catalogue; new vehicles/construction/wall pieces still need prose entries |
| Windows, drag, resize, scaling, dropdowns | Working | Groups 1, 6, 8 |
| Minimap, layers, territory | Working | Groups 1–3 |
| Tooltips and hover cards | Working | Groups 1, 7 |
| Audio cues | Working | Synth cues on action; no mixer test |
| Graphics quality switching | Working | Existing smoke suite; model quality is not upgraded |

## Error capture

The browser checks fail on any `console.error`, uncaught exception or failed request. Group 8 additionally asserts that the request, wall, vehicle and rain scenarios add zero new console errors.

`node tests/monkey.mjs` performs **1,200 fixed-seed mixed actions** through real windows and map input, then advances **two simulated years** with a populated town and reloads the save. It currently passes with zero console errors and no non-finite values. The soak advances the simulation directly rather than rendering every hour at 20×; a ten-year rendered 20× soak is still outstanding.
