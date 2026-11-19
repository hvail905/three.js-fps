// sewer-props.js : props and light fixtures for sewer levels, in the stylized low-poly look.
// Builders return { group, solids, light?, parts } in local space:
//   wall-mounted: the wall is the plane z = 0 and the prop sticks out toward +z
//   free-standing: stands on y = 0, centred on the origin
// solids are BufferGeometries (local space) that become part of the level collider.
import * as THREE from 'three';
import { PIXEL_TEXTURES, stencilTexture } from './pixeltex.js';

let M = null;
const HAS_DOM = typeof document !== 'undefined';
function mats() {
  if (M) return M;
  if (!HAS_DOM) return (M = new Proxy({}, { get: () => undefined })); // headless: geometry and solids only
  const T = name => { const t = PIXEL_TEXTURES[name](); return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.8 }); };
  const flat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.8, metalness: o.metal ?? 0, flatShading: true, ...(o.emissive ? { emissive: o.emissive, emissiveIntensity: o.ei ?? 1 } : {}), ...(o.transparent ? { transparent: true, opacity: o.opacity } : {}) });
  M = {
    plate: T('plate'), rust: T('rust'), crate: T('crate'), hazard: T('hazard'), pine: T('pine'), drum: T('drum'),
    steel: flat(0x4a4e4c, { rough: 0.45, metal: 0.6 }), dark: flat(0x1c1d1c, { rough: 0.6, metal: 0.3 }), black: flat(0x0c0c0c),
    cloth: T('cloth'), stained: T('cloth'), leather: T('leather'), card: T('cardboard'),
    glass: flat(0x8aa0a0, { rough: 0.1, transparent: true, opacity: 0.35 }), bag: flat(0xb8c0a0, { rough: 0.3, transparent: true, opacity: 0.6 }),
    cable: flat(0x151515, { rough: 0.5 }), jar: flat(0x6a7a52, { rough: 0.2, transparent: true, opacity: 0.75 }),
  };
  return M;
}
const box = (w, h, d, m, x, y, z) => { const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); g.position.set(x, y, z); g.castShadow = g.receiveShadow = true; return g; };
const cyl = (rt, rb, h, m, x, y, z, seg = 10) => { const g = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); g.position.set(x, y, z); g.castShadow = g.receiveShadow = true; return g; };
const solid = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

export const PROP_BUILDERS = {
  // CCTV on a bracket; head turns toward the player, red LED blinks
  camera() {
    const m = mats(), g = new THREE.Group(), head = new THREE.Group();
    g.add(box(0.06, 0.06, 0.25, m.dark, 0, 0, 0.12));
    head.position.set(0, -0.06, 0.25);
    head.add(box(0.14, 0.12, 0.3, m.steel, 0, 0, 0.1), box(0.16, 0.02, 0.34, m.dark, 0, 0.07, 0.1));
    const lens = cyl(0.04, 0.045, 0.04, m.black, 0, 0, 0.27); lens.rotation.x = Math.PI / 2; head.add(lens);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), new THREE.MeshStandardMaterial({ color: 0xff2010, emissive: 0xff2010, emissiveIntensity: 3 })); led.position.set(0.05, 0.04, 0.26); head.add(led);
    head.rotation.x = 0.35; g.add(head);
    return { group: g, solids: [], parts: { head, led } };
  },
  // intercom speaker grille: the voice comes from the nearest one
  speaker() {
    const m = mats(), g = new THREE.Group();
    g.add(box(0.34, 0.34, 0.08, m.plate, 0, 0, 0.04));
    for (let i = -3; i <= 3; i++) g.add(box(0.26, 0.012, 0.01, m.black, 0, i * 0.035, 0.085));
    g.add(box(0.03, 0.6, 0.03, m.cable, 0.12, 0.45, 0.02));
    return { group: g, solids: [] };
  },
  stencil(p) {
    if (!HAS_DOM) return { group: new THREE.Group(), solids: [] };
    const w = p.w || 1.2, h = p.h || (p.text === '>' || p.text === '<' ? 0.6 : w / 4);
    const t = stencilTexture(p.text, { color: p.color || '#c9b48a', w: p.text.length > 10 ? 256 : 128, h: p.text === '>' ? 64 : 32, font: p.text.length > 10 ? 'bold 22px monospace' : 'bold 20px monospace', seed: p.text.length * 13 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    mesh.position.z = 0.012; mesh.receiveShadow = true;
    const g = new THREE.Group(); g.add(mesh); return { group: g, solids: [] };
  },
  // welded bulkhead frame in an opening (local: opening spans x -1..1, frame in the plane z = 0)
  door(p, ctx) {
    const m = mats(), g = new THREE.Group(), H = ctx.openingHeight, W = ctx.cell;
    const fm = p.gate ? m.hazard : m.plate, post = 0.28, t = 0.32, top = Math.min(H, 2.5);
    g.add(box(post, top, t, fm, -W / 2 + post / 2, top / 2, 0), box(post, top, t, fm, W / 2 - post / 2, top / 2, 0));
    g.add(box(W, H - top, t, m.plate, 0, top + (H - top) / 2, 0));
    for (const s of [-1, 1]) for (let i = 0; i < 6; i++) g.add(box(0.03, 0.03, 0.02, m.steel, s * (W / 2 - post / 2), 0.3 + i * 0.38, t / 2 + 0.01)); // weld beads
    const solids = [solid(post, top, t, -W / 2 + post / 2, top / 2, 0), solid(post, top, t, W / 2 - post / 2, top / 2, 0)];
    if (!p.gate) { // heavy leaf hanging open against the wall
      const leaf = new THREE.Group(); leaf.position.set(-W / 2 + post, 0, t / 2); leaf.rotation.y = -1.75;
      leaf.add(box(1.35, top - 0.05, 0.08, m.plate, 0.675, (top - 0.05) / 2, 0.04)); leaf.add(cyl(0.12, 0.12, 0.05, m.rust, 0.6, 1.2, 0.1)); g.add(leaf);
    }
    return { group: g, solids };
  },
  // observation window high on a wall: lit room beyond dirty glass, a figure standing in it
  window(p) {
    if (!HAS_DOM) return { group: new THREE.Group(), solids: [] };
    const m = mats(), g = new THREE.Group(), W = 1.6, H = 0.9;
    const c = document.createElement('canvas'); c.width = 64; c.height = 36; const x = c.getContext('2d');
    const grd = x.createLinearGradient(0, 0, 0, 36); grd.addColorStop(0, '#6a5a3a'); grd.addColorStop(1, '#2a2418'); x.fillStyle = grd; x.fillRect(0, 0, 64, 36);
    x.fillStyle = '#0c0a08'; x.fillRect(40, 8, 7, 28); x.beginPath(); x.arc(43.5, 7, 4, 0, 7); x.fill(); // someone watching
    x.fillStyle = 'rgba(0,0,0,0.5)'; for (let i = 0; i < 8; i++) x.fillRect(0, i * 5, 64, 1);
    const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.9, roughness: 0.2 })); pane.position.z = 0.03; g.add(pane);
    g.add(box(W + 0.2, 0.12, 0.2, m.plate, 0, -H / 2 - 0.06, 0.1), box(W + 0.2, 0.1, 0.12, m.plate, 0, H / 2 + 0.05, 0.06), box(0.1, H, 0.12, m.plate, -W / 2 - 0.05, 0, 0.06), box(0.1, H, 0.12, m.plate, W / 2 + 0.05, 0, 0.06));
    for (let i = -3; i <= 3; i++) g.add(box(0.02, H, 0.02, m.steel, i * 0.22, 0, 0.09)); // mesh grille
    const light = new THREE.PointLight(0xffc890, 3, 9, 1.8); light.position.set(0, 0, 0.8); g.add(light);
    return { group: g, solids: [], light };
  },
  gurney() {
    const m = mats(), g = new THREE.Group();
    for (const [x, z] of [[-0.9, -0.3], [0.9, -0.3], [-0.9, 0.3], [0.9, 0.3]]) g.add(box(0.04, 0.75, 0.04, m.steel, x, 0.375, z));
    g.add(box(1.95, 0.05, 0.7, m.steel, 0, 0.75, 0), box(1.9, 0.1, 0.65, m.stained, 0, 0.82, 0), box(0.4, 0.08, 0.5, m.cloth, -0.75, 0.9, 0));
    for (const x of [-0.4, 0.2, 0.7]) g.add(box(0.08, 0.12, 0.72, m.leather, x, 0.84, 0));
    return { group: g, solids: [solid(2, 0.9, 0.72, 0, 0.45, 0)] };
  },
  chair() {
    const m = mats(), g = new THREE.Group();
    for (const [x, z] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]]) g.add(box(0.05, 0.45, 0.05, m.steel, x, 0.225, z));
    g.add(box(0.5, 0.06, 0.5, m.leather, 0, 0.47, 0), box(0.5, 0.7, 0.06, m.leather, 0, 0.85, -0.24), box(0.06, 0.06, 0.45, m.steel, -0.27, 0.68, 0), box(0.06, 0.06, 0.45, m.steel, 0.27, 0.68, 0));
    for (const x of [-0.27, 0.27]) g.add(box(0.1, 0.05, 0.08, m.black, x, 0.72, 0.05));
    return { group: g, solids: [solid(0.6, 1.2, 0.6, 0, 0.6, 0)] };
  },
  iv() { const m = mats(), g = new THREE.Group(); g.add(cyl(0.015, 0.015, 1.9, m.steel, 0, 0.95, 0, 6), cyl(0.25, 0.25, 0.03, m.steel, 0, 0.02, 0, 5), box(0.12, 0.18, 0.04, m.bag, 0.08, 1.7, 0), box(0.3, 0.015, 0.015, m.steel, 0, 1.85, 0)); return { group: g, solids: [] }; },
  cabinet() { const m = mats(), g = new THREE.Group(); g.add(box(0.8, 1.8, 0.45, m.plate, 0, 0.9, 0.225), box(0.02, 1.7, 0.02, m.black, 0, 0.9, 0.455)); return { group: g, solids: [solid(0.8, 1.8, 0.45, 0, 0.9, 0.225)] }; },
  locker() { const m = mats(), g = new THREE.Group(); for (const x of [-0.3, 0.3]) { g.add(box(0.58, 1.9, 0.5, m.plate, x, 0.95, 0.25)); for (let i = 0; i < 5; i++) g.add(box(0.3, 0.015, 0.01, m.black, x, 1.6 + i * 0.04, 0.505)); } return { group: g, solids: [solid(1.2, 1.9, 0.5, 0, 0.95, 0.25)] }; },
  shelf() {
    const m = mats(), g = new THREE.Group();
    for (const x of [-0.7, 0.7]) for (const z of [0.05, 0.45]) g.add(box(0.04, 1.9, 0.04, m.steel, x, 0.95, z));
    for (let i = 0; i < 4; i++) { const y = 0.2 + i * 0.5; g.add(box(1.45, 0.03, 0.45, m.steel, 0, y, 0.25)); for (let k = 0; k < 4; k++) if ((i * 7 + k * 3) % 5 !== 0) { const s = 0.12 + ((i + k) % 3) * 0.05; g.add((i + k) % 2 ? box(s * 1.4, s, s, m.crate, -0.5 + k * 0.33, y + s / 2 + 0.015, 0.25) : cyl(0.05, 0.05, 0.16, m.jar, -0.5 + k * 0.33, y + 0.095, 0.25, 8)); } }
    return { group: g, solids: [solid(1.5, 1.9, 0.5, 0, 0.95, 0.25)] };
  },
  crate() { const m = mats(), g = new THREE.Group(); g.add(box(0.9, 0.9, 0.9, m.pine, 0, 0.45, 0)); for (const s of [-1, 1]) g.add(box(0.03, 0.08, 0.3, m.leather, s * 0.46, 0.7, 0)); /* rope handles */ return { group: g, solids: [solid(0.9, 0.9, 0.9, 0, 0.45, 0)] }; },
  barrel() { const m = mats(), g = new THREE.Group(); g.add(cyl(0.3, 0.3, 0.9, m.drum, 0, 0.45, 0, 12), cyl(0.31, 0.31, 0.03, m.steel, 0, 0.88, 0, 12), cyl(0.31, 0.31, 0.03, m.steel, 0, 0.02, 0, 12)); return { group: g, solids: [solid(0.6, 0.9, 0.6, 0, 0.45, 0)] }; },
  table(p = {}) { const m = mats(), g = new THREE.Group(); for (const [x, z] of [[-0.7, -0.35], [0.7, -0.35], [-0.7, 0.35], [0.7, 0.35]]) g.add(box(0.05, 0.85, 0.05, m.steel, x, 0.425, z)); g.add(box(1.6, 0.05, 0.85, m.plate, 0, 0.87, 0)); if (p.bare) g.add(box(1.1, 0.008, 0.62, m.cloth, 0.05, 0.899, 0)); /* a pale sheet laid over it: dark metal shows against it */ else g.add(box(0.4, 0.3, 0.3, m.dark, -0.4, 1.04, 0), box(0.25, 0.08, 0.2, m.steel, 0.3, 0.93, 0.1), cyl(0.06, 0.06, 0.2, m.jar, 0.55, 0.99, -0.2, 8)); /* bare: something has been laid out on it */ return { group: g, solids: [solid(1.65, 0.9, 0.9, 0, 0.45, 0)] }; },
};

// Light fixtures: geometry plus the light itself. kind: cage (wall lamp), tube (fluorescent bar),
// bulb (hanging), red (emergency dome). Wall-mounted fixtures use the wall frame (z out of the wall).
export function buildFixture(L, ceil, y) {
  const m = mats(), g = new THREE.Group(), color = new THREE.Color(L.color);
  const glow = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: L.kind === 'tube' ? 0.8 : 2.2 });
  let light, lightPos = new THREE.Vector3(), glowMesh;
  if (L.kind === 'tube') {
    g.add(box(1.3, 0.06, 0.18, m.steel, 0, -0.03, 0)); glowMesh = box(1.2, 0.04, 0.08, glow, 0, -0.08, 0); g.add(glowMesh);
    g.add(box(0.01, ceil - y, 0.01, m.cable, -0.5, (ceil - y) / 2, 0), box(0.01, ceil - y, 0.01, m.cable, 0.5, (ceil - y) / 2, 0));
    lightPos.set(0, -0.2, 0);
  } else if (L.kind === 'bulb') {
    g.add(box(0.01, ceil - y, 0.01, m.cable, 0, (ceil - y) / 2, 0)); glowMesh = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), glow); g.add(glowMesh, cyl(0.04, 0.03, 0.06, m.dark, 0, 0.05, 0, 6));
    lightPos.set(0, -0.1, 0);
  } else if (L.kind === 'red') {
    g.add(box(0.18, 0.18, 0.04, m.dark, 0, 0, 0.02)); glowMesh = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), glow); glowMesh.rotation.x = Math.PI / 2; glowMesh.position.z = 0.04; g.add(glowMesh);
    lightPos.set(0, 0, 0.3);
  } else { // cage: wall bracket, wire cage, bulb
    g.add(box(0.06, 0.06, 0.3, m.dark, 0, 0.1, 0.15), cyl(0.07, 0.05, 0.05, m.dark, 0, 0.06, 0.3, 8));
    glowMesh = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), glow); glowMesh.position.set(0, -0.02, 0.3); g.add(glowMesh);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; g.add(box(0.008, 0.16, 0.008, m.steel, Math.cos(a) * 0.08, -0.03, 0.3 + Math.sin(a) * 0.08)); }
    lightPos.set(0, -0.05, 0.38);
  }
  light = new THREE.PointLight(color, L.intensity * 6, L.kind === 'tube' ? 18 : 13, 1.7);
  light.position.copy(lightPos); g.add(light);
  return { group: g, light, glow: glowMesh };
}
