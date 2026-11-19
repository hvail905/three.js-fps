// Test course: visual meshes plus one merged collision geometry.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function buildCourse({ visual = true } = {}) {
  const group = new THREE.Group();
  const colliderGeos = [];
  const hasDOM = visual && typeof document !== 'undefined';

  // world-scaled UVs so grid lines are 1 m everywhere
  function worldUV(geo, ox, oy, oz, tile = 1) {
    const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv;
    if (!uv) return;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + ox, y = pos.getY(i) + oy, z = pos.getZ(i) + oz;
      const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i));
      if (nz >= nx && nz >= ny) uv.setXY(i, x / tile, y / tile); else if (nx >= ny) uv.setXY(i, z / tile, y / tile); else uv.setXY(i, x / tile, z / tile);
    }
  }
  function gridTex(bg, fg) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, 256, 256); g.fillStyle = fg;
    g.fillRect(0, 0, 256, 4); g.fillRect(0, 0, 4, 256);
    g.globalAlpha = 0.35; g.fillRect(0, 126, 256, 2); g.fillRect(126, 0, 2, 256);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  }
  const mats = {};
  function m(name, bg, fg) {
    if (!hasDOM) return null;
    if (!mats[name]) mats[name] = new THREE.MeshStandardMaterial({ map: gridTex(bg, fg), roughness: 0.9 });
    return mats[name];
  }
  const M = () => ({
    floor: m('floor', '#e9e9e9', '#222222'), wall: m('wall', '#9a9a9a', '#1a1a1a'), dark: m('dark', '#3a3a3a', '#111111'),
    light: m('light', '#d0d0d0', '#2a2a2a'), accent: m('accent', '#f2c14e', '#3a2a00'), red: m('red', '#d9534f', '#3a0f0e'),
  });
  const mt = M();

  function addMesh(geo, mat, x, y, z, rx = 0, ry = 0) {
    const mesh = new THREE.Mesh(geo, mat || undefined);
    mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, 0); mesh.updateMatrixWorld(true);
    if (hasDOM) { worldUV(geo, x, y, z); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh); }
    const cg = geo.clone(); cg.applyMatrix4(mesh.matrixWorld);
    for (const k of Object.keys(cg.attributes)) if (k !== 'position') cg.deleteAttribute(k);
    colliderGeos.push(cg.index ? cg.toNonIndexed() : cg);
    return mesh;
  }
  const box = (w, h, d, x, y, z, mat) => addMesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
  // box resting on y0 (bottom face)
  const block = (w, h, d, x, z, mat, y0 = 0) => box(w, h, d, x, y0 + h / 2, z, mat);
  // ramp rising toward -z from (x, zStart), reaching height h
  function ramp(width, angleDeg, h, x, zStart, mat) {
    const run = h / Math.tan(THREE.MathUtils.degToRad(angleDeg));
    const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(run, 0); s.lineTo(run, h); s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false });
    geo.translate(0, 0, -width / 2);
    // shape x -> world -z, extrude z -> world x
    addMesh(geo, mat, x, 0, zStart, 0, Math.PI / 2);
    return run;
  }
  function label(text, x, y, z, ry = 0) {
    if (!hasDOM) return;
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const g = c.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#f2c14e'; g.font = '700 54px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 66);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.5), new THREE.MeshBasicMaterial({ map: t }));
    p.position.set(x, y, z); p.rotation.y = ry; group.add(p);
  }

  // ---- floor + perimeter ----
  box(140, 1, 140, 0, -0.5, -30, mt.floor);
  for (const [w, d, x, z] of [[140, 1, 0, 40], [140, 1, 0, -100], [1, 140, 70, -30], [1, 140, -70, -30]]) block(w, 5, d, x, z, mt.wall);

  // ---- sprint lane (x -2..2, z 0 .. -60) ----
  const lane = { x0: -2, x1: 2, zStart: 0, zEnd: -50 };
  if (hasDOM) for (let z = 0; z >= -60; z -= 5) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(4, z % 10 === 0 ? 0.25 : 0.1), new THREE.MeshBasicMaterial({ color: z === 0 || z === -50 ? 0xf2c14e : 0x333333 }));
    stripe.rotation.x = -Math.PI / 2; stripe.position.set(0, 0.006, z); group.add(stripe);
  }
  for (const z of [0, -50]) for (const x of [-2.4, 2.4]) block(0.15, 2.4, 0.15, x, z, mt.accent);
  label('50 m sprint', 0, 2.7, 0.1);

  // ---- stairs: rise 0.15 / 0.25 / 0.35 / 0.45 to ~2 m ----
  [0.15, 0.25, 0.35, 0.45].forEach((rise, i) => {
    const x = -8 - i * 3, run = 0.35, n = Math.ceil(2 / rise);
    for (let k = 0; k < n; k++) block(2.5, rise * (k + 1), run, x, -1 - k * run - run / 2, k % 2 ? mt.light : mt.wall);
    block(2.5, rise * n, 3, x, -1 - n * run - 1.5, mt.light);
    label(`${rise.toFixed(2)} m steps`, x, 2.7, 0.1);
  });

  // ---- ramps: 20..60 degrees to 2.5 m ----
  [20, 30, 40, 45, 50, 60].forEach((a, i) => {
    const x = -22 - i * 3, run = ramp(2.5, a, 2.5, x, -1, a > 45 ? mt.red : mt.light);
    block(2.5, 2.5, 3, x, -1 - run - 1.5, mt.wall);
    label(`${a}° ramp`, x, 3.2, 0.1);
  });

  // ---- gap jumps on a 1 m high path ----
  {
    const x = 12; let z = -1;
    block(3, 1, 6, x, z - 3, mt.light); z -= 6;
    label('gap jumps', x, 3.0, 0.1);
    for (const gap of [2, 3, 4, 5, 6]) {
      label(`${gap} m`, x, 2.4, z - 0.05);
      z -= gap;
      block(3, 1, 3, x, z - 1.5, gap >= 5 ? mt.accent : mt.light); z -= 3;
    }
    block(1, 1.2, 0.3, x - 2, -0.5, mt.dark); // step onto the path
  }

  // ---- ledges: 0.5 .. 2.0 m ----
  [0.5, 0.75, 1.0, 1.25, 1.5, 2.0].forEach((h, i) => {
    const z = -3 - i * 4;
    block(3, h, 2, 22, z, i % 2 ? mt.light : mt.wall);
    label(`${h.toFixed(2)} m`, 22, h + 0.6, z + 1.05);
  });

  // ---- crouch: 1.3 m tunnel and a 1.0 m vent ----
  {
    const x = 30;
    for (const s of [-1, 1]) block(0.4, 1.3, 8, x + s * 1.2, -5, mt.wall);
    block(2.8, 0.4, 8, x, -5, mt.dark, 1.3);
    label('1.3 m tunnel', x, 2.2, -0.9);
    const x2 = 35;
    for (const s of [-1, 1]) block(0.4, 1.0, 6, x2 + s * 1.2, -4, mt.wall);
    block(2.8, 0.4, 6, x2, -4, mt.red, 1.0);
    label('1.0 m vent', x2, 1.9, -0.9);
  }

  // ---- slide lane: long flat run into a 1.2 m bar ----
  block(3, 0.3, 0.3, 42, -14, mt.accent, 1.2);
  for (const s of [-1, 1]) block(0.2, 1.5, 0.3, 42 + s * 1.6, -14, mt.dark);
  label('slide under 1.2 m', 42, 2.2, 0.1);

  // ---- arena: cover, pillars, a long gentle hill ----
  const r = (() => { let a = 7; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })();
  for (let i = 0; i < 18; i++) {
    const x = -30 + r() * 60, z = -68 - r() * 26, h = 0.6 + r() * 2.4, w = 1 + r() * 2;
    block(w, h, w, x, z, i % 3 ? mt.light : mt.dark);
  }
  for (let i = 0; i < 6; i++) block(1, 5, 1, -25 + i * 10, -62, mt.wall);
  ramp(8, 12, 2, 50, -60, mt.light); block(8, 2, 6, 50, -60 - 2 / Math.tan(THREE.MathUtils.degToRad(12)) - 3, mt.light);
  label('arena', 0, 2.7, -60);

  const collider = mergeGeometries(colliderGeos, false);
  return { group, collider, spawn: new THREE.Vector3(0, 0.05, 8), lane };
}
