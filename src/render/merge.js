// merge.js : merge static meshes by material to cut draw calls (measured in the Performance lab:
// a 2x2 city went from 24,294 draw calls to 546). Used by the Performance lab and the game.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// split a mesh into (material, world-space geometry) pieces, honoring multi-material groups
export function pieces(mesh, inv) {
  const m4 = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld), out = [];
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  g.applyMatrix4(m4);
  if (Array.isArray(mesh.material)) {
    const src = mesh.geometry, idx = src.index;
    for (const grp of src.groups) {
      // group ranges refer to the indexed geometry; with toNonIndexed the vertex range equals the index range
      const sub = new THREE.BufferGeometry();
      for (const k of ['position', 'normal', 'uv']) { const a = g.attributes[k]; sub.setAttribute(k, new THREE.BufferAttribute(a.array.slice(grp.start * a.itemSize, (grp.start + grp.count) * a.itemSize), a.itemSize)); }
      out.push([mesh.material[grp.materialIndex], sub]);
      void idx;
    }
    g.dispose();
  } else out.push([mesh.material, g]);
  return out;
}
export function mergeInto(group, objects) {
  const buckets = new Map(), inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  for (const o of objects) o.traverse(c => { if (c.isMesh) for (const [m, g] of pieces(c, inv)) { if (!buckets.has(m)) buckets.set(m, []); buckets.get(m).push(g); } });
  for (const [m, geos] of buckets) {
    const merged = mergeGeometries(geos, false); for (const g of geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, m); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
  }
}

// Merge everything under `root` into one mesh per material, in place. Point and spot lights are kept
// (re-parented to root at the same world position) so lamps still work after merging.
export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const lights = [], before = { meshes: 0 };
  root.traverse(o => { if (o.isPointLight || o.isSpotLight) lights.push(o); if (o.isMesh) before.meshes++; });
  for (const l of lights) root.attach(l);
  const kids = root.children.filter(c => !(c.isPointLight || c.isSpotLight));
  const merged = new THREE.Group(); merged.name = 'merged-static';
  root.add(merged); merged.updateMatrixWorld(true);
  mergeInto(merged, kids);
  for (const k of kids) root.remove(k);
  return { meshesBefore: before.meshes, meshesAfter: merged.children.length, lights: lights.length };
}
