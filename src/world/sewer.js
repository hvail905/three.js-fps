// sewer.js : builds a sewer level from an ASCII grid (data/sewer/*.json).
// Every open cell has a floor and ceiling height by type; walls, steps and low headers are generated
// wherever neighbouring cells differ, so tunnels, water channels, tall halls and crawl vents all come
// from one rule. Returns visuals, one collider (bodies, bullets and sight share it), lights and markers.
// World space: cell (c, r) spans x = c*cell .. (c+1)*cell, z = r*cell .. (r+1)*cell.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import { SURFACES } from './level.js';
import { mulberry32 } from './terrain.js';

const SURF = name => Math.max(0, SURFACES.indexOf(name));

// ---------------------------------------------------------------- procedural textures
function canvas(S) { const c = document.createElement('canvas'); c.width = c.height = S; return c; }
function noiseFill(ctx, S, rnd, base, spread, alpha = 1) {
  const img = ctx.getImageData(0, 0, S, S), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * spread; d[i] = Math.max(0, Math.min(255, base[0] + n)); d[i + 1] = Math.max(0, Math.min(255, base[1] + n)); d[i + 2] = Math.max(0, Math.min(255, base[2] + n)); d[i + 3] = 255 * alpha; }
  ctx.putImageData(img, 0, 0);
}
function blotches(ctx, S, rnd, n, color, rmin, rmax, alpha) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * S, y = rnd() * S, r = rmin + rnd() * (rmax - rmin);
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
      const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      g.addColorStop(0, `rgba(${color},${alpha})`); g.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = g; ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    }
  }
}
// height (luminance) -> tangent-space normal map
function normalFrom(src, strength = 2) {
  const S = src.width, sctx = src.getContext('2d'), h = sctx.getImageData(0, 0, S, S).data, out = canvas(S), octx = out.getContext('2d'), img = octx.createImageData(S, S), d = img.data;
  const L = (x, y) => h[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const nx = (L(x - 1, y) - L(x + 1, y)) * strength, ny = (L(x, y - 1) - L(x, y + 1)) * strength, l = Math.hypot(nx, ny, 1), i = (y * S + x) * 4;
    d[i] = (nx / l * 0.5 + 0.5) * 255; d[i + 1] = (ny / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  octx.putImageData(img, 0, 0); return out;
}
function brickCanvases(seed) {
  const S = 512, rnd = mulberry32(seed), col = canvas(S), hgt = canvas(S), c = col.getContext('2d'), h = hgt.getContext('2d');
  noiseFill(c, S, rnd, [70, 64, 58], 18); h.fillStyle = '#000'; h.fillRect(0, 0, S, S);
  const bw = S / 4, bh = S / 12, m = 5;
  for (let row = 0; row < 12; row++) for (let k = -1; k < 5; k++) {
    const x = k * bw + (row % 2 ? bw / 2 : 0), y = row * bh;
    const t = 0.7 + rnd() * 0.5, r = 120 * t, g = 68 * t, b = 52 * t;
    c.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`; c.fillRect(x + m / 2, y + m / 2, bw - m, bh - m);
    h.fillStyle = `rgb(${170 + rnd() * 60 | 0},0,0)`; h.fillRect(x + m / 2 + 1, y + m / 2 + 1, bw - m - 2, bh - m - 2);
    for (let s = 0; s < 40; s++) { c.fillStyle = `rgba(0,0,0,${rnd() * 0.25})`; c.fillRect(x + rnd() * bw, y + rnd() * bh, 2, 2); }
  }
  // grime: darker and wetter toward the bottom of the tile (tile = 2 m tall), streaks down
  const g = c.createLinearGradient(0, 0, 0, S); g.addColorStop(0, 'rgba(10,8,6,0.15)'); g.addColorStop(0.7, 'rgba(14,16,10,0.35)'); g.addColorStop(1, 'rgba(8,10,6,0.75)');
  c.fillStyle = g; c.fillRect(0, 0, S, S);
  for (let i = 0; i < 60; i++) { const x = rnd() * S, w = 2 + rnd() * 6, len = S * (0.2 + rnd() * 0.8); c.fillStyle = `rgba(20,24,14,${0.15 + rnd() * 0.3})`; c.fillRect(x, 0, w, len); }
  blotches(c, S, rnd, 20, '30,36,20', 10, 50, 0.35);
  return { col, hgt };
}
function concreteCanvases(seed, base, stains) {
  const S = 512, rnd = mulberry32(seed), col = canvas(S), c = col.getContext('2d');
  noiseFill(c, S, rnd, base, 26);
  blotches(c, S, rnd, 40, '20,20,16', 15, 80, stains);
  blotches(c, S, rnd, 25, '60,58,50', 10, 40, 0.25);
  c.strokeStyle = 'rgba(10,10,8,0.6)'; c.lineWidth = 1.5;
  for (let i = 0; i < 14; i++) { let x = rnd() * S, y = rnd() * S; c.beginPath(); c.moveTo(x, y); for (let k = 0; k < 10; k++) { x += (rnd() - 0.5) * 40; y += (rnd() - 0.5) * 40; c.lineTo(x, y); } c.stroke(); }
  const hgt = canvas(S); hgt.getContext('2d').drawImage(col, 0, 0);
  return { col, hgt };
}
function metalCanvases(seed) {
  const S = 256, rnd = mulberry32(seed), col = canvas(S), c = col.getContext('2d');
  noiseFill(c, S, rnd, [70, 72, 70], 20);
  for (let y = 0; y < S; y += 16) { c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(0, y, S, 3); c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(0, y + 3, S, 2); }
  blotches(c, S, rnd, 30, '90,50,20', 5, 30, 0.45); // rust
  const hgt = canvas(S); hgt.getContext('2d').drawImage(col, 0, 0);
  return { col, hgt };
}
function texture(cv, repeat = 1, srgb = true) { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; }
function material({ col, hgt }, { rough = 0.85, metal = 0, normal = 2.5, color = 0xffffff } = {}) {
  return new THREE.MeshStandardMaterial({ map: texture(col), normalMap: texture(normalFrom(hgt, normal), 1, false), roughness: rough, metalness: metal, color });
}

// ---------------------------------------------------------------- geometry helpers
// quad from 4 corners (counter-clockwise seen from the side it faces), with world-scaled UVs
function quad(arr, a, b, c, d, uvs) { arr.push({ p: [a, b, c, d], uv: uvs }); }
function toGeometry(quads) {
  if (!quads.length) return null;
  const pos = [], uv = [], idx = [];
  for (const q of quads) {
    const base = pos.length / 3;
    for (let i = 0; i < 4; i++) { pos.push(...q.p[i]); uv.push(...q.uv[i]); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// visuals: false builds only the collider and layout data (no canvas textures), for headless tests and servers.
export function buildSewer(def, { visuals = true } = {}) {
  const C = def.cell, map = def.map, rows = map.length, cols = map[0].length, H = def.heights;
  const at = (c, r) => (r < 0 || c < 0 || r >= rows || c >= cols) ? '#' : map[r][c];
  const open = ch => ch !== '#';
  const hOf = ch => H[ch] || H['.'];
  const center = ([c, r]) => [c * C + C / 2, r * C + C / 2];
  const rnd = mulberry32(1234);

  const mats = !visuals ? null : {
    brick: material(brickCanvases(7), { rough: 0.8, normal: 3 }),
    floor: material(concreteCanvases(11, [92, 88, 78], 0.5), { rough: 0.45, normal: 1.5 }), // wet: low roughness so the flashlight glints
    ceil: material(concreteCanvases(13, [66, 64, 58], 0.6), { rough: 0.9, normal: 1.5 }),
    metal: material(metalCanvases(17), { rough: 0.6, metal: 0.5, normal: 1.5 }),
    channel: material(concreteCanvases(19, [44, 46, 36], 0.7), { rough: 0.3, normal: 1.2 }),
  };
  const Q = { brick: [], floor: [], ceil: [], metal: [], channel: [] };
  const surfQ = { concrete: [], metal: [], water: [] }; // same quads, grouped by impact surface for the collider

  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const ch = at(c, r); if (!open(ch)) continue;
    const { floor: f, ceil: k } = hOf(ch), x0 = c * C, x1 = x0 + C, z0 = r * C, z1 = z0 + C;
    const vent = ch === 'v', water = ch === '~';
    const floorM = vent ? 'metal' : water ? 'channel' : 'floor', wallM = vent ? 'metal' : water ? 'channel' : 'brick', ceilM = vent ? 'metal' : 'ceil';
    const fq = { p: [[x0, f, z1], [x1, f, z1], [x1, f, z0], [x0, f, z0]], uv: [[x0 / 2, z1 / 2], [x1 / 2, z1 / 2], [x1 / 2, z0 / 2], [x0 / 2, z0 / 2]] };
    Q[floorM].push(fq); surfQ[water ? 'water' : vent ? 'metal' : 'concrete'].push(fq);
    const cq = { p: [[x0, k, z0], [x1, k, z0], [x1, k, z1], [x0, k, z1]], uv: [[x0 / 2, z0 / 2], [x1 / 2, z0 / 2], [x1 / 2, z1 / 2], [x0 / 2, z1 / 2]] };
    Q[ceilM].push(cq); surfQ[vent ? 'metal' : 'concrete'].push(cq);
    // four sides: [neighbour dc, dr, edge start, edge end] with the edge running so the face points into this cell
    const sides = [
      [0, -1, [x1, z0], [x0, z0]], [0, 1, [x0, z1], [x1, z1]],
      [-1, 0, [x0, z0], [x0, z1]], [1, 0, [x1, z1], [x1, z0]],
    ];
    for (const [dc, dr, A, B] of sides) {
      const nch = at(c + dc, r + dr);
      const wall = (y0, y1, m) => {
        if (y1 - y0 < 0.01) return;
        const len = Math.hypot(B[0] - A[0], B[1] - A[1]), u0 = (A[0] + A[1]) / 2, u1 = u0 + len / 2;
        const q = { p: [[B[0], y0, B[1]], [A[0], y0, A[1]], [A[0], y1, A[1]], [B[0], y1, B[1]]], uv: [[u1, y0 / 2], [u0, y0 / 2], [u0, y1 / 2], [u1, y1 / 2]] }; // B->A so the face points into this cell
        Q[m].push(q); surfQ[m === 'metal' ? 'metal' : 'concrete'].push(q);
      };
      if (!open(nch)) { wall(f, k, wallM); continue; }
      const n = hOf(nch);
      if (n.floor > f) wall(f, Math.min(n.floor, k), water ? 'channel' : wallM);
      if (n.ceil < k) wall(Math.max(n.ceil, f), k, nch === 'v' || vent ? 'metal' : wallM);
    }
  }

  const root = new THREE.Group();
  if (visuals) for (const [m, qs] of Object.entries(Q)) { const g = toGeometry(qs); if (!g) continue; const mesh = new THREE.Mesh(g, mats[m]); mesh.receiveShadow = true; mesh.castShadow = true; root.add(mesh); }

  // ---------- dressing: wall pipes, pump machinery, rubble, light fixtures, exit gate ----------
  const dress = [], dressMat = new THREE.MeshStandardMaterial({ color: 0x3e3a33, roughness: 0.55, metalness: 0.6 });
  const rust = new THREE.MeshStandardMaterial({ color: 0x5a3a24, roughness: 0.8, metalness: 0.3 });
  const solidBoxes = []; // collidable dressing (world boxes)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const ch = at(c, r); if (ch !== '.' && ch !== 'P') continue;
    const k = hOf(ch).ceil;
    // a run of pipe along any rock wall, near the ceiling
    for (const [dc, dr, ox, oz, rotY] of [[0, -1, 0, -1, 0], [0, 1, 0, 1, 0], [-1, 0, -1, 0, Math.PI / 2], [1, 0, 1, 0, Math.PI / 2]]) {
      if (open(at(c + dc, r + dr)) || rnd() < 0.35) continue;
      const g = new THREE.CylinderGeometry(0.09, 0.09, C, 8).rotateZ(Math.PI / 2).rotateY(rotY);
      const [cx, cz] = center([c, r]);
      g.translate(cx + ox * (C / 2 - 0.15), k - 0.35, cz + oz * (C / 2 - 0.15)); dress.push(g);
      if (rnd() < 0.25) { const b = new THREE.CylinderGeometry(0.13, 0.13, 0.12, 8).rotateZ(Math.PI / 2).rotateY(rotY); b.translate(cx + ox * (C / 2 - 0.15), k - 0.35, cz + oz * (C / 2 - 0.15)); dress.push(b); }
    }
    // rubble
    if (rnd() < 0.18) for (let i = 0; i < 4; i++) { const [cx, cz] = center([c, r]); const s = 0.06 + rnd() * 0.12; dress.push(new THREE.BoxGeometry(s * 1.4, s, s).rotateY(rnd() * 3).translate(cx + (rnd() - 0.5) * 1.6, s / 2, cz + (rnd() - 0.5) * 1.6)); }
  }
  // pump hall machinery: big tanks and a pump housing (solid cover)
  const machines = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (at(c, r) === 'P' && at(c, r - 1) !== 'P' && c % 4 === 1) machines.push([c, r]);
  for (const [c, r] of machines) {
    const [cx, cz] = center([c, r + 1]);
    const tank = new THREE.CylinderGeometry(0.7, 0.7, 2.2, 16).translate(cx, 1.1, cz); const tankTop = new THREE.CylinderGeometry(0.35, 0.7, 0.4, 16).translate(cx, 2.4, cz);
    const riser = new THREE.CylinderGeometry(0.1, 0.1, 3.0, 8).translate(cx + 0.5, 4.0, cz);
    dress.push(tank, tankTop, riser); solidBoxes.push([cx, 1.2, cz, 1.4, 2.4, 1.4]);
  }
  const pumpHousing = (cx, cz) => { dress.push(new THREE.BoxGeometry(2.4, 1.3, 1.4).translate(cx, 0.65, cz), new THREE.CylinderGeometry(0.5, 0.5, 1.5, 12).rotateZ(Math.PI / 2).translate(cx, 1.6, cz)); solidBoxes.push([cx, 0.85, cz, 2.4, 1.7, 1.4]); };
  pumpHousing(...center([21, 18])); pumpHousing(...center([14, 20])); pumpHousing(...center([23, 21]));
  // exit gate bars
  const gateBars = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (at(c, r) === 'X' && at(c + 1, r) === '#') for (let i = 0; i < 6; i++) { const z = r * C + (i + 0.5) * C / 6; gateBars.push(new THREE.CylinderGeometry(0.03, 0.03, 3.2, 6).translate(c * C + C - 0.3, 1.6, z)); }
  if (dress.length) { const m = new THREE.Mesh(mergeGeometries(dress.map(g => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; }), false), dressMat); m.castShadow = m.receiveShadow = true; root.add(m); }
  if (gateBars.length) { const m = new THREE.Mesh(mergeGeometries(gateBars), rust); m.castShadow = true; root.add(m); }

  // ---------- water ----------
  const wq = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (at(c, r) === '~') {
    const y = hOf('~').floor + 0.2, x0 = c * C, x1 = x0 + C, z0 = r * C, z1 = z0 + C;
    wq.push({ p: [[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]], uv: [[x0 / 3, z1 / 3], [x1 / 3, z1 / 3], [x1 / 3, z0 / 3], [x0 / 3, z0 / 3]] });
  }
  let water = null;
  if (wq.length && visuals) {
    const nrm = canvas(256); { const ctx = nrm.getContext('2d'); ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, 256, 256); const r2 = mulberry32(5); for (let i = 0; i < 300; i++) { const x = r2() * 256, y = r2() * 256, rr = 4 + r2() * 18; const g = ctx.createRadialGradient(x, y, 0, x, y, rr); g.addColorStop(0, `rgba(255,255,255,${0.2 + r2() * 0.3})`); g.addColorStop(1, 'rgba(128,128,128,0)'); ctx.fillStyle = g; ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2); } }
    const nt = texture(normalFrom(nrm, 4), 1, false);
    water = new THREE.Mesh(toGeometry(wq), new THREE.MeshStandardMaterial({ color: 0x1d2418, roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.86, normalMap: nt, normalScale: new THREE.Vector2(0.6, 0.6) }));
    water.receiveShadow = true; root.add(water);
  }

  // ---------- lights (fixtures + point lights) ----------
  const lights = [];
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd9a0, emissiveIntensity: 2 });
  for (const L of def.lights || []) {
    const [cx, cz] = center(L.cell), ch = at(...L.cell), y = L.height ?? hOf(ch).ceil - 0.35;
    const light = new THREE.PointLight(L.color, L.intensity * 6, 16, 1.7); // data intensities are relative; x6 to physical units light.position.set(cx, y - 0.15, cz);
    const bm = bulbMat.clone(); bm.emissive.set(L.color);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), bm); bulb.position.copy(light.position);
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.08, 0.18, 8, 1, true), dressMat); cage.position.set(cx, y - 0.1, cz);
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, hOf(ch).ceil - y, 4), dressMat); wire.position.set(cx, (hOf(ch).ceil + y) / 2, cz);
    root.add(light, bulb, cage, wire);
    lights.push({ light, bulb, base: L.intensity * 6, flicker: L.flicker || 0, phase: rnd() * 100 });
  }

  // ---------- collider: every surface quad + solid dressing, with an impact surface per triangle ----------
  const parts = [], surf = [];
  for (const [name, qs] of Object.entries(surfQ)) { const g = toGeometry(qs); if (!g) continue; const ng = g.toNonIndexed(); for (const k of Object.keys(ng.attributes)) if (k !== 'position') ng.deleteAttribute(k); parts.push(ng); surf.push([ng.attributes.position.count / 3, SURF(name === 'water' ? 'water' : name)]); }
  for (const [x, y, z, w, h, d] of solidBoxes) { const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed(); g.deleteAttribute('normal'); g.deleteAttribute('uv'); parts.push(g); surf.push([g.attributes.position.count / 3, SURF('metal')]); }
  const geometry = mergeGeometries(parts, false), triSurface = new Uint8Array(geometry.attributes.position.count / 3);
  let t = 0; for (const [n, s] of surf) { triSurface.fill(s, t, t + n); t += n; }
  const collider = { geometry, bvh: new MeshBVH(geometry), triSurface };

  return {
    root, collider, lights, water, mats,
    bounds: { x0: 0, z0: 0, width: cols * C, depth: rows * C },
    cellCenter: center, cellAt: (x, z) => at(Math.floor(x / C), Math.floor(z / C)), heightsAt: (x, z) => hOf(at(Math.floor(x / C), Math.floor(z / C))),
  };
}
