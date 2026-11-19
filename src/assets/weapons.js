function createWeaponLibrary(THREE) {
  const VERSION = 1;
  const PI = Math.PI;

  // ---------- materials & helpers (self-contained) ----------
  const matCache = new Map();
  function mat(color, o = {}) {
    const key = color + '|' + JSON.stringify(o);
    if (matCache.has(key)) return matCache.get(key);
    const transparent = o.opacity != null && o.opacity < 1;
    const m = new THREE.MeshStandardMaterial({
      color, roughness: o.rough ?? 0.6, metalness: o.metal ?? 0.1, flatShading: true,
      transparent, opacity: o.opacity ?? 1, depthWrite: !transparent,
      emissive: o.emissive ?? 0x000000, emissiveIntensity: o.emissiveIntensity ?? 1,
    });
    m.userData.role = o.role || 'solid';
    matCache.set(key, m);
    return m;
  }
  function add(parent, geo, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    parent.add(m); return m;
  }
  const box = (p, w, h, d, m, x, y, z, rx, ry, rz) => add(p, new THREE.BoxGeometry(w, h, d), m, x, y, z, rx, ry, rz);
  // cylinder along Z (barrels, tubes). rT is the radius at the rear (+Z) end.
  const tube = (p, rT, rF, len, seg, m, x, y, z) => add(p, new THREE.CylinderGeometry(rT, rF, len, seg), m, x, y, z, PI / 2);
  const r4 = v => +v.toFixed(4);
  const V = (x, y, z) => [r4(x), r4(y), r4(z)];

  const R = (min, max, step, value, when) => ({ type: 'range', min, max, step, value, when });
  const C = (value, when) => ({ type: 'color', value, when });
  const B = (value, when) => ({ type: 'bool', value, when });
  const S = (options, value, when) => ({ type: 'select', options, value, when });

  function mats(p) {
    return {
      metal: mat(p.finishColor, { metal: 0.6, rough: 0.4 }),
      furn: mat(p.furnitureColor, { rough: 0.7, metal: 0.05 }),
      dark: mat('#121212', { rough: 0.55, metal: 0.4 }),
      glass: mat('#4a6a7a', { rough: 0.05, metal: 0.6, opacity: 0.6, role: 'glass' }),
      lamp: mat('#ff2a2a', { emissive: '#ff2a2a', emissiveIntensity: 2.5, role: 'lamp' }),
    };
  }

  // Sight: returns the eye-line point used for aim-down-sights alignment.
  function addSight(g, M, kind, zRear, zFront, topY) {
    if (kind === 'redDot') {
      const zc = zRear - 0.03;
      box(g, 0.026, 0.008, 0.045, M.dark, 0, topY + 0.004, zc);
      for (const s of [1, -1]) box(g, 0.004, 0.03, 0.035, M.dark, s * 0.014, topY + 0.023, zc);
      box(g, 0.032, 0.004, 0.035, M.dark, 0, topY + 0.04, zc);
      box(g, 0.024, 0.028, 0.002, M.glass, 0, topY + 0.023, zc - 0.012);
      box(g, 0.0025, 0.0025, 0.001, M.lamp, 0, topY + 0.023, zc - 0.0105);
      return V(0, topY + 0.023, zRear - 0.01);
    }
    if (kind === 'scope') {
      const ay = topY + 0.036, zc = zRear - 0.1;
      for (const z of [zRear - 0.04, zRear - 0.15]) box(g, 0.03, 0.036, 0.014, M.dark, 0, topY + 0.018, z);
      tube(g, 0.013, 0.013, 0.2, 12, M.dark, 0, ay, zc);
      tube(g, 0.017, 0.023, 0.06, 12, M.dark, 0, ay, zc - 0.13);
      tube(g, 0.019, 0.015, 0.05, 12, M.dark, 0, ay, zRear + 0.015);
      tube(g, 0.021, 0.021, 0.002, 12, M.glass, 0, ay, zc - 0.161);
      box(g, 0.012, 0.014, 0.012, M.dark, 0, ay + 0.016, zc);
      return V(0, ay, zRear + 0.04);
    }
    if (kind === 'bead') {
      add(g, new THREE.SphereGeometry(0.0035, 6, 4), mat('#d8d8d8', { metal: 0.6 }), 0, topY + 0.003, zFront);
      box(g, 0.012, 0.006, 0.01, M.dark, 0, topY + 0.003, zRear);
      return V(0, topY + 0.008, zRear + 0.004);
    }
    // iron
    box(g, 0.0045, 0.018, 0.005, M.dark, 0, topY + 0.009, zFront);
    box(g, 0.02, 0.004, 0.012, M.dark, 0, topY + 0.002, zRear);
    for (const s of [1, -1]) box(g, 0.005, 0.015, 0.008, M.dark, s * 0.006, topY + 0.0075, zRear);
    return V(0, topY + 0.016, zRear + 0.004);
  }
  // Muzzle device: returns the tip z.
  function addMuzzle(g, M, kind, z, y, r) {
    if (kind === 'compensator') { box(g, r * 2.6, r * 2.6, 0.045, M.dark, 0, y, z - 0.0225); for (const s of [1, -1]) box(g, 0.002, r * 1.6, 0.01, mat('#050505'), s * r * 1.3, y, z - 0.02); return z - 0.045; }
    if (kind === 'suppressor') { tube(g, 0.019, 0.019, 0.16, 12, M.dark, 0, y, z - 0.08); return z - 0.16; }
    return z;
  }
  function magChain(g, M, x, y, z, len, curve, w, d) {
    let parent = new THREE.Group(); parent.position.set(x, y, z); g.add(parent);
    const n = 4, seg = len / n;
    for (let i = 0; i < n; i++) {
      box(parent, w, seg + 0.002, d, M.dark, 0, -seg / 2, 0);
      const next = new THREE.Group(); next.position.y = -seg; next.rotation.x = curve; parent.add(next); parent = next;
    }
  }

  // ---------- long guns (SMG, rifle, shotgun, sniper) ----------
  function buildLongGun(p, cfg) {
    const g = new THREE.Group(), M = mats(p), bore = cfg.bore;
    const RL = p.receiverLength, zr = 0.07, zf = zr - RL, BL = p.barrelLength, br = cfg.barrelR;
    box(g, 0.05, 0.075, RL, M.metal, 0, bore - 0.0075, (zr + zf) / 2);
    box(g, 0.002, 0.018, Math.min(0.06, RL * 0.3), M.dark, 0.0255, bore + 0.006, zf + RL * 0.45);
    tube(g, br, br, BL, 10, M.metal, 0, bore, zf - BL / 2);
    const barrelEnd = zf - BL;
    let support, frontZ = zf, topY = bore + 0.03;

    if (cfg.action === 'auto') {
      const HG = Math.min(p.handguard, BL - 0.02);
      box(g, 0.048, 0.052, HG, M.furn, 0, bore, zf - HG / 2);
      for (let i = 0; i < 3; i++) box(g, 0.049, 0.006, 0.04, M.dark, 0, bore - 0.01 + i * 0.012, zf - HG * 0.5);
      box(g, 0.03, 0.008, 0.012, M.dark, 0, bore + 0.034, zr - 0.012);
      box(g, 0.022, 0.008, RL + HG * 0.95, M.dark, 0, bore + 0.034, zr - (RL + HG * 0.95) / 2);
      topY = bore + 0.038; frontZ = zf - HG;
      support = V(0, bore - 0.034, zf - HG * 0.55);
      if (p.underbarrel === 'grip') { box(g, 0.024, 0.075, 0.03, M.furn, 0, bore - 0.026 - 0.0375, zf - HG * 0.55); support = V(0, bore - 0.075, zf - HG * 0.55); }
      if (p.underbarrel === 'light') { tube(g, 0.014, 0.014, 0.08, 8, M.dark, 0.032, bore, zf - HG + 0.05); box(g, 0.002, 0.02, 0.02, mat('#fff6dc', { emissive: '#fff6dc', emissiveIntensity: 1.5, role: 'lamp' }), 0.032, bore, zf - HG + 0.0095, 0, PI / 2); }
      magChain(g, M, 0, bore - 0.045, -0.088, p.magLength, p.magCurve, 0.024, 0.055);
    } else if (cfg.action === 'pump') {
      const tubeLen = BL * 0.85;
      tube(g, 0.011, 0.011, tubeLen, 8, M.metal, 0, bore - 0.026, zf - tubeLen / 2);
      const pz = zf - 0.14;
      tube(g, 0.022, 0.022, 0.16, 8, M.furn, 0, bore - 0.022, pz);
      for (let i = 0; i < 5; i++) tube(g, 0.0225, 0.0225, 0.006, 8, M.dark, 0, bore - 0.022, pz - 0.06 + i * 0.03);
      topY = bore + 0.03; frontZ = barrelEnd + 0.01;
      support = V(0, bore - 0.045, pz);
    } else { // bolt
      const FL = p.forendLength;
      box(g, 0.045, 0.045, FL, M.furn, 0, bore - 0.02, zf - FL / 2);
      tube(g, 0.006, 0.006, 0.04, 6, M.metal, 0, bore + 0.02, zr - 0.03);
      const handle = add(g, new THREE.CylinderGeometry(0.004, 0.004, 0.05, 6), M.metal, 0.035, bore + 0.01, zr - 0.05, 0, 0, PI / 2.3);
      add(g, new THREE.SphereGeometry(0.008, 8, 6), M.metal, 0.058, bore + 0.0, zr - 0.05);
      if (p.sight === 'scope') box(g, 0.02, 0.006, RL * 0.9, M.dark, 0, bore + 0.033, (zr + zf) / 2);
      topY = bore + 0.036; frontZ = barrelEnd + 0.02;
      support = V(0, bore - 0.046, zf - FL * 0.5);
      if (p.bipod) for (const s of [1, -1]) box(g, 0.008, 0.16, 0.008, M.dark, s * 0.025, bore - 0.12, zf - FL + 0.03, 0, 0, s * 0.18);
      magChain(g, M, 0, bore - 0.045, -0.07, 0.05, 0, 0.026, 0.07);
      void handle;
    }
    if (cfg.action === 'bolt' && p.sight === 'iron') box(g, 0.008, topY - bore - br, 0.01, M.metal, 0, (topY + bore + br) / 2, frontZ);

    // grip / wrist
    const fullStock = p.stock === 'full' || cfg.action === 'bolt';
    if (fullStock) box(g, 0.036, 0.09, 0.09, M.furn, 0, -0.012, 0.03, -0.55);
    else box(g, 0.03, 0.11, 0.045, M.furn, 0, -0.035, 0.012, -0.3);
    box(g, 0.008, 0.006, 0.055, M.metal, 0, 0.004, -0.035);
    box(g, 0.008, 0.03, 0.006, M.metal, 0, 0.018, -0.062);
    box(g, 0.004, 0.02, 0.004, M.dark, 0, 0.02, -0.03);

    // stock
    const SL = p.stockLength ?? 0.25;
    if (p.stock === 'fixed') { box(g, 0.04, 0.085, SL, M.furn, 0, bore - 0.03, zr + SL / 2); box(g, 0.045, 0.13, 0.02, M.dark, 0, bore - 0.045, zr + SL + 0.01); }
    else if (p.stock === 'collapsible') { tube(g, 0.014, 0.014, SL, 8, M.dark, 0, bore - 0.005, zr + SL / 2); box(g, 0.04, 0.1, 0.1, M.furn, 0, bore - 0.03, zr + SL - 0.05); box(g, 0.045, 0.13, 0.015, M.dark, 0, bore - 0.04, zr + SL + 0.0075); }
    else if (p.stock === 'folding') { for (const y of [bore, bore - 0.06]) box(g, 0.006, 0.006, SL, M.dark, 0.015, y, zr + SL / 2); box(g, 0.035, 0.09, 0.012, M.dark, 0.015, bore - 0.03, zr + SL); }
    else if (p.stock === 'full' || cfg.action === 'bolt') {
      const s = new THREE.Shape(), h0 = 0.06, h1 = 0.14;
      s.moveTo(0, 0); s.lineTo(SL, -0.02); s.lineTo(SL, -0.02 - h1); s.lineTo(SL * 0.35, -h0 - 0.02); s.lineTo(0, -h0); s.closePath();
      const geo = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: false }); geo.translate(0, 0, -0.02);
      add(g, geo, M.furn, 0, bore - 0.02, zr, 0, -PI / 2); // comb sits below the sight line
      box(g, 0.044, h1, 0.02, M.dark, 0, bore - 0.11, zr + SL + 0.01);
    } else if (p.stock === 'pistolGrip' || p.stock === 'none') { /* grip already built */ }

    const sight = addSight(g, M, p.sight, zr - 0.015, frontZ + 0.012, topY);
    const tip = addMuzzle(g, M, p.muzzle, barrelEnd, bore, br);
    return { g, anchors: { grip: V(0, 0, 0), support, muzzle: V(0, bore, tip), sight } };
  }

  function buildPistol(p) {
    const g = new THREE.Group(), M = mats(p), bore = 0.058, SL = p.slideLength, zr = 0.035, zf = zr - SL;
    box(g, 0.03, 0.032, SL, M.metal, 0, bore, (zr + zf) / 2);
    for (let i = 0; i < 5; i++) box(g, 0.031, 0.024, 0.003, M.dark, 0, bore, zr - 0.012 - i * 0.007);
    box(g, 0.002, 0.014, 0.035, M.dark, 0.0155, bore + 0.004, zr - SL * 0.45);
    box(g, 0.028, 0.022, SL * 0.85, M.furn, 0, bore - 0.027, zr - (SL * 0.85) / 2 - 0.005);
    tube(g, 0.006, 0.006, 0.01, 8, M.dark, 0, bore + 0.002, zf - 0.004);
    box(g, 0.03, 0.11, 0.046, M.furn, 0, -0.03, 0.015, -0.25);
    box(g, 0.008, 0.005, 0.045, M.furn, 0, 0.012, -0.03);
    box(g, 0.008, 0.022, 0.006, M.furn, 0, 0.022, -0.052);
    box(g, 0.004, 0.018, 0.004, M.dark, 0, 0.024, -0.026);
    box(g, 0.032, 0.01, 0.05, M.dark, 0, -0.084, 0.03);
    if (p.extendedMag) box(g, 0.026, 0.06, 0.04, M.dark, 0, -0.115, 0.035, -0.25);
    if (p.light) { box(g, 0.026, 0.024, 0.05, M.dark, 0, bore - 0.05, zf + 0.04); box(g, 0.02, 0.018, 0.002, mat('#fff6dc', { emissive: '#fff6dc', emissiveIntensity: 1.5, role: 'lamp' }), 0, bore - 0.05, zf + 0.014); }
    const sight = addSight(g, M, p.sight, zr - 0.008, zf + 0.008, bore + 0.016);
    const tip = addMuzzle(g, M, p.muzzle, zf - 0.008, bore + 0.002, 0.007);
    return { g, anchors: { grip: V(0, 0, 0), support: V(-0.032, -0.035, 0.005), muzzle: V(0, bore + 0.002, tip), sight } };
  }

  function buildRevolver(p) {
    const g = new THREE.Group(), M = mats(p), bore = 0.06, BL = p.barrelLength;
    box(g, 0.026, 0.05, 0.075, M.metal, 0, bore - 0.012, -0.002);
    add(g, new THREE.CylinderGeometry(0.021, 0.021, 0.044, 6), M.metal, 0, bore - 0.014, -0.008, PI / 2, 0, PI / 6);
    tube(g, 0.008, 0.008, BL, 8, M.metal, 0, bore, -0.035 - BL / 2);
    box(g, 0.014, 0.014, BL, M.metal, 0, bore - 0.012, -0.035 - BL / 2);
    box(g, 0.003, 0.012, 0.01, M.metal, 0, bore + 0.012, -0.035 - BL + 0.008);
    box(g, 0.008, 0.022, 0.012, M.dark, 0, bore + 0.014, 0.038, 0.45);
    box(g, 0.03, 0.095, 0.042, M.furn, 0, -0.028, 0.032, -0.4);
    box(g, 0.008, 0.005, 0.04, M.metal, 0, 0.012, -0.012);
    box(g, 0.004, 0.018, 0.004, M.dark, 0, 0.024, -0.005);
    const sight = V(0, bore + 0.018, 0.028);
    return { g, anchors: { grip: V(0, 0, 0), support: V(-0.032, -0.035, 0.01), muzzle: V(0, bore, -0.035 - BL), sight } };
  }

  // ---------- melee ----------
  function buildKnife(p) {
    const g = new THREE.Group(), M = mats(p), HL = p.handleLength, L = p.bladeLength, w = p.bladeWidth;
    box(g, 0.022, 0.028, HL, M.furn, 0, 0, 0);
    box(g, 0.024, 0.03, 0.012, M.metal, 0, 0, HL / 2 + 0.006);
    const gz = p.guard ? 0.008 : 0;
    if (p.guard) box(g, 0.016, 0.065, 0.008, M.metal, 0, 0, -HL / 2 - 0.004);
    const s = new THREE.Shape();
    [[0, -w / 2], [0.75 * L, -w / 2], [L, w * 0.35], [0.85 * L, w / 2], [0, w / 2]].forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y));
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: false }); geo.translate(0, 0, -0.002);
    const z0 = -HL / 2 - gz;
    add(g, geo, mat(p.finishColor, { metal: 0.85, rough: 0.25 }), 0, 0, z0, 0, PI / 2);
    return { g, anchors: { grip: V(0, 0, 0), support: null, muzzle: V(0, w * 0.35, z0 - L), sight: null } };
  }
  function buildBat(p) {
    const g = new THREE.Group(), L = p.length, Rb = p.barrelRadius;
    const pts = [[0, -0.09], [0.024, -0.09], [0.024, -0.075], [0.013, -0.068], [0.013, 0.22], [Rb * 0.75, L * 0.55], [Rb, L * 0.75], [Rb, L - 0.1], [Rb * 0.85, L - 0.09], [0, L - 0.09]].map(([r, y]) => new THREE.Vector2(r, y));
    const m = p.material === 'aluminum' ? mat(p.batColor, { metal: 0.8, rough: 0.3 }) : mat(p.batColor, { rough: 0.7 });
    add(g, new THREE.LatheGeometry(pts, 10), m, 0, 0, 0, -PI / 2);
    if (p.tape) add(g, new THREE.CylinderGeometry(0.0145, 0.0145, 0.2, 10, 1, true), mat('#151515', { rough: 0.9 }), 0, 0, -0.04, -PI / 2);
    if (p.nails) for (let i = 0; i < 10; i++) {
      const a = i * 2.4, z = -(L * 0.62 + (i % 4) * 0.05), d = Rb * 0.6;
      add(g, new THREE.CylinderGeometry(0.0015, 0.0015, 0.06, 4), mat('#8a8f94', { metal: 0.8 }), Math.cos(a) * d, Math.sin(a) * d, z, 0, 0, a - PI / 2);
    }
    return { g, anchors: { grip: V(0, 0, 0), support: V(0, 0, -0.09), muzzle: V(0, 0, -(L - 0.09)), sight: null } };
  }
  function buildPipe(p) {
    const g = new THREE.Group(), L = p.length, r = p.radius, m = mat(p.pipeColor, { metal: 0.5, rough: 0.75 });
    tube(g, r, r, L, 8, m, 0, 0, 0.08 - L / 2);
    const end = 0.08 - L;
    if (p.elbow) {
      tube(g, r * 1.35, r * 1.35, 0.05, 8, m, 0, 0, end + 0.01);
      add(g, new THREE.CylinderGeometry(r * 1.35, r * 1.35, 0.07, 8), m, 0, 0.035, end - 0.005);
    }
    if (p.tape) tube(g, r * 1.12, r * 1.12, 0.16, 8, mat('#2a3a8a', { rough: 0.9 }), 0, 0, 0);
    return { g, anchors: { grip: V(0, 0, 0), support: null, muzzle: V(0, p.elbow ? 0.07 : 0, end), sight: null } };
  }

  // ---------- schema ----------
  // Viewmodel: where the grip sits in camera space at the hip (meters), its rotation (degrees),
  // eye distance to the sight when aiming, and how hard the viewmodel kicks when fired.
  const vm = d => ({
    viewX: R(-0.1, 0.35, 0.005, d[0]), viewY: R(-0.4, 0, 0.005, d[1]), viewZ: R(-0.6, -0.05, 0.005, d[2]),
    viewPitch: R(-60, 80, 1, d[3] ?? 0), viewYaw: R(-30, 30, 1, d[4] ?? 0), viewRoll: R(-45, 45, 1, d[5] ?? 0),
    adsDistance: R(0.05, 0.6, 0.005, d[6] ?? 0.3, d[6] == null ? { __never: [1] } : undefined),
    kick: R(0, 2, 0.05, d[7] ?? 1),
  });
  const colors = (fin, furn) => ({ finishColor: C(fin), furnitureColor: C(furn) });
  const muzzle = (v, opts = ['none', 'compensator', 'suppressor']) => ({ muzzle: S(opts, v) });

  const props = {
    pistol: {
      label: 'Pistol', category: 'Firearms', kind: 'firearm',
      params: { slideLength: R(0.14, 0.22, 0.005, 0.18), sight: S(['iron', 'redDot'], 'iron'), ...muzzle('none', ['none', 'suppressor']), extendedMag: B(false), light: B(false), ...colors('#2a2a2a', '#1e1e1e'), ...vm([0.1, -0.12, -0.4, 0, 5, 0, 0.32, 1]) },
      build: buildPistol,
    },
    revolver: {
      label: 'Revolver', category: 'Firearms', kind: 'firearm',
      params: { barrelLength: R(0.05, 0.2, 0.005, 0.1), ...colors('#9aa0a5', '#6b4a2e'), ...vm([0.1, -0.12, -0.4, 0, 5, 0, 0.32, 1.4]) },
      build: buildRevolver,
    },
    smg: {
      label: 'SMG', category: 'Firearms', kind: 'firearm',
      params: {
        receiverLength: R(0.14, 0.26, 0.005, 0.2), handguard: R(0.04, 0.16, 0.005, 0.08), barrelLength: R(0.1, 0.3, 0.005, 0.16),
        magLength: R(0.08, 0.3, 0.005, 0.16), magCurve: R(0, 0.2, 0.01, 0), stock: S(['none', 'folding', 'collapsible'], 'folding'), stockLength: R(0.12, 0.3, 0.005, 0.22),
        sight: S(['iron', 'redDot'], 'iron'), ...muzzle('none'), underbarrel: S(['none', 'grip', 'light'], 'none'), ...colors('#2a2a2a', '#1e1e1e'),
        ...vm([0.13, -0.16, -0.36, 0, 5, 0, 0.24, 0.6]),
      },
      build: p => buildLongGun(p, { bore: 0.075, barrelR: 0.008, action: 'auto' }),
    },
    rifle: {
      label: 'Assault Rifle', category: 'Firearms', kind: 'firearm',
      params: {
        receiverLength: R(0.2, 0.34, 0.005, 0.26), handguard: R(0.12, 0.36, 0.005, 0.24), barrelLength: R(0.25, 0.6, 0.005, 0.36),
        magLength: R(0.12, 0.32, 0.005, 0.2), magCurve: R(0, 0.2, 0.01, 0.1), stock: S(['fixed', 'collapsible', 'none'], 'collapsible'), stockLength: R(0.15, 0.35, 0.005, 0.24),
        sight: S(['iron', 'redDot', 'scope'], 'redDot'), ...muzzle('compensator'), underbarrel: S(['none', 'grip', 'light'], 'grip'), ...colors('#2b2b2b', '#3a3a34'),
        ...vm([0.14, -0.17, -0.4, 0, 5, 0, 0.2, 0.8]),
      },
      build: p => buildLongGun(p, { bore: 0.075, barrelR: 0.009, action: 'auto' }),
    },
    shotgun: {
      label: 'Shotgun', category: 'Firearms', kind: 'firearm',
      params: {
        receiverLength: R(0.16, 0.28, 0.005, 0.22), barrelLength: R(0.35, 0.7, 0.005, 0.5), stock: S(['full', 'pistolGrip', 'none'], 'full'), stockLength: R(0.2, 0.38, 0.005, 0.3, { stock: ['full'] }),
        sight: S(['bead', 'redDot'], 'bead'), ...colors('#2a2a2a', '#6b4a2e'),
        ...vm([0.14, -0.17, -0.4, 0, 5, 0, 0.26, 1.6]),
      },
      build: p => buildLongGun({ ...p, muzzle: 'none' }, { bore: 0.075, barrelR: 0.012, action: 'pump' }),
    },
    sniper: {
      label: 'Sniper Rifle', category: 'Firearms', kind: 'firearm',
      params: {
        receiverLength: R(0.18, 0.3, 0.005, 0.22), barrelLength: R(0.45, 0.8, 0.005, 0.62), forendLength: R(0.2, 0.45, 0.005, 0.32), stockLength: R(0.22, 0.38, 0.005, 0.3),
        sight: S(['scope', 'iron'], 'scope'), ...muzzle('compensator'), bipod: B(true), ...colors('#2a2a2a', '#3f4a3a'),
        ...vm([0.14, -0.17, -0.38, 0, 5, 0, 0.1, 1.4]),
      },
      build: p => buildLongGun({ ...p, stock: 'full' }, { bore: 0.075, barrelR: 0.01, action: 'bolt' }),
    },
    knife: {
      label: 'Knife', category: 'Melee', kind: 'melee',
      params: { bladeLength: R(0.08, 0.45, 0.005, 0.17), bladeWidth: R(0.015, 0.06, 0.001, 0.03), handleLength: R(0.09, 0.15, 0.005, 0.12), guard: B(true), finishColor: C('#c8ccd0'), furnitureColor: C('#1e1e1e'), ...vm([0.14, -0.15, -0.36, 10, -8, -10, null, 1]) },
      build: buildKnife,
    },
    bat: {
      label: 'Bat', category: 'Melee', kind: 'melee',
      params: { length: R(0.6, 0.95, 0.005, 0.84), barrelRadius: R(0.025, 0.045, 0.001, 0.034), material: S(['wood', 'aluminum'], 'wood'), batColor: C('#c49a6c'), tape: B(true), nails: B(false), ...vm([0.17, -0.2, -0.42, 62, -12, -18, null, 1]) },
      build: buildBat,
    },
    pipe: {
      label: 'Pipe', category: 'Melee', kind: 'melee',
      params: { length: R(0.4, 1.0, 0.005, 0.6), radius: R(0.012, 0.03, 0.001, 0.017), elbow: B(true), tape: B(true), pipeColor: C('#6b5a4a'), ...vm([0.17, -0.2, -0.42, 58, -12, -18, null, 1]) },
      build: buildPipe,
    },
  };

  // ================= API =================
  function defaults(id) {
    const out = {};
    for (const [k, s] of Object.entries(props[id].params)) out[k] = s.value;
    return out;
  }
  // Viewmodel transforms in camera space (camera looks down -Z).
  function viewmodel(p, anchors) {
    const hip = { position: V(p.viewX, p.viewY, p.viewZ), rotationDeg: [p.viewPitch, p.viewYaw, p.viewRoll] };
    let ads = null;
    if (anchors.sight) {
      const [sx, sy, sz] = anchors.sight;
      const scoped = p.sight === 'scope';
      ads = { position: V(-sx, -sy, -p.adsDistance - sz), rotationDeg: [0, 0, 0], cameraFov: scoped ? 22 : 62, overlay: scoped ? 'scope' : null };
    }
    return { hip, ads, kick: p.kick };
  }
  function build(preset) {
    const def = props[preset.prop];
    if (!def) throw new Error('Unknown weapon: ' + preset.prop);
    const p = Object.assign(defaults(preset.prop), preset.params || {});
    const { g, anchors } = def.build(p);
    g.name = preset.prop;
    g.userData.preset = { prop: preset.prop, version: VERSION, params: p };
    g.userData.kind = def.kind;
    g.userData.anchors = anchors;
    g.userData.viewmodel = viewmodel(p, anchors);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }
  function dispose(obj) {
    obj.traverse(o => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      for (const m of [].concat(o.material)) if (m.userData.disposable) { if (m.map) m.map.dispose(); m.dispose(); }
    });
  }
  return { VERSION, props, defaults, build, dispose };
}

export { createWeaponLibrary };
