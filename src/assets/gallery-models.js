// gallery-models.js : loads the Blender-built Gallery assets (tools/blender/build_*.py -> assets/models/*.glb).
// Everything has a procedural fallback, so a missing or failed file only costs detail, never the level.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const FILES = {
  zombie_gown: new URL('../../assets/models/zombie_gown.glb', import.meta.url).href,
  zombie_coverall: new URL('../../assets/models/zombie_coverall.glb', import.meta.url).href,
  zombie_hood: new URL('../../assets/models/zombie_hood.glb', import.meta.url).href,
  crate: new URL('../../assets/models/crate.glb', import.meta.url).href,
  drum: new URL('../../assets/models/drum.glb', import.meta.url).href,
  gurney: new URL('../../assets/models/gurney.glb', import.meta.url).href,
  chair: new URL('../../assets/models/chair.glb', import.meta.url).href,
  table: new URL('../../assets/models/table.glb', import.meta.url).href,
  table_sheet: new URL('../../assets/models/table_sheet.glb', import.meta.url).href,
  shelf: new URL('../../assets/models/shelf.glb', import.meta.url).href,
  locker: new URL('../../assets/models/locker.glb', import.meta.url).href,
  cabinet: new URL('../../assets/models/cabinet.glb', import.meta.url).href,
  iv: new URL('../../assets/models/iv.glb', import.meta.url).href,
  camera: new URL('../../assets/models/camera.glb', import.meta.url).href,
  speaker: new URL('../../assets/models/speaker.glb', import.meta.url).href,
  lamp_cage: new URL('../../assets/models/lamp_cage.glb', import.meta.url).href,
  lamp_tube: new URL('../../assets/models/lamp_tube.glb', import.meta.url).href,
  lamp_red: new URL('../../assets/models/lamp_red.glb', import.meta.url).href,
  lamp_bulb: new URL('../../assets/models/lamp_bulb.glb', import.meta.url).href,
  pick_brick: new URL('../../assets/models/pick_brick.glb', import.meta.url).href,
  pick_bottle: new URL('../../assets/models/pick_bottle.glb', import.meta.url).href,
  pick_pipe: new URL('../../assets/models/pick_pipe.glb', import.meta.url).href,
  pick_bandage: new URL('../../assets/models/pick_bandage.glb', import.meta.url).href,
  pick_ammo: new URL('../../assets/models/pick_ammo.glb', import.meta.url).href,
};

// Painted atlases keep their texels crisp (nearest when magnified), like the level textures.
function prepare(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) {
      if (m.map) { m.map.magFilter = THREE.NearestFilter; m.map.anisotropy = 4; m.map.needsUpdate = true; }
      if (m.emissive && m.emissiveIntensity > 0 && m.emissive.getHex() !== 0) m.toneMapped = true;
      m.roughness = Math.max(m.roughness ?? 0.85, 0.5); m.metalness = 0;
    }
  });
  return root;
}

let cache = null;
export function loadGalleryModels({ only = null, onProgress = null } = {}) {
  if (cache) return cache;
  const loader = new GLTFLoader(), names = Object.keys(FILES).filter(n => !only || only.includes(n));
  let done = 0;
  cache = Promise.all(names.map(n => loader.loadAsync(FILES[n]).then(g => { prepare(g.scene); return [n, g]; }).catch(err => { console.warn('model', n, 'failed:', err.message); return [n, null]; })
    .finally(() => onProgress && onProgress(++done / names.length))))
    .then(list => Object.fromEntries(list.filter(([, g]) => g)));
  return cache;
}
