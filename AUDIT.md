# Completion audit — Unborn Civilization

Baseline at `4cb05c3` (Group 2 committed). Round-3 additions are recorded in RESUME.md, BUGS.md and MECHANICS.md. Automated evidence is from `tests/smoke.mjs`, `tests/groups.mjs` and the browser pass. “Start” is the status found before this audit’s repairs; “Now” is updated after each item is genuinely reachable and tested.

A DONE row requires a passing browser test or a checked screenshot of the feature through the normal interface, not merely code or a debug hook.

## Round 1

| ID | Item | Start | Now | Evidence | What is left |
|---|---|---|---|---|---|
| R1-01 | Interface scale applies to the whole GUI | DONE | DONE | Group 1: HUD height, window and controls scale, drag/resize at 150%; group 6: Apply/revert. | — |
| R1-02 | Recognizable gear icon everywhere | DONE | DONE | Group 1: cog path, teeth and hub rendered at 17 px. | — |
| R1-03 | Currency is coins everywhere; old saves load | DONE | DONE | Group 1: no visible crowns, coin icon, README/tutorial/shop strings. | — |
| R1-04 | Time speeds through 20× with stable sub-stepping | DONE | DONE | Group 1: exact speed list and finite clock/sun at 20×. | — |
| R1-05 | Inverted pan by default, separate pan/rotation/tilt toggles | DONE | DONE | Group 1: pan inverted, rotation and tilt independent. | — |
| R1-06 | Demolish hover red highlight and refund tooltip | DONE | DONE | Group 1: helper highlight, card and clear on removal. | — |
| R1-07 | Road preview with path, validity, cost and cancel | DONE | DONE | Group 1/Group 2: live strip, cost, Escape cleanup. | — |
| R1-08 | Font size setting independent of UI scale | DONE | DONE | Groups 1/6: computed HUD font changes, all sliders show percent bars. | — |
| R1-09 | Citizens Needs Overview and Wants & Needs list | DONE | DONE | Group 1: averages, every need, every citizen, filter and sort. | Virtualisation with thousands is asserted by implementation but not stress-tested with thousands. |
| R1-10 | Demolish works for buildings, roads and decorations | DONE | DONE | Group 1: real click removes building, clears highlight and mesh. | — |
| R1-11 | All water shares one material and look | DONE | DONE | Group 2: all water is one mesh/material inside and outside the map. | Lake shapes still share sea surface height; see R2-10. |
| R1-12 | Earth map, rivers, lakes, gentler shores, Earth/Random | DONE | DONE | Group 2: Earth default, 10+ rivers and lakes, flat starting shelf; screenshots `shots/revamp-earth-*`. | — |
| R1-13 | Map 2–3× larger with World size option | DONE | DONE | Group 2: 3072 world is 2.25× the old area; New World exposes size. | — |
| R1-14 | Instanced grass and bushes with seasons/wind | DONE | DONE | Group 2: instanced vegetation and placement exclusions. | Desert bushes still exist (R2-12). |
| R1-15 | Pre-built AI civilizations, borders, war and conquest | DONE | DONE | Group 3: 10 nations, borders, conquest transfer and unrest. | — |
| R1-16 | Trade window, offers, recurring deals, visible routes | DONE | DONE | Group 3: offers, immediate shipment, repeat on agreed day. | — |
| R1-17 | Treaties, invasions and AI aggression | DONE | DONE | Group 3: pact holds, break damages relations, warning then invasion. | — |
| R1-18 | Terrain area tool with height, falloff, cost, undo and save | DONE | DONE | Group 3: area select, target height, cost, undo and save. | — |
| R1-19 | Darker but readable night | DONE | DONE | Group 4: night luminance and moonlit readability. | — |
| R1-20 | Lit occupied houses, dark empty houses | DONE | DONE | Group 4: warm lanterns after dark and off by day. | — |
| R1-21 | Wildlife by biome, behaviour, performance | DONE | DONE | Group 4: species counts, water/cliff exclusions, sleep cycle, instancing. | — |
| R1-22 | Shooting stars absent | DONE | DONE | Group 4: removed from sky, data and renderer; group 1 source audit. | — |
| R1-23 | 150+ additional building options | DONE | DONE | Group 5: 272 buildings, every model, shop, encyclopedia and effect. | — |

## Round 2

| ID | Item | Start | Now | Evidence | What is left |
|---|---|---|---|---|---|
| R2-01 | Quit to menu with save prompt and clean disposal | DONE | DONE | Group 6: Cancel, discard, full disposal, second game, save on quit. | — |
| R2-02 | Staged interface scale, percent bars on every slider | DONE | DONE | Group 6: Apply/Cancel, 10 s revert, Keep/Reset, all ranges filled. | — |
| R2-03 | Black dropdown text everywhere | DONE | DONE | Group 6: computed colours of all dropdowns. | — |
| R2-04 | Shooting stars fully removed | DONE | DONE | Group 4 and group 6. | — |
| R2-05 | Smooth road connections, many road types, real traffic | PARTIAL | PARTIAL | Group 2: 17 surfaces, welded junction aprons, split-at-junction, moving cars/carts. | No fillet curves, tunnels/ramps/interchanges, traffic lights, queues/jams or in-place upgrades. |
| R2-06 | Fancy era bridges with supports, styles, preview | PARTIAL | PARTIAL | Group 2: deck, railings, piers, abutments, foam, 5 styles, auto/manual choice, preview. | No cable-stayed, viaduct or lift bridges; no research gate outside era; stone arches are only piers + fascia. |
| R2-07 | Roads clear trees/bushes/rocks, preview, persisted | PARTIAL | PARTIAL | Group 2: exact tree removal, cleared count, timber salvage, saved roads; preview markers. | No falling animation; cleared trees are recomputed from the road footprint rather than stored individually; rocks not explicitly cleared by roads. |
| R2-08 | Walls category, drag preview, pathing, sieges, AI walls | PARTIAL | PARTIAL | Group 2: 15 walls, terrain-following preview, invalid refusal, walker blocking, gates, AI walls, save. | No wall snapping/closed circuits, siege damage, repair, upgrade or defenders on walls. |
| R2-09 | Campfire model, flame, sparks, smoke, fuel, gathering | PARTIAL | PARTIAL | Group 2: grounded model, animated flame/glow, smoke particles, night light, rain/storm extinguish. | No fuel consumption, crackle/hiss sound, wind-driven smoke or citizen gathering behaviour. |
| R2-10 | One global sea level, local lakes, sand shorelines | PARTIAL | PARTIAL | World carves lakes below one water plane; every shore has a blended sand band. | Inland lakes are sea-level basins, not lakes above sea level with their own rim height; flood-fill lake classification and river-mouth sea-level assertions are absent. |
| R2-11 | Territory tab, off by default, build blocking | MISSING | DONE | `territory-btn`, off by default, hides all borders, blocks buildings/roads/walls/terrain in foreign land, focus panel. | — |
| R2-12 | No grass/bushes on sand; biome rocks | PARTIAL | PARTIAL | Group 2: no grass/bush on beaches or water; instanced rocks exist. | Desert bushes still spawn; no cacti/desert scrub rules; rocks are one generic shape/colour, not biome-specific. |
| R2-13 | Townspeople for homes/jobs, stay in town, job outfits | PARTIAL | PARTIAL | People are instanced for occupied homes/jobs and jobInfo assigns coat/hat/tool (farmer, miner, doctor, police, soldier, teacher, etc.). | No explicit town boundary; no changing outfit on job change refresh beyond next frame; no town assignment/conquest transfer; some jobs lack distinct looks. |
| R2-14 | Construction stages, builders, time, persistence | MISSING | DONE | Scaffold, two builders, dust, hammer cue, game-hour progress, disabled simulation, saved progress, completion swap. Test R2-14. | — |
| R2-15 | Resource requirements, nodes, depletion, full list | MISSING | MISSING | 9 stock resources only; deposits exist in world but nothing reads them; no recipe check. | Whole feature. |
| R2-16 | Mining category and real mining buildings | MISSING | MISSING | No mining category; a generic `mine`/`quarry` building exists in industry only. | Whole feature. |
| R2-17 | Research tab with age tech tree driven by quests | MISSING | MISSING | Research tab and age tree exist, but points come from buildings, not quests; no quest tracker. | Quest/task system and its UI. |
| R2-18 | Loans from nations, interest, defaults, war | PARTIAL | PARTIAL | Economy has one bank loan (+5,000, 5,500 owed). | Nation offers, schedules, early repayment, credit rating, warnings, default war countdown. |
| R2-19 | One global 2× purchase price multiplier | MISSING | DONE | `D.PRICE_MULTIPLIER = 2`, applied to buildings, roads, branches, repairs, terrain, walls and towers; income untouched. | — |
| R2-20 | Docks, ports, visible ships, routes and uses | MISSING | MISSING | Catalogue has decorative pier/lighthouse; `shipTrade` is a trade arrival function, not ships. | Whole feature. |
| R2-21 | Rare natural disasters with warnings and recovery | MISSING | MISSING | Events exist (fire, disease) but no disasters, warning buildings, setting or effects. | Whole feature. |
| R2-22 | Tutorial/encyclopedia/guide cover every new feature | PARTIAL | PARTIAL | Roads, bridges, walls, campfires, territory, construction and owned traffic have entries; catalogue auto-covers buildings. | Still missing resources, mining, quests, loans, ships and disasters. |
