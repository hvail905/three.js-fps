// textures.js : procedural, seamlessly tiling ground textures drawn on canvas.
// makeLayerCanvas(kind, colors[mid, light, dark], size) -> HTMLCanvasElement
import { mulberry32 } from './terrain.js';

function hexRGB(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

// periodic value noise: lattice wraps at `period`, so the texture tiles
function lattice(period, rnd) { const g = new Float32Array(period * period); for (let i = 0; i < g.length; i++) g[i] = rnd(); return g; }
function fbmField(S, base, oct, rnd, gain = 0.5) {
  const out = new Float32Array(S * S);
  let amp = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    const P = base << o, g = lattice(P, rnd), k = P / S;
    for (let y = 0; y < S; y++) {
      const fy = y * k, iy = fy | 0, ty = fy - iy, sy = ty * ty * (3 - 2 * ty), y0 = (iy % P) * P, y1 = ((iy + 1) % P) * P;
      for (let x = 0; x < S; x++) {
        const fx = x * k, ix = fx | 0, tx = fx - ix, sx = tx * tx * (3 - 2 * tx), x0 = ix % P, x1 = (ix + 1) % P;
        const a = g[y0 + x0] + (g[y0 + x1] - g[y0 + x0]) * sx, b = g[y1 + x0] + (g[y1 + x1] - g[y1 + x0]) * sx;
        out[y * S + x] += amp * (a + (b - a) * sy);
      }
    }
    norm += amp; amp *= gain;
  }
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < out.length; i++) { out[i] /= norm; if (out[i] < lo) lo = out[i]; if (out[i] > hi) hi = out[i]; }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo);
  return out;
}

// draw a shape 9 times so it wraps across tile edges
function wrapDraw(S, x, y, r, fn) {
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const px = x + dx * S, py = y + dy * S;
    if (px + r < 0 || py + r < 0 || px - r > S || py - r > S) continue;
    fn(px, py);
  }
}
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const shade = (c, f) => [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)];

export function makeLayerCanvas(kind, colors, S = 512, seed = 7) {
  const rnd = mulberry32(seed * 131 + kind.length * 977 + kind.charCodeAt(0));
  const [mid, light, dark] = colors.map(hexRGB);
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S), d = img.data;
  const base = fbmField(S, 4, 6, rnd, kind === 'snow' ? 0.4 : 0.55);
  const fine = fbmField(S, 64, 2, rnd);
  const ramp = (v, i) => v < 0.5 ? dark[i] + (mid[i] - dark[i]) * v * 2 : mid[i] + (light[i] - mid[i]) * (v - 0.5) * 2;

  let field = base;
  if (kind === 'rock') {
    const r = fbmField(S, 8, 5, rnd);
    field = new Float32Array(S * S);
    for (let i = 0; i < field.length; i++) { const v = 1 - Math.abs(r[i] * 2 - 1); field[i] = 0.45 * base[i] + 0.55 * v * v; }
  }
  if (kind === 'sand') {
    const w = fbmField(S, 3, 3, rnd);
    field = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x, rip = Math.sin((y / S) * Math.PI * 2 * 22 + w[i] * 9 + (x / S) * Math.PI * 2 * 2);
      field[i] = 0.55 * base[i] + 0.25 * (rip * 0.5 + 0.5) + 0.2 * fine[i];
    }
  }
  for (let i = 0, p = 0; i < S * S; i++, p += 4) {
    let v = field[i];
    const grain = (rnd() - 0.5) * (kind === 'asphalt' || kind === 'concrete' ? 0.35 : kind === 'snow' ? 0.04 : 0.12);
    v = Math.min(1, Math.max(0, v * 0.85 + fine[i] * 0.15 + grain));
    if (kind === 'asphalt' || kind === 'concrete') v = 0.35 + v * 0.3 + base[i] * 0.2;
    d[p] = ramp(v, 0); d[p + 1] = ramp(v, 1); d[p + 2] = ramp(v, 2); d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const pebbles = (count, rmin, rmax, cols) => {
    for (let n = 0; n < count; n++) {
      const x = rnd() * S, y = rnd() * S, r = rmin + rnd() * (rmax - rmin), rot = rnd() * Math.PI, ry = r * (0.6 + rnd() * 0.4);
      const c = cols[(rnd() * cols.length) | 0];
      wrapDraw(S, x, y, r * 1.5, (px, py) => {
        ctx.save(); ctx.translate(px, py); ctx.rotate(rot);
        ctx.fillStyle = rgba(shade(c, 0.45), 0.5); ctx.beginPath(); ctx.ellipse(r * 0.25, r * 0.3, r, ry, 0, 0, 7); ctx.fill();
        ctx.fillStyle = rgba(c, 1); ctx.beginPath(); ctx.ellipse(0, 0, r, ry, 0, 0, 7); ctx.fill();
        ctx.fillStyle = rgba(shade(c, 1.35), 0.7); ctx.beginPath(); ctx.ellipse(-r * 0.3, -r * 0.3, r * 0.45, ry * 0.4, 0, 0, 7); ctx.fill();
        ctx.restore();
      });
    }
  };
  const strokes = (count, len, width, cols, alpha) => {
    ctx.lineCap = 'round';
    for (let n = 0; n < count; n++) {
      const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI * 2, l = len * (0.5 + rnd());
      const c = cols[(rnd() * cols.length) | 0];
      ctx.strokeStyle = rgba(c, alpha * (0.6 + rnd() * 0.4)); ctx.lineWidth = width * (0.6 + rnd() * 0.8);
      wrapDraw(S, x, y, l, (px, py) => { ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(px + Math.cos(a) * l * 0.5 + 2, py + Math.sin(a) * l * 0.5, px + Math.cos(a) * l, py + Math.sin(a) * l); ctx.stroke(); });
    }
  };
  const cracks = (count, steps, col, alpha, w) => {
    ctx.strokeStyle = rgba(col, alpha); ctx.lineCap = 'round';
    for (let n = 0; n < count; n++) {
      let x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI * 2;
      const pts = [[x, y]];
      for (let s = 0; s < steps; s++) { a += (rnd() - 0.5) * 1.2; x += Math.cos(a) * 6; y += Math.sin(a) * 6; pts.push([x, y]); }
      ctx.lineWidth = w * (0.5 + rnd());
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        ctx.beginPath(); pts.forEach(([px, py], i) => i ? ctx.lineTo(px + dx * S, py + dy * S) : ctx.moveTo(px + dx * S, py + dy * S)); ctx.stroke();
      }
    }
  };

  switch (kind) {
    case 'grass':
      strokes(5200, 9, 1.6, [shade(dark, 0.8), dark, mid, light, shade(light, 1.15)], 0.75); break;
    case 'drygrass':
      strokes(4200, 10, 1.4, [dark, mid, light, shade(light, 1.15)], 0.7); pebbles(80, 1, 2.5, [dark, mid]); break;
    case 'dirt':
      pebbles(700, 1, 3.5, [dark, mid, light, shade(mid, 0.8)]); strokes(120, 8, 1.2, [shade(dark, 0.7)], 0.4); break;
    case 'mud':
      pebbles(160, 1, 3, [dark, mid]);
      for (let n = 0; n < 40; n++) { const x = rnd() * S, y = rnd() * S, r = 10 + rnd() * 30; wrapDraw(S, x, y, r, (px, py) => { const g = ctx.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, rgba(shade(light, 1.2), 0.35)); g.addColorStop(1, rgba(light, 0)); ctx.fillStyle = g; ctx.fillRect(px - r, py - r, r * 2, r * 2); }); }
      break;
    case 'gravel':
      pebbles(2600, 1.5, 4.5, [dark, mid, light, shade(mid, 1.2), shade(dark, 0.8)]); break;
    case 'rock':
      cracks(55, 18, shade(dark, 0.55), 0.55, 1.6); cracks(40, 10, shade(light, 1.2), 0.25, 1); break;
    case 'cracked': {
      // tileable Voronoi edges: mud-crack plates
      const pts = []; const G = 9;
      for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) pts.push([(i + 0.15 + rnd() * 0.7) * S / G, (j + 0.15 + rnd() * 0.7) * S / G]);
      const id = ctx.getImageData(0, 0, S, S), q = id.data;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        let d1 = 1e9, d2 = 1e9;
        const ci = Math.floor(x / (S / G)), cj = Math.floor(y / (S / G));
        for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) {
          const ii = (ci + a + G) % G, jj = (cj + b + G) % G, p = pts[jj * G + ii];
          const px = p[0] + Math.floor((ci + a) / G) * S - (ci + a < 0 ? 0 : 0), py = p[1] + Math.floor((cj + b) / G) * S;
          const dd = Math.hypot(px - x, py - y);
          if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) d2 = dd;
        }
        const e = d2 - d1, k = (y * S + x) * 4;
        if (e < 2.2) { const f = 0.45 + e * 0.12; q[k] *= f; q[k + 1] *= f; q[k + 2] *= f; }
        else if (e < 4) { q[k] = Math.min(255, q[k] * 1.08); q[k + 1] = Math.min(255, q[k + 1] * 1.08); q[k + 2] = Math.min(255, q[k + 2] * 1.08); }
      }
      ctx.putImageData(id, 0, 0);
      break;
    }
    case 'leaves': {
      const cols = [[150, 70, 30], [190, 110, 40], [130, 45, 30], [175, 140, 60], [95, 60, 35], mid, light];
      for (let n = 0; n < 1700; n++) {
        const x = rnd() * S, y = rnd() * S, r = 3 + rnd() * 4, rot = rnd() * Math.PI, c = cols[(rnd() * cols.length) | 0];
        wrapDraw(S, x, y, r * 2, (px, py) => {
          ctx.save(); ctx.translate(px, py); ctx.rotate(rot);
          ctx.fillStyle = rgba(shade(c, 0.5), 0.45); ctx.beginPath(); ctx.ellipse(1, 1.5, r, r * 0.5, 0, 0, 7); ctx.fill();
          ctx.fillStyle = rgba(c, 0.95); ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.5, 0, 0, 7); ctx.fill();
          ctx.strokeStyle = rgba(shade(c, 0.6), 0.7); ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
          ctx.restore();
        });
      }
      break;
    }
    case 'snow':
      for (let n = 0; n < 900; n++) { const x = rnd() * S, y = rnd() * S; ctx.fillStyle = rgba([255, 255, 255], 0.5 + rnd() * 0.5); ctx.fillRect(x, y, 1, 1); }
      for (let n = 0; n < 30; n++) { const x = rnd() * S, y = rnd() * S, r = 15 + rnd() * 40; wrapDraw(S, x, y, r, (px, py) => { const g = ctx.createRadialGradient(px, py, 0, px, py, r); g.addColorStop(0, rgba(dark, 0.18)); g.addColorStop(1, rgba(dark, 0)); ctx.fillStyle = g; ctx.fillRect(px - r, py - r, r * 2, r * 2); }); }
      break;
    case 'sand':
      pebbles(90, 0.8, 1.8, [dark, light]); break;
    case 'asphalt':
      pebbles(1400, 0.6, 1.4, [shade(light, 1.3), dark, shade(mid, 1.4)]); cracks(10, 22, shade(dark, 0.4), 0.7, 1.4); break;
    case 'concrete': {
      cracks(6, 12, shade(dark, 0.7), 0.5, 1);
      ctx.strokeStyle = rgba(shade(dark, 0.6), 0.85); ctx.lineWidth = 2;
      for (const t of [0, S / 2]) { ctx.beginPath(); ctx.moveTo(t + 1, 0); ctx.lineTo(t + 1, S); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, t + 1); ctx.lineTo(S, t + 1); ctx.stroke(); }
      break;
    }
  }
  return cv;
}

// Tiling normal map for water ripples, from periodic noise.
export function makeWaterNormalCanvas(S = 256, seed = 3) {
  const rnd = mulberry32(seed);
  const h = fbmField(S, 8, 4, rnd, 0.5);
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = h[y * S + (x + 1) % S] - h[y * S + (x - 1 + S) % S];
    const dy = h[((y + 1) % S) * S + x] - h[((y - 1 + S) % S) * S + x];
    let nx = -dx * 6, ny = -dy * 6, nz = 1; const l = Math.hypot(nx, ny, nz);
    const p = (y * S + x) * 4; d[p] = (nx / l * 0.5 + 0.5) * 255; d[p + 1] = (ny / l * 0.5 + 0.5) * 255; d[p + 2] = (nz / l * 0.5 + 0.5) * 255; d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
