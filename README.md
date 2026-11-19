# three.js-fps

A first-person shooter for the web, built on three.js. Single player first, with PvE co-op planned.

The project is a set of **labs** (tuning tools) built on one shared codebase. The game will be assembled from the same code and the settings tuned in the labs.

## Run it

```bash
npm install
npm run dev      # opens the hub at http://localhost:5173 (game + labs)
npm test         # simulation and data tests
npm run build    # production build into dist/
```

Requires Node 20 or newer.

## Layout

| Folder | What lives there |
| --- | --- |
| `src/sim/` | Fixed-tick simulation on plain data: `world.js` (the game rules: players, weapons, projectiles, damage, enemy AI bridge, round state; returns events each tick), `movement.js` (60 Hz player controller), `gun.js` (fire, recoil, spread), `survival.js` (sewer prototype rules: melee with durability, kicks, throwables, scarce ammo, pickups, zombies with per-limb damage), `ai.js` (30 Hz enemy brains: sight, hearing, A* on a nav grid, cover, squad callouts; runs on a real level through `enableAI` in world.js). No rendering, so the same code can run on a co-op host. |
| `src/world/` | `sewer.js` (sewer levels from an ASCII grid), `level.js` (builds a level and its collider from a blockout layout), `terrain.js` (deterministic terrain generator), `ground-textures.js`. |
| `src/render/` | `look.js` (sky, sun, fog, bloom, grade, lens: the Effects lab pipeline), `camera-feel.js` (bob, tilt, landing dip, FOV: the Movement lab feel), `viewmodel.js` (first-person weapon), `merge.js` (static geometry merging). |
| `src/assets/` | Procedural model libraries: props, vehicles, facades, weapons, characters. Each exports `createXLibrary(THREE)` returning `{ props, defaults, build, dispose }`. |
| `src/fx/` | Particles; `gore.js` (wounds with running blood and drips, spatter, dismemberment, pools). |
| `src/audio/` | Procedural sound effects and sample layers. |
| `data/` | Tuned settings as versioned JSON. See `data/README.md`. |
| `proto/` | Prototypes on the same code. `proto/sewer/` is The Gallery: survival horror in the sewers, rules in `src/sim/survival.js`, level in `data/sewer/`. |
| `game/` | The playable slice: City block, clear the street. Input and presentation only; rules come from `src/sim/world.js`. |
| `labs/` | One page per lab. Each imports from `src/` and reads or writes `data/`. |
| `tests/` | `node --test` suites. |

## How the game is wired

Each fixed tick (60 Hz) the game samples input, calls `stepWorld(world, inputs)`, and reacts to the events it returns (`shot`, `impact`, `hit`, `killed`, `reloadStart`, `cleared`, ...) with effects, sound and HUD. Settings load from `data/`, then any values left in a lab's saved state on the same site override them, so tuning in a lab shows up in the game on the next load.

## Labs

Movement, Weapon feel, Viewmodel, UI/HUD, Level blockout, Terrain, City assets, Physics & destruction, Enemy AI, Characters, Effects & post, Audio, Performance. The hub page links to all of them.

Labs that open with `#autotest` at the end of the URL expose a small test hook on `window` for headless checks.

## Dependencies (pinned)

- three 0.170.0
- three-mesh-bvh 0.9.18 (capsule collision)
- cannon-es 0.20.0 (physics lab)
