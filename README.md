# three.js-fps

A first-person shooter for the web, built on three.js. Single player first, with PvE co-op planned.

The project is a set of **labs** (tuning tools) built on one shared codebase. The game will be assembled from the same code and the settings tuned in the labs.

## Run it

```bash
npm install
npm run dev      # opens the lab hub at http://localhost:5173
npm test         # simulation and data tests
npm run build    # production build into dist/
```

Requires Node 20 or newer.

## Layout

| Folder | What lives there |
| --- | --- |
| `src/sim/` | Fixed-tick simulation on plain data: `movement.js` (60 Hz player controller), `gun.js` (fire, recoil, spread), `ai.js` (30 Hz enemy brains). No rendering, so the same code can run on a co-op host. |
| `src/world/` | `terrain.js` (deterministic terrain generator), `ground-textures.js` (procedural ground textures). |
| `src/assets/` | Procedural model libraries: props, vehicles, facades, weapons, characters. Each exports `createXLibrary(THREE)` returning `{ props, defaults, build, dispose }`. |
| `src/fx/` | Particles. |
| `src/audio/` | Procedural sound effects and sample layers. |
| `data/` | Tuned settings as versioned JSON. See `data/README.md`. |
| `labs/` | One page per lab. Each imports from `src/` and reads or writes `data/`. |
| `tests/` | `node --test` suites. |

## Labs

Movement, Weapon feel, Viewmodel, UI/HUD, Level blockout, Terrain, City assets, Physics & destruction, Enemy AI, Characters, Effects & post, Audio, Performance. The hub page links to all of them.

Labs that open with `#autotest` at the end of the URL expose a small test hook on `window` for headless checks.

## Dependencies (pinned)

- three 0.170.0
- three-mesh-bvh 0.9.18 (capsule collision)
- cannon-es 0.20.0 (physics lab)
