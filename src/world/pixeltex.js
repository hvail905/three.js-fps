// pixeltex.js : stylized low-resolution textures in the Gloomwood / Pigface vein.
// Each texture is painted small (64-128 px per 2 m tile) with soft, low-contrast detail and sampled with
// nearest filtering so texels stay crisp. Palette quantizing with Bayer dither is available but off:
// compared against Gloomwood and Pigface screenshots it read as screen-door noise rather than paint.
// A matching normal map is derived from the pre-quantized height so light rakes across the detail.
import * as THREE from 'three';
import { mulberry32 } from './terrain.js';

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => v / 16 - 0.5);
const hex = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return [c, g]; }

// Quantize a canvas in place to a palette (dark to light), with ordered dithering.
function quantize(c, palette, spread = 0.6) {
  const g = c.getContext('2d'), img = g.getImageData(0, 0, c.width, c.height), d = img.data, P = palette.map(hex);
  const lum = p => p[0] * 0.3 + p[1] * 0.59 + p[2] * 0.11;
  const PL = P.map(lum);
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const i = (y * c.width + x) * 4, L = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) + BAYER4[(y & 3) * 4 + (x & 3)] * 255 / P.length * spread * 2;
    // nearest palette entry by luminance, then nudge toward the source hue
    let best = 0, bd = 1e9; for (let k = 0; k < P.length; k++) { const dd = Math.abs(PL[k] - L); if (dd < bd) { bd = dd; best = k; } }
    d[i] = P[best][0]; d[i + 1] = P[best][1]; d[i + 2] = P[best][2];
  }
  g.putImageData(img, 0, 0);
}
function heightToNormal(src, strength) {
  const w = src.width, h = src.height, s = src.getContext('2d').getImageData(0, 0, w, h).data, [c, g] = makeCanvas(w, h), img = g.createImageData(w, h), d = img.data;
  const L = (x, y) => s[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const nx = (L(x - 1, y) - L(x + 1, y)) * strength, ny = (L(x, y - 1) - L(x, y + 1)) * strength, l = Math.hypot(nx, ny, 1), i = (y * w + x) * 4;
    d[i] = (nx / l * 0.5 + 0.5) * 255; d[i + 1] = (ny / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); return c;
}
function tex(c, srgb) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter; t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}

// draw(g, hg, rnd, w, h): paint colour into g and height (greyscale) into hg
function build(key, { w = 128, h = 128, palette = null, normal = 3, dither = 0.6, draw }) {
  const rnd = mulberry32(key.split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0);
  const [c, g] = makeCanvas(w, h), [hc, hg] = makeCanvas(w, h);
  hg.fillStyle = '#808080'; hg.fillRect(0, 0, w, h);
  draw(g, hg, rnd, w, h);
  if (palette) quantize(c, palette, dither);
  return { map: tex(c, true), normalMap: tex(heightToNormal(hc, normal), false), canvas: c };
}
const R = (g, x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x | 0, y | 0, Math.max(1, w | 0), Math.max(1, h | 0)); };
const shade = (v, a = 1) => `rgba(${v},${v},${v},${a})`;
function speckle(g, rnd, w, h, n, cols, size = 1) { for (let i = 0; i < n; i++) R(g, rnd() * w, rnd() * h, size, size, cols[(rnd() * cols.length) | 0]); }
function stain(g, rnd, w, h, n, col, rmin, rmax) { for (let i = 0; i < n; i++) { const x = rnd() * w, y = rnd() * h, r = rmin + rnd() * (rmax - rmin); for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { g.fillStyle = col; g.beginPath(); g.ellipse(x + ox, y + oy, r, r * (0.5 + rnd() * 0.6), rnd() * 3, 0, 7); g.fill(); } } }
function drips(g, rnd, w, h, n, col, fromTop = true) { for (let i = 0; i < n; i++) { const x = rnd() * w, len = h * (0.15 + rnd() * 0.6), y0 = fromTop ? 0 : h - len; R(g, x, y0, 1 + (rnd() < 0.3 ? 1 : 0), len, col); } }

// Low-frequency, tileable mottling: a small random grid scaled up with smoothing (wrap-padded so it tiles).
function cloud(g, rnd, w, h, n, col, amin, amax) {
  const [sc, sg] = makeCanvas(n + 2, n + 2), v = [];
  for (let i = 0; i < n * n; i++) v.push(rnd());
  const img = sg.createImageData(n + 2, n + 2), [r, gg, bb] = hex(col);
  for (let y = 0; y < n + 2; y++) for (let x = 0; x < n + 2; x++) {
    const t = v[((y - 1 + n) % n) * n + ((x - 1 + n) % n)], i = (y * (n + 2) + x) * 4;
    img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = bb; img.data[i + 3] = (amin + (amax - amin) * t) * 255;
  }
  sg.putImageData(img, 0, 0);
  const s = w / n; g.save(); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(sc, -s, -s * h / w, (n + 2) * s, (n + 2) * s * h / w); g.restore();
}
const grime = (g, w, h, from, col) => { const grd = g.createLinearGradient(0, h * from, 0, h); grd.addColorStop(0, col.replace(/[\d.]+\)$/, '0)')); grd.addColorStop(1, col); g.fillStyle = grd; g.fillRect(0, h * from, w, h * (1 - from)); };

// Painterly, low-contrast surfaces with large readable features (the Gloomwood/Pigface read comes from
// soft hand-painted texels sampled with nearest filtering, not from dither noise).
export const PIXEL_TEXTURES = {
  // old sewer brick: big soft bricks with bevelled faces, recessed mortar, grime and damp rising from the floor
  brick: () => build('brick', { w: 256, h: 256, normal: 1.6, draw(g, hg, rnd, w, h) {
    R(g, 0, 0, w, h, '#241b16'); R(hg, 0, 0, w, h, shade(80));
    const bh = 12;
    for (let row = 0; row < h / bh; row++) {
      let x = -rnd() * 20; const y = row * bh;
      while (x < w) {
        const bw = 26 + (rnd() * 12 | 0), t = 0.78 + rnd() * 0.32, k = rnd(), tint = k < 0.12 ? [0.75, 0.8, 0.7] : k < 0.22 ? [1.1, 0.95, 0.85] : [1, 1, 1];
        const c = m => `rgb(${108 * t * tint[0] * m | 0},${66 * t * tint[1] * m | 0},${48 * t * tint[2] * m | 0})`;
        for (const ox of [0, w]) {
          R(g, x + 1 - ox, y + 1, bw - 1, bh - 1, c(1)); R(g, x + 1 - ox, y + 1, bw - 1, 1, c(1.1)); R(g, x + 1 - ox, y + bh - 1, bw - 1, 1, c(0.85));
          R(hg, x + 1 - ox, y + 1, bw - 1, bh - 1, shade(190 + rnd() * 25 | 0));
          if (rnd() < 0.2) { const cx = x + 2 + rnd() * (bw - 8) - ox; R(g, cx, y + 1, 4 + rnd() * 5, 2 + rnd() * 3, c(0.6)); }
        }
        x += bw;
      }
    }
    cloud(g, rnd, w, h, 5, '#100a06', 0, 0.5); cloud(g, rnd, w, h, 16, '#5a3e2c', 0, 0.22); cloud(g, rnd, w, h, 32, '#140e0a', 0, 0.2);
    grime(g, w, h, 0.45, 'rgba(32,38,18,0.85)');
    stain(g, rnd, w, h, 4, 'rgba(12,10,8,0.3)', 14, 40);
    for (let i = 0; i < 10; i++) { const x = rnd() * w, len = h * (0.15 + rnd() * 0.5); const grd = g.createLinearGradient(0, 0, 0, len); grd.addColorStop(0, 'rgba(28,32,16,0.6)'); grd.addColorStop(1, 'rgba(28,32,16,0)'); g.fillStyle = grd; g.fillRect(x, 0, 2 + rnd() * 4, len); }
  } }),
  // wet poured concrete: broad mottling, a few cracks, slab joints
  floor: () => build('floor', { normal: 1.5, draw(g, hg, rnd, w, h) {
    R(g, 0, 0, w, h, '#4a463d'); R(hg, 0, 0, w, h, shade(140));
    cloud(g, rnd, w, h, 5, '#1c1b16', 0.05, 0.55); cloud(g, rnd, w, h, 14, '#6a6656', 0, 0.25); cloud(hg, rnd, w, h, 10, '#000000', 0, 0.3);
    stain(g, rnd, w, h, 3, 'rgba(36,44,22,0.35)', 10, 26);
    g.strokeStyle = 'rgba(20,19,16,0.8)'; hg.strokeStyle = shade(60); g.lineWidth = hg.lineWidth = 1;
    for (let i = 0; i < 3; i++) { let x = rnd() * w, y = rnd() * h; g.beginPath(); hg.beginPath(); g.moveTo(x, y); hg.moveTo(x, y); for (let k = 0; k < 7; k++) { x += (rnd() - 0.5) * 18; y += (rnd() - 0.5) * 18; g.lineTo(x, y); hg.lineTo(x, y); } g.stroke(); hg.stroke(); }
    R(g, 0, 0, w, 2, '#2a2822'); R(g, 0, 0, 2, h, '#2a2822'); R(hg, 0, 0, w, 2, shade(70)); R(hg, 0, 0, 2, h, shade(70));
  } }),
  ceiling: () => build('ceiling', { normal: 1.2, draw(g, hg, rnd, w, h) {
    R(g, 0, 0, w, h, '#2f2c26'); cloud(g, rnd, w, h, 5, '#0c0b09', 0.1, 0.7); cloud(g, rnd, w, h, 12, '#4a4438', 0, 0.2); cloud(hg, rnd, w, h, 8, '#000000', 0, 0.3);
    stain(g, rnd, w, h, 3, 'rgba(70,44,26,0.3)', 8, 20);
  } }),
  // big grubby ceramic tile in pale green-grey; grout is mid-grey, not black
  tile: () => build('tile', { w: 256, h: 256, normal: 1.5, draw(g, hg, rnd, w, h) {
    R(g, 0, 0, w, h, '#77786c'); R(hg, 0, 0, w, h, shade(110));
    const s = 32;
    for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) {
      if (rnd() < 0.03) { R(g, x + 1, y + 1, s - 1, s - 1, '#4a4234'); R(hg, x + 1, y + 1, s - 1, s - 1, shade(60)); continue; }
      const v = 0.92 + rnd() * 0.1; R(g, x + 2, y + 2, s - 2, s - 2, `rgb(${170 * v | 0},${174 * v | 0},${158 * v | 0})`); R(hg, x + 2, y + 2, s - 2, s - 2, shade(190));
      if (rnd() < 0.1) { g.strokeStyle = 'rgba(80,78,68,0.9)'; g.beginPath(); g.moveTo(x + 3 + rnd() * 26, y + 2); g.lineTo(x + 3 + rnd() * 26, y + s - 1); g.stroke(); }
    }
    cloud(g, rnd, w, h, 5, '#2a261c', 0.05, 0.45); cloud(g, rnd, w, h, 14, '#5a4a30', 0, 0.22);
    grime(g, w, h, 0.4, 'rgba(56,44,26,0.85)');
    for (let i = 0; i < 14; i++) { const x = rnd() * w, len = h * (0.15 + rnd() * 0.6); const grd = g.createLinearGradient(0, 0, 0, len); grd.addColorStop(0, 'rgba(80,58,36,0.5)'); grd.addColorStop(1, 'rgba(80,58,36,0)'); g.fillStyle = grd; g.fillRect(x, 0, 1 + rnd() * 3, len); }
    stain(g, rnd, w, h, 2, 'rgba(70,24,18,0.35)', 6, 14);
  } }),
  // painted steel plate: seams, rivets, paint worn to rust at edges
  plate: () => build('plate', { normal: 2.5, draw(g, hg, rnd, w, h) {
    R(g, 0, 0, w, h, '#4a5242'); R(hg, 0, 0, w, h, shade(150));
    cloud(g, rnd, w, h, 6, '#1c2018', 0, 0.5); cloud(g, rnd, w, h, 8, '#6a3e20', 0, 0.35);
    for (const y of [0, h / 2]) { R(g, 0, y, w, 2, '#20241c'); R(g, 0, y + 2, w, 1, '#5e6852'); R(hg, 0, y, w, 2, shade(60)); }
    for (const x of [0, w / 2]) { R(g, x, 0, 2, h, '#20241c'); R(hg, x, 0, 2, h, shade(60)); }
    for (let y = 6; y < h; y += h / 2) for (let x = 6; x < w; x += 14) for (const yy of [y, y + h / 2 - 12]) { R(g, x, yy, 3, 3, '#2a2e24'); R(g, x, yy, 2, 2, '#69735c'); R(hg, x, yy, 3, 3, shade(240)); }
    for (let i = 0; i < 8; i++) { const x = rnd() * w, len = h * (0.1 + rnd() * 0.4), y0 = rnd() * h * 0.6; const grd = g.createLinearGradient(0, y0, 0, y0 + len); grd.addColorStop(0, 'rgba(110,60,28,0.6)'); grd.addColorStop(1, 'rgba(110,60,28,0)'); g.fillStyle = grd; g.fillRect(x, y0, 2, len); }
  } }),
  slime: () => build('slime', { normal: 1.2, draw(g, hg, rnd, w, h) {
    R(g, 0, 0, w, h, '#26301b'); cloud(g, rnd, w, h, 5, '#0c1008', 0.1, 0.6); cloud(g, rnd, w, h, 12, '#4a5a2c', 0, 0.35); cloud(hg, rnd, w, h, 8, '#000000', 0, 0.4);
  } }),
  hazard: () => build('hazard', { w: 64, h: 64, normal: 1, draw(g, hg, rnd, w, h) {
    R(g, 0, 0, w, h, '#1c1a16');
    g.fillStyle = '#b8922a'; for (let k = -2; k < 4; k++) { g.beginPath(); g.moveTo(k * 32, 0); g.lineTo(k * 32 + 16, 0); g.lineTo(k * 32 + 16 + 64, 64); g.lineTo(k * 32 + 64, 64); g.fill(); }
    cloud(g, rnd, w, h, 5, '#1a1410', 0.05, 0.55);
  } }),
  rust: () => build('rust', { w: 64, h: 64, normal: 2, draw(g, hg, rnd, w, h) { R(g, 0, 0, w, h, '#4a2a16'); cloud(g, rnd, w, h, 5, '#1a0e06', 0, 0.6); cloud(g, rnd, w, h, 12, '#8a5228', 0, 0.45); cloud(hg, rnd, w, h, 12, '#000000', 0, 0.6); } }),
  crate: () => build('crate', { w: 64, h: 64, normal: 2, draw(g, hg, rnd, w, h) {
    R(g, 0, 0, w, h, '#5a4630'); R(hg, 0, 0, w, h, shade(170));
    for (let y = 0; y < h; y += 16) { const t = 0.85 + rnd() * 0.25; R(g, 0, y + 1, w, 14, `rgb(${96 * t | 0},${76 * t | 0},${52 * t | 0})`); R(g, 0, y, w, 1, '#20180e'); R(hg, 0, y, w, 1, shade(40)); for (let i = 0; i < 6; i++) R(g, rnd() * w, y + 3 + rnd() * 10, 6 + rnd() * 14, 1, 'rgba(50,38,24,0.6)'); }
    R(g, 0, 0, 5, h, '#3a2c1c'); R(g, w - 5, 0, 5, h, '#3a2c1c'); R(g, 0, 0, w, 5, '#3a2c1c'); R(g, 0, h - 5, w, 5, '#3a2c1c');
    cloud(g, rnd, w, h, 4, '#140e08', 0, 0.45);
  } }),
};

// Stenciled paint: text or arrows on a transparent background, low-res and worn.
export function stencilTexture(text, { color = '#c9b48a', w = 128, h = 32, font = 'bold 20px monospace', wear = 0.25, seed = 1 } = {}) {
  const [c, g] = makeCanvas(w, h), rnd = mulberry32(seed);
  g.fillStyle = color; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  if (text === '>' || text === '<') { g.beginPath(); const d = text === '>' ? 1 : -1, cx = w / 2; g.moveTo(cx - d * w * 0.35, h * 0.38); g.lineTo(cx + d * w * 0.1, h * 0.38); g.lineTo(cx + d * w * 0.1, h * 0.15); g.lineTo(cx + d * w * 0.4, h * 0.5); g.lineTo(cx + d * w * 0.1, h * 0.85); g.lineTo(cx + d * w * 0.1, h * 0.62); g.lineTo(cx - d * w * 0.35, h * 0.62); g.fill(); }
  else g.fillText(text, w / 2, h / 2 + 1);
  // stencil bridges and wear: punch random holes
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < w * h * wear * 0.02; i++) g.fillRect(rnd() * w | 0, rnd() * h | 0, 1 + (rnd() * 2 | 0), 1);
  for (let x = 6; x < w; x += 9) g.fillRect(x, 0, 1, h * (0.3 + rnd() * 0.2));
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
