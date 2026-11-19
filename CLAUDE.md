# Project notes for Claude

- Simulation code in `src/sim/` stays free of rendering and DOM access. It runs at a fixed tick on plain data so a co-op host can run it.
- Shared code lives once in `src/`. Labs import it with relative paths (`../../src/...`); never copy a module into a lab folder.
- Tuned values go in `data/` as `{ kind, version, ... }` JSON. Keep code defaults and data files in sync (tests enforce this for movement).
- three.js is pinned to 0.170.0. Import addons as `three/addons/...`.
- Before committing: `npm test` and `npm run build` must pass. Labs support `#autotest` for headless checks.
- Writing style for docs and commit messages: no em dashes.
