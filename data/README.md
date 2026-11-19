# data/

Every tuned setting is a JSON file with a `kind` and a `version`, so the game and the labs can load and migrate them.

| Folder | kind | Produced by |
| --- | --- | --- |
| `movement/` | `movementSettings` | Movement lab ("Copy settings"). `sim` feeds `src/sim/movement.js`; `view` is camera feel. |
| `looks/` | `lookSettings` | Effects lab ("Copy settings"). The Effects lab lists every file here as a "(yours)" preset; the game's pause menu lists them too. |
| `weapons/` | `weaponStats` | Gun lab. `stats` feeds `src/sim/gun.js`. Must match `PRESETS` in that file (tested). |
| `levels/` | `level` | Blockout lab ("Save .json"; "Open level file" loads these). The game plays `city-block.json`. |

Planned: `terrain/` (terrain lab exports), `ai/` (enemy profiles), `audio/` (sound presets).

## Rules

- Bloom trim in any look is capped at 0.6.
- `tests/movement.test.js` checks that `movement/standard.json` matches the sim's built-in defaults. Change both together.
- A terrain file only needs the seed and settings: `generateTerrain(params)` rebuilds the identical map.
- Level markers: one `playerSpawn`, at least one `enemySpawn`. A marker's `rotY` is the way its arrow points (the camera's facing for the player; hostiles are turned to face it too).
