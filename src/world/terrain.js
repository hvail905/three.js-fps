// terrain.js : deterministic terrain generator on plain data (no three.js).
// generateTerrain(params) -> { res, size, cell, heights, normals, splat, aux, scatter, lots, water, stats }
// Same params + seed always give the same map, so a co-op host only needs to share the settings.

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 2D simplex noise (Gustavson), seeded permutation. Output roughly [-1, 1].
export function makeNoise(seed) {
  const rnd = mulberry32(seed * 9973 + 17);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const GX = [1, -1, 1, -1, 1, -1, 0, 0], GY = [1, 1, -1, -1, 0, 0, 1, -1];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  return function (xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0, tt, g;
    tt = 0.5 - x0 * x0 - y0 * y0; if (tt > 0) { g = perm[ii + perm[jj]] & 7; tt *= tt; n += tt * tt * (GX[g] * x0 + GY[g] * y0); }
    tt = 0.5 - x1 * x1 - y1 * y1; if (tt > 0) { g = perm[ii + i1 + perm[jj + j1]] & 7; tt *= tt; n += tt * tt * (GX[g] * x1 + GY[g] * y1); }
    tt = 0.5 - x2 * x2 - y2 * y2; if (tt > 0) { g = perm[ii + 1 + perm[jj + 1]] & 7; tt *= tt; n += tt * tt * (GX[g] * x2 + GY[g] * y2); }
    return 70 * n;
  };
}

function fbm(n, x, y, oct, lac, gain) {
  let a = 1, f = 1, sum = 0, norm = 0;
  for (let o = 0; o < oct; o++) { sum += a * n(x * f + o * 17.3, y * f - o * 9.1); norm += a; a *= gain; f *= lac; }
  return sum / norm;
}
function ridged(n, x, y, oct, lac, gain) {
  let a = 1, f = 1, sum = 0, norm = 0, w = 1;
  for (let o = 0; o < oct; o++) {
    let v = 1 - Math.abs(n(x * f + o * 31.7, y * f + o * 4.3));
    v *= v; v *= w; w = Math.min(1, Math.max(0, v * 1.6));
    sum += a * v; norm += a; a *= gain; f *= lac;
  }
  return sum / norm;
}
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- biomes
// Splat channels: 0 = ground cover, 1 = path / dirt / road, 2 = rock (slopes), 3 = special (rule below).
// Texture kinds are drawn by the viewer; colors are part of the data so exports can bake them.
export const BIOMES = {
  temperate: {
    label: 'Temperate',
    layers: [
      { kind: 'grass', c: ['#4f6b2c', '#6f8a3a', '#38521f'], tile: 4 },
      { kind: 'dirt', c: ['#6b5238', '#8a6e4e', '#4c3a28'], tile: 3 },
      { kind: 'rock', c: ['#76746e', '#99968e', '#55534f'], tile: 6 },
      { kind: 'sand', c: ['#c2ad84', '#d8c6a0', '#a8916a'], tile: 3 },
    ],
    special: 'beach', grass: { amount: 1, color: ['#3d5a1e', '#86a345'], height: 0.45 },
    sky: { fog: '#b9c8d4', hemiSky: '#cfe0f0', hemiGround: '#4b4a36', sun: '#fff1dc' },
    scatter: [
      { type: 'pine', density: 1.6, slopeMax: 32, forest: 0.75, scale: [0.8, 1.35] },
      { type: 'broadleaf', density: 1.2, slopeMax: 26, forest: 0.6, scale: [0.8, 1.3] },
      { type: 'shrub', density: 5, slopeMax: 35, forest: 0.3, scale: [0.6, 1.3] },
      { type: 'rock', density: 3, slopeMax: 60, rocky: 1, scale: [0.4, 1.4] },
      { type: 'boulder', density: 0.4, slopeMax: 40, rocky: 0.6, scale: [0.8, 1.6] },
    ],
  },
  alpine: {
    label: 'Alpine',
    layers: [
      { kind: 'grass', c: ['#43592d', '#5d7340', '#2f4220'], tile: 4 },
      { kind: 'gravel', c: ['#77736c', '#9a958c', '#56524c'], tile: 3 },
      { kind: 'rock', c: ['#6c6e72', '#8e9196', '#4a4c50'], tile: 7 },
      { kind: 'snow', c: ['#e9eef3', '#ffffff', '#c9d3de'], tile: 5 },
    ],
    special: 'snow', snowLine: 0.42, grass: { amount: 0.7, color: ['#34481f', '#6f8549'], height: 0.3 },
    sky: { fog: '#c4d0dc', hemiSky: '#d8e6f4', hemiGround: '#50524e', sun: '#fff6ea' },
    scatter: [
      { type: 'pine', density: 2.4, slopeMax: 34, forest: 0.85, maxH: 0.6, scale: [0.7, 1.5] },
      { type: 'rock', density: 5, slopeMax: 65, rocky: 1, scale: [0.4, 1.6] },
      { type: 'boulder', density: 0.8, slopeMax: 45, rocky: 0.6, scale: [0.8, 2] },
    ],
  },
  desert: {
    label: 'Desert',
    layers: [
      { kind: 'sand', c: ['#c99d68', '#ddb985', '#a87d4e'], tile: 4 },
      { kind: 'cracked', c: ['#a8805a', '#c19a72', '#7c5b3e'], tile: 5 },
      { kind: 'rock', c: ['#9a5f42', '#b97d5c', '#6e4130'], tile: 8 },
      { kind: 'gravel', c: ['#8e7357', '#ab8f70', '#6a533d'], tile: 3 },
    ],
    special: 'patches', grass: { amount: 0, color: ['#8a7a45', '#b9a462'], height: 0.3 },
    sky: { fog: '#e0cfb4', hemiSky: '#f2e4cc', hemiGround: '#7a5a3c', sun: '#fff0d6' },
    scatter: [
      { type: 'cactus', density: 0.6, slopeMax: 22, forest: 0.2, scale: [0.7, 1.4] },
      { type: 'deadshrub', density: 3, slopeMax: 30, forest: 0.1, scale: [0.5, 1.2] },
      { type: 'rock', density: 3, slopeMax: 65, rocky: 1, scale: [0.4, 1.5] },
      { type: 'boulder', density: 0.6, slopeMax: 45, rocky: 0.8, scale: [1, 2.2] },
    ],
  },
  autumn: {
    label: 'Autumn',
    layers: [
      { kind: 'leaves', c: ['#7a4f24', '#b5652a', '#5a3a1c'], tile: 3 },
      { kind: 'dirt', c: ['#5c4632', '#7a5f45', '#3f2f22'], tile: 3 },
      { kind: 'rock', c: ['#6e6b64', '#8f8b82', '#4f4c47'], tile: 6 },
      { kind: 'grass', c: ['#6b6a32', '#8c8640', '#4c4a22'], tile: 4 },
    ],
    special: 'patches', grass: { amount: 0.45, color: ['#5a5524', '#a8963f'], height: 0.4 },
    sky: { fog: '#c8bfae', hemiSky: '#e3d9c6', hemiGround: '#4f3e2a', sun: '#ffe2bd' },
    scatter: [
      { type: 'autumn', density: 2.2, slopeMax: 30, forest: 0.8, scale: [0.8, 1.3] },
      { type: 'pine', density: 0.4, slopeMax: 32, forest: 0.7, scale: [0.8, 1.2] },
      { type: 'shrub', density: 3, slopeMax: 35, forest: 0.4, scale: [0.6, 1.2] },
      { type: 'rock', density: 2.5, slopeMax: 60, rocky: 1, scale: [0.4, 1.3] },
    ],
  },
  wasteland: {
    label: 'Wasteland',
    layers: [
      { kind: 'drygrass', c: ['#7d7350', '#9c9064', '#5c5438'], tile: 4 },
      { kind: 'mud', c: ['#4a4036', '#62564a', '#342c25'], tile: 4 },
      { kind: 'rock', c: ['#58544f', '#77726b', '#3c3936'], tile: 6 },
      { kind: 'gravel', c: ['#5e5a55', '#7b766f', '#45423e'], tile: 3 },
    ],
    special: 'patches', grass: { amount: 0.35, color: ['#5c5536', '#a39a6b'], height: 0.35 },
    sky: { fog: '#a9a59a', hemiSky: '#c9c4b6', hemiGround: '#3e3a33', sun: '#f3e6cf' },
    scatter: [
      { type: 'dead', density: 0.9, slopeMax: 30, forest: 0.5, scale: [0.7, 1.3] },
      { type: 'deadshrub', density: 3.5, slopeMax: 35, forest: 0.2, scale: [0.6, 1.3] },
      { type: 'rock', density: 3, slopeMax: 65, rocky: 1, scale: [0.4, 1.4] },
      { type: 'boulder', density: 0.5, slopeMax: 45, rocky: 0.6, scale: [0.8, 1.8] },
    ],
  },
  urban: {
    label: 'Urban',
    layers: [
      { kind: 'grass', c: ['#55702f', '#73903f', '#3c5521'], tile: 3 },
      { kind: 'asphalt', c: ['#3b3c3e', '#4c4d50', '#2c2d2f'], tile: 6 },
      { kind: 'rock', c: ['#7d7a74', '#9a978f', '#5d5b56'], tile: 6 },
      { kind: 'concrete', c: ['#9c9a94', '#b3b1aa', '#84827d'], tile: 4 },
    ],
    special: 'lots', grass: { amount: 0.8, color: ['#40601f', '#8aa64c'], height: 0.12 },
    sky: { fog: '#bcc6cf', hemiSky: '#d6e2ee', hemiGround: '#4a4944', sun: '#fff1dc' },
    scatter: [
      { type: 'broadleaf', density: 1.4, slopeMax: 25, forest: 0.4, scale: [0.7, 1.1] },
      { type: 'shrub', density: 3, slopeMax: 30, forest: 0.2, scale: [0.5, 1] },
    ],
  },
};

export const LAYOUTS = {
  hills: { label: 'Rolling hills', p: { heightScale: 28, featureScale: 140, ridged: 0.2, warp: 0.35, water: 0 } },
  mountains: { label: 'Mountains', p: { heightScale: 70, featureScale: 200, ridged: 0.75, warp: 0.3, water: 0 } },
  valley: { label: 'River valley', p: { heightScale: 36, featureScale: 130, ridged: 0.35, warp: 0.3, water: 0.1 } },
  plateau: { label: 'Mesa / plateau', p: { heightScale: 34, featureScale: 150, ridged: 0.15, warp: 0.4, water: 0 } },
  island: { label: 'Island', p: { heightScale: 32, featureScale: 110, ridged: 0.35, warp: 0.45, water: 0.2 } },
  urban: { label: 'Urban grid', p: { heightScale: 14, featureScale: 220, ridged: 0, warp: 0.2, water: 0 } },
};

export const DEFAULTS = {
  seed: 1337, layout: 'hills', biome: 'temperate',
  size: 256, res: 257,
  heightScale: 28, featureScale: 140, octaves: 6, roughness: 0.5, lacunarity: 2.0,
  ridged: 0.2, warp: 0.35,
  erosion: 30000, erosionStrength: 0.3,
  terraces: 0, terraceSharp: 0.6,
  water: 0, sandBand: 1.5,
  rockSlope: 38, maxSlope: 45,
  blockSize: 48, roadWidth: 10, parkChance: 0.2,
  treeDensity: 1, rockDensity: 1, shrubDensity: 1,
};

// ---------------------------------------------------------------- erosion (particle droplets, after S. Lague)
function erode(H, res, iterations, strength, rnd, dep) {
  const inertia = 0.05, capacityK = 4, minCap = 0.01, depositK = 0.3, erodeK = strength, evap = 0.015, gravity = 4, maxSteps = 40, R = 2;
  const bOff = [], bW = []; let wsum = 0;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const d = Math.hypot(dx, dy); if (d > R) continue;
    bOff.push([dx, dy]); bW.push(R - d); wsum += R - d;
  }
  for (let k = 0; k < bW.length; k++) bW[k] /= wsum;
  const hg = (x, y, out) => {
    const cx = x | 0, cy = y | 0, u = x - cx, v = y - cy, i = cy * res + cx;
    const nw = H[i], ne = H[i + 1], sw = H[i + res], se = H[i + res + 1];
    out.gx = (ne - nw) * (1 - v) + (se - sw) * v;
    out.gy = (sw - nw) * (1 - u) + (se - ne) * u;
    out.h = nw * (1 - u) * (1 - v) + ne * u * (1 - v) + sw * (1 - u) * v + se * u * v;
  };
  const a = {}, b = {};
  for (let it = 0; it < iterations; it++) {
    let x = 1 + rnd() * (res - 3), y = 1 + rnd() * (res - 3), dx = 0, dy = 0, speed = 1, water = 1, sed = 0;
    for (let s = 0; s < maxSteps; s++) {
      const nx = x | 0, ny = y | 0, u = x - nx, v = y - ny, ni = ny * res + nx;
      hg(x, y, a);
      dx = dx * inertia - a.gx * (1 - inertia); dy = dy * inertia - a.gy * (1 - inertia);
      const len = Math.hypot(dx, dy); if (len < 1e-9) break;
      dx /= len; dy /= len; x += dx; y += dy;
      if (x < 1 || y < 1 || x >= res - 2 || y >= res - 2) break;
      hg(x, y, b);
      const dh = b.h - a.h;
      const cap = Math.max(-dh * speed * water * capacityK, minCap);
      if (sed > cap || dh > 0) {
        const amt = dh > 0 ? Math.min(dh, sed) : (sed - cap) * depositK;
        sed -= amt;
        H[ni] += amt * (1 - u) * (1 - v); H[ni + 1] += amt * u * (1 - v); H[ni + res] += amt * (1 - u) * v; H[ni + res + 1] += amt * u * v;
        dep[ni] += amt;
      } else {
        const amt = Math.min((cap - sed) * erodeK, -dh);
        for (let k = 0; k < bOff.length; k++) {
          const px = nx + bOff[k][0], py = ny + bOff[k][1];
          if (px < 0 || py < 0 || px >= res || py >= res) continue;
          const d = amt * bW[k]; H[py * res + px] -= d; sed += d; dep[py * res + px] -= d * 0.5;
        }
      }
      speed = Math.sqrt(Math.max(0, speed * speed + dh * gravity));
      water *= 1 - evap;
    }
  }
}

// ---------------------------------------------------------------- main
export function generateTerrain(input) {
  const t0 = performance.now();
  const P = { ...DEFAULTS, ...input };
  const res = P.res | 0, size = P.size, cell = size / (res - 1), half = size / 2, N = res * res;
  const biome = BIOMES[P.biome] || BIOMES.temperate;
  const rnd = mulberry32(P.seed);
  const n1 = makeNoise(P.seed), n2 = makeNoise(P.seed + 101), n3 = makeNoise(P.seed + 202), n4 = makeNoise(P.seed + 303);
  const H = new Float32Array(N);
  const urban = P.layout === 'urban';
  const freq = 1 / P.featureScale;
  const oct = urban ? 2 : P.octaves;

  // 1. base field: domain-warped fBm blended with ridged multifractal
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const x = -half + i * cell, z = -half + j * cell;
    const wf = freq * 0.5, wa = P.warp * P.featureScale;
    const wx = x + wa * fbm(n3, x * wf + 5.2, z * wf + 1.3, 3, 2, 0.5);
    const wz = z + wa * fbm(n3, x * wf - 3.7, z * wf + 8.1, 3, 2, 0.5);
    const f = fbm(n1, wx * freq, wz * freq, oct, P.lacunarity, P.roughness) * 0.5 + 0.5;
    const r = P.ridged > 0 ? ridged(n2, wx * freq * 0.8, wz * freq * 0.8, oct, P.lacunarity, P.roughness) : 0;
    const v = mix(f, r, P.ridged);
    H[j * res + i] = v; if (v < lo) lo = v; if (v > hi) hi = v;
  }
  for (let k = 0; k < N; k++) H[k] = clamp01((H[k] - lo) / (hi - lo || 1)); // clamp: Float32 storage can round just below lo

  // 2. layout shaping in normalized height (0..1)
  const phase = rnd() * 6.283, phase2 = rnd() * 6.283;
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const k = j * res + i, u = (i / (res - 1)) * 2 - 1, v = (j / (res - 1)) * 2 - 1;
    let h = H[k];
    switch (P.layout) {
      case 'hills': h = Math.pow(h, 1.25); break;
      case 'mountains': h = Math.pow(h, 1.7); break;
      case 'valley': {
        const c = 0.3 * Math.sin(v * 2.1 + phase) + 0.12 * Math.sin(v * 5.3 + phase2);
        const d = Math.abs(u - c);
        const prof = smooth(0.05, 0.75, d);
        h = mix(0.02 + h * 0.06, 0.18 + Math.pow(h, 1.2) * 0.82, prof);
        break;
      }
      case 'plateau': {
        const s = h * 3, f = s - Math.floor(s);
        const st = (Math.floor(s) + smooth(0.3, 0.6, f)) / 3;
        h = st * 0.88 + h * 0.12;
        break;
      }
      case 'island': {
        const r = Math.hypot(u, v) + 0.22 * fbm(n4, u * 2.5, v * 2.5, 3, 2, 0.5);
        const fall = 1 - smooth(0.3, 0.92, r);
        h = mix(0.02, 0.14 + 0.86 * Math.pow(h, 1.2), Math.pow(fall, 0.7));
        break;
      }
      case 'urban': h = h; break;
    }
    H[k] = h;
  }

  // 3. erosion (runs in cell units so slopes are unitless)
  const dep = new Float32Array(N);
  if (!urban && P.erosion > 0) {
    const toCells = P.heightScale / cell;
    for (let k = 0; k < N; k++) H[k] *= toCells;
    erode(H, res, Math.round(P.erosion * (res * res) / (257 * 257)), P.erosionStrength, mulberry32(P.seed + 7), dep);
    for (let k = 0; k < N; k++) H[k] /= toCells;
  }

  // 4. terraces
  if (P.terraces > 0) {
    const T = P.terraces, ex = 1 + P.terraceSharp * 7;
    for (let k = 0; k < N; k++) {
      const s = H[k] * T, f = s - Math.floor(s);
      H[k] = mix(H[k], (Math.floor(s) + Math.pow(f, ex)) / T, P.terraceSharp);
    }
  }

  // to meters
  for (let k = 0; k < N; k++) H[k] *= P.heightScale;
  const waterY = P.water > 0 ? P.water * P.heightScale : null;

  // 5. urban grid: roads follow the grade, lots become flat pads (retaining walls where the grade is steep)
  const roadMask = new Float32Array(N), lotMask = new Float32Array(N);
  const lots = [];
  if (urban) {
    const B = P.blockSize, rw = P.roadWidth / 2;
    const grade = H.slice();
    const sample = (x, z) => {
      const fx = Math.min(res - 1.001, Math.max(0, (x + half) / cell)), fz = Math.min(res - 1.001, Math.max(0, (z + half) / cell));
      const i = fx | 0, j = fz | 0, a = fx - i, b = fz - j, k = j * res + i;
      return grade[k] * (1 - a) * (1 - b) + grade[k + 1] * a * (1 - b) + grade[k + res] * (1 - a) * b + grade[k + res + 1] * a * b;
    };
    const lotInfo = new Map();
    const lotKey = (bi, bj) => bi + ',' + bj;
    const lr = mulberry32(P.seed + 31);
    for (let bj = Math.floor(-half / B) - 1; bj <= Math.ceil(half / B); bj++) for (let bi = Math.floor(-half / B) - 1; bi <= Math.ceil(half / B); bi++) {
      const cx = (bi + 0.5) * B, cz = (bj + 0.5) * B;
      const park = lr() < P.parkChance;
      const pad = sample(cx, cz) + 0.18;
      const info = { cx, cz, w: B - P.roadWidth, pad, park };
      lotInfo.set(lotKey(bi, bj), info);
      if (Math.abs(cx) < half && Math.abs(cz) < half) lots.push(info);
    }
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const k = j * res + i, x = -half + i * cell, z = -half + j * cell;
      const dx = Math.abs(x - Math.round(x / B) * B), dz = Math.abs(z - Math.round(z / B) * B);
      const d = Math.min(dx, dz);
      const info = lotInfo.get(lotKey(Math.floor(x / B), Math.floor(z / B)));
      const road = grade[k];
      if (d <= rw) { H[k] = road; roadMask[k] = 1; continue; }
      const t = smooth(rw, rw + 1.2, d);
      const target = info.park ? mix(road, grade[k], 0.6) + 0.1 : info.pad;
      H[k] = mix(road, target, t);
      roadMask[k] = 1 - smooth(rw, rw + 0.4, d);
      if (!info.park) lotMask[k] = smooth(rw + 0.3, rw + 1.0, d);
    }
  }

  // 6. normals (central differences) + slope
  const normals = new Float32Array(N * 3), slope = new Float32Array(N);
  let walk = 0;
  const cosMax = Math.cos(P.maxSlope * Math.PI / 180);
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const k = j * res + i;
    const hl = H[j * res + Math.max(0, i - 1)], hr = H[j * res + Math.min(res - 1, i + 1)];
    const hd = H[Math.max(0, j - 1) * res + i], hu = H[Math.min(res - 1, j + 1) * res + i];
    const sx = (i === 0 || i === res - 1) ? 1 : 2, sz = (j === 0 || j === res - 1) ? 1 : 2;
    let nx = -(hr - hl) / (sx * cell), nz = -(hu - hd) / (sz * cell), ny = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    normals[k * 3] = nx; normals[k * 3 + 1] = ny; normals[k * 3 + 2] = nz;
    slope[k] = Math.acos(ny) * 180 / Math.PI;
    if (ny >= cosMax) walk++;
  }

  // 7. splat weights + cavity occlusion
  const splat = new Float32Array(N * 4), aux = new Float32Array(N);
  let depMax = 0; for (let k = 0; k < N; k++) if (dep[k] > depMax) depMax = dep[k];
  const R = Math.max(1, Math.round(3 / cell));
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const k = j * res + i, x = -half + i * cell, z = -half + j * cell, h = H[k], hn = h / P.heightScale;
    // cavity: height relative to neighbourhood mean
    let sum = 0, cnt = 0;
    for (let dj = -R; dj <= R; dj += R) for (let di = -R; di <= R; di += R) {
      const ii = Math.min(res - 1, Math.max(0, i + di)), jj = Math.min(res - 1, Math.max(0, j + dj));
      sum += H[jj * res + ii]; cnt++;
    }
    const cav = h - sum / cnt;
    aux[k] = clamp01(0.75 + cav * 0.35);

    const s = slope[k];
    const rock = smooth(P.rockSlope - 8, P.rockSlope + 4, s) * (urban ? (roadMask[k] > 0.5 ? 0 : 1) : 1);
    const patch = fbm(n4, x / 22, z / 22, 3, 2, 0.5);
    let path = smooth(0.25, 0.55, patch) * 0.6;
    if (depMax > 0) path = Math.max(path, smooth(0.02, 0.25, dep[k] / depMax) * 0.8);
    if (urban) path = Math.max(path * 0.3, roadMask[k]);
    let special = 0;
    if (biome.special === 'beach' && waterY !== null) special = 1 - smooth(waterY + P.sandBand * 0.5, waterY + P.sandBand, h);
    else if (biome.special === 'snow') {
      const line = (biome.snowLine || 0.6) + 0.06 * fbm(n2, x / 30, z / 30, 3, 2, 0.5);
      special = smooth(line - 0.03, line + 0.03, hn) * (1 - smooth(40, 55, s));
    } else if (biome.special === 'patches') special = smooth(0.15, 0.45, fbm(n3, x / 35 + 9, z / 35 - 4, 3, 2, 0.5)) * 0.85;
    if (urban) special = Math.max(special * 0.3, lotMask[k]);
    if (waterY !== null && biome.special !== 'beach' && h < waterY + 0.6) path = Math.max(path, 1 - smooth(waterY, waterY + 0.6, h));
    // compose (rock overrides, then special, then path, remainder = ground cover)
    let wR = rock, wS = special * (1 - wR), wP = path * (1 - wR - wS), wG = Math.max(0, 1 - wR - wS - wP);
    splat[k * 4] = wG; splat[k * 4 + 1] = wP; splat[k * 4 + 2] = wR; splat[k * 4 + 3] = wS;
  }

  // 8. scatter (trees, shrubs, rocks) with forest clustering, slope and layer rules
  const scatter = [];
  const area = size * size;
  const occ = new Map(); const occCell = 2.5;
  const free = (x, z, r) => {
    const ci = Math.floor(x / occCell), cj = Math.floor(z / occCell), rr = Math.ceil(r / occCell);
    for (let a = -rr; a <= rr; a++) for (let b = -rr; b <= rr; b++) {
      const list = occ.get((ci + a) + ',' + (cj + b)); if (!list) continue;
      for (const o of list) if (Math.hypot(o[0] - x, o[1] - z) < r + o[2]) return false;
    }
    return true;
  };
  const claim = (x, z, r) => { const key = Math.floor(x / occCell) + ',' + Math.floor(z / occCell); if (!occ.has(key)) occ.set(key, []); occ.get(key).push([x, z, r]); };
  const RADIUS = { pine: 1.6, broadleaf: 2.2, autumn: 2.2, dead: 1.2, cactus: 0.8, shrub: 0.7, deadshrub: 0.6, rock: 0.5, boulder: 1.6 };
  const isTree = t => ['pine', 'broadleaf', 'autumn', 'dead', 'cactus'].includes(t);
  const sr = mulberry32(P.seed + 55);
  const sampleGrid = (x, z, arr, stride = 1, off = 0) => {
    const fx = Math.min(res - 1.001, Math.max(0, (x + half) / cell)), fz = Math.min(res - 1.001, Math.max(0, (z + half) / cell));
    const i = fx | 0, j = fz | 0, a = fx - i, b = fz - j, k = j * res + i;
    return arr[k * stride + off] * (1 - a) * (1 - b) + arr[(k + 1) * stride + off] * a * (1 - b) + arr[(k + res) * stride + off] * (1 - a) * b + arr[(k + res + 1) * stride + off] * a * b;
  };
  for (const rule of biome.scatter) {
    const mult = isTree(rule.type) ? P.treeDensity : (rule.type === 'rock' || rule.type === 'boulder') ? P.rockDensity : P.shrubDensity;
    const target = Math.round(rule.density * mult * area / 1000);
    const tries = target * 4;
    let placed = 0;
    for (let t = 0; t < tries && placed < target; t++) {
      const x = (sr() - 0.5) * (size - 4), z = (sr() - 0.5) * (size - 4);
      const y = sampleGrid(x, z, H), s = sampleGrid(x, z, slope);
      if (s > rule.slopeMax) continue;
      if (waterY !== null && y < waterY + 0.4) continue;
      if (rule.maxH !== undefined && y / P.heightScale > rule.maxH) continue;
      const wRoad = sampleGrid(x, z, splat, 4, 1), wRock = sampleGrid(x, z, splat, 4, 2), wSpec = sampleGrid(x, z, splat, 4, 3);
      if (urban && (sampleGrid(x, z, roadMask) > 0.05 || sampleGrid(x, z, lotMask) > 0.05)) continue;
      let p;
      if (rule.rocky) p = 0.25 + wRock * 1.2 * rule.rocky;
      else {
        const forest = smooth(-0.15, 0.35, fbm(n1, x / 55 + 40, z / 55 - 40, 3, 2, 0.5));
        p = mix(1, forest, rule.forest) * (1 - wRoad * 0.9) * (1 - wRock) * (biome.special === 'snow' ? 1 - wSpec : 1);
      }
      if (sr() > p) continue;
      const sc = mix(rule.scale[0], rule.scale[1], sr());
      const r = RADIUS[rule.type] * sc;
      if (!free(x, z, r * 0.8)) continue;
      claim(x, z, r * 0.8);
      const nk = (Math.round((z + half) / cell) * res + Math.round((x + half) / cell)) * 3;
      scatter.push({ type: rule.type, x, y, z, rot: sr() * Math.PI * 2, scale: sc, tint: sr(), nx: normals[nk], ny: normals[nk + 1], nz: normals[nk + 2] });
      placed++;
    }
  }

  let hmin = Infinity, hmax = -Infinity; for (let k = 0; k < N; k++) { if (H[k] < hmin) hmin = H[k]; if (H[k] > hmax) hmax = H[k]; }
  return {
    params: P, res, size, cell, heights: H, normals, slope, splat, aux, scatter, lots, water: waterY, biome,
    stats: { ms: performance.now() - t0, hmin, hmax, walkable: walk / N, scatter: scatter.length },
  };
}

// Bilinear height lookup for gameplay (spawns, AI placement).
export function heightAt(T, x, z) {
  const half = T.size / 2, res = T.res;
  const fx = Math.min(res - 1.001, Math.max(0, (x + half) / T.cell)), fz = Math.min(res - 1.001, Math.max(0, (z + half) / T.cell));
  const i = fx | 0, j = fz | 0, a = fx - i, b = fz - j, k = j * res + i, H = T.heights;
  return H[k] * (1 - a) * (1 - b) + H[k + 1] * a * (1 - b) + H[k + res] * (1 - a) * b + H[k + res + 1] * a * b;
}
