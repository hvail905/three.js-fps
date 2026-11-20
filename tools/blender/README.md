# Blender asset builds

The Gallery's zombies, props, light fixtures and pickups are built by script in Blender and exported as GLB to
`assets/models/`. The game loads them through `src/assets/gallery-models.js`. Each model has a procedural
fallback in code, so a missing file costs detail but never breaks a level.

```
pip install bpy                      # Blender as a Python module (needs Python 3.13)
python tools/blender/build_zombies.py out/zombies
python tools/blender/build_props.py out/props [--only crate,drum]
cp out/zombies/*.glb out/props/*.glb assets/models/
```

The same scripts run inside the Blender app. Use `blender -b --python tools/blender/build_props.py -- OUT_DIR`, or run
them from the Scripting tab with `sys.argv` set. Each run writes the GLBs, the painted textures, preview renders
and a `.blend` file you can open and keep editing.

## How the assets are made

- **Shapes.** Zombie bodies come from a skin-modifier sketch of the skeleton, subdivided, then shaped by position
  (jaw, sockets, ribs, spine) and decimated. Heads are separate dense spheres. Props are bevelled primitives with
  smooth shading.
- **Layers.** Garments are shells grown from the body: inflated, folded, torn and solidified. Lofted pieces
  (skirt, collar, belt) and primitives (cuffs, straps, respirator, rope) sit on top. Body faces hidden under a
  garment are removed.
- **Textures.** Each asset gets one painted atlas. Paint is computed from 3D position (`gallery_lib.paint_and_bake`),
  so changing the UV layout never reshuffles it. Edge wear reads the distance to sharp polygon edges. Ambient
  occlusion is baked with Cycles and multiplied in, so layers read as layers. The game samples textures with
  nearest filtering.
- **Skinning.** The body uses Blender's automatic (heat) weights, with the arms modelled in an A-pose so they
  stay clear of the torso. Each garment vertex copies the weights of the body vertex it grew from. Influences
  are capped at four and normalised.
- **Bones.** Bone names match `src/assets/zombie.js`. The game rebuilds the bones with identity rest rotations
  at the exported joint positions, so its procedural poses apply unchanged. It then splits the mesh by dominant
  bone into segments that can be severed.

## Conventions

- Metres, Z up, front toward -Y. The glTF exporter maps that to the game's +Z forward.
- Free-standing props have their origin at the base centre on the ground.
- Wall-mounted props have the wall at y = 0 and stick out toward -Y.
- Named nodes the game drives: `head` and `led` (CCTV camera), and `glow*` (lamps; Blender may add `.001` suffixes).
- Budgets: zombies are about 10k triangles each with a 512 px atlas. Props are 100 to 2,400 triangles, with
  64 to 512 px textures.

`tests/models.test.js` checks the exported files: joint names, four influences per vertex, the named nodes, and
grounding and size for the physical props.
