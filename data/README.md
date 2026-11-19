# data/

Every tuned setting is a JSON file with a `kind` and a `version`, so the game and the labs can load and migrate them.

| Folder | kind | Produced by |
| --- | --- | --- |
| `movement/` | `movementSettings` | Movement lab ("Copy settings"). `sim` feeds `src/sim/movement.js`; `view` is camera feel. |
| `looks/` | `lookSettings` | Effects lab ("Copy settings"). The Effects lab lists every file here as a "(yours)" preset. |

Planned: `weapons/` (gun lab), `terrain/` (terrain lab exports), `levels/` (blockout layouts), `ai/` (enemy profiles), `audio/` (sound presets).

## Rules

- Bloom trim in any look is capped at 0.6.
- `tests/movement.test.js` checks that `movement/standard.json` matches the sim's built-in defaults. Change both together.
- A terrain file only needs the seed and settings: `generateTerrain(params)` rebuilds the identical map.
