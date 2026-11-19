// zombie.js : low-poly skinned "experiment subjects" with a hand-painted atlas, in the Gloomwood vein.
//
// One skeleton per body; the body is a handful of SkinnedMeshes (torso, head, upper arms, forearms,
// thighs, shins) that share it and blend weights across every joint, so it reads as one continuous body
// while a limb segment can still be hidden and thrown as a gib. Invisible hit proxies ride the bones so
// wounds have a surface to stick to.
//
// Conventions match characters.js: the body faces +z, +x is its left, bone rotation.x > 0 leans a spine
// forward, thigh rotation.x < 0 swings a leg forward, knee > 0 bends it back, shoulder < 0 raises an arm
// forward, elbow < 0 bends the forearm forward.
//
// API: build(variant, seed, height) -> root; animate(root, st, dt); setMove(st, legs, upper); hit(st, zone, dir, side, power);
//      attack(st); kill(st, zone, dir); setCrawl(st); dispose(root). root.userData.severPart(jointName) -> gib object.
import * as THREE from 'three';
import { mulberry32 } from '../world/terrain.js';

export const ZOMBIE_VARIANTS = ['gown', 'coverall', 'hood'];
const HAS_DOM = typeof document !== 'undefined';
const PI = Math.PI;

// ---------------------------------------------------------------- skeleton
const BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'shoulderL', 'elbowL', 'wristL', 'shoulderR', 'elbowR', 'wristR', 'thighL', 'kneeL', 'ankleL', 'thighR', 'kneeR', 'ankleR'];
const B = Object.fromEntries(BONES.map((n, i) => [n, i]));
// bind-pose world positions for a 1.8 m body
function bindLayout(k, gaunt) {
  const ankle = 0.085, knee = ankle + 0.43, hip = knee + 0.44, spine = hip + 0.13, chest = spine + 0.2, neck = chest + 0.25, head = neck + 0.08;
  const sh = chest + 0.2, el = sh - 0.31, wr = el - 0.29, shX = 0.19 * (gaunt ? 0.95 : 1.05), hipX = 0.095;
  const P = {
    root: [0, 0, 0], hips: [0, hip, 0], spine: [0, spine, 0], chest: [0, chest, 0], neck: [0, neck, 0.0], head: [0, head, 0.015],
    shoulderL: [shX, sh, 0], elbowL: [shX + 0.02, el, 0], wristL: [shX + 0.03, wr, 0.01],
    shoulderR: [-shX, sh, 0], elbowR: [-shX - 0.02, el, 0], wristR: [-shX - 0.03, wr, 0.01],
    thighL: [hipX, hip, 0], kneeL: [hipX, knee, 0.01], ankleL: [hipX, ankle, 0],
    thighR: [-hipX, hip, 0], kneeR: [-hipX, knee, 0.01], ankleR: [-hipX, ankle, 0],
  };
  for (const v of Object.values(P)) { v[0] *= k; v[1] *= k; v[2] *= k; }
  return P;
}
const PARENT = { hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck', shoulderL: 'chest', elbowL: 'shoulderL', wristL: 'elbowL', shoulderR: 'chest', elbowR: 'shoulderR', wristR: 'elbowR', thighL: 'hips', kneeL: 'thighL', ankleL: 'kneeL', thighR: 'hips', kneeR: 'thighR', ankleR: 'kneeR' };

// ---------------------------------------------------------------- atlas (256 x 256), regions in pixels [x, y, w, h]
const REG = {
  head: [0, 0, 128, 64], uarm: [128, 0, 64, 32], farm: [128, 32, 64, 32], thigh: [192, 0, 64, 32], shin: [192, 32, 64, 32],
  torso: [0, 64, 256, 96], skirt: [0, 160, 256, 48], flesh: [0, 224, 32, 32],
};
const hexRGB = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
function cloud(g, rnd, x, y, w, h, n, col, amin, amax) {
  const c = document.createElement('canvas'); c.width = c.height = n; const cg = c.getContext('2d'), img = cg.createImageData(n, n), [r, gg, b] = hexRGB(col);
  for (let i = 0; i < n * n; i++) { img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = (amin + (amax - amin) * rnd()) * 255; }
  cg.putImageData(img, 0, 0); g.save(); g.imageSmoothingEnabled = true; g.drawImage(c, x, y, w, h); g.restore();
}
const box = (g, c, x, y, w, h) => { g.fillStyle = c; g.fillRect(x | 0, y | 0, Math.max(1, w | 0), Math.max(1, h | 0)); };

function paintAtlas(variant, seed) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), rnd = mulberry32(seed * 977 + 13);
  g.imageSmoothingEnabled = false;
  const skinTones = ['#5e6456', '#665e52', '#56604f', '#6a6456'], skin = skinTones[seed % skinTones.length];
  const skinArea = (x, y, w, h) => { box(g, skin, x, y, w, h); cloud(g, rnd, x, y, w, h, 6, '#3a3426', 0, 0.55); cloud(g, rnd, x, y, w, h, 12, '#6a2a24', 0, 0.22); cloud(g, rnd, x, y, w, h, 10, '#a8a890', 0, 0.12);
    g.strokeStyle = 'rgba(60,50,80,0.35)'; for (let i = 0; i < w * h / 600; i++) { g.beginPath(); let px = x + rnd() * w, py = y + rnd() * h; g.moveTo(px, py); for (let k = 0; k < 4; k++) { px += (rnd() - 0.5) * 8; py += rnd() * 6; g.lineTo(px, py); } g.stroke(); } };
  const cloth = (x, y, w, h, base, dark, folds = 6) => { box(g, base, x, y, w, h); cloud(g, rnd, x, y, w, h, 5, dark, 0.05, 0.6);
    for (let i = 0; i < folds * w / 64; i++) { const fx = x + rnd() * w, fw = 2 + rnd() * 4; const grd = g.createLinearGradient(fx - fw, 0, fx + fw, 0); grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.5, 'rgba(0,0,0,0.35)'); grd.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grd; g.fillRect(fx - fw, y, fw * 2, h); } };
  const blood = (x, y, w, h, n, run = 1) => { for (let i = 0; i < n; i++) { const bx = x + rnd() * w, by = y + rnd() * h * 0.6, r = 2 + rnd() * 5; g.fillStyle = `rgba(${70 + rnd() * 30 | 0},8,6,${0.6 + rnd() * 0.3})`; g.beginPath(); g.ellipse(bx, by, r, r * 0.7, 0, 0, 7); g.fill();
    for (let k = 0; k < 2 * run; k++) { const dx = bx + (rnd() - 0.5) * r * 1.4, len = 4 + rnd() * 16 * run; g.fillRect(dx, by, 1 + (rnd() < 0.4 ? 1 : 0), len); } } };
  const stitches = (x0, y0, x1, y1) => { g.strokeStyle = '#3a1a14'; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); const n = Math.hypot(x1 - x0, y1 - y0) / 4; for (let i = 0; i <= n; i++) { const t = i / n, px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t; box(g, '#1a0c08', px - 2, py, 4, 1); } };

  // raw flesh swatch (stump caps)
  box(g, '#5a1410', ...REG.flesh); cloud(g, rnd, ...REG.flesh, 4, '#a0302a', 0.2, 0.7);

  // ---- head: front of the face sits at the middle of the region (u = 0.5)
  { const [x, y, w, h] = REG.head, cx = x + w / 2;
    if (variant === 'hood') {
      box(g, '#6a5a3c', x, y, w, h); cloud(g, rnd, x, y, w, h, 8, '#2a2214', 0.05, 0.6);
      for (let yy = y; yy < y + h; yy += 2) box(g, 'rgba(40,30,16,0.25)', x, yy, w, 1); for (let xx = x; xx < x + w; xx += 3) box(g, 'rgba(120,100,60,0.18)', xx, y, 1, h); // weave
      for (const s of [-1, 1]) { g.fillStyle = '#060404'; g.beginPath(); g.ellipse(cx + s * 9, y + 27, 4 + rnd() * 2, 3 + rnd() * 2, rnd() - 0.5, 0, 7); g.fill(); box(g, '#d8c890', cx + s * 9, y + 27, 1, 1); }
      g.strokeStyle = '#120c06'; g.beginPath(); g.moveTo(cx - 8, y + 42); g.lineTo(cx + 8, y + 43); g.stroke(); // stitched mouth slit
      g.fillStyle = '#c8b480'; g.font = 'bold 9px monospace'; g.textAlign = 'center'; g.fillText(String(10 + (seed % 89)), cx, y + 15);
      box(g, '#3a2c18', x, y + h - 8, w, 6); for (let xx = x; xx < x + w; xx += 4) box(g, '#5a4628', xx, y + h - 8 + (xx % 8 ? 1 : 3), 3, 2); // rope at the neck
      blood(x + w * 0.3, y + 30, w * 0.4, 20, 3, 1.4);
    } else {
      skinArea(x, y, w, h);
      // hair: thin patches on the back half
      if (variant !== 'gown' || seed % 2) { box(g, 'rgba(20,16,12,0.85)', x, y, w, 12); for (let i = 0; i < 60; i++) box(g, '#14100c', x + rnd() * w, y + 8 + rnd() * 10, 1, 2 + rnd() * 6); }
      box(g, skin, cx - 22, y + 8, 44, 6); // forehead stays bare
      for (const s of [-1, 1]) { // sunken sockets, dull eyes
        g.fillStyle = 'rgba(20,10,10,0.85)'; g.beginPath(); g.ellipse(cx + s * 9, y + 27, 6, 4.5, 0, 0, 7); g.fill();
        box(g, '#b8b088', cx + s * 9 - 1, y + 27, 3, 2); box(g, '#2a0a06', cx + s * 9, y + 27, 1, 1);
        g.fillStyle = 'rgba(30,20,20,0.4)'; g.beginPath(); g.ellipse(cx + s * 15, y + 39, 5, 7, 0, 0, 7); g.fill(); // hollow cheek
      }
      box(g, 'rgba(0,0,0,0.45)', cx - 2, y + 30, 4, 7); box(g, 'rgba(255,240,220,0.15)', cx - 1, y + 30, 1, 6); // nose
      g.fillStyle = '#100404'; g.beginPath(); g.ellipse(cx, y + 44, 8, 4 + (seed % 3), 0, 0, 7); g.fill(); // gaping mouth
      for (let i = -3; i <= 3; i++) box(g, i % 2 ? '#a89a70' : '#887a54', cx + i * 2 - 1, y + 41, 2, 2 + (rnd() < 0.3 ? 1 : 0));
      blood(cx - 6, y + 46, 12, 10, 3, 1.6);
      if (seed % 3 === 0) stitches(cx - 18, y + 13, cx + 14, y + 18); // surgical scar
    } }

  // ---- torso: front centre at x = 128
  { const [x, y, w, h] = REG.torso, cx = x + w / 2;
    if (variant === 'gown') {
      cloth(x, y, w, h, '#8e9a8c', '#2a3028', 8);
      box(g, 'rgba(0,0,0,0.5)', x, y, 10, h); box(g, 'rgba(0,0,0,0.5)', x + w - 10, y, 10, h); for (let k = 0; k < 3; k++) box(g, '#c8ccb8', x + 2, y + 20 + k * 25, 14, 2); // open back, ties
      for (let i = 0; i < 40; i++) box(g, 'rgba(60,80,110,0.35)', x + 30 + (i % 8) * 25 + (i * 7 % 5), y + 10 + (i / 8 | 0) * 18, 3, 3); // faded print
      box(g, '#d6d2bc', cx + 20, y + 22, 18, 9); g.fillStyle = '#3a3428'; g.font = '7px monospace'; g.fillText('#' + (100 + seed % 900), cx + 21, y + 29); // name tag
      blood(x + w * 0.3, y + 10, w * 0.4, h * 0.6, 7, 2);
      cloud(g, rnd, x, y + h * 0.5, w, h * 0.5, 6, '#4a3a20', 0, 0.5);
    } else if (variant === 'coverall') {
      cloth(x, y, w, h, '#3a4250', '#10141a', 7);
      box(g, '#1a1c20', cx - 1, y, 3, h); for (let yy = y; yy < y + h; yy += 3) box(g, '#6a6a60', cx, yy, 1, 1); // zipper
      box(g, '#2c323e', cx + 14, y + 20, 22, 16); box(g, '#1c2028', cx + 14, y + 20, 22, 2); // pocket
      box(g, '#b8a878', cx - 40, y + 22, 26, 8); // name patch
      for (let i = 0; i < 4; i++) { const tx = x + 20 + rnd() * (w - 40), ty = y + 10 + rnd() * (h - 30), tw = 8 + rnd() * 14, th = 6 + rnd() * 10; skinArea(tx, ty, tw, th); box(g, 'rgba(10,10,14,0.6)', tx - 1, ty - 1, tw + 2, 1); } // torn through
      blood(x + w * 0.25, y + 6, w * 0.5, h * 0.7, 6, 2.2);
      cloud(g, rnd, x, y, w, h, 7, '#2a2010', 0, 0.45);
    } else { // hood: bare, starved, opened and stitched shut
      skinArea(x, y, w, h);
      for (let i = 0; i < 6; i++) { const ry = y + 14 + i * 7; for (const s of [-1, 1]) { g.strokeStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.moveTo(cx + s * 6, ry); g.quadraticCurveTo(cx + s * 30, ry - 4, cx + s * 52, ry + 6); g.stroke(); g.strokeStyle = 'rgba(220,210,180,0.18)'; g.beginPath(); g.moveTo(cx + s * 6, ry - 1); g.quadraticCurveTo(cx + s * 30, ry - 5, cx + s * 52, ry + 5); g.stroke(); } } // ribs
      stitches(cx - 30, y + 6, cx, y + 30); stitches(cx + 30, y + 6, cx, y + 30); stitches(cx, y + 30, cx, y + 80); // Y incision
      box(g, 'rgba(0,0,0,0.5)', cx - 1, y + 66, 3, 3); // navel
      box(g, '#2a2620', x, y + h - 22, w, 22); cloud(g, rnd, x, y + h - 22, w, 22, 6, '#0c0a08', 0, 0.6); box(g, '#3a2a1a', x, y + h - 24, w, 3); // trousers, belt of rope
      blood(cx - 30, y + 20, 60, 60, 6, 2.5);
    } }

  // ---- gown skirt
  { const [x, y, w, h] = REG.skirt; cloth(x, y, w, h, '#8a9688', '#262c24', 10); box(g, 'rgba(0,0,0,0.5)', x, y, 10, h); box(g, 'rgba(0,0,0,0.5)', x + w - 10, y, 10, h); blood(x + w * 0.35, y, w * 0.3, h, 4, 2); cloud(g, rnd, x, y + h * 0.4, w, h * 0.6, 6, '#3a2c18', 0, 0.6); }

  // ---- limbs: bare grey skin, sleeves and trousers per variant, a restraint strap at the wrist
  for (const k of ['uarm', 'farm', 'thigh', 'shin']) {
    const [x, y, w, h] = REG[k];
    const sleeve = variant === 'coverall' || (variant === 'gown' && k === 'uarm' && false), trousers = (variant !== 'gown') && (k === 'thigh' || k === 'shin');
    if (sleeve) cloth(x, y, w, h, '#3a4250', '#10141a', 4);
    else if (trousers) cloth(x, y, w, h, variant === 'coverall' ? '#3a4250' : '#2a2620', '#0c0c0e', 4);
    else skinArea(x, y, w, h);
    if (k === 'uarm' && variant === 'gown') { cloth(x, y, w, 10, '#8e9a8c', '#2a3028', 3); }
    if (k === 'farm') { // hand at the bottom of the region: darker, nails
      box(g, 'rgba(30,20,16,0.35)', x, y + h - 10, w, 10); for (let i = 0; i < 5; i++) box(g, '#2a1a12', x + w / 2 - 10 + i * 5, y + h - 2, 2, 2);
      if (variant !== 'coverall') { box(g, '#3a2a1c', x, y + h - 15, w, 4); box(g, '#8a8270', x + w / 2 - 2, y + h - 15, 4, 4); } // leather restraint, buckle
      blood(x, y + h - 14, w, 10, 2, 0.8);
    }
    if (k === 'shin') { box(g, variant === 'hood' ? '#3a3026' : '#1a1814', x, y + h - 9, w, 9); if (variant === 'gown') skinArea(x, y + h - 9, w, 9); } // boots or bare feet
    if (k === 'thigh' && variant === 'gown') blood(x, y, w, h, 2, 2);
  }
  // baked shading, Gloomwood style: every segment darkens toward its ends and its sides (u = 0.25, 0.75),
  // the torso darkens under the arms and down the back, grime gathers low
  const shadeBand = (x, y, w, h, top, bottom, side) => {
    let grd = g.createLinearGradient(0, y, 0, y + h); grd.addColorStop(0, `rgba(0,0,0,${top})`); grd.addColorStop(0.25, 'rgba(0,0,0,0)'); grd.addColorStop(0.75, 'rgba(0,0,0,0)'); grd.addColorStop(1, `rgba(0,0,0,${bottom})`); g.fillStyle = grd; g.fillRect(x, y, w, h);
    grd = g.createLinearGradient(x, 0, x + w, 0); grd.addColorStop(0, `rgba(0,0,0,${side * 1.2})`); grd.addColorStop(0.25, `rgba(0,0,0,${side * 0.6})`); grd.addColorStop(0.5, 'rgba(0,0,0,0)'); grd.addColorStop(0.75, `rgba(0,0,0,${side * 0.6})`); grd.addColorStop(1, `rgba(0,0,0,${side * 1.2})`); g.fillStyle = grd; g.fillRect(x, y, w, h);
  };
  shadeBand(...REG.head, 0.25, 0.45, 0.35); shadeBand(...REG.torso, 0.45, 0.3, 0.4); shadeBand(...REG.skirt, 0.4, 0.35, 0.35);
  for (const k of ['uarm', 'farm', 'thigh', 'shin']) shadeBand(...REG[k], 0.4, 0.35, 0.3);
  cloud(g, rnd, 0, 0, 256, 224, 16, '#14100a', 0, 0.3); // overall grime
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------- geometry
// A tube is a list of rings: { y, x, z, rx, rz, w: [[bone, weight], ...], shape?(angle)->radius mult }.
// u wraps around the ring with the front (+z) at u = 0.5; v runs from the first ring (0) to the last (1).
function tube(rings, reg, segs, { capTop = false, capBottom = false } = {}) {
  if (rings[rings.length - 1].y < rings[0].y) rings = [...rings].reverse(); // always build bottom to top so winding and v agree
  const pos = [], uv = [], si = [], sw = [], idx = [];
  const [rx0, ry0, rw, rh] = reg;
  const n = rings.length;
  const toUV = (uu, t) => [(rx0 + uu * rw) / 256, 1 - (ry0 + (1 - t) * rh) / 256];
  const pushW = w => { const s = [...w].sort((a, b) => b[1] - a[1]).slice(0, 4); while (s.length < 4) s.push([0, 0]); const tot = s.reduce((a, b) => a + b[1], 0) || 1; for (const [b, ww] of s) { si.push(b); sw.push(ww / tot); } };
  rings.forEach((r, i) => {
    const t = i / (n - 1);
    for (let k = 0; k <= segs; k++) {
      const a = (k / segs) * PI * 2 - PI, m = r.shape ? r.shape(a) : 1; // a = 0 is the front
      pos.push(r.x + Math.sin(a) * r.rx * m, r.y + (r.dy ? r.dy(a) : 0), r.z + Math.cos(a) * r.rz * m);
      uv.push(...toUV(k / segs, t)); pushW(r.w);
    }
  });
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < segs; k++) {
    const a = i * (segs + 1) + k, b = a + 1, c = a + segs + 1, d = c + 1;
    idx.push(a, b, c, b, d, c); // counter-clockwise seen from outside
  }
  const cap = (ri, up) => { const r = rings[ri], ci = pos.length / 3; pos.push(r.x, r.y + (up ? 0.012 : -0.012), r.z); uv.push(...(up ? toUV(0.5, 1) : toUV(0.5, 0))); pushW(r.w);
    for (let k = 0; k < segs; k++) { const a = ri * (segs + 1) + k; if (up) idx.push(a, a + 1, ci); else idx.push(a, ci, a + 1); } };
  if (capTop) cap(n - 1, true); if (capBottom) cap(0, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- kit
export function createZombieKit() {
  const atlasCache = new Map();
  const proxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const fleshMat = new THREE.MeshStandardMaterial({ color: 0x5a1410, roughness: 0.5 });

  function build(variant = 'gown', seed = 1, height = 1.8) {
    const rnd = mulberry32(seed * 31 + 7);
    const gaunt = variant === 'hood' || rnd() < 0.4, k = height / 1.8, wide = (gaunt ? 0.86 : 1.06) * (0.95 + rnd() * 0.1);
    const P = bindLayout(k, gaunt);
    // bones
    const bones = BONES.map(n => { const b = new THREE.Bone(); b.name = n; if (n.startsWith('shoulder')) b.rotation.order = 'YXZ'; return b; }); // shoulders: raise (x) then swing (y)
    for (const n of BONES) {
      const b = bones[B[n]], p = P[n], par = PARENT[n];
      if (par) { const q = P[par]; b.position.set(p[0] - q[0], p[1] - q[1], p[2] - q[2]); bones[B[par]].add(b); } else b.position.set(...p);
    }
    const root = new THREE.Group(); root.add(bones[0]); root.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(bones);
    const key = variant + ':' + (seed % 4);
    if (!atlasCache.has(key)) atlasCache.set(key, HAS_DOM ? new THREE.MeshStandardMaterial({ map: paintAtlas(variant, seed % 4 + 1), roughness: 0.82 }) : new THREE.MeshStandardMaterial());
    const mat = atlasCache.get(key);
    const W = (...pairs) => pairs.map(([n, w]) => [B[n], w]);
    const y = n => P[n][1];
    const parts = {}; // segment name -> mesh
    const add = (name, rings, reg, segs, caps) => { const m = new THREE.SkinnedMesh(tube(rings, REG[reg], segs, caps), mat); m.name = name; m.castShadow = m.receiveShadow = true; m.frustumCulled = false; root.add(m); m.bind(skeleton); parts[name] = m; return m; };
    const s = wide;

    // torso and neck (front bulge for belly/chest, flattened back, sunken under the ribs if gaunt)
    const chestShape = a => 1 + 0.08 * Math.cos(a) - (gaunt ? 0.06 * Math.max(0, Math.cos(a)) : 0) + 0.1 * Math.pow(Math.max(0, -Math.cos(a)), 4) * Math.pow(Math.abs(Math.sin(a)), 0.5); // shoulder blades
    add('torso', [
      { y: y('hips') - 0.04 * k, x: 0, z: 0, rx: 0.15 * s * k, rz: 0.1 * k, w: W(['hips', 0.8], ['thighL', 0.1], ['thighR', 0.1]) },
      { y: y('hips') + 0.05 * k, x: 0, z: 0, rx: 0.165 * s * k, rz: 0.115 * k, w: W(['hips', 1]) },
      { y: y('spine') + 0.02 * k, x: 0, z: 0.005, rx: (gaunt ? 0.125 : 0.15) * s * k, rz: (gaunt ? 0.095 : 0.115) * k, w: W(['hips', 0.4], ['spine', 0.6]) },
      { y: y('chest') - 0.03 * k, x: 0, z: 0.01, rx: 0.155 * s * k, rz: 0.11 * k, w: W(['spine', 0.6], ['chest', 0.4]), shape: chestShape },
      { y: y('chest') + 0.08 * k, x: 0, z: 0.015, rx: 0.18 * s * k, rz: 0.125 * k, w: W(['chest', 1]), shape: chestShape },
      { y: y('shoulderL') - 0.03 * k, x: 0, z: 0, rx: 0.2 * s * k, rz: 0.12 * k, w: W(['chest', 1]) },
      { y: y('shoulderL') + 0.04 * k, x: 0, z: -0.01, rx: 0.13 * s * k, rz: 0.09 * k, w: W(['chest', 0.8], ['neck', 0.2]) },
      { y: y('neck') + 0.01 * k, x: 0, z: 0.005, rx: 0.058 * k, rz: 0.06 * k, w: W(['neck', 0.8], ['chest', 0.2]) },
      { y: y('head') + 0.005 * k, x: 0, z: 0.01, rx: 0.052 * k, rz: 0.055 * k, w: W(['neck', 0.5], ['head', 0.5]) },
    ], 'torso', 12, { capTop: true });

    // head: jaw, gaping mouth, nose ridge and brow pushed forward, flatter sides
    const hy = y('head'), hz = P.head[2];
    const face = (nose, brow) => a => { const f = Math.max(0, Math.cos(a)); return 1 + nose * Math.pow(f, 12) + brow * Math.pow(f, 3) - 0.06 * Math.abs(Math.sin(a)); };
    add('head', [
      { y: hy - 0.005 * k, x: 0, z: hz, rx: 0.05 * k, rz: 0.052 * k, w: W(['head', 1]) },
      { y: hy + 0.03 * k, x: 0, z: hz + 0.012, rx: 0.07 * k, rz: 0.078 * k, w: W(['head', 1]), shape: face(0, 0.12) },
      { y: hy + 0.07 * k, x: 0, z: hz + 0.008, rx: 0.084 * k, rz: 0.094 * k, w: W(['head', 1]), shape: face(0.05, 0.06) },
      { y: hy + 0.11 * k, x: 0, z: hz + 0.004, rx: 0.088 * k, rz: 0.1 * k, w: W(['head', 1]), shape: face(0.22, 0.02) },
      { y: hy + 0.15 * k, x: 0, z: hz, rx: 0.09 * k, rz: 0.104 * k, w: W(['head', 1]), shape: face(0.02, 0.07) },
      { y: hy + 0.19 * k, x: 0, z: hz - 0.006, rx: 0.084 * k, rz: 0.1 * k, w: W(['head', 1]) },
      { y: hy + 0.225 * k, x: 0, z: hz - 0.01, rx: 0.062 * k, rz: 0.075 * k, w: W(['head', 1]) },
      { y: hy + 0.245 * k, x: 0, z: hz - 0.012, rx: 0.03 * k, rz: 0.035 * k, w: W(['head', 1]), dy: variant === 'hood' ? a => 0.03 * k * Math.max(0, -Math.cos(a)) : undefined },
    ], 'head', 12, { capTop: true, capBottom: true });
    if (variant === 'hood') add('rope', [
      { y: y('head') - 0.01 * k, x: 0, z: 0.012, rx: 0.07 * k, rz: 0.072 * k, w: W(['neck', 0.4], ['head', 0.6]) },
      { y: y('head') + 0.02 * k, x: 0, z: 0.012, rx: 0.072 * k, rz: 0.074 * k, w: W(['head', 1]) },
    ], 'head', 10);
    if (variant === 'coverall') add('collar', [
      { y: y('shoulderL') + 0.03 * k, x: 0, z: 0, rx: 0.15 * s * k, rz: 0.1 * k, w: W(['chest', 1]) },
      { y: y('neck') + 0.04 * k, x: 0, z: -0.005, rx: 0.08 * k, rz: 0.075 * k, w: W(['chest', 0.5], ['neck', 0.5]), dy: a => 0.02 * k * Math.max(0, -Math.cos(a)) },
    ], 'torso', 12);

    // arms: long, thin, hands hang past the hips
    for (const [sd, S] of [[1, 'L'], [-1, 'R']]) {
      const sh = P['shoulder' + S], el = P['elbow' + S], wr = P['wrist' + S], ar = (gaunt ? 0.85 : 1.05) * k;
      add('uarm' + S, [
        { y: sh[1] + 0.035 * k, x: sh[0] - sd * 0.01, z: 0, rx: 0.058 * ar, rz: 0.062 * ar, w: W(['chest', 0.5], ['shoulder' + S, 0.5]) },
        { y: sh[1] - 0.04 * k, x: sh[0], z: 0, rx: 0.056 * ar, rz: 0.058 * ar, w: W(['shoulder' + S, 1]) },
        { y: sh[1] - 0.16 * k, x: (sh[0] + el[0]) / 2, z: 0, rx: 0.046 * ar, rz: 0.05 * ar, w: W(['shoulder' + S, 1]) },
        { y: el[1] + 0.01 * k, x: el[0], z: 0, rx: 0.038 * ar, rz: 0.042 * ar, w: W(['shoulder' + S, 0.5], ['elbow' + S, 0.5]), shape: a => 1 + 0.35 * Math.pow(Math.max(0, -Math.cos(a)), 6) },
      ], 'uarm', 9);
      add('farm' + S, [
        { y: el[1] + 0.01 * k, x: el[0], z: 0, rx: 0.038 * ar, rz: 0.042 * ar, w: W(['shoulder' + S, 0.5], ['elbow' + S, 0.5]) },
        { y: el[1] - 0.09 * k, x: el[0], z: 0.003, rx: 0.042 * ar, rz: 0.04 * ar, w: W(['elbow' + S, 1]) },
        { y: wr[1] + 0.01 * k, x: wr[0], z: wr[2], rx: 0.028 * ar, rz: 0.026 * ar, w: W(['elbow' + S, 0.5], ['wrist' + S, 0.5]) },
        { y: wr[1] - 0.05 * k, x: wr[0], z: wr[2] + 0.005, rx: 0.022 * ar, rz: 0.045 * ar, w: W(['wrist' + S, 1]) }, // flat palm, faces the thigh
        { y: wr[1] - 0.13 * k, x: wr[0], z: wr[2] + 0.012, rx: 0.016 * ar, rz: 0.042 * ar, w: W(['wrist' + S, 1]) },
        { y: wr[1] - 0.19 * k, x: wr[0], z: wr[2] + 0.02, rx: 0.008 * ar, rz: 0.03 * ar, w: W(['wrist' + S, 1]) }, // long fingers
      ], 'farm', 9, { capBottom: true });
      // legs
      const th = P['thigh' + S], kn = P['knee' + S], an = P['ankle' + S], lr = (gaunt ? 0.9 : 1.05) * k;
      add('thigh' + S, [
        { y: th[1] + 0.03 * k, x: th[0] + sd * 0.01, z: 0, rx: 0.088 * lr, rz: 0.095 * lr, w: W(['hips', 0.5], ['thigh' + S, 0.5]) },
        { y: th[1] - 0.1 * k, x: th[0], z: 0.005, rx: 0.08 * lr, rz: 0.085 * lr, w: W(['thigh' + S, 1]) },
        { y: kn[1] + 0.02 * k, x: kn[0], z: kn[2], rx: 0.055 * lr, rz: 0.06 * lr, w: W(['thigh' + S, 0.5], ['knee' + S, 0.5]), shape: a => 1 + 0.3 * Math.pow(Math.max(0, Math.cos(a)), 6) },
      ], 'thigh', 9);
      add('shin' + S, [
        { y: kn[1] + 0.02 * k, x: kn[0], z: kn[2], rx: 0.055 * lr, rz: 0.06 * lr, w: W(['thigh' + S, 0.5], ['knee' + S, 0.5]) },
        { y: kn[1] - 0.13 * k, x: kn[0], z: kn[2] - 0.01, rx: 0.055 * lr, rz: 0.065 * lr, w: W(['knee' + S, 1]) },
        { y: an[1] + 0.03 * k, x: an[0], z: 0, rx: 0.036 * lr, rz: 0.04 * lr, w: W(['knee' + S, 0.5], ['ankle' + S, 0.5]) },
        { y: an[1] - 0.04 * k, x: an[0], z: 0.04 * k, rx: 0.048 * lr, rz: 0.1 * lr, w: W(['ankle' + S, 1]) }, // foot
        { y: 0.006, x: an[0], z: 0.06 * k, rx: (variant === 'gown' ? 0.05 : 0.062) * lr, rz: (variant === 'gown' ? 0.13 : 0.145) * lr, w: W(['ankle' + S, 1]) },
      ], 'shin', 9, { capBottom: true });
    }
    // fingers: long, splayed, weighted to the wrist so they follow the hand
    for (const [sd, S] of [[1, 'L'], [-1, 'R']]) {
      const wr = P['wrist' + S], hy0 = wr[1] - 0.12 * k;
      for (let f = 0; f < 5; f++) {
        const thumb = f === 4, oz = thumb ? 0.035 : -0.03 + f * 0.02, len = (thumb ? 0.06 : 0.085 + (f === 1 || f === 2 ? 0.015 : 0)) * k, curl = 0.02 * k;
        const fx = wr[0] + sd * (thumb ? 0.018 : 0.004), fz = wr[2] + 0.012 + oz * k;
        add('finger' + S + f, [
          { y: hy0 + (thumb ? 0.05 * k : 0), x: fx, z: fz, rx: 0.009 * k, rz: 0.009 * k, w: W(['wrist' + S, 1]) },
          { y: hy0 - len * 0.55 + (thumb ? 0.05 * k : 0), x: fx + sd * 0.006, z: fz + curl * 0.5, rx: 0.0075 * k, rz: 0.0075 * k, w: W(['wrist' + S, 1]) },
          { y: hy0 - len + (thumb ? 0.05 * k : 0), x: fx + sd * 0.01, z: fz + curl * 1.6, rx: 0.004 * k, rz: 0.004 * k, w: W(['wrist' + S, 1]) },
        ], 'farm', 5, { capBottom: true });
      }
    }
    // gown hangs to mid-thigh
    if (variant === 'gown') add('skirt', [
      { y: y('hips') + 0.06 * k, x: 0, z: 0, rx: 0.175 * s * k, rz: 0.125 * k, w: W(['hips', 1]) },
      { y: y('hips') - 0.12 * k, x: 0, z: 0.01, rx: 0.2 * s * k, rz: 0.15 * k, w: W(['hips', 0.6], ['thighL', 0.2], ['thighR', 0.2]) },
      { y: y('hips') - 0.3 * k, x: 0, z: 0.02, rx: 0.22 * s * k, rz: 0.16 * k, w: W(['hips', 0.3], ['thighL', 0.35], ['thighR', 0.35]), dy: a => -0.05 * k * Math.abs(Math.sin(a * 3.7 + seed)) - (Math.sin(a * 9 + seed * 2) > 0.6 ? 0.06 * k : 0) },
    ], 'skirt', 16);

    // hit proxies on the bones (invisible), sized to the body so wounds sit on the surface
    const zones = [], joints = Object.fromEntries(BONES.map(n => [n, bones[B[n]]]));
    const proxy = (bone, zone, w, h, d, oy, oz = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), proxyMat); m.position.set(0, oy, oz); m.userData.zone = zone; joints[bone].add(m); zones.push(m); };
    proxy('hips', 'torso', 0.3 * s * k, 0.16 * k, 0.21 * k, 0.04 * k); proxy('spine', 'torso', 0.27 * s * k, 0.2 * k, 0.2 * k, 0.1 * k); proxy('chest', 'torso', 0.36 * s * k, 0.24 * k, 0.23 * k, 0.12 * k, 0.01);
    proxy('head', 'head', 0.17 * k, 0.24 * k, 0.2 * k, 0.12 * k, 0.01); proxy('neck', 'head', 0.1 * k, 0.1 * k, 0.1 * k, 0.04 * k);
    for (const S of ['L', 'R']) { proxy('shoulder' + S, 'arm', 0.1 * k, 0.3 * k, 0.1 * k, -0.15 * k); proxy('elbow' + S, 'arm', 0.08 * k, 0.28 * k, 0.08 * k, -0.14 * k); proxy('wrist' + S, 'arm', 0.05 * k, 0.18 * k, 0.08 * k, -0.09 * k);
      proxy('thigh' + S, 'leg', 0.16 * k, 0.44 * k, 0.17 * k, -0.22 * k); proxy('knee' + S, 'leg', 0.11 * k, 0.43 * k, 0.12 * k, -0.21 * k); }

    // severing: hide the segments below the joint and hand back a baked copy of them, posed as they were
    const FING = S => [0, 1, 2, 3, 4].map(f => 'finger' + S + f);
    const BELOW = { head: ['head', 'rope'], elbowL: ['farmL', ...FING('L')], elbowR: ['farmR', ...FING('R')], kneeL: ['shinL'], kneeR: ['shinR'], shoulderL: ['uarmL', 'farmL', ...FING('L')], shoulderR: ['uarmR', 'farmR', ...FING('R')], thighL: ['thighL', 'shinL'], thighR: ['thighR', 'shinR'] };
    const _v = new THREE.Vector3();
    function severPart(jointName) {
      const names = BELOW[jointName]; if (!names) return null;
      const segs = names.map(n => parts[n]).filter(m => m && m.visible); if (!segs.length) return null;
      root.updateMatrixWorld(true);
      const jw = new THREE.Vector3(); joints[jointName].getWorldPosition(jw);
      const gib = new THREE.Group(); gib.position.copy(jw);
      for (const m of segs) {
        const src = m.geometry, pa = src.attributes.position, out = new Float32Array(pa.count * 3);
        for (let i = 0; i < pa.count; i++) { m.getVertexPosition(i, _v); _v.applyMatrix4(m.matrixWorld).sub(jw); out[i * 3] = _v.x; out[i * 3 + 1] = _v.y; out[i * 3 + 2] = _v.z; }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(out, 3)); g.setAttribute('uv', src.attributes.uv); g.setIndex(src.index); g.computeVertexNormals();
        const gm = new THREE.Mesh(g, mat); gm.castShadow = true; gib.add(gm); m.visible = false;
      }
      // a raw end on the gib where it came off
      const end = new THREE.Mesh(new THREE.SphereGeometry(0.035 * k, 6, 4), fleshMat); gib.add(end);
      return gib;
    }
    root.userData.rig = { joints, bones, skeleton, P, k, legLen: y('hips') };
    root.userData.zones = zones; root.userData.parts = parts; root.userData.severPart = severPart; root.userData.zombie = { variant, seed, gaunt };
    return root;
  }

  // ---------------------------------------------------------------- animation
  // st: { t, legs: idle|walk|run, upper: free|reach, hit, atk, dead, crawl, limp, phase }
  const s = Math.sin, c = Math.cos;
  function pose(st, rig) {
    const P = {}, add = (n, x = 0, y = 0, z = 0) => { const a = P[n] || (P[n] = [0, 0, 0]); a[0] += x; a[1] += y; a[2] += z; };
    const t = st.t, L = st.limp ?? 0.5, sd = st.side ?? 1; // which leg drags
    let hipsY = 0, rootRot = [0, 0, 0], rootOff = [0, 0, 0];
    // base hunch: head pushed forward, shoulders slumped
    add('spine', 0.22); add('chest', 0.12); add('neck', -0.15); add('head', -0.05, 0, 0.12 * sd);
    add('shoulderL', 0.05, 0, 0.1); add('shoulderR', 0.05, 0, -0.1); add('elbowL', -0.25); add('elbowR', -0.25);
    if (st.crawl) {
      // face down, pulling with the arms, the legs dragging behind
      const ph = t * 2.2 * PI;
      rootRot = [PI / 2 - 0.12, 0, 0]; rootOff = [0, 0.12 - rig.legLen * 0.0, -rig.legLen * 0.95]; hipsY = 0;
      add('spine', -0.2); add('chest', -0.15); add('neck', -0.9); add('head', -0.35);
      for (const [S, sg] of [['L', 1], ['R', -1]]) {
        const p = s(ph + (sg > 0 ? 0 : PI)), reach = Math.max(0, p);
        add('shoulder' + S, -2.5 + reach * 0.7 - 0.6 * (1 - reach), 0, sg * (0.35 + 0.2 * reach)); add('elbow' + S, -0.4 - (1 - reach) * 1.1);
        add('thigh' + S, 0.08 + 0.1 * p, 0, sg * 0.15); add('knee' + S, 0.3 + 0.25 * Math.max(0, -p)); add('ankle' + S, 0.6);
      }
      add('spine', 0, 0, s(ph) * 0.12); add('hips', 0, s(ph) * 0.1, 0);
    } else if (st.legs === 'walk' || st.legs === 'run') {
      const run = st.legs === 'run', ph = t * (run ? 1.55 : 0.95) * PI * 2;
      // a shamble: one leg strides, the other drags; the hips drop on the bad side
      for (const [S, sg] of [['L', 1], ['R', -1]]) {
        const bad = (sg === sd), p = s(ph + (sg > 0 ? 0 : PI)), amp = (run ? 0.75 : 0.5) * (bad ? 1 - L * 0.55 : 1);
        add('thigh' + S, -p * amp - (run ? 0.25 : 0.08), 0, sg * 0.04); add('knee' + S, (run ? 0.5 : 0.18) + Math.max(0, -c(ph + (sg > 0 ? 0 : PI))) * (run ? 1.3 : 0.75) * (bad ? 1 - L * 0.7 : 1));
        add('ankle' + S, bad ? 0.25 * L : -0.1 * p);
      }
      const bob = Math.abs(s(ph)); hipsY = -0.03 - (run ? 0.06 : 0.02) * (1 - bob) - (s(ph) * sd > 0 ? 0.035 * L : 0);
      add('hips', 0, s(ph) * 0.12, s(ph) * sd * 0.07 * (0.5 + L)); add('spine', run ? 0.32 : 0.08, -s(ph) * 0.1, -s(ph) * sd * 0.06);
      add('head', s(ph * 0.5) * 0.08, 0, s(ph) * 0.12); // lolling
      if (st.upper === 'reach') {
        for (const [S, sg] of [['L', 1], ['R', -1]]) { const p = s(ph * (run ? 1 : 0.5) + (sg > 0 ? 0 : 1.7)); add('shoulder' + S, -1.25 - 0.25 * p, 0, sg * (0.2 + 0.08 * p)); add('elbow' + S, -0.3 - 0.35 * Math.max(0, p)); add('wrist' + S, 0.3); }
        add('neck', 0.15); add('head', -0.15);
      } else {
        for (const [S, sg] of [['L', 1], ['R', -1]]) { const p = s(ph + (sg > 0 ? PI : 0) - 0.6); add('shoulder' + S, p * (run ? 0.6 : 0.28), 0, sg * 0.05); add('elbow' + S, -0.2 * Math.max(0, p)); } // dead weight with lag
      }
    } else {
      // idle: sway, twitch, breathing
      add('spine', s(t * 0.9) * 0.04, s(t * 0.33) * 0.12, s(t * 0.6) * 0.05); add('head', s(t * 1.7) * 0.06, s(t * 0.41) * 0.3, s(t * 0.77) * 0.12);
      if (s(t * 2.9) > 0.97) add('head', 0, 0.25, 0.3); // twitch
      add('shoulderL', s(t * 0.8) * 0.06); add('shoulderR', s(t * 0.8 + 1) * 0.06);
      add('kneeL', 0.12); add('kneeR', 0.2); hipsY = -0.02;
      if (st.upper === 'reach') { add('shoulderL', -1.1, 0, 0.25); add('shoulderR', -1.2, 0, -0.25); add('elbowL', -0.4); add('elbowR', -0.3); }
    }
    // ---- attack: anticipation (rear back, arms high), strike (lunge, swipe down), recover
    if (st.atk && !st.dead) {
      const a = st.atk, at = t - a.t, W = 0.55, Sk = 0.16, R = 0.5, kind = a.kind, ar = st.crawl ? 0.5 : 1;
      let wind = 0, strike = 0, rec = 0;
      if (at < W) wind = 1 - Math.pow(1 - at / W, 2);
      else if (at < W + Sk) { wind = 1 - (at - W) / Sk; strike = Math.sin(((at - W) / Sk) * PI / 2); }
      else if (at < W + Sk + R) { strike = 1 - (at - W - Sk) / R; rec = 1; }
      else st.atk = null;
      const e = strike * strike * (3 - 2 * strike);
      if (kind === 'grab') { // both arms up and out, then lunge in and clamp
        add('spine', (-0.15 * wind + 0.5 * e) * ar); add('chest', -0.1 * wind + 0.2 * e); add('neck', 0.2 * wind); add('head', -0.3 * wind + 0.2 * e);
        for (const [S, sg] of [['L', 1], ['R', -1]]) { add('shoulder' + S, -1.3 * wind - 0.2 * e, sg * (0.75 * wind - 0.65 * e), 0); add('elbow' + S, -0.5 * wind - 0.6 * e); add('wrist' + S, 0.4 * wind); }
      } else { // swipe with one arm: wound up high behind the head, slashed across and down
        const S = kind === 'swipeL' ? 'L' : 'R', O = S === 'L' ? 'R' : 'L', sg = S === 'L' ? 1 : -1;
        add('spine', (-0.25 * wind + 0.5 * e) * ar, sg * (0.45 * wind - 0.6 * e)); add('chest', 0, sg * (0.3 * wind - 0.35 * e));
        add('shoulder' + S, -2.6 * wind - 0.9 * e, 0, sg * (0.9 * wind - 0.5 * e)); add('elbow' + S, -1.4 * wind - 0.2 * e);
        add('shoulder' + O, -0.5 * wind - 0.3 * e, 0, -sg * 0.2); add('elbow' + O, -0.6 * wind);
        add('head', -0.2 * wind + 0.1 * e, -sg * 0.3 * wind);
      }
      // the lunge carries the whole body forward on the strike
      rootOff[2] += (0.32 * e - 0.08 * wind) * ar; hipsY -= 0.06 * e; add('thighL', -0.35 * e); add('kneeL', 0.4 * e); add('thighR', 0.25 * e);
      if (rec && !strike) {} // recover blends back through the move crossfade
    }
    // ---- hit reaction: flinch by zone, scaled by power; heavy hits stagger the legs
    if (st.hit && !st.dead) {
      const h = st.hit, ht = t - h.t, k = Math.exp(-ht * 5.5) * Math.sin(Math.min(ht * 15, PI)) * h.power, dx = h.dir[0], dz = h.dir[1], S = h.side > 0 ? 'L' : 'R';
      if (h.zone === 'head') { add('head', dz * 1.0 * k, -dx * 0.5 * k, -dx * 0.7 * k); add('neck', dz * 0.4 * k); add('chest', dz * 0.25 * k); }
      else if (h.zone === 'arm') { add('shoulder' + S, -dz * 1.1 * k, 0, h.side * 0.7 * k); add('elbow' + S, 0.5 * k); add('chest', 0, h.side * 0.4 * k); }
      else if (h.zone === 'leg') { add('knee' + S, 1.2 * k); add('thigh' + S, -0.4 * k); hipsY -= 0.14 * k; add('spine', 0.35 * k, 0, -dx * 0.2 * k); }
      else { add('spine', dz * 0.6 * k, -dx * 0.3 * k, -dx * 0.4 * k); add('chest', dz * 0.35 * k); add('head', dz * 0.45 * k); add('shoulderL', 0.35 * k, 0, 0.4 * k); add('shoulderR', 0.35 * k, 0, -0.4 * k); }
      if (h.power > 1) { rootOff[2] -= dz * 0.12 * k; rootOff[0] -= dx * 0.12 * k; } // shoved back
      if (ht > 1) st.hit = null;
    }
    // ---- death: crumple, then topple away from the blow (ragdolls replace this in a later phase)
    if (st.dead) {
      const d = st.dead, dt2 = t - d.t, dx = d.dir[0], dz = d.dir[1];
      if (st.crawl) { for (const n of Object.keys(P)) P[n] = P[n].map(v => v * Math.max(0, 1 - dt2 * 2)); rootRot = [PI / 2 - 0.05, 0, 0]; rootOff = [0, 0.1, -rig.legLen * 0.95]; add('shoulderL', -2.4, 0, 0.6); add('shoulderR', -0.4, 0, -0.9); add('head', 0, 0.9, 0); }
      else {
        const dur = d.zone === 'head' ? 0.55 : d.zone === 'leg' ? 1.2 : 0.85, k = Math.min(1, dt2 / dur), e = k * k * (3 - 2 * k);
        for (const n of Object.keys(P)) P[n] = P[n].map(v => v * (1 - e));
        const buckle = d.zone === 'leg' ? Math.min(1, dt2 / 0.4) : Math.min(1, k * 2);
        add('kneeL', 1.6 * buckle * (1 - e * 0.7)); add('kneeR', 1.4 * buckle * (1 - e * 0.6)); add('thighL', -0.7 * buckle * (1 - e)); add('thighR', -0.5 * buckle * (1 - e));
        add('head', dz * 0.7 * e, 0.6 * e); add('spine', dz * 0.35 * e);
        add('shoulderL', 0.2, 0, 0.6 + 1.2 * e); add('shoulderR', -0.3, 0, -0.5 - 1.0 * e); add('elbowL', -0.4); add('elbowR', -0.9);
        hipsY = -rig.legLen * 0.78 * Math.min(1, d.zone === 'leg' ? buckle : k * 1.6);
        const fall = d.zone === 'leg' ? Math.max(0, (dt2 - 0.3) / (dur - 0.3)) : k, fe = Math.min(1, fall) ** 2 * (3 - 2 * Math.min(1, fall));
        if (Math.abs(dz) >= Math.abs(dx)) rootRot = [(PI / 2) * Math.sign(dz || -1) * fe, 0, -dx * 0.4 * fe];
        else rootRot = [dz * 0.4 * fe, 0, -Math.sign(dx) * (PI / 2) * fe];
        if (d.zone === 'leg') rootRot[0] = Math.abs(rootRot[0]) * 0.9;
        // settle: a few small twitches once down
        if (dt2 > dur && dt2 < dur + 2.5 && s(dt2 * 23) > 0.9) add('elbowL', -0.3 * Math.max(0, 1 - (dt2 - dur) / 2.5));
      }
    }
    return { P, hipsY, rootRot, rootOff };
  }
  function animate(root, st, dt) {
    const rig = root.userData.rig;
    st.t = (st.t || 0) + dt * (st.rate || 1);
    st.blend = Math.min(1, (st.blend ?? 1) + dt / (st.blendDur || 0.25));
    const cur = pose(st, rig), from = st.from, w = from && st.blend < 1 ? st.blend * st.blend * (3 - 2 * st.blend) : 1;
    for (const n of BONES) {
      if (n === 'root') continue;
      const a = cur.P[n] || [0, 0, 0], b = (from && from.P[n]) || [0, 0, 0];
      rig.joints[n].rotation.set(b[0] + (a[0] - b[0]) * w, b[1] + (a[1] - b[1]) * w, b[2] + (a[2] - b[2]) * w);
    }
    const lerp = (x, y) => from ? x + (y - x) * w : y;
    rig.joints.hips.position.y = rig.P.hips[1] + lerp(from ? from.hipsY : 0, cur.hipsY);
    const rr = cur.rootRot.map((v, i) => lerp(from ? from.rootRot[i] : 0, v)), ro = cur.rootOff.map((v, i) => lerp(from ? from.rootOff[i] : 0, v));
    rig.joints.root.rotation.set(rr[0], rr[1], rr[2]); rig.joints.root.position.set(ro[0], ro[1], ro[2]);
    st.last = cur;
  }
  const crossfade = (st, dur = 0.25) => { st.from = st.last || null; st.blend = 0; st.blendDur = dur; };
  function setMove(st, legs, upper) { if (st.legs !== legs || st.upper !== upper) { crossfade(st); st.legs = legs; st.upper = upper; } }
  function hit(st, zone, dir, side, power = 1) { st.hit = { zone, dir, side, power, t: st.t || 0 }; if (power > 1.1) st.atk = null; }
  function attack(st, kind) { st.atk = { t: st.t || 0, kind: kind || ['swipeL', 'swipeR', 'grab'][(st.atkN = (st.atkN || 0) + 1) % 3] }; }
  function kill(st, zone, dir) { crossfade(st); st.dead = { zone, dir, t: st.t || 0 }; st.hit = null; st.atk = null; }
  function setCrawl(st) { if (!st.crawl) { crossfade(st, 0.9); st.crawl = true; } } // slower blend: it falls onto its front
  function dispose(root) { root.traverse(o => { if (o.isMesh && o.geometry) o.geometry.dispose(); }); }
  function makeState(seed) { const r = mulberry32(seed * 5 + 3); return { t: r() * 10, legs: 'idle', upper: 'free', limp: 0.3 + r() * 0.6, side: r() < 0.5 ? 1 : -1, rate: 1 }; }
  return { build, animate, setMove, hit, attack, kill, setCrawl, dispose, makeState, variants: ZOMBIE_VARIANTS };
}
