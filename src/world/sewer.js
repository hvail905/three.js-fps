// sewer.js : builds a sewer level from an ASCII grid (data/sewer/*.json).
// Every open cell has a floor and ceiling height by type; walls, steps and low headers are generated
// wherever neighbouring cells differ, so tunnels, water channels, tall halls and crawl vents all come
// from one rule. Returns visuals, one collider (bodies, bullets and sight share it), lights and markers.
// World space: cell (c, r) spans x = c*cell .. (c+1)*cell, z = r*cell .. (r+1)*cell.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import { SURFACES } from './level.js';
import { PIXEL_TEXTURES } from './pixeltex.js';
import { PROP_BUILDERS, buildFixture } from './sewer-props.js';
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

  const pix = (name, o = {}) => { const t = PIXEL_TEXTURES[name](); return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: o.rough ?? 0.85, metalness: o.metal ?? 0, color: o.color ?? 0xffffff }); };
  const mats = !visuals ? null : {
    brick: pix('brick'), tile: pix('tile', { rough: 0.5 }), floor: pix('floor', { rough: 0.5 }), // wet floors: low roughness so lights glint
    ceil: pix('ceiling'), metal: pix('plate', { rough: 0.55, metal: 0.4 }), channel: pix('slime', { rough: 0.3 }),
    gdark: pix('brick', { color: 0x4a4a4a }), void: new THREE.MeshBasicMaterial({ color: 0x020202 }),
  };
  const Q = { brick: [], tile: [], floor: [], ceil: [], metal: [], channel: [], gdark: [], void: [] };
  const surfQ = { concrete: [], metal: [], water: [] }; // same quads, grouped by impact surface for the collider

  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const ch = at(c, r); if (!open(ch)) continue;
    const { floor: f, ceil: k } = hOf(ch), x0 = c * C, x1 = x0 + C, z0 = r * C, z1 = z0 + C;
    const vent = ch === 'v', water = ch === '~', room = ch === 'R', gal = ch === 'g';
    const floorM = vent ? 'metal' : water ? 'channel' : room ? 'tile' : 'floor', wallM = vent ? 'metal' : water ? 'channel' : room ? 'tile' : gal ? 'gdark' : 'brick', ceilM = vent ? 'metal' : 'ceil';
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
      // the far end of a barred side tunnel is a black void, so it reads as a tunnel running on into the dark
      if (!open(nch)) { wall(f, k, gal && open(at(c - dc, r - dr)) ? 'void' : wallM); continue; }
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

  // ---------- lights: fixtures by kind ----------
  // side: n/s/w/e mounts the fixture on that wall of the cell; no side hangs it from the ceiling
  const SIDE = { n: [0, -1, 0], s: [0, 1, Math.PI], w: [-1, 0, Math.PI / 2], e: [1, 0, -Math.PI / 2] };
  const mount = (obj, cell, side, y) => {
    const [cx, cz] = center(cell);
    if (side && SIDE[side]) { const [dc, dr, ry] = SIDE[side]; obj.position.set(cx + dc * C / 2, y, cz + dr * C / 2); obj.rotation.y = ry; }
    else obj.position.set(cx, y, cz);
  };
  const lights = [];
  if (visuals) for (const L of def.lights || []) {
    const ch = at(...L.cell), { floor: f, ceil: k } = hOf(ch);
    const y = L.height ?? (L.side ? Math.min(k - 0.4, f + 2.3) : L.kind === 'tube' ? k - 0.25 : k - 0.6);
    const fx = buildFixture(L, k, y); mount(fx.group, L.cell, L.side, y); root.add(fx.group);
    lights.push({ light: fx.light, bulb: fx.glow, kind: L.kind, base: L.intensity * 6, flicker: L.flicker || 0, phase: rnd() * 100 });
  }

  // ---------- props: data-driven dressing that says someone rebuilt this place ----------
  const cameras = [], speakers = [], propSolids = [];
  const WALL_KINDS = new Set(['camera', 'speaker', 'stencil', 'window', 'cabinet', 'locker', 'shelf']);
  for (const p of def.props || []) {
    const build = PROP_BUILDERS[p.kind]; if (!build) continue;
    const ch = at(...p.cell), { floor: f, ceil: k } = hOf(ch);
    let out, nk = k;
    if (p.kind === 'door') { const [dc, dr] = SIDE[p.side]; nk = Math.min(k, hOf(at(p.cell[0] + dc, p.cell[1] + dr)).ceil); }
    out = build(p, { cell: C, openingHeight: nk - f });
    const g = out.group;
    if (p.kind === 'stencil' && p.side === 'floor') { // painted on the floor: rot is degrees clockwise from +x seen from above
      if (g.children[0]) g.children[0].rotation.x = -Math.PI / 2; const [cx, cz] = center(p.cell); g.position.set(cx, f + 0.002, cz); g.rotation.y = -(p.rot || 0) * Math.PI / 180;
    } else if (p.kind === 'door') {
      const [dc, dr] = SIDE[p.side], [cx, cz] = center(p.cell); g.position.set(cx + dc * C / 2, f, cz + dr * C / 2); g.rotation.y = dc ? Math.PI / 2 : 0;
    } else if (WALL_KINDS.has(p.kind) && p.side) {
      const y = p.kind === 'camera' ? k - 0.25 : p.kind === 'speaker' ? (p.y ?? Math.min(k - 0.5, f + 2.2)) : ['cabinet', 'locker', 'shelf'].includes(p.kind) ? f : f + (p.y ?? 1.5);
      mount(g, p.cell, p.side, y);
    } else { const [cx, cz] = center(p.cell); g.position.set(cx, f, cz); g.rotation.y = -(p.rot || 0) * Math.PI / 180; }
    if (visuals) root.add(g);
    g.updateMatrixWorld(true);
    for (const sg of out.solids) propSolids.push([sg.applyMatrix4(g.matrixWorld), p.kind === 'crate' || p.kind === 'shelf' ? 'wood' : 'metal']);
    if (out.light && visuals) lights.push({ light: out.light, bulb: null, kind: 'window', base: out.light.intensity, flicker: 0, phase: 0 });
    if (p.kind === 'camera') cameras.push({ head: out.parts.head, led: out.parts.led, group: g, phase: rnd() * 6 });
    if (p.kind === 'speaker') { const v = new THREE.Vector3(); g.getWorldPosition(v); speakers.push([v.x, v.y, v.z]); }
  }

  // ---------- architecture: brick ribs along the tunnels, trim in the tiled rooms ----------
  // Compared against Gloomwood/Pigface, flat walls with texture alone read as empty; the references break every
  // wall up with pilasters, beams, frames and trim. World-space UVs keep the brick scale continuous on the ribs.
  const worldUV = geo => {
    const g = geo.index ? geo.toNonIndexed() : geo, P = g.attributes.position, N = g.attributes.normal, uv = new Float32Array(P.count * 2);
    for (let i = 0; i < P.count; i++) { const nx = Math.abs(N.getX(i)), ny = Math.abs(N.getY(i)), x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      const [u, v] = ny > 0.5 ? [x, z] : nx > 0.5 ? [z, y] : [x, y]; uv[i * 2] = u / 2; uv[i * 2 + 1] = v / 2; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return g;
  };
  const ribs = [], trim = [], beams = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const ch = at(c, r); if (ch !== '.') continue;
    const { floor: f, ceil: k } = hOf(ch), [cx, cz] = center([c, r]);
    const alongX = open(at(c - 1, r)) && open(at(c + 1, r)) && !open(at(c, r - 1)) && !open(at(c, r + 1));
    const alongZ = open(at(c, r - 1)) && open(at(c, r + 1)) && !open(at(c - 1, r)) && !open(at(c + 1, r));
    if (!(alongX && c % 3 === 0) && !(alongZ && r % 3 === 0)) continue;
    const pw = 0.45, pd = 0.2, bh = 0.3;
    for (const s of [-1, 1]) {
      const g = alongX ? new THREE.BoxGeometry(pw, k - f, pd).translate(cx, f + (k - f) / 2, cz + s * (C / 2 - pd / 2)) : new THREE.BoxGeometry(pd, k - f, pw).translate(cx + s * (C / 2 - pd / 2), f + (k - f) / 2, cz);
      ribs.push(g); propSolids.push([g.clone(), 'concrete']);
    }
    ribs.push(alongX ? new THREE.BoxGeometry(pw, bh, C).translate(cx, k - bh / 2, cz) : new THREE.BoxGeometry(C, bh, pw).translate(cx, k - bh / 2, cz));
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (at(c, r) !== 'R') continue; const f = hOf('R').floor, [cx, cz] = center([c, r]);
    for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      if (open(at(c + dc, r + dr))) continue;
      const ex = cx + dc * (C / 2 - 0.03), ez = cz + dr * (C / 2 - 0.03), w = dr ? C : 0.06, d = dc ? C : 0.06;
      trim.push(new THREE.BoxGeometry(w, 0.14, d).translate(ex, f + 0.07, ez), new THREE.BoxGeometry(w, 0.06, d).translate(ex, f + 1.15, ez));
    }
  }
  // steel I-beams across the pump hall ceiling so the tall space has structure instead of a black lid
  for (let c = 0; c < cols; c++) {
    if (c % 2) continue; let r0 = -1, r1 = -1;
    for (let r = 0; r < rows; r++) if (at(c, r) === 'P') { if (r0 < 0) r0 = r; r1 = r; }
    if (r0 < 0) continue; const k = hOf('P').ceil, x = c * C + C / 2, z0 = r0 * C, z1 = (r1 + 1) * C, L = z1 - z0, zc = (z0 + z1) / 2;
    beams.push(new THREE.BoxGeometry(0.3, 0.05, L).translate(x, k - 0.03, zc), new THREE.BoxGeometry(0.06, 0.4, L).translate(x, k - 0.25, zc), new THREE.BoxGeometry(0.3, 0.05, L).translate(x, k - 0.48, zc));
    for (let z = z0 + 1; z < z1; z += 2) beams.push(new THREE.CylinderGeometry(0.012, 0.012, 1.4, 4).translate(x + 0.3, k - 1.2, z), new THREE.BoxGeometry(0.4, 0.06, 0.15).translate(x + 0.3, k - 1.9, z)); // hanging chains and hooks
  }
  if (visuals && beams.length) { const m = new THREE.Mesh(mergeGeometries(beams.map(g => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; }), false), dressMat); m.castShadow = true; root.add(m); }
  if (visuals && ribs.length) { const m = new THREE.Mesh(mergeGeometries(ribs.map(worldUV), false), mats.brick); m.castShadow = m.receiveShadow = true; root.add(m); }
  if (visuals && trim.length) { const m = new THREE.Mesh(mergeGeometries(trim.map(g => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; }), false), new THREE.MeshStandardMaterial({ color: 0x2c3a30, roughness: 0.5, flatShading: true })); m.receiveShadow = true; root.add(m); }

  // ---------- clutter: the references fill every floor edge and wall with small things ----------
  // No loose bottles or bricks here, so junk never reads as a pickup.
  if (visuals) {
    const J = { paper: [], card: [], can: [], wood: [], rag: [], box: [], conduit: [] }, rr = mulberry32(99);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const ch = at(c, r); if (!'.RPX'.includes(ch)) continue;
      const { floor: f, ceil: k } = hOf(ch), [cx, cz] = center([c, r]);
      for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        if (open(at(c + dc, r + dr))) continue;
        const wx = cx + dc * (C / 2 - 0.25), wz = cz + dr * (C / 2 - 0.25), along = () => (rr() - 0.5) * C * 0.8;
        const px = () => wx + (dr ? along() : (rr() - 0.5) * 0.2), pz = () => wz + (dc ? along() : (rr() - 0.5) * 0.2);
        if (rr() < 0.45) for (let i = 0; i < 2 + rr() * 4; i++) J.paper.push(new THREE.PlaneGeometry(0.21 + rr() * 0.1, 0.28 + rr() * 0.1).rotateX(-Math.PI / 2).rotateY(rr() * 6).translate(px() + (rr() - 0.5) * 0.6 * -dc, f + 0.004 + i * 0.001, pz() + (rr() - 0.5) * 0.6 * -dr));
        if (rr() < 0.25) for (let i = 0; i < 1 + rr() * 3; i++) J.can.push(new THREE.CylinderGeometry(0.033, 0.033, 0.12, 7).rotateZ(rr() < 0.6 ? Math.PI / 2 : 0).rotateY(rr() * 6).translate(px(), f + 0.04, pz()));
        if (rr() < 0.18) { const s = 0.3 + rr() * 0.3; J.card.push(new THREE.BoxGeometry(s * 1.3, s * 0.8, s).rotateY(rr() * 0.6).translate(px(), f + s * 0.4, pz())); if (rr() < 0.5) J.card.push(new THREE.BoxGeometry(s, s * 0.6, s * 0.8).rotateY(rr()).translate(px(), f + s * 0.8 + s * 0.3, pz())); }
        if (rr() < 0.12) { const g = new THREE.BoxGeometry(0.15, 1.6 + rr() * 0.6, 0.03).rotateX(dr * 0.25).rotateZ(-dc * 0.25); g.translate(cx + dc * (C / 2 - 0.2) + (dr ? along() : 0), f + 0.85, cz + dr * (C / 2 - 0.2) + (dc ? along() : 0)); J.wood.push(g); }
        if (rr() < 0.15) J.rag.push(new THREE.SphereGeometry(0.18, 6, 4).scale(1.4, 0.35, 1).rotateY(rr() * 6).translate(px(), f + 0.04, pz()));
        // wall: junction boxes with conduit to the ceiling, and notices pinned up by whoever runs this place
        if (ch !== 'X' && rr() < 0.16) {
          const ex = cx + dc * (C / 2 - 0.06), ez = cz + dr * (C / 2 - 0.06), o = (rr() - 0.5) * C * 0.6, x = ex + (dr ? o : 0), z = ez + (dc ? o : 0), y = f + 1.3 + rr() * 0.4;
          J.box.push(new THREE.BoxGeometry(dr ? 0.3 : 0.12, 0.38, dc ? 0.3 : 0.12).translate(x, y, z), new THREE.CylinderGeometry(0.02, 0.02, k - y, 5).translate(x + (dr ? 0.08 : 0), (k + y) / 2, z + (dc ? 0.08 : 0)));
        }
        if (ch !== 'X' && rr() < 0.12) {
          const ex = cx + dc * (C / 2 - 0.012), ez = cz + dr * (C / 2 - 0.012), o = (rr() - 0.5) * C * 0.6;
          const g = new THREE.PlaneGeometry(0.21, 0.3).rotateZ((rr() - 0.5) * 0.15).rotateY(dc ? -dc * Math.PI / 2 : dr > 0 ? Math.PI : 0); g.translate(ex + (dr ? o : 0), f + 1.45 + rr() * 0.2, ez + (dc ? o : 0)); J.paper.push(g);
        }
      }
    }
    const tx = n => { const t = PIXEL_TEXTURES[n](); return { map: t.map, normalMap: t.normalMap }; };
    const JM = { paper: new THREE.MeshStandardMaterial({ ...tx('paper'), roughness: 0.95, side: THREE.DoubleSide }), card: new THREE.MeshStandardMaterial({ ...tx('cardboard'), roughness: 1 }),
      can: new THREE.MeshStandardMaterial({ color: 0x6a5a48, roughness: 0.5, metalness: 0.5, flatShading: true }), wood: new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.9, flatShading: true }),
      rag: new THREE.MeshStandardMaterial({ color: 0x3a3428, roughness: 1, flatShading: true }), box: dressMat, conduit: dressMat };
    for (const [k, gs] of Object.entries(J)) if (gs.length) { const keepUV = k === 'paper' || k === 'card'; const m = new THREE.Mesh(mergeGeometries(gs.map(g => { if (!keepUV) g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; }), false), JM[k]); m.receiveShadow = true; m.castShadow = k !== 'paper'; root.add(m); }
  }

  // ---------- bars across the mouths of the side tunnels ----------
  const bars = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (at(c, r) === 'g') for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const n = at(c + dc, r + dr); if (!open(n) || n === 'g') continue;
    const [cx, cz] = center([c, r]), ex = cx + dc * C / 2, ez = cz + dr * C / 2, k = Math.min(hOf('g').ceil, hOf(n).ceil);
    for (let i = 0; i < 9; i++) { const o = -C / 2 + (i + 0.5) * C / 9; bars.push(new THREE.CylinderGeometry(0.025, 0.025, k, 6).translate(ex + (dr ? o : 0), k / 2, ez + (dc ? o : 0))); }
    for (const y of [0.15, 1.2, k - 0.1]) bars.push(new THREE.BoxGeometry(dr ? C : 0.06, 0.06, dc ? C : 0.06).translate(ex, y, ez));
    propSolids.push([new THREE.BoxGeometry(dr ? C : 0.12, k, dc ? C : 0.12).translate(ex, k / 2, ez), 'metal']);
  }
  if (bars.length && visuals) { const m = new THREE.Mesh(mergeGeometries(bars.map(g => g.index ? g.toNonIndexed() : g), false), rust); m.castShadow = true; root.add(m); }

  // ---------- cable bundles stapled along corridor ceilings ----------
  if (visuals) {
    const cab = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const ch = at(c, r); if (ch !== '.' && ch !== 'R') continue;
      const k = hOf(ch).ceil, [cx, cz] = center([c, r]), alongX = open(at(c - 1, r)) || open(at(c + 1, r));
      for (let i = 0; i < 3; i++) {
        const off = -0.5 + i * 0.07, sag = 0.04 + i * 0.02;
        const g = new THREE.CylinderGeometry(0.018, 0.018, C, 5).rotateZ(Math.PI / 2);
        if (!alongX) g.rotateY(Math.PI / 2);
        g.translate(cx + (alongX ? 0 : off), k - 0.08 - sag, cz + (alongX ? off : 0)); cab.push(g);
      }
      if ((c + r) % 2 === 0) cab.push(new THREE.BoxGeometry(alongX ? 0.04 : 0.3, 0.1, alongX ? 0.3 : 0.04).translate(cx + (alongX ? 0 : -0.43), k - 0.08, cz + (alongX ? -0.43 : 0)));
    }
    if (cab.length) { const m = new THREE.Mesh(mergeGeometries(cab.map(g => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; }), false), new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.5 })); root.add(m); }
  }

  // ---------- collider: every surface quad + solid dressing, with an impact surface per triangle ----------
  const parts = [], surf = [];
  for (const [name, qs] of Object.entries(surfQ)) { const g = toGeometry(qs); if (!g) continue; const ng = g.toNonIndexed(); for (const k of Object.keys(ng.attributes)) if (k !== 'position') ng.deleteAttribute(k); parts.push(ng); surf.push([ng.attributes.position.count / 3, SURF(name === 'water' ? 'water' : name)]); }
  for (const [g0, sname] of propSolids) { const g = g0.index ? g0.toNonIndexed() : g0; for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k); parts.push(g); surf.push([g.attributes.position.count / 3, SURF(sname)]); }
  for (const [x, y, z, w, h, d] of solidBoxes) { const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed(); g.deleteAttribute('normal'); g.deleteAttribute('uv'); parts.push(g); surf.push([g.attributes.position.count / 3, SURF('metal')]); }
  const geometry = mergeGeometries(parts, false), triSurface = new Uint8Array(geometry.attributes.position.count / 3);
  let t = 0; for (const [n, s] of surf) { triSurface.fill(s, t, t + n); t += n; }
  const collider = { geometry, bvh: new MeshBVH(geometry), triSurface };

  return {
    root, collider, lights, water, mats, cameras, speakers,
    bounds: { x0: 0, z0: 0, width: cols * C, depth: rows * C },
    cellCenter: center, cellAt: (x, z) => at(Math.floor(x / C), Math.floor(z / C)), heightsAt: (x, z) => hOf(at(Math.floor(x / C), Math.floor(z / C))),
  };
}
