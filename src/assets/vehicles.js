function createVehicleLibrary(THREE) {
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
  const cyl = (p, rt, rb, h, seg, m, x, y, z, rx, ry, rz) => add(p, new THREE.CylinderGeometry(rt, rb, h, seg), m, x, y, z, rx, ry, rz);
  function rng(seed) {
    let a = (Math.imul(seed | 0, 2654435761) >>> 0) || 1;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function textMat(text, bg, fg, aspect, lit) {
    const W = 1024, H = Math.max(48, Math.min(1024, Math.round(W / aspect)));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = H * 0.62; g.font = `900 ${size}px Arial, Helvetica, sans-serif`;
    const mw = g.measureText(text).width; if (mw > W * 0.9) { size *= (W * 0.9) / mw; g.font = `900 ${size}px Arial, Helvetica, sans-serif`; }
    g.fillText(text, W / 2, H / 2);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, emissive: lit ? 0xffffff : 0, emissiveMap: lit ? t : null, emissiveIntensity: lit ? 0.7 : 0 });
    m.userData.role = 'decal'; m.userData.disposable = true;
    return m;
  }

  const R = (min, max, step, value, when) => ({ type: 'range', min, max, step, value, when });
  const C = (value, when) => ({ type: 'color', value, when });
  const B = (value, when) => ({ type: 'bool', value, when });
  const S = (options, value, when) => ({ type: 'select', options, value, when });
  const T = (value, when) => ({ type: 'text', value, when });

  // ---------- body type definitions ----------
  // Side profiles in normalized units: u = 0 rear .. 1 front, v = fraction of height.
  // lowerTop runs front -> rear. parts are extruded across the width (w = fraction of width).
  const TYPES = {
    sedan: {
      label: 'Sedan', L: 4.6, W: 1.8, H: 1.45, wR: 0.32, wheels: [0.19, 0.8], headV: 0.5, tailV: 0.55, paint: '#4a6fa5',
      lowerTop: [[1, .40], [.985, .5], [.72, .6], [.28, .62], [.04, .63], [0, .52]],
      parts: [
        { poly: [[.72, .6], [.55, .96], [.29, .96], [.15, .62]], w: .84, m: 'glass' },
        { poly: [[.565, .93], [.545, 1], [.29, 1], [.275, .93]], w: .86, m: 'paint' },
        { poly: [[.44, .61], [.44, .96], [.41, .96], [.41, .61]], w: .865, m: 'paint' },
      ], roofU: .42, roofV: 1, mirrorU: .7, mirrorV: .63, textV: .45, textU: [.3, .7],
    },
    hatchback: {
      label: 'Hatchback', L: 4.0, W: 1.75, H: 1.5, wR: 0.31, wheels: [0.17, 0.81], headV: 0.5, tailV: 0.62, paint: '#c23b22',
      lowerTop: [[1, .40], [.985, .5], [.76, .58], [.03, .62], [0, .5]],
      parts: [
        { poly: [[.76, .58], [.58, .95], [.08, .95], [.03, .62]], w: .84, m: 'glass' },
        { poly: [[.6, .92], [.585, 1], [.07, 1], [.06, .92]], w: .86, m: 'paint' },
        { poly: [[.43, .6], [.43, .95], [.40, .95], [.40, .6]], w: .865, m: 'paint' },
        { poly: [[.17, .6], [.15, .95], [.08, .95], [.035, .62]], w: .865, m: 'paint' },
      ], roofU: .35, roofV: 1, mirrorU: .74, mirrorV: .6, textV: .45, textU: [.25, .7],
    },
    pickup: {
      label: 'Pickup', L: 5.4, W: 1.95, H: 1.85, wR: 0.4, wheels: [0.17, 0.79], headV: 0.5, tailV: 0.5, paint: '#6b6b6b',
      lowerTop: [[1, .42], [.985, .52], [.80, .56], [.47, .56], [.47, .40], [.02, .40], [.02, .56], [0, .56], [0, .42]],
      parts: [
        { poly: [[.80, .56], [.69, .94], [.5, .94], [.48, .56]], w: .84, m: 'glass' },
        { poly: [[.70, .91], [.69, .99], [.5, .99], [.5, .91]], w: .86, m: 'paint' },
        { poly: [[.6, .57], [.6, .93], [.58, .93], [.58, .57]], w: .865, m: 'paint' },
        { poly: [[.47, .40], [.47, .56], [.02, .56], [.02, .40]], sides: true, m: 'paint' },
        { poly: [[.47, .38], [.47, .41], [.02, .41], [.02, .38]], w: .92, m: 'dark' },
      ], roofU: .6, roofV: .99, mirrorU: .79, mirrorV: .58, textV: .45, textU: [.5, .78],
    },
    van: {
      label: 'Van', L: 5.2, W: 2.0, H: 2.15, wR: 0.36, wheels: [0.16, 0.8], headV: 0.4, tailV: 0.45, paint: '#e8e8e8',
      lowerTop: [[1, .32], [.98, .42], [.86, .47], [0, .47]],
      parts: [
        { poly: [[.86, .47], [.76, .96], [.72, 1], [0, 1], [0, .47]], w: 1, m: 'paint' },
        { poly: [[.856, .49], [.764, .94], [.774, .94], [.866, .49]], w: .9, m: 'glass' },
        { poly: [[.84, .58], [.79, .9], [.66, .9], [.66, .58]], w: 1.01, m: 'glass' },
      ], roofU: .4, roofV: 1, mirrorU: .84, mirrorV: .56, textV: .72, textU: [.08, .6],
    },
    boxTruck: {
      label: 'Box Truck', L: 6.5, W: 2.3, H: 3.2, wR: 0.45, wheels: [0.18, 0.83], dually: true, headV: 0.27, tailV: 0.25, paint: '#e8e8e8',
      lowerTop: [[1, .24], [.99, .33], [0, .33]],
      parts: [
        { poly: [[.99, .33], [.985, .45], [.95, .68], [.78, .69], [.76, .33]], w: .92, m: 'paint' },
        { poly: [[.983, .47], [.953, .66], [.959, .66], [.989, .47]], w: .82, m: 'glass' },
        { poly: [[.93, .5], [.92, .64], [.84, .65], [.84, .5]], w: .93, m: 'glass' },
        { poly: [[.755, .33], [.755, 1], [0, 1], [0, .33]], w: 1, m: 'cargo' },
      ], roofU: .87, roofV: .69, mirrorU: .95, mirrorV: .55, textV: .68, textU: [.04, .72],
    },
    bus: {
      label: 'City Bus', L: 11, W: 2.55, H: 3.1, wR: 0.5, wheels: [0.2, 0.8], headV: 0.2, tailV: 0.25, paint: '#e3b505',
      lowerTop: [[1, .15], [1, .95], [.985, 1], [.015, 1], [0, .95]],
      parts: [
        { poly: [[.975, .4], [.975, .86], [.02, .86], [.02, .4]], w: 1.005, m: 'glass' },
        { poly: [[.998, .3], [.998, .9], [1.004, .9], [1.004, .3]], w: .9, m: 'glass' },
      ], pillars: { u0: .02, u1: .975, every: 1.25, v0: .4, v1: .86 },
      roofU: .5, roofV: 1, mirrorU: .99, mirrorV: .75, textV: .25, textU: [.25, .7],
    },
  };

  // ---------- body construction ----------
  function polyShape(poly, L, H) {
    const s = new THREE.Shape();
    poly.forEach(([u, v], i) => { const x = u * L - L / 2, y = v * H; i ? s.lineTo(x, y) : s.moveTo(x, y); });
    s.closePath();
    return s;
  }
  function extrude(shape, depth, material, z = 0) {
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 8 });
    geo.translate(0, 0, -depth / 2 + z);
    return new THREE.Mesh(geo, material);
  }
  function lowerBodyShape(t, L, H, c, wy, rA) {
    const s = new THREE.Shape();
    const xr = t.wheels[0] * L - L / 2, xf = t.wheels[1] * L - L / 2;
    s.moveTo(-L / 2, c + 0.08);
    s.lineTo(-L / 2 + 0.08, c);
    s.lineTo(xr - rA, c); s.lineTo(xr - rA, wy); s.absarc(xr, wy, rA, PI, 0, true); s.lineTo(xr + rA, c);
    s.lineTo(xf - rA, c); s.lineTo(xf - rA, wy); s.absarc(xf, wy, rA, PI, 0, true); s.lineTo(xf + rA, c);
    s.lineTo(L / 2 - 0.08, c);
    for (const [u, v] of t.lowerTop) s.lineTo(u * L - L / 2, v * H);
    s.closePath();
    return s;
  }

  function buildVehicle(typeId, p) {
    const t = TYPES[typeId];
    const L = p.length, W = p.width, H = p.height;
    const r = rng(p.seed);
    const burned = p.condition === 'burned', wrecked = p.condition === 'wrecked', dirty = p.condition === 'dirty' || wrecked;
    // wheel geometry, clamped so arches never overlap the bumpers or each other
    let wR = Math.min(t.wR * p.wheelSize, L * 0.12, H * 0.3);
    // keep the wheel arch below the body's top line around each wheel
    const topAt = u => {
      let best = Infinity; const pts = t.lowerTop;
      for (let i = 0; i < pts.length - 1; i++) {
        const [u0, v0] = pts[i], [u1, v1] = pts[i + 1], lo = Math.min(u0, u1), hi = Math.max(u0, u1);
        if (u < lo || u > hi) continue;
        best = Math.min(best, hi === lo ? Math.min(v0, v1) : v0 + (v1 - v0) * ((u - u0) / (u1 - u0)));
      }
      return best === Infinity ? 1 : best;
    };
    for (const u of t.wheels) {
      const span = (wR + 0.05) / L;
      let m = Infinity;
      for (let k = 0; k <= 8; k++) m = Math.min(m, topAt(u - span + (2 * span * k) / 8));
      wR = Math.max(0.15, Math.min(wR, (m * H - 0.12 - p.rideHeight) / 2));
    }
    const wy = wR + p.rideHeight, rA = wR + 0.05, c = wy * 0.55;

    const paintCol = new THREE.Color(burned ? '#2b2724' : p.paint);
    if (dirty) paintCol.lerp(new THREE.Color('#6b5e4a'), 0.3);
    const M = {
      paint: mat('#' + paintCol.getHexString(), burned ? { rough: 1, metal: 0 } : { rough: dirty ? 0.75 : 0.35, metal: dirty ? 0.15 : 0.45 }),
      glass: mat(wrecked ? '#8fa3ad' : p.glassTint, { rough: 0.1, metal: 0.4, opacity: wrecked ? 0.75 : 0.88, role: 'glass' }),
      trim: mat(burned ? '#1a1714' : p.trim, { rough: 0.6 }),
      dark: mat('#151515', { rough: 0.9 }),
      cargo: mat(burned ? '#2b2724' : p.cargoColor, { rough: burned ? 1 : 0.6 }),
    };

    const g = new THREE.Group();   // final, front = +Z
    const body = new THREE.Group(); // built with length along +X, then rotated
    body.rotation.y = -PI / 2;
    g.add(body);

    body.add(extrude(lowerBodyShape(t, L, H, c, wy, rA), W, M.paint));
    for (const part of t.parts) {
      if (part.m === 'glass' && burned) continue;
      const shape = polyShape(part.poly, L, H);
      if (part.sides) for (const s of [1, -1]) body.add(extrude(shape, 0.06, M[part.m], s * (W / 2 - 0.03)));
      else body.add(extrude(shape, W * part.w, M[part.m]));
    }
    if (t.pillars && !burned) {
      const pl = t.pillars, n = Math.max(2, Math.round(((pl.u1 - pl.u0) * L) / pl.every));
      for (let i = 0; i <= n; i++) {
        const u = pl.u0 + (i / n) * (pl.u1 - pl.u0);
        body.add(extrude(polyShape([[u - 0.004, pl.v0], [u + 0.004, pl.v0], [u + 0.004, pl.v1], [u - 0.004, pl.v1]], L, H), W * 1.012, M.paint));
      }
    }
    if (burned) box(body, L * 0.45, H * 0.22, W * 0.75, M.dark, (t.roofU - 0.5) * L, H * 0.5, 0);

    // bumpers, grille, lights, mirrors
    const bumpY = c + 0.12;
    box(body, 0.14, 0.16, W * 0.98, M.trim, L / 2 - 0.02, bumpY, 0);
    box(body, 0.14, 0.16, W * 0.98, M.trim, -L / 2 + 0.02, bumpY, 0);
    box(body, 0.03, H * 0.08, W * 0.4, M.dark, L / 2 + 0.003, t.headV * H, 0);
    const headOn = p.lightsOn && !burned;
    const head = headOn ? mat('#fff6dc', { emissive: '#fff6dc', emissiveIntensity: 2, role: 'lamp' }) : mat('#d8d8d8', { rough: 0.2, role: 'lamp' });
    const tail = headOn ? mat('#ff2020', { emissive: '#ff2020', emissiveIntensity: 1.5, role: 'lamp' }) : mat('#8a1010', { rough: 0.3, role: 'lamp' });
    for (const s of [1, -1]) {
      box(body, 0.04, 0.12, W * 0.18, burned ? M.dark : head, L / 2 + 0.004, t.headV * H, s * W * 0.34);
      box(body, 0.04, 0.14, W * 0.12, burned ? M.dark : tail, -L / 2 - 0.004, t.tailV * H, s * W * 0.38);
      box(body, 0.12, 0.1, 0.06, M.trim, t.mirrorU * L - L / 2, t.mirrorV * H, s * (W / 2 + 0.06));
    }
    if (headOn) {
      const L1 = new THREE.SpotLight('#fff6dc', 40, 30, 0.5, 0.5, 1.5);
      L1.position.set(L / 2, t.headV * H, 0); L1.userData.isPropLight = true;
      L1.target.position.set(L / 2 + 5, 0, 0);
      body.add(L1, L1.target);
    }

    // wheels
    const tireW = Math.min(0.32, wR * 0.6);
    const tire = mat('#1b1b1b', { rough: 0.95 }), rim = mat(burned ? '#4a3a30' : '#b8bcc0', { metal: burned ? 0.2 : 0.8, rough: burned ? 1 : 0.3 });
    const flat = wrecked ? Math.floor(r() * 4) : -1;
    let wi = 0;
    for (const u of t.wheels) for (const s of [1, -1]) {
      const x = u * L - L / 2, isFlat = wi++ === flat;
      const offsets = t.dually && u === t.wheels[0] ? [0, tireW * 1.05] : [0];
      for (const off of offsets) {
        const z = s * (W / 2 - tireW / 2 - 0.02 - off);
        const wy2 = burned ? wR * 0.6 : wy;
        if (!burned) { const tm = cyl(body, wR, wR, tireW, 16, tire, x, isFlat ? wy - wR * 0.12 : wy2, z, PI / 2); if (isFlat) tm.scale.z = 0.85; }
        cyl(body, wR * 0.6, wR * 0.6, tireW + 0.01, 10, rim, x, wy2, z, PI / 2);
      }
    }
    if (burned) body.position.y = -(wy - wR * 0.6) * 0.8;

    // livery and decals
    const roofY = t.roofV * H, roofX = t.roofU * L - L / 2;
    if (p.livery === 'taxi' && !burned) {
      box(body, 0.3, 0.2, 0.7, textMat('TAXI', '#f2c14e', '#111111', 3.5, p.lightsOn), roofX, roofY + 0.1, 0);
    }
    if (p.livery === 'police' && !burned) {
      box(body, 0.25, 0.1, W * 0.38, mat('#ff2020', { emissive: '#ff2020', emissiveIntensity: p.lightsOn ? 2 : 0.2, role: 'lamp' }), roofX, roofY + 0.05, W * 0.19);
      box(body, 0.25, 0.1, W * 0.38, mat('#2060ff', { emissive: '#2060ff', emissiveIntensity: p.lightsOn ? 2 : 0.2, role: 'lamp' }), roofX, roofY + 0.05, -W * 0.19);
    }
    const text = p.sideText || (p.livery === 'police' ? 'POLICE' : '');
    if (text && !burned) {
      const len = (t.textU[1] - t.textU[0]) * L, hh = Math.min(H * 0.18, len / 3), x = ((t.textU[0] + t.textU[1]) / 2) * L - L / 2;
      const dm = textMat(text, p.livery === 'police' ? '#ffffff' : (typeId === 'boxTruck' ? p.cargoColor : p.paint), p.livery === 'police' ? '#1d3b8a' : p.textColor, len / hh, false);
      for (const s of [1, -1]) add(body, new THREE.PlaneGeometry(len, hh), dm, x, t.textV * H, s * (W / 2 + 0.006), 0, s === 1 ? 0 : PI);
    }

    if (wrecked) { g.rotation.z = (r() - 0.5) * 0.06; g.rotation.x = (r() - 0.5) * 0.04; }
    g.updateMatrixWorld(true);
    const low = new THREE.Box3().setFromObject(g).min.y;
    if (low < 0) g.position.y = -low;
    return g;
  }

  // ---------- prop table (one entry per body type) ----------
  const props = {};
  for (const [id, t] of Object.entries(TYPES)) {
    props[id] = {
      label: t.label,
      category: ['bus', 'boxTruck', 'van'].includes(id) ? 'Commercial' : 'Cars',
      params: {
        length: R(+(t.L * 0.8).toFixed(1), +(t.L * 1.25).toFixed(1), 0.05, t.L),
        width: R(+(t.W * 0.85).toFixed(2), +(t.W * 1.15).toFixed(2), 0.01, t.W),
        height: R(+(t.H * 0.85).toFixed(2), +(t.H * 1.2).toFixed(2), 0.01, t.H),
        wheelSize: R(0.8, 1.35, 0.01, 1),
        rideHeight: R(0, 0.3, 0.01, 0),
        paint: C(t.paint),
        cargoColor: C('#f0f0f0', id === 'boxTruck' ? undefined : { livery: ['__never'] }),
        trim: C('#1c1c1c'),
        glassTint: C('#25323d'),
        condition: S(['clean', 'dirty', 'wrecked', 'burned'], 'clean'),
        livery: S(['none', 'taxi', 'police'], 'none'),
        sideText: T(''),
        textColor: C('#111111'),
        lightsOn: B(false),
        seed: R(1, 999, 1, 1, { condition: ['wrecked'] }),
      },
      build: p => buildVehicle(id, p),
    };
  }

  // ================= API =================
  function defaults(id) {
    const out = {};
    for (const [k, s] of Object.entries(props[id].params)) out[k] = s.value;
    return out;
  }
  function build(preset) {
    const def = props[preset.prop];
    if (!def) throw new Error('Unknown vehicle: ' + preset.prop);
    const p = Object.assign(defaults(preset.prop), preset.params || {});
    const g = def.build(p);
    g.name = preset.prop;
    g.userData.preset = { prop: preset.prop, version: VERSION, params: p };
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

export { createVehicleLibrary };
