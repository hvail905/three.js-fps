// level.js : build a level from a blockout layout ({ version, objects: [records] }).
// Shared by the Blockout lab (editing) and the game (loading). Rendering-side code; the
// collider it produces is plain geometry + BVH that the simulation consumes.
//
// Record shapes:
//   { id, type: 'prim',   kind: 'block'|'wall'|..., params, pos: [x,y,z], rotY: degrees }
//   { id, type: 'kit',    kit: 'props'|'vehicles'|'facades', kind: <asset id>, params, pos, rotY }
//   { id, type: 'marker', kind: 'playerSpawn'|'enemySpawn'|'objective'|'coverPoint'|'patrolPoint', pos, rotY }
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';

export const PRIMS = {
  block: { label: 'Block', params: { w: 4, h: 3, d: 4, color: 'grey' } },
  wall: { label: 'Wall', params: { w: 6, h: 3, d: 0.3, color: 'dark' } },
  platform: { label: 'Platform', params: { w: 6, h: 1, d: 6, color: 'light' } },
  ramp: { label: 'Ramp', params: { w: 3, h: 2, angle: 30, color: 'light' } },
  stairs: { label: 'Stairs', params: { w: 2, h: 3, rise: 0.2, run: 0.3, color: 'light' } },
  pillar: { label: 'Pillar', params: { r: 0.4, h: 4, color: 'dark' } },
  cover: { label: 'Low cover', params: { w: 2, h: 1.1, d: 0.6, color: 'yellow' } },
};
export const MARKERS = {
  playerSpawn: { label: 'Player spawn', color: 0x22c55e },
  enemySpawn: { label: 'Enemy spawn', color: 0xef4444 },
  objective: { label: 'Objective', color: 0xf2c14e },
  coverPoint: { label: 'Cover point', color: 0x3b82f6 },
  patrolPoint: { label: 'Patrol point', color: 0xa855f7 },
};
export const COLORS = { grey: ['#bdbdbd', '#2a2a2a'], light: ['#e6e6e6', '#333333'], dark: ['#5a5a5a', '#1a1a1a'], yellow: ['#f2c14e', '#3a2a00'], red: ['#d9534f', '#3a0f0e'], blue: ['#5b8bd9', '#10213d'] };

// Surface types decide impact sounds and particles. Index order is stable (stored per triangle).
export const SURFACES = ['concrete', 'metal', 'wood', 'glass', 'dirt', 'asphalt'];
const KIT_SURFACE = {
  vehicles: 'metal',
  facades: 'concrete',
  props: {
    dumpster: 'metal', phoneBooth: 'metal', streetLight: 'metal', busStop: 'metal', trashCan: 'metal', bench: 'wood', bikeRack: 'metal',
    newspaperBox: 'metal', mailbox: 'metal', bollard: 'metal', trafficLight: 'metal', roadSign: 'metal', parkingMeter: 'metal',
    fireHydrant: 'metal', utilityPole: 'wood', electricalBox: 'metal', acUnit: 'metal', atm: 'metal', vendingMachine: 'metal',
    foodCart: 'metal', shoppingCart: 'metal', palletStack: 'wood', guardrail: 'metal', manhole: 'metal', stormDrain: 'metal',
    bush: 'dirt', tree: 'wood', planter: 'concrete',
  },
};
export function surfaceOf(rec) {
  if (rec.type === 'prim') return 'concrete';
  const s = KIT_SURFACE[rec.kit];
  return typeof s === 'string' ? s : (s && s[rec.kind]) || 'concrete';
}

export function createLevelKit(THREE, kits) {
  const D2R = THREE.MathUtils.degToRad;
  const matCache = {};
  function gridTex(bg, fg) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, 128, 128); g.fillStyle = fg; g.fillRect(0, 0, 128, 3); g.fillRect(0, 0, 3, 128);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  }
  function primMat(name) {
    if (!matCache[name]) { const [bg, fg] = COLORS[name] || COLORS.grey; matCache[name] = new THREE.MeshStandardMaterial({ map: gridTex(bg, fg), roughness: 0.9 }); }
    return matCache[name];
  }
  function worldUV(geo) { // object-space 1 m grid
    const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i));
      if (nz >= nx && nz >= ny) uv.setXY(i, x, y); else if (nx >= ny) uv.setXY(i, z, y); else uv.setXY(i, x, z);
    }
    return geo;
  }
  function buildPrim(kind, p) {
    const g = new THREE.Group(), m = primMat(p.color);
    const add = (geo, x, y, z, ry = 0) => { const mesh = new THREE.Mesh(worldUV(geo), m); mesh.position.set(x, y, z); mesh.rotation.y = ry; mesh.castShadow = mesh.receiveShadow = true; g.add(mesh); return mesh; };
    if (kind === 'ramp') {
      const run = p.h / Math.tan(D2R(Math.min(80, Math.max(5, p.angle))));
      const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(run, 0); s.lineTo(run, p.h); s.closePath();
      const geo = new THREE.ExtrudeGeometry(s, { depth: p.w, bevelEnabled: false }); geo.translate(-run / 2, 0, -p.w / 2);
      add(geo, 0, 0, 0, Math.PI / 2); // rises toward -Z
    } else if (kind === 'stairs') {
      const n = Math.max(1, Math.round(p.h / p.rise)), rise = p.h / n, L = n * p.run;
      for (let k = 0; k < n; k++) add(new THREE.BoxGeometry(p.w, rise * (k + 1), p.run), 0, (rise * (k + 1)) / 2, L / 2 - p.run * (k + 0.5));
    } else if (kind === 'pillar') {
      add(new THREE.CylinderGeometry(p.r, p.r, p.h, 12), 0, p.h / 2, 0);
    } else {
      add(new THREE.BoxGeometry(p.w, p.h, p.d), 0, p.h / 2, 0);
    }
    return g;
  }
  function buildMarker(kind) {
    const g = new THREE.Group(), col = MARKERS[kind].color;
    const m = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.35, transparent: true, opacity: 0.85 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 20), m); base.position.y = 0.025; g.add(base);
    const pole = new THREE.Mesh(kind === 'objective' ? new THREE.OctahedronGeometry(0.4) : new THREE.ConeGeometry(0.25, 0.9, 12), m);
    pole.position.y = kind === 'objective' ? 1.4 : 0.5; g.add(pole);
    if (kind.endsWith('Spawn')) { const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5, 8), m); arrow.rotation.x = -Math.PI / 2; arrow.position.set(0, 0.3, -0.7); g.add(arrow); }
    g.userData.marker = true;
    return g;
  }
  function buildRecord(rec) {
    let obj;
    try {
      if (rec.type === 'prim') obj = buildPrim(rec.kind, { ...PRIMS[rec.kind].params, ...rec.params });
      else if (rec.type === 'marker') obj = buildMarker(rec.kind);
      else obj = kits[rec.kit].build({ prop: rec.kind, params: rec.params || {} });
    } catch (e) { console.error(e); obj = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), primMat('red')); }
    obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const root = new THREE.Group(); root.add(obj);
    root.position.set(...rec.pos); root.rotation.y = D2R(rec.rotY || 0);
    root.userData.rec = rec;
    return root;
  }
  function disposeRecord(root) {
    const rec = root.userData.rec;
    if (rec.type === 'kit') kits[rec.kit].dispose(root.children[0]);
    else root.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
  }
  // Collision, plus a ground slab. Returns the merged geometry, its BVH, and a surface index per triangle.
  //   precise = false (movement): primitives exact, kit assets as their oriented bounding box, so the
  //                               player and enemies slide along props without snagging on details.
  //   precise = true (bullets, sight): every visible triangle, so shots and line of sight follow the
  //                               real shape (gaps in a bus shelter, the space under a street light's arm).
  function buildCollider(roots, { groundSize = 400, precise = false } = {}) {
    const geos = [], surf = [];
    const push = (g, surface) => {
      const ng = g.index ? g.toNonIndexed() : g;
      for (const k of Object.keys(ng.attributes)) if (k !== 'position') ng.deleteAttribute(k);
      geos.push(ng); surf.push([ng.attributes.position.count / 3, SURFACES.indexOf(surface)]);
    };
    const floor = new THREE.BoxGeometry(groundSize, 1, groundSize); floor.translate(0, -0.5, 0); push(floor, 'asphalt');
    for (const root of roots) {
      const rec = root.userData.rec;
      if (!rec || rec.type === 'marker') continue;
      root.updateMatrixWorld(true);
      if (rec.type === 'prim' || precise) {
        // lamp glow meshes are visual only
        // skip helper meshes (size-reference figures); windows and windshields read as glass
        root.traverse(o => {
          if (!o.isMesh || o.userData.isPropLight) return;
          const role = !Array.isArray(o.material) && o.material && o.material.userData ? o.material.userData.role : null;
          if (role === 'reference') return;
          const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
          push(g, rec.type === 'prim' ? 'concrete' : role === 'glass' ? 'glass' : surfaceOf(rec));
        });
      } else if (false) {
        root.traverse(o => { if (o.isMesh) { const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); push(g, 'concrete'); } });
      } else {
        const inner = root.children[0], bb = new THREE.Box3();
        const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
        inner.traverse(o => { if (o.isMesh && !o.userData.isPropLight) { o.geometry.computeBoundingBox(); bb.union(o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld))); } });
        if (bb.isEmpty()) continue;
        const s = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
        const g = new THREE.BoxGeometry(Math.max(0.05, s.x), Math.max(0.05, s.y), Math.max(0.05, s.z)); g.translate(c.x, c.y, c.z); g.applyMatrix4(root.matrixWorld);
        push(g, surfaceOf(rec));
      }
    }
    const geometry = mergeGeometries(geos, false);
    const triSurface = new Uint8Array(geometry.attributes.position.count / 3);
    let t = 0; for (const [n, s] of surf) { triSurface.fill(s, t, t + n); t += n; }
    const bvh = new MeshBVH(geometry);
    geometry.boundsTree = bvh;
    return { geometry, bvh, triSurface };
  }
  // Whole level for the game: visuals, markers (not drawn), collider.
  function buildLevel(layout, { showMarkers = false, groundSize = 400 } = {}) {
    const root = new THREE.Group(), roots = [], markers = [];
    for (const rec of layout.objects) {
      if (rec.type === 'marker') { markers.push({ kind: rec.kind, pos: [...rec.pos], rotY: rec.rotY || 0 }); if (!showMarkers) continue; }
      const r = buildRecord(rec); root.add(r); roots.push(r);
    }
    root.updateMatrixWorld(true);
    const collider = buildCollider(roots, { groundSize });
    const shotCollider = buildCollider(roots, { groundSize, precise: true });
    const lights = [], lampMats = new Set();
    root.traverse(o => { if (o.isPointLight || o.isSpotLight) lights.push(o); if (o.isMesh && o.material && o.material.userData && o.material.userData.role === 'lamp') lampMats.add(o.material); });
    return { root, markers, collider, shotCollider, lights, lampMats: [...lampMats] };
  }
  return { PRIMS, MARKERS, COLORS, primMat, gridTex, buildPrim, buildMarker, buildRecord, disposeRecord, buildCollider, buildLevel };
}
