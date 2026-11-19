function createPropLibrary(THREE) {
  const VERSION = 2;
  const PI = Math.PI, deg = THREE.MathUtils.degToRad;

  // ---------- materials ----------
  const matCache = new Map();
  function mat(color, o = {}) {
    const key = color + '|' + JSON.stringify(o);
    if (!o.nocache && matCache.has(key)) return matCache.get(key);
    const transparent = o.opacity != null && o.opacity < 1;
    const m = new THREE.MeshStandardMaterial({
      color, roughness: o.rough ?? 0.75, metalness: o.metal ?? 0.05, flatShading: true,
      transparent, opacity: o.opacity ?? 1, depthWrite: !transparent,
      emissive: o.emissive ?? 0x000000, emissiveIntensity: o.emissiveIntensity ?? 1,
    });
    m.userData.role = o.role || 'solid';
    if (o.nocache) m.userData.disposable = true; else matCache.set(key, m);
    return m;
  }
  const glass = () => mat('#9fc4d6', { opacity: 0.32, rough: 0.1, metal: 0.2, role: 'glass' });
  const dark = () => mat('#1a1a1a', { rough: 0.8, metal: 0.3 });

  function texMat(tex, lit) {
    const m = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.6, metalness: 0,
      emissive: lit ? 0xffffff : 0x000000, emissiveMap: lit ? tex : null, emissiveIntensity: lit ? 0.6 : 0,
    });
    m.userData.role = 'decal'; m.userData.disposable = true;
    return m;
  }

  // ---------- geometry helpers ----------
  function add(parent, geo, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    parent.add(m); return m;
  }
  const box = (p, w, h, d, m, x, y, z, rx, ry, rz) => add(p, new THREE.BoxGeometry(w, h, d), m, x, y, z, rx, ry, rz);
  const cyl = (p, rt, rb, h, seg, m, x, y, z, rx, ry, rz) => add(p, new THREE.CylinderGeometry(rt, rb, h, seg), m, x, y, z, rx, ry, rz);
  const torus = (p, r, t, m, y) => add(p, new THREE.TorusGeometry(r, t, 6, 20), m, 0, y, 0, PI / 2);

  function rng(seed) {
    let a = (Math.imul(seed | 0, 2654435761) >>> 0) || 1;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function hash3(x, y, z, s) { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + s * 13.3) * 43758.5453; return h - Math.floor(h); }
  // Icosphere with deterministic per-position jitter (no cracks between shared verts)
  function lumpy(radius, detail, seed, amt) {
    const g = new THREE.IcosahedronGeometry(radius, detail);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const q = v => Math.round(v * 1e4) / 1e4;
      const f = 1 + (hash3(q(x), q(y), q(z), seed) - 0.5) * 2 * amt;
      p.setXYZ(i, x * f, y * f, z * f);
    }
    g.computeVertexNormals();
    return g;
  }

  // Canvas texture with stacked centered text lines
  function adTexture(lines, bg, fg, aspect, o = {}) {
    const W = 1024, H = Math.max(48, Math.min(2048, Math.round(W / Math.max(aspect, 0.25))));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    if (o.deco) {
      g.fillStyle = fg; g.globalAlpha = 0.16;
      g.beginPath(); g.arc(W * 0.86, H * 0.18, Math.min(W, H) * 0.5, 0, PI * 2); g.fill();
      g.globalAlpha = 1; g.fillRect(0, H * 0.88, W, H * 0.035);
    }
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((ln, i) => {
      let size = ln.size * H;
      const font = s => `${ln.bold ? 900 : 600} ${s}px Arial, Helvetica, sans-serif`;
      g.font = font(size);
      const mw = g.measureText(ln.text).width;
      if (mw > W * 0.9) { size *= (W * 0.9) / mw; g.font = font(size); }
      g.fillText(ln.text, W / 2, H * ((i + 1) / (lines.length + 1)));
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }

  function propLight(color, intensity, dist, x, y, z) {
    const L = new THREE.PointLight(color, intensity, dist, 1.6);
    L.position.set(x, y, z); L.userData.isPropLight = true;
    return L;
  }

  // ---------- param spec helpers ----------
  const R = (min, max, step, value, when) => ({ type: 'range', min, max, step, value, when });
  const C = (value, when) => ({ type: 'color', value, when });
  const B = (value, when) => ({ type: 'bool', value, when });
  const S = (options, value, when) => ({ type: 'select', options, value, when });
  const T = (value, when) => ({ type: 'text', value, when });

  // ================= PROPS =================
  // Convention: origin at ground center, +Z is the front, 1 unit = 1 meter.
  const props = {};

  props.dumpster = {
    label: 'Dumpster', category: 'Utilities',
    params: {
      width: R(1.0, 3.0, 0.05, 1.8), depth: R(0.7, 1.6, 0.05, 1.1), height: R(0.8, 1.6, 0.05, 1.2),
      color: C('#2f6b3a'), lidColor: C('#222222'), lidOpen: R(0, 110, 1, 0),
      splitLid: B(true), wheels: B(true), forkPockets: B(true),
    },
    build(p) {
      const g = new THREE.Group();
      const body = mat(p.color, { metal: 0.3, rough: 0.6 }), lid = mat(p.lidColor, { rough: 0.7 }), dk = dark();
      const wh = p.wheels ? 0.14 : 0.04, bh = p.height - wh - 0.05;
      box(g, p.width, bh, p.depth, body, 0, wh + bh / 2, 0);
      box(g, p.width + 0.06, 0.07, p.depth + 0.06, body, 0, wh + bh, 0);
      box(g, p.width - 0.1, 0.004, p.depth - 0.1, dk, 0, wh + bh + 0.037, 0);
      for (const sx of [-0.3, 0.3]) for (const sz of [1, -1])
        box(g, 0.06, bh * 0.85, 0.04, body, sx * p.width, wh + bh * 0.5, sz * (p.depth / 2 + 0.02));
      if (p.forkPockets) for (const sx of [1, -1])
        box(g, 0.07, 0.13, p.depth * 0.85, dk, sx * (p.width / 2 + 0.035), wh + bh * 0.55, 0);
      if (p.wheels) for (const sx of [1, -1]) for (const sz of [1, -1]) {
        const x = sx * (p.width / 2 - 0.15), z = sz * (p.depth / 2 - 0.12);
        cyl(g, 0.06, 0.06, 0.05, 10, dk, x, 0.06, z, 0, 0, PI / 2);
        box(g, 0.08, 0.06, 0.08, dk, x, wh - 0.03, z);
      }
      const n = p.splitLid ? 2 : 1, lw = (p.width + 0.04) / n;
      for (let i = 0; i < n; i++) {
        const pivot = new THREE.Group();
        pivot.position.set(-p.width / 2 - 0.02 + lw * (i + 0.5), wh + bh + 0.04, -p.depth / 2 - 0.03);
        pivot.rotation.x = -deg(p.lidOpen);
        g.add(pivot);
        box(pivot, lw - 0.02, 0.04, p.depth + 0.06, lid, 0, 0.02, (p.depth + 0.06) / 2);
      }
      return g;
    },
  };

  props.phoneBooth = {
    label: 'Phone Booth', category: 'Street furniture',
    params: {
      style: S(['classic', 'kiosk'], 'classic'),
      height: R(2.2, 3.0, 0.05, 2.5), width: R(0.8, 1.2, 0.05, 0.95),
      color: C('#c8102e'), signText: T('TELEPHONE'),
      paneRows: R(3, 8, 1, 6, { style: ['classic'] }), paneCols: R(2, 4, 1, 3, { style: ['classic'] }),
      doorOpen: R(0, 90, 1, 0, { style: ['classic'] }),
    },
    build(p) {
      const g = new THREE.Group();
      const W = p.width, H = p.height, dk = dark();
      if (p.style === 'kiosk') {
        const steel = mat('#8a8f94', { metal: 0.6, rough: 0.4 }), acc = mat(p.color, { rough: 0.5 });
        cyl(g, 0.06, 0.07, H - 0.5, 10, steel, 0, (H - 0.5) / 2, -0.2);
        box(g, 0.75, 0.95, 0.04, acc, 0, H - 0.95, -0.17);
        for (const s of [1, -1]) box(g, 0.04, 0.95, 0.45, acc, s * 0.375, H - 0.95, 0.04);
        box(g, 0.8, 0.05, 0.5, acc, 0, H - 0.45, 0.04);
        box(g, 0.24, 0.36, 0.1, dk, 0, H - 1.0, -0.1);
        box(g, 0.5, 0.03, 0.22, steel, 0, H - 1.3, -0.04);
        const sign = texMat(adTexture([{ text: p.signText, size: 0.6, bold: true }], '#111111', '#ffffff', 4), true);
        box(g, 0.8, 0.2, 0.06, sign, 0, H - 0.32, 0.04);
        return g;
      }
      const red = mat(p.color, { rough: 0.5 }), gl = glass();
      box(g, W + 0.16, 0.12, W + 0.16, red, 0, 0.06, 0);
      const postH = H - 0.12 - 0.5, topY = 0.12 + postH;
      for (const sx of [1, -1]) for (const sz of [1, -1]) box(g, 0.1, postH, 0.1, red, sx * W / 2, 0.12 + postH / 2, sz * W / 2);
      box(g, W + 0.14, 0.32, W + 0.14, red, 0, topY + 0.16, 0);
      box(g, W + 0.22, 0.06, W + 0.22, red, 0, topY + 0.35, 0);
      box(g, W * 0.8, 0.08, W * 0.8, red, 0, topY + 0.42, 0);
      box(g, W * 0.45, 0.06, W * 0.45, red, 0, topY + 0.49, 0);
      const sign = texMat(adTexture([{ text: p.signText, size: 0.6, bold: true }], '#111111', '#ffffff', (W - 0.1) / 0.18), true);
      const panelW = W - 0.1, panelH = postH - 0.1, panelY = 0.12 + 0.05 + panelH / 2;
      const glazed = (parent) => {
        box(parent, panelW, panelH, 0.01, gl, 0, 0, 0);
        for (const s of [1, -1]) { box(parent, panelW, 0.06, 0.04, red, 0, s * panelH / 2, 0); box(parent, 0.06, panelH, 0.04, red, s * panelW / 2, 0, 0); }
        for (let c = 1; c < p.paneCols; c++) box(parent, 0.025, panelH, 0.03, red, -panelW / 2 + c * panelW / p.paneCols, 0, 0);
        for (let r = 1; r < p.paneRows; r++) box(parent, panelW, 0.025, 0.03, red, 0, -panelH / 2 + r * panelH / p.paneRows, 0);
      };
      for (let k = 0; k < 4; k++) {
        const side = new THREE.Group(); side.rotation.y = k * PI / 2; g.add(side);
        box(side, W - 0.1, 0.18, 0.01, sign, 0, topY + 0.16, (W + 0.14) / 2 + 0.006);
        if (k === 0) {
          const hinge = new THREE.Group(); hinge.position.set(-panelW / 2, panelY, W / 2); hinge.rotation.y = -deg(p.doorOpen); side.add(hinge);
          const door = new THREE.Group(); door.position.x = panelW / 2; hinge.add(door);
          glazed(door);
          box(door, 0.04, 0.2, 0.05, dk, panelW / 2 - 0.1, 0, 0.04);
        } else {
          const panel = new THREE.Group(); panel.position.set(0, panelY, W / 2); side.add(panel); glazed(panel);
        }
      }
      box(g, 0.22, 0.32, 0.12, dk, 0, 1.35, -W / 2 + 0.1);
      box(g, 0.4, 0.03, 0.25, dk, 0, 1.0, -W / 2 + 0.16);
      return g;
    },
  };

  props.streetLight = {
    label: 'Street Light', category: 'Street furniture',
    params: {
      style: S(['cobra', 'double', 'globe'], 'cobra'),
      poleHeight: R(3, 12, 0.1, 7), armLength: R(0.5, 3.5, 0.05, 1.8, { style: ['cobra', 'double'] }),
      poleColor: C('#3a3d40'), decorativeBase: B(false),
      lampOn: B(true), lightColor: C('#ffd9a0'),
    },
    build(p) {
      const g = new THREE.Group(), H = p.poleHeight;
      const pm = mat(p.poleColor, { metal: 0.5, rough: 0.5 });
      const lamp = p.lampOn ? mat(p.lightColor, { emissive: p.lightColor, emissiveIntensity: 2, role: 'lamp' }) : mat('#d8d8d8', { role: 'lamp' });
      if (p.decorativeBase) cyl(g, 0.2, 0.26, 0.6, 8, pm, 0, 0.3, 0); else box(g, 0.35, 0.05, 0.35, pm, 0, 0.025, 0);
      cyl(g, 0.06, 0.11, H, 10, pm, 0, H / 2, 0);
      if (p.style === 'globe') {
        add(g, new THREE.SphereGeometry(0.26, 12, 8), lamp, 0, H + 0.3, 0);
        cyl(g, 0.12, 0.08, 0.1, 10, pm, 0, H + 0.05, 0);
        cyl(g, 0.06, 0.2, 0.1, 10, pm, 0, H + 0.6, 0);
        if (p.lampOn) g.add(propLight(p.lightColor, 40, 16, 0, H + 0.3, 0));
        return g;
      }
      const dirs = p.style === 'double' ? [1, -1] : [1];
      for (const d of dirs) {
        const arm = new THREE.Group(); arm.position.set(0, H - 0.1, 0); arm.rotation.x = -0.08 * d; g.add(arm);
        const L = p.armLength;
        cyl(arm, 0.04, 0.05, L, 8, pm, 0, 0, d * L / 2, PI / 2);
        box(arm, 0.3, 0.12, 0.6, pm, 0, 0, d * (L + 0.25));
        box(arm, 0.24, 0.02, 0.45, lamp, 0, -0.07, d * (L + 0.25));
        if (p.lampOn) arm.add(propLight(p.lightColor, 60, 20, 0, -0.35, d * (L + 0.25)));
      }
      return g;
    },
  };

  props.busStop = {
    label: 'Bus Stop', category: 'Street furniture',
    params: {
      width: R(2, 6, 0.1, 3.5), depth: R(1, 2, 0.05, 1.4), height: R(2.2, 3, 0.05, 2.5),
      frameColor: C('#6b7177'), roofColor: C('#2b2b2b'),
      backGlass: B(true), sidePanels: S(['none', 'left', 'right', 'both'], 'left'),
      bench: B(true), adPanel: B(true), adText: T('YOUR AD HERE', { adPanel: [true] }),
      adColor: C('#1f7a8c', { adPanel: [true] }), signPole: B(true), route: T('42', { signPole: [true] }),
    },
    build(p) {
      const g = new THREE.Group(), W = p.width, D = p.depth, H = p.height;
      const fr = mat(p.frameColor, { metal: 0.5, rough: 0.4 }), roof = mat(p.roofColor, { rough: 0.6 }), gl = glass();
      const nPosts = Math.max(2, Math.round(W / 1.8) + 1), span = W / (nPosts - 1), backZ = -D / 2 + 0.05;
      const glassH = H * 0.72, glassY = 0.25 + glassH / 2;
      for (let i = 0; i < nPosts; i++) {
        const x = -W / 2 + i * span;
        box(g, 0.08, H, 0.08, fr, x, H / 2, backZ);
        box(g, 0.06, 0.08, D, fr, x, H - 0.04, 0);
        if (p.backGlass && i < nPosts - 1) {
          box(g, span - 0.1, glassH, 0.015, gl, x + span / 2, glassY, backZ);
          box(g, span, 0.05, 0.05, fr, x + span / 2, 0.25, backZ);
        }
      }
      box(g, W + 0.3, 0.08, D + 0.25, roof, 0, H + 0.04, 0.05);
      const sides = { none: [], left: [-1], right: [1], both: [-1, 1] }[p.sidePanels] || [];
      for (const s of sides) box(g, 0.015, glassH, D * 0.75, gl, s * W / 2, glassY, backZ + D * 0.375);
      if (p.adPanel) {
        const tex = adTexture([{ text: p.adText, size: 0.12, bold: true }], p.adColor, '#ffffff', 1.2 / 1.8, { deco: true });
        const ad = texMat(tex, true);
        const x = W / 2 + 0.12;
        box(g, 0.14, 1.8, 1.2, [ad, ad, fr, fr, fr, fr], x, 0.2 + 0.9, backZ + 0.65);
        box(g, 0.1, 0.2, 0.1, fr, x, 0.1, backZ + 0.2);
        box(g, 0.1, 0.2, 0.1, fr, x, 0.1, backZ + 1.1);
      }
      if (p.bench) {
        const bw = Math.min(W * 0.55, 2.2);
        box(g, bw, 0.05, 0.38, fr, 0, 0.46, backZ + 0.3);
        for (const s of [1, -1]) box(g, 0.05, 0.44, 0.3, fr, s * (bw / 2 - 0.1), 0.22, backZ + 0.3);
      }
      if (p.signPole) {
        const tex = adTexture([{ text: 'BUS', size: 0.22, bold: true }, { text: p.route, size: 0.4, bold: true }], '#1d4ed8', '#ffffff', 1);
        const sign = texMat(tex, false);
        cyl(g, 0.04, 0.04, 2.8, 8, fr, -W / 2 - 0.5, 1.4, D / 2);
        box(g, 0.5, 0.5, 0.04, sign, -W / 2 - 0.5, 2.5, D / 2 + 0.05);
      }
      return g;
    },
  };

  props.trashCan = {
    label: 'Trash Can', category: 'Street furniture',
    params: {
      style: S(['municipal', 'wire', 'dome'], 'municipal'),
      height: R(0.6, 1.3, 0.05, 0.95), radius: R(0.2, 0.5, 0.01, 0.3),
      color: C('#1f3a5f'), lid: B(true, { style: ['municipal'] }),
    },
    build(p) {
      const g = new THREE.Group(), H = p.height, Rr = p.radius;
      const c = mat(p.color, { metal: 0.4, rough: 0.5 }), dk = dark();
      if (p.style === 'wire') {
        const n = 16;
        for (let i = 0; i < n; i++) { const a = (i / n) * PI * 2; box(g, 0.015, H - 0.06, 0.015, c, Math.cos(a) * Rr, H / 2, Math.sin(a) * Rr); }
        for (const y of [0.05, H * 0.5, H - 0.02]) torus(g, Rr, 0.014, c, y);
        cyl(g, Rr, Rr, 0.02, 16, c, 0, 0.04, 0);
        cyl(g, Rr * 0.93, Rr * 0.85, H * 0.9, 12, mat('#262626', { rough: 0.95 }), 0, H * 0.47, 0);
        return g;
      }
      if (p.style === 'dome') {
        const bodyH = H * 0.75;
        box(g, Rr * 2, bodyH, Rr * 2, c, 0, bodyH / 2, 0);
        const dome = add(g, new THREE.SphereGeometry(Rr * 1.05, 14, 6, 0, PI * 2, 0, PI / 2), c, 0, bodyH, 0);
        dome.scale.y = (H - bodyH) / (Rr * 1.05);
        box(g, Rr * 1.0, Math.min(0.14, (H - bodyH) * 0.5), 0.06, dk, 0, bodyH + (H - bodyH) * 0.3, Rr * 0.9);
        box(g, Rr * 2.04, 0.06, Rr * 2.04, dk, 0, 0.03, 0);
        return g;
      }
      cyl(g, Rr, Rr * 0.92, H - 0.05, 14, c, 0, (H - 0.05) / 2 + 0.05, 0);
      cyl(g, Rr * 0.95, Rr * 0.95, 0.05, 14, dk, 0, 0.025, 0);
      cyl(g, Rr + 0.02, Rr + 0.02, 0.05, 14, c, 0, H - 0.04, 0);
      cyl(g, Rr + 0.01, Rr * 0.93 + 0.01, 0.04, 14, c, 0, H * 0.3, 0);
      if (p.lid) {
        cyl(g, Rr * 0.35, Rr + 0.03, 0.16, 14, c, 0, H + 0.06, 0);
        box(g, Rr * 0.9, 0.08, 0.05, dk, 0, H + 0.05, Rr * 0.6, -0.5);
      } else {
        cyl(g, Rr * 0.92, Rr * 0.92, 0.01, 14, dk, 0, H - 0.01, 0);
      }
      return g;
    },
  };

  function clumpCloud(parent, r, cfg) {
    const base = new THREE.Color(cfg.color);
    for (let i = 0; i < cfg.count; i++) {
      const rad = cfg.size * (0.7 + r() * 0.5) * (i === 0 ? 1.15 : 1);
      const a = r() * PI * 2, u = i === 0 ? 0 : Math.sqrt(r());
      const x = Math.cos(a) * u * cfg.rx, z = Math.sin(a) * u * cfg.rx, y = (r() * 2 - 1) * cfg.ry * (i === 0 ? 0 : 1);
      const col = base.clone().offsetHSL((r() - 0.5) * 0.04, (r() - 0.5) * cfg.variation, (r() - 0.5) * cfg.variation);
      add(parent, lumpy(rad, 1, cfg.seed * 31 + i, 0.18), mat('#' + col.getHexString(), { rough: 0.95, nocache: true }),
        cfg.cx + x, cfg.cy + y, cfg.cz + z, r() * 3, r() * 3, 0);
    }
  }

  props.bush = {
    label: 'Bush', category: 'Vegetation',
    params: {
      width: R(0.4, 3, 0.05, 1.4), height: R(0.3, 2, 0.05, 0.9), clumps: R(1, 14, 1, 6),
      seed: R(1, 999, 1, 7), color: C('#3f7a3a'), variation: R(0, 0.4, 0.01, 0.15),
    },
    build(p) {
      const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner);
      const r = rng(p.seed);
      clumpCloud(inner, r, { count: p.clumps, size: p.width * 0.28, rx: p.width * 0.3, ry: p.width * 0.08, cx: 0, cy: 0, cz: 0, color: p.color, variation: p.variation, seed: p.seed });
      inner.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(inner);
      const sy = p.height / Math.max(0.01, bb.max.y - bb.min.y);
      inner.scale.y = sy; inner.position.y = -bb.min.y * sy - 0.02;
      return g;
    },
  };

  props.tree = {
    label: 'Tree', category: 'Vegetation',
    params: {
      style: S(['round', 'conifer', 'columnar'], 'round'),
      trunkHeight: R(0.5, 5, 0.05, 2.2), trunkRadius: R(0.05, 0.5, 0.01, 0.15), canopySize: R(0.8, 6, 0.05, 2.6),
      clumps: R(1, 16, 1, 8, { style: ['round', 'columnar'] }), seed: R(1, 999, 1, 3),
      trunkColor: C('#5a4030'), leafColor: C('#4a8a3c'), variation: R(0, 0.4, 0.01, 0.12), grate: B(true),
    },
    build(p) {
      const g = new THREE.Group(), r = rng(p.seed), TH = p.trunkHeight, TR = p.trunkRadius, Cs = p.canopySize;
      const trunk = mat(p.trunkColor, { rough: 0.95 });
      if (p.grate) {
        box(g, 1.3, 0.02, 1.3, mat('#2a2a2a', { metal: 0.5, rough: 0.5 }), 0, 0.01, 0);
        box(g, 0.9, 0.025, 0.9, mat('#3b2f25', { rough: 1 }), 0, 0.012, 0);
      }
      if (p.style === 'conifer') {
        cyl(g, TR * 0.5, TR, TH + Cs * 0.6, 7, trunk, 0, (TH + Cs * 0.6) / 2, 0);
        const base = new THREE.Color(p.leafColor), tiers = 4;
        for (let t = 0; t < tiers; t++) {
          const f = 1 - t / tiers, col = base.clone().offsetHSL(0, 0, (r() - 0.5) * p.variation);
          add(g, new THREE.ConeGeometry(Cs * 0.5 * (f * 0.85 + 0.15), Cs * 0.5, 8),
            mat('#' + col.getHexString(), { rough: 0.95, nocache: true }), 0, TH + t * Cs * 0.3 + Cs * 0.2, 0, 0, r() * PI, 0);
        }
        return g;
      }
      cyl(g, TR * 0.7, TR, TH, 7, trunk, 0, TH / 2, 0);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * PI * 2 + r();
        const br = new THREE.Group(); br.position.y = TH * 0.95; br.rotation.set(0, a, 0.6); g.add(br);
        cyl(br, TR * 0.3, TR * 0.5, Cs * 0.35, 6, trunk, 0, Cs * 0.17, 0);
      }
      const col = p.style === 'columnar';
      const size = Cs * (col ? 0.22 : 0.28), ry = Cs * (col ? 0.55 : 0.18);
      // keep the lowest clump above ground on short trunks
      const cy = Math.max(TH + Cs * (col ? 0.6 : 0.35), ry + size * 1.65 + 0.15);
      const canopy = new THREE.Group(); g.add(canopy);
      clumpCloud(canopy, r, {
        count: p.clumps, size, rx: Cs * (col ? 0.18 : 0.32), ry,
        cx: 0, cy, cz: 0, color: p.leafColor, variation: p.variation, seed: p.seed,
      });
      canopy.updateMatrixWorld(true);
      const low = new THREE.Box3().setFromObject(canopy).min.y;
      if (low < 0.15) canopy.position.y = 0.15 - low;
      return g;
    },
  };

  props.advertisement = {
    label: 'Advertisement', category: 'Commerce & storefront',
    params: {
      type: S(['billboard', 'poster', 'sandwich', 'column'], 'billboard'),
      width: R(0.6, 8, 0.1, 4), height: R(0.5, 4, 0.05, 2), mountHeight: R(0, 8, 0.1, 4, { type: ['billboard', 'poster'] }),
      headline: T('DRINK COLA'), subline: T('Ice cold. Since 1931.'),
      bgColor: C('#e63946'), fgColor: C('#ffffff'), frameColor: C('#333333'), lit: B(true),
    },
    build(p) {
      const g = new THREE.Group(), fr = mat(p.frameColor, { metal: 0.4, rough: 0.5 });
      const makeAd = aspect => texMat(adTexture([{ text: p.headline, size: 0.3, bold: true }, { text: p.subline, size: 0.13 }], p.bgColor, p.fgColor, aspect, { deco: true }), p.lit);
      let W = p.width, H = p.height;
      if (p.type === 'billboard') {
        const PH = Math.max(0.08, p.mountHeight), ad = makeAd(W / H);
        const poles = W >= 3 ? [-W * 0.3, W * 0.3] : [0];
        for (const x of poles) cyl(g, 0.12, 0.15, PH + H * 0.5, 10, fr, x, (PH + H * 0.5) / 2, -0.15);
        box(g, W + 0.16, H + 0.16, 0.1, fr, 0, PH + H / 2, -0.04);
        box(g, W, H, 0.12, [fr, fr, fr, fr, ad, ad], 0, PH + H / 2, 0);
        if (PH > 1) box(g, W, 0.04, 0.5, fr, 0, PH - 0.08, 0.3);
        if (p.lit) {
          const lampM = mat('#fff4d6', { emissive: '#fff4d6', emissiveIntensity: 2, role: 'lamp' });
          const n = Math.max(1, Math.round(W / 2));
          for (let i = 0; i < n; i++) {
            const x = -W / 2 + (i + 0.5) * W / n;
            box(g, 0.04, 0.04, 0.6, fr, x, PH + H + 0.1, 0.3);
            box(g, 0.25, 0.06, 0.12, lampM, x, PH + H + 0.08, 0.6);
          }
        }
        return g;
      }
      if (p.type === 'poster') {
        const bottom = Math.max(0.3, Math.min(p.mountHeight, 3)), ad = makeAd(W / H);
        box(g, W + 1, bottom + H + 0.6, 0.2, mat('#a9a39a', { rough: 0.95 }), 0, (bottom + H + 0.6) / 2, -0.13);
        box(g, W + 0.1, H + 0.1, 0.06, fr, 0, bottom + H / 2, 0);
        box(g, W, H, 0.01, ad, 0, bottom + H / 2, 0.035);
        return g;
      }
      if (p.type === 'sandwich') {
        W = Math.min(W, 0.7); H = Math.min(H, 1.0);
        const a = 0.2, top = H * Math.cos(a), ad = makeAd(W / H);
        for (const s of [1, -1]) {
          const pivot = new THREE.Group(); pivot.position.y = top; pivot.rotation.x = -a * s; g.add(pivot);
          const mats = s === 1 ? [fr, fr, fr, fr, ad, fr] : [fr, fr, fr, fr, fr, ad];
          box(pivot, W, H, 0.03, mats, 0, -H / 2, 0);
        }
        box(g, W * 0.6, 0.04, 0.04, fr, 0, top + 0.01, 0);
        return g;
      }
      // column (Morris column)
      const Rc = Math.max(0.35, Math.min(1.0, W / 6)), CH = Math.max(H, 1.8);
      const ad = makeAd((2 * PI * Rc) / CH);
      cyl(g, Rc + 0.08, Rc + 0.12, 0.3, 16, fr, 0, 0.15, 0);
      cyl(g, Rc, Rc, CH, 16, [ad, fr, fr], 0, 0.3 + CH / 2, 0);
      cyl(g, Rc + 0.12, Rc + 0.05, 0.14, 16, fr, 0, 0.3 + CH + 0.07, 0);
      const dome = add(g, new THREE.SphereGeometry(Rc * 0.95, 16, 6, 0, PI * 2, 0, PI / 2), fr, 0, 0.3 + CH + 0.14, 0);
      dome.scale.y = 0.5;
      cyl(g, 0.03, 0.06, 0.25, 8, fr, 0, 0.3 + CH + 0.14 + Rc * 0.47 + 0.1, 0);
      return g;
    },
  };

  // ---------- extra helpers ----------
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }
  function decalMat(tex, o = {}) {
    const m = new THREE.MeshStandardMaterial({
      map: tex, color: o.color ?? 0xffffff, roughness: o.rough ?? 0.6, metalness: o.metal ?? 0,
      emissive: o.lit ? 0xffffff : 0x000000, emissiveMap: o.lit ? tex : null, emissiveIntensity: o.lit ? 0.6 : 0,
      alphaTest: o.alpha ? 0.5 : 0, side: o.double ? THREE.DoubleSide : THREE.FrontSide,
    });
    m.userData.role = 'decal';
    if (o.shared) m.userData.sharedMap = true;
    m.userData.disposable = true;
    return m;
  }
  const shared = {};
  function sharedTex(name, make) { return shared[name] || (shared[name] = make()); }
  const louverTex = () => sharedTex('louver', () => canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = '#555555';
    for (let y = 4; y < h; y += 16) g.fillRect(0, y, w, 6);
  }));
  const wireTex = () => sharedTex('wire', () => {
    const t = canvasTex(64, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h); g.fillStyle = '#ffffff';
      for (let i = 0; i < w; i += 16) { g.fillRect(i, 0, 3, h); g.fillRect(0, i, w, 3); }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 4); return t;
  });
  function stripeTex(c1, c2, count, horizontal) {
    return canvasTex(256, 256, (g, w, h) => {
      for (let i = 0; i < count; i++) {
        g.fillStyle = i % 2 ? c2 : c1;
        if (horizontal) g.fillRect(0, (i * h) / count, w, h / count + 1);
        else g.fillRect((i * w) / count, 0, w / count + 1, h);
      }
    });
  }
  function refWall(g, w, h, show) {
    if (!show) return;
    box(g, w, h, 0.2, mat('#8c8c8c', { rough: 0.95, role: 'reference' }), 0, h / 2, -0.1);
  }
  const lampMat = (color, on) => on ? mat(color, { emissive: color, emissiveIntensity: 2.5, role: 'lamp' }) : mat(new THREE.Color(color).multiplyScalar(0.25).getStyle(), { role: 'lamp' });

  // ================= STREET FURNITURE =================
  props.bench = {
    label: 'Bench', category: 'Street furniture',
    params: { style: S(['slat', 'metal', 'backless'], 'slat'), width: R(1.2, 3, 0.05, 1.8), seatColor: C('#8a5a35'), frameColor: C('#2b2b2b'), armrests: B(true) },
    build(p) {
      const g = new THREE.Group(), W = p.width, fr = mat(p.frameColor, { metal: 0.5, rough: 0.5 }), seat = mat(p.seatColor, { rough: 0.8 });
      const back = p.style !== 'backless', tilt = -0.2;
      const xs = W > 2.2 ? [-W / 2 + 0.15, 0, W / 2 - 0.15] : [-W / 2 + 0.15, W / 2 - 0.15];
      for (const x of xs) {
        box(g, 0.06, 0.45, 0.06, fr, x, 0.225, 0.18); box(g, 0.06, 0.45, 0.06, fr, x, 0.225, -0.18);
        box(g, 0.06, 0.05, 0.5, fr, x, 0.44, 0);
        if (back) box(g, 0.06, 0.5, 0.05, fr, x, 0.72, -0.25, tilt);
      }
      if (p.style === 'metal') {
        box(g, W, 0.03, 0.48, fr, 0, 0.47, 0);
        if (back) box(g, W, 0.4, 0.03, fr, 0, 0.75, -0.28, tilt);
      } else {
        for (let i = 0; i < 4; i++) box(g, W, 0.035, 0.1, seat, 0, 0.48, -0.18 + i * 0.12);
        if (back) for (let i = 0; i < 3; i++) { const y = 0.6 + i * 0.13; box(g, W, 0.08, 0.03, seat, 0, y, -0.27 + Math.sin(tilt) * (y - 0.47), tilt); }
      }
      if (p.armrests) for (const s of [1, -1]) {
        box(g, 0.05, 0.04, 0.45, fr, s * (W / 2 - 0.15), 0.69, 0.02);
        box(g, 0.04, 0.2, 0.04, fr, s * (W / 2 - 0.15), 0.58, 0.2);
      }
      return g;
    },
  };

  props.bikeRack = {
    label: 'Bike Rack', category: 'Street furniture',
    params: { style: S(['hoop', 'wave', 'grid'], 'hoop'), count: R(1, 8, 1, 3), color: C('#2b2b2b') },
    build(p) {
      const g = new THREE.Group(), m = mat(p.color, { metal: 0.6, rough: 0.4 }), n = p.count;
      if (p.style === 'hoop') {
        for (let i = 0; i < n; i++) {
          const x = (i - (n - 1) / 2) * 0.9;
          const h = new THREE.Group(); h.position.set(x, 0, 0); h.rotation.y = PI / 2; g.add(h);
          add(h, new THREE.TorusGeometry(0.35, 0.025, 6, 14, PI), m, 0, 0.5, 0);
          for (const s of [1, -1]) cyl(h, 0.025, 0.025, 0.5, 8, m, s * 0.35, 0.25, 0);
        }
      } else if (p.style === 'wave') {
        const L = n * 0.6, pts = [];
        for (let i = 0; i <= n * 2; i++) pts.push(new THREE.Vector3(-L / 2 + (i / (n * 2)) * L, i % 2 ? 0.85 : 0.04, 0));
        add(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 16, 0.03, 6), m);
      } else {
        const L = n * 0.45;
        for (const z of [-0.25, 0.25]) box(g, L, 0.04, 0.04, m, 0, 0.03, z);
        for (let i = 0; i < n; i++) {
          const x = -L / 2 + (i + 0.5) * (L / n), r = i % 2 ? 0.22 : 0.3;
          const u = new THREE.Group(); u.position.set(x, 0, 0); u.rotation.y = PI / 2; g.add(u);
          add(u, new THREE.TorusGeometry(0.25, 0.015, 5, 12, PI), m, 0, r, 0);
          for (const s of [1, -1]) cyl(u, 0.015, 0.015, r, 6, m, s * 0.25, r / 2, 0);
        }
      }
      return g;
    },
  };

  props.planter = {
    label: 'Planter', category: 'Street furniture',
    params: { shape: S(['box', 'round'], 'box'), width: R(0.4, 3, 0.05, 1.2), depth: R(0.4, 1.5, 0.05, 0.6, { shape: ['box'] }), height: R(0.3, 1.2, 0.05, 0.6), color: C('#9c9a94'), soil: B(true) },
    build(p) {
      const g = new THREE.Group(), m = mat(p.color, { rough: 0.9 }), soil = mat('#3b2f25', { rough: 1 });
      if (p.shape === 'round') {
        const r = p.width / 2;
        cyl(g, r, r * 0.85, p.height, 14, m, 0, p.height / 2, 0);
        cyl(g, r + 0.03, r + 0.03, 0.06, 14, m, 0, p.height - 0.03, 0);
        if (p.soil) cyl(g, r * 0.9, r * 0.9, 0.02, 14, soil, 0, p.height - 0.05, 0);
      } else {
        box(g, p.width, p.height, p.depth, m, 0, p.height / 2, 0);
        box(g, p.width + 0.06, 0.06, p.depth + 0.06, m, 0, p.height - 0.03, 0);
        if (p.soil) box(g, p.width - 0.1, 0.02, p.depth - 0.1, soil, 0, p.height - 0.04 + 0.031, 0);
      }
      return g;
    },
  };

  props.newspaperBox = {
    label: 'Newspaper Box', category: 'Street furniture',
    params: { count: R(1, 5, 1, 3), color: C('#1f4fa0'), seed: R(1, 999, 1, 4), label: T('NEWS') },
    build(p) {
      const g = new THREE.Group(), r = rng(p.seed), dk = dark(), gl = glass();
      const palette = ['#1f4fa0', '#c1121f', '#f2c14e', '#2f7d32', '#e5e5e5', '#333333', '#e07a1f'];
      const paper = mat('#d9d6cc', { rough: 1 });
      for (let i = 0; i < p.count; i++) {
        const x = (i - (p.count - 1) / 2) * 0.56;
        const c = mat(i === 0 ? p.color : palette[Math.floor(r() * palette.length)], { metal: 0.3, rough: 0.5 });
        box(g, 0.32, 0.35, 0.32, dk, x, 0.175, 0);
        box(g, 0.5, 0.62, 0.45, c, x, 0.66, 0);
        box(g, 0.52, 0.04, 0.47, c, x, 0.99, 0);
        box(g, 0.4, 0.26, 0.01, gl, x, 0.8, 0.228);
        box(g, 0.36, 0.2, 0.01, paper, x, 0.79, 0.215);
        box(g, 0.1, 0.12, 0.05, dk, x + 0.15, 0.6, 0.24);
        const lab = decalMat(adTexture([{ text: p.label, size: 0.6, bold: true }], '#ffffff', '#111111', 0.44 / 0.08));
        box(g, 0.44, 0.08, 0.01, lab, x, 0.6, 0.227);
      }
      return g;
    },
  };

  props.mailbox = {
    label: 'Mailbox', category: 'Street furniture',
    params: { color: C('#1f4fa0'), label: T('MAIL') },
    build(p) {
      const g = new THREE.Group(), c = mat(p.color, { metal: 0.3, rough: 0.5 }), dk = dark();
      for (const sx of [1, -1]) for (const sz of [1, -1]) box(g, 0.05, 0.3, 0.05, c, sx * 0.19, 0.15, sz * 0.21);
      box(g, 0.45, 0.75, 0.5, c, 0, 0.675, 0);
      add(g, new THREE.CylinderGeometry(0.225, 0.225, 0.5, 14, 1, false, PI / 2, PI), c, 0, 1.05, 0, PI / 2);
      box(g, 0.3, 0.05, 0.08, dk, 0, 1.0, 0.27);
      const lab = decalMat(adTexture([{ text: p.label, size: 0.6, bold: true }], p.color, '#ffffff', 0.35 / 0.12));
      box(g, 0.35, 0.12, 0.01, lab, 0, 0.75, 0.256);
      return g;
    },
  };

  props.bollard = {
    label: 'Bollard', category: 'Street furniture',
    params: { style: S(['post', 'dome', 'square'], 'post'), height: R(0.5, 1.3, 0.05, 0.9), radius: R(0.06, 0.25, 0.01, 0.11), count: R(1, 8, 1, 3), spacing: R(0.8, 2.5, 0.05, 1.4), color: C('#2b2b2b'), band: B(true) },
    build(p) {
      const g = new THREE.Group(), c = mat(p.color, { metal: 0.5, rough: 0.5 }), refl = mat('#f2c14e', { rough: 0.3, emissive: '#3a2a00' });
      for (let i = 0; i < p.count; i++) {
        const x = (i - (p.count - 1) / 2) * p.spacing, H = p.height, Rr = p.radius;
        if (p.style === 'square') { box(g, Rr * 2, H, Rr * 2, c, x, H / 2, 0); box(g, Rr * 2.3, 0.05, Rr * 2.3, c, x, H, 0); }
        else {
          cyl(g, Rr, Rr * 1.05, H - (p.style === 'dome' ? Rr : 0), 12, c, x, (H - (p.style === 'dome' ? Rr : 0)) / 2, 0);
          if (p.style === 'dome') add(g, new THREE.SphereGeometry(Rr, 12, 6, 0, PI * 2, 0, PI / 2), c, x, H - Rr, 0);
          else cyl(g, Rr * 1.15, Rr * 1.15, 0.05, 12, c, x, H, 0);
        }
        if (p.band) cyl(g, Rr * 1.03 + 0.003, Rr * 1.03 + 0.003, 0.06, 12, refl, x, H * 0.8, 0);
      }
      return g;
    },
  };

  // ================= TRAFFIC & ROAD =================
  function signalHead(parent, x, y, z, state, housing) {
    const h = mat(housing, { rough: 0.6, metal: 0.2 });
    box(parent, 0.36, 1.0, 0.28, h, x, y, z);
    box(parent, 0.52, 1.18, 0.02, mat('#1b1b1b'), x, y, z - 0.15);
    [['red', '#ff2a2a', 0.31], ['yellow', '#ffc21a', 0], ['green', '#22e07a', -0.31]].forEach(([name, col, dy]) => {
      cyl(parent, 0.11, 0.11, 0.03, 12, lampMat(col, state === name), x, y + dy, z + 0.145, PI / 2);
      box(parent, 0.28, 0.02, 0.16, h, x, y + dy + 0.14, z + 0.22);
    });
  }
  props.trafficLight = {
    label: 'Traffic Light', category: 'Traffic & road',
    params: {
      mount: S(['pole', 'mastArm'], 'mastArm'), poleHeight: R(2.5, 5, 0.05, 3.2, { mount: ['pole'] }),
      armLength: R(3, 12, 0.1, 7, { mount: ['mastArm'] }), heads: R(1, 3, 1, 2, { mount: ['mastArm'] }),
      state: S(['red', 'yellow', 'green', 'off'], 'red'), pedSignal: B(true), poleColor: C('#5b6066'), housingColor: C('#1b1b1b'),
    },
    build(p) {
      const g = new THREE.Group(), pm = mat(p.poleColor, { metal: 0.5, rough: 0.45 });
      box(g, 0.4, 0.05, 0.4, pm, 0, 0.025, 0);
      if (p.mount === 'pole') {
        cyl(g, 0.07, 0.09, p.poleHeight, 10, pm, 0, p.poleHeight / 2, 0);
        signalHead(g, 0, p.poleHeight + 0.5, 0.05, p.state, p.housingColor);
      } else {
        const H = 6.6, ay = H - 0.3;
        cyl(g, 0.12, 0.17, H, 10, pm, 0, H / 2, 0);
        cyl(g, 0.06, 0.1, p.armLength, 8, pm, p.armLength / 2, ay, 0, 0, 0, PI / 2);
        box(g, 0.04, 0.04, 0.04, pm, 0, ay, 0);
        for (let k = 0; k < p.heads; k++) {
          const x = p.armLength - 0.4 - k * 2.2;
          if (x < 0.6) break;
          box(g, 0.05, 0.3, 0.05, pm, x, ay - 0.2, 0);
          signalHead(g, x, ay - 0.85, 0.05, p.state, p.housingColor);
        }
      }
      if (p.pedSignal) {
        const pedOn = p.state !== 'off';
        box(g, 0.32, 0.32, 0.2, mat(p.housingColor), 0, 2.7, 0.2);
        box(g, 0.24, 0.24, 0.01, lampMat(p.state === 'green' ? '#ffffff' : '#ff7a1a', pedOn), 0, 2.7, 0.305);
        box(g, 0.1, 0.16, 0.06, mat('#f2c14e'), 0, 1.1, 0.15);
      }
      return g;
    },
  };

  function signTexture(kind, p) {
    if (kind === 'stop') return canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = '#c1121f'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff'; g.font = '900 170px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('STOP', w / 2, h / 2 + 6);
    });
    if (kind === 'yield') return canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = '#c1121f'; g.fillRect(0, 0, w, h);
      const v = [[256, 512], [478, 128], [34, 128]], c = [256, 256];
      g.fillStyle = '#fff'; g.beginPath();
      v.forEach(([x, y], i) => { const X = c[0] + 0.62 * (x - c[0]), Y = c[1] + 0.62 * (y - c[1]); i ? g.lineTo(X, Y) : g.moveTo(X, Y); });
      g.fill();
      g.fillStyle = '#c1121f'; g.font = '900 64px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('YIELD', 256, 220);
    });
    if (kind === 'speedLimit') return canvasTex(384, 512, (g, w, h) => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.strokeStyle = '#111'; g.lineWidth = 14; g.strokeRect(14, 14, w - 28, h - 28);
      g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '700 70px Arial'; g.fillText('SPEED', w / 2, 100); g.fillText('LIMIT', w / 2, 180);
      g.font = '900 200px Arial'; g.fillText(String(p.speed), w / 2, 350);
    });
    if (kind === 'noParking') return canvasTex(384, 512, (g, w, h) => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.strokeStyle = '#111'; g.lineWidth = 10; g.strokeRect(10, 10, w - 20, h - 20);
      g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 200px Arial'; g.fillText('P', w / 2, 230);
      g.strokeStyle = '#c1121f'; g.lineWidth = 26; g.beginPath(); g.arc(w / 2, 230, 140, 0, PI * 2); g.stroke();
      g.beginPath(); g.moveTo(w / 2 - 99, 131); g.lineTo(w / 2 + 99, 329); g.stroke();
      g.fillStyle = '#c1121f'; g.font = '700 54px Arial'; g.fillText('ANY TIME', w / 2, 440);
    });
    if (kind === 'oneWay') return canvasTex(1024, 342, (g, w, h) => {
      g.fillStyle = '#111'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff'; g.beginPath();
      g.moveTo(60, 120); g.lineTo(700, 120); g.lineTo(700, 50); g.lineTo(970, 171); g.lineTo(700, 292); g.lineTo(700, 222); g.lineTo(60, 222); g.closePath(); g.fill();
      g.fillStyle = '#111'; g.font = '900 86px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ONE WAY', 380, 174);
    });
    return null;
  }
  props.roadSign = {
    label: 'Road Sign', category: 'Traffic & road',
    params: {
      type: S(['stop', 'yield', 'speedLimit', 'noParking', 'oneWay', 'streetName'], 'stop'),
      postHeight: R(1.8, 3.5, 0.05, 2.3), speed: R(15, 65, 5, 25, { type: ['speedLimit'] }),
      street1: T('MAIN ST', { type: ['streetName'] }), street2: T('1ST AVE', { type: ['streetName'] }), postColor: C('#8e9399'),
    },
    build(p) {
      const g = new THREE.Group(), pm = mat(p.postColor, { metal: 0.6, rough: 0.4 }), back = mat('#a7abb0', { metal: 0.6, rough: 0.4 });
      const H = p.postHeight;
      box(g, 0.05, H + (p.type === 'streetName' ? 0.5 : 0.35), 0.05, pm, 0, (H + (p.type === 'streetName' ? 0.5 : 0.35)) / 2, 0);
      if (p.type === 'stop' || p.type === 'yield') {
        const sides = p.type === 'stop' ? 8 : 3, r = p.type === 'stop' ? 0.38 : 0.5;
        const start = p.type === 'stop' ? PI / 8 : -PI / 2;
        const tex = signTexture(p.type, p);
        add(g, new THREE.CircleGeometry(r * 1.03, sides, start), mat('#ffffff'), 0, H, 0.034);
        add(g, new THREE.CircleGeometry(r, sides, start), decalMat(tex), 0, H, 0.036);
        add(g, new THREE.CircleGeometry(r * 1.03, sides, start), back, 0, H, 0.03, 0, PI);
      } else if (p.type === 'streetName') {
        const blade = (text, y, ry) => {
          const t = decalMat(adTexture([{ text, size: 0.6, bold: true }], '#1d6b3a', '#ffffff', 1.0 / 0.2));
          const grp = new THREE.Group(); grp.rotation.y = ry; grp.position.y = y; g.add(grp);
          box(grp, 1.0, 0.2, 0.02, t, 0, 0, 0);
        };
        blade(p.street1, H + 0.15, 0); blade(p.street2, H + 0.38, PI / 2);
      } else {
        const tex = signTexture(p.type, p);
        const w = p.type === 'oneWay' ? 0.9 : 0.45, h = p.type === 'oneWay' ? 0.3 : 0.6;
        box(g, w, h, 0.01, [back, back, back, back, decalMat(tex), back], 0, H, 0.035);
      }
      return g;
    },
  };

  props.parkingMeter = {
    label: 'Parking Meter', category: 'Traffic & road',
    params: { style: S(['single', 'double', 'payStation'], 'single'), color: C('#7c8389'), screenLit: B(true) },
    build(p) {
      const g = new THREE.Group(), c = mat(p.color, { metal: 0.6, rough: 0.4 }), dk = dark();
      if (p.style === 'payStation') {
        box(g, 0.45, 1.55, 0.3, c, 0, 0.775, 0);
        box(g, 0.25, 0.18, 0.02, lampMat('#7ec8ff', p.screenLit), 0, 1.25, 0.155);
        box(g, 0.2, 0.15, 0.04, dk, 0, 1.0, 0.16);
        const sign = decalMat(adTexture([{ text: 'PAY HERE', size: 0.55, bold: true }], '#1d4ed8', '#ffffff', 0.45 / 0.15), { lit: p.screenLit });
        box(g, 0.45, 0.15, 0.32, [c, c, c, c, sign, c], 0, 1.62, 0);
        return g;
      }
      cyl(g, 0.04, 0.05, 1.1, 8, c, 0, 0.55, 0);
      const heads = p.style === 'double' ? [-0.15, 0.15] : [0];
      if (p.style === 'double') box(g, 0.42, 0.05, 0.08, c, 0, 1.12, 0);
      for (const x of heads) {
        box(g, 0.2, 0.3, 0.15, c, x, 1.3, 0);
        const d = add(g, new THREE.SphereGeometry(0.1, 10, 5, 0, PI * 2, 0, PI / 2), c, x, 1.45, 0); d.scale.z = 0.75;
        box(g, 0.13, 0.08, 0.01, lampMat('#9ef0a0', p.screenLit), x, 1.38, 0.077);
        box(g, 0.03, 0.06, 0.02, dk, x + 0.05, 1.24, 0.08);
      }
      return g;
    },
  };

  props.trafficCone = {
    label: 'Traffic Cone', category: 'Traffic & road',
    params: { height: R(0.3, 1.0, 0.02, 0.7), count: R(1, 8, 1, 3), spacing: R(0.5, 3, 0.05, 1.0), color: C('#ff6a00'), band: B(true) },
    build(p) {
      const g = new THREE.Group(), c = mat(p.color, { rough: 0.5 }), w = mat('#f2f2f2', { rough: 0.3, emissive: '#222222' });
      const H = p.height, rb = H * 0.2;
      for (let i = 0; i < p.count; i++) {
        const x = (i - (p.count - 1) / 2) * p.spacing;
        box(g, H * 0.55, 0.03, H * 0.55, c, x, 0.015, 0);
        add(g, new THREE.ConeGeometry(rb, H - 0.03, 12), c, x, 0.03 + (H - 0.03) / 2, 0);
        if (p.band) { const y = H * 0.55, r1 = rb * (1 - (y + 0.06) / H) + 0.004, r0 = rb * (1 - (y - 0.06) / H) + 0.004; cyl(g, r1, r0, 0.12 * Math.min(1, H / 0.7), 12, w, x, y, 0); }
      }
      return g;
    },
  };

  props.trafficBarrel = {
    label: 'Traffic Barrel', category: 'Traffic & road',
    params: { count: R(1, 6, 1, 2), spacing: R(0.8, 3, 0.05, 1.2), color: C('#ff6a00'), light: B(false) },
    build(p) {
      const g = new THREE.Group(), c = mat(p.color, { rough: 0.5 }), w = mat('#f2f2f2', { rough: 0.3, emissive: '#222222' }), dk = dark();
      for (let i = 0; i < p.count; i++) {
        const x = (i - (p.count - 1) / 2) * p.spacing;
        cyl(g, 0.38, 0.38, 0.08, 14, dk, x, 0.04, 0);
        cyl(g, 0.26, 0.29, 0.95, 14, c, x, 0.08 + 0.475, 0);
        for (const y of [0.45, 0.78]) cyl(g, 0.28, 0.285, 0.12, 14, w, x, y, 0);
        if (p.light) { box(g, 0.04, 0.12, 0.04, dk, x, 1.09, 0); cyl(g, 0.07, 0.07, 0.05, 10, lampMat('#ffb000', true), x, 1.17, 0.03, PI / 2); }
      }
      return g;
    },
  };

  props.jerseyBarrier = {
    label: 'Jersey Barrier', category: 'Traffic & road',
    params: { length: R(1, 6, 0.1, 3), count: R(1, 5, 1, 1), material: S(['concrete', 'plastic'], 'concrete'), color: C('#b8b4ab') },
    build(p) {
      const g = new THREE.Group();
      const c = mat(p.material === 'plastic' && p.color === '#b8b4ab' ? '#e23b2b' : p.color, { rough: p.material === 'plastic' ? 0.5 : 0.95 });
      const s = new THREE.Shape();
      [[-0.305, 0], [0.305, 0], [0.305, 0.075], [0.18, 0.33], [0.075, 0.81], [-0.075, 0.81], [-0.18, 0.33], [-0.305, 0.075]].forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y));
      for (let i = 0; i < p.count; i++) {
        const L = p.length, geo = new THREE.ExtrudeGeometry(s, { depth: L - 0.02, bevelEnabled: false });
        geo.translate(0, 0, -(L - 0.02) / 2);
        const x = (i - (p.count - 1) / 2) * L;
        add(g, geo, c, x, 0, 0, 0, PI / 2);
        for (const sx of [-L * 0.3, L * 0.3]) box(g, 0.25, 0.08, 0.62, dark(), x + sx, 0.04, 0);
      }
      return g;
    },
  };

  props.barricade = {
    label: 'Barricade', category: 'Traffic & road',
    params: { width: R(1.2, 3.5, 0.05, 2.4), rails: R(1, 3, 1, 3), color: C('#ff6a00'), frameColor: C('#e8e8e8'), lamp: B(true) },
    build(p) {
      const g = new THREE.Group(), fr = mat(p.frameColor, { rough: 0.7 }), W = p.width;
      const tex = canvasTex(1024, Math.max(32, Math.round(1024 / (W / 0.2))), (gg, w, h) => {
        gg.fillStyle = '#ffffff'; gg.fillRect(0, 0, w, h); gg.fillStyle = p.color;
        const step = h * 2;
        for (let x = -h; x < w + h; x += step) { gg.beginPath(); gg.moveTo(x, h); gg.lineTo(x + h, 0); gg.lineTo(x + h * 2, 0); gg.lineTo(x + h, h); gg.fill(); }
      });
      const rail = decalMat(tex, { rough: 0.4 });
      const top = 0.45 + (p.rails - 1) * 0.32 + 0.15;
      for (const s of [1, -1]) {
        const x = s * (W / 2 - 0.15);
        for (const t of [0.22, -0.22]) box(g, 0.06, top + 0.05, 0.06, fr, x, (top + 0.05) / 2, t * 0.6, t);
      }
      for (let i = 0; i < p.rails; i++) box(g, W, 0.2, 0.03, [fr, fr, fr, fr, rail, rail], 0, 0.45 + i * 0.32, 0);
      if (p.lamp) { box(g, 0.04, 0.12, 0.04, fr, -W / 2 + 0.15, top + 0.08, 0); cyl(g, 0.08, 0.08, 0.06, 10, lampMat('#ffb000', true), -W / 2 + 0.15, top + 0.18, 0.02, PI / 2); }
      return g;
    },
  };

  const manholeTex = () => sharedTex('manhole', () => canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = '#7a7a7a';
    for (let y = 10; y < h; y += 22) for (let x = 10; x < w; x += 22) g.fillRect(x, y, 12, 12);
    g.fillStyle = '#ffffff'; g.fillRect(48, 110, 160, 36);
    g.fillStyle = '#555'; g.font = '700 30px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('SEWER', 128, 129);
  }));
  props.manhole = {
    label: 'Manhole Cover', category: 'Traffic & road',
    params: { shape: S(['round', 'square'], 'round'), size: R(0.5, 1.0, 0.02, 0.7), color: C('#4a4642') },
    build(p) {
      const g = new THREE.Group(), r = p.size / 2;
      const plate = decalMat(manholeTex(), { color: p.color, metal: 0.6, rough: 0.6, shared: true });
      const ring = mat('#333130', { metal: 0.5, rough: 0.6 });
      if (p.shape === 'round') {
        cyl(g, r + 0.06, r + 0.06, 0.015, 24, ring, 0, 0.0075, 0);
        add(g, new THREE.CircleGeometry(r, 24), plate, 0, 0.016, 0, -PI / 2);
      } else {
        box(g, p.size + 0.12, 0.015, p.size + 0.12, ring, 0, 0.0075, 0);
        add(g, new THREE.PlaneGeometry(p.size, p.size), plate, 0, 0.016, 0, -PI / 2);
      }
      return g;
    },
  };

  props.stormDrain = {
    label: 'Storm Drain', category: 'Traffic & road',
    params: { width: R(0.5, 1.5, 0.05, 0.9), curbInlet: B(true), color: C('#3a3836') },
    build(p) {
      const g = new THREE.Group(), m = mat(p.color, { metal: 0.6, rough: 0.6 }), W = p.width;
      box(g, W, 0.003, 0.42, mat('#050505'), 0, 0.002, 0);
      box(g, W + 0.08, 0.02, 0.06, m, 0, 0.01, 0.24); box(g, W + 0.08, 0.02, 0.06, m, 0, 0.01, -0.24);
      for (const s of [1, -1]) box(g, 0.04, 0.02, 0.48, m, s * (W / 2 + 0.02), 0.01, 0);
      const n = Math.floor(W / 0.06);
      for (let i = 0; i < n; i++) box(g, 0.025, 0.02, 0.42, m, -W / 2 + (i + 0.5) * (W / n), 0.01, 0);
      if (p.curbInlet) {
        const conc = mat('#b8b4ab', { rough: 0.95 });
        box(g, W + 1.2, 0.17, 0.3, conc, 0, 0.085, -0.42);
        box(g, W, 0.09, 0.01, mat('#050505'), 0, 0.055, -0.266);
      }
      return g;
    },
  };

  props.guardrail = {
    label: 'Guardrail', category: 'Traffic & road',
    params: { length: R(2, 20, 0.1, 6), postType: S(['steel', 'wood'], 'steel'), color: C('#9aa0a5') },
    build(p) {
      const g = new THREE.Group(), c = mat(p.color, { metal: 0.7, rough: 0.35 });
      const post = p.postType === 'wood' ? mat('#5c4a3a', { rough: 0.95 }) : mat('#6f757a', { metal: 0.6, rough: 0.5 });
      const s = new THREE.Shape();
      [[0, 0], [0.08, 0.06], [0.035, 0.155], [0.08, 0.25], [0, 0.31], [-0.012, 0.31], [0.068, 0.25], [0.023, 0.155], [0.068, 0.06], [-0.012, 0]].forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y));
      const L = p.length, geo = new THREE.ExtrudeGeometry(s, { depth: L, bevelEnabled: false });
      geo.translate(0, 0, -L / 2);
      add(g, geo, c, 0, 0.45, 0, 0, -PI / 2);
      const n = Math.max(2, Math.round(L / 1.9) + 1);
      for (let i = 0; i < n; i++) {
        const x = -L / 2 + 0.1 + i * ((L - 0.2) / (n - 1));
        box(g, 0.15, 0.78, p.postType === 'wood' ? 0.2 : 0.1, post, x, 0.39, -0.2);
        box(g, 0.14, 0.3, 0.13, post, x, 0.6, -0.08);
      }
      return g;
    },
  };

  // ================= UTILITIES =================
  props.fireHydrant = {
    label: 'Fire Hydrant', category: 'Utilities',
    params: { style: S(['standard', 'wall'], 'standard'), height: R(0.6, 1.0, 0.02, 0.8, { style: ['standard'] }), color: C('#c9a400'), capColor: C('#e8e8e8'), showWall: B(true, { style: ['wall'] }) },
    build(p) {
      const g = new THREE.Group(), c = mat(p.color, { metal: 0.3, rough: 0.5 }), cap = mat(p.capColor, { metal: 0.3, rough: 0.5 });
      if (p.style === 'wall') {
        refWall(g, 1.6, 2.2, p.showWall);
        const brass = mat('#b08d57', { metal: 0.8, rough: 0.35 });
        box(g, 0.5, 0.28, 0.03, brass, 0, 0.85, 0.015);
        for (const s of [1, -1]) { cyl(g, 0.055, 0.06, 0.14, 10, brass, s * 0.13, 0.85, 0.09, PI / 2); cyl(g, 0.065, 0.065, 0.04, 10, cap, s * 0.13, 0.85, 0.17, PI / 2); }
        const lab = decalMat(adTexture([{ text: 'STANDPIPE', size: 0.55, bold: true }], '#c1121f', '#ffffff', 0.45 / 0.1));
        box(g, 0.45, 0.1, 0.01, lab, 0, 1.1, 0.006);
        return g;
      }
      const H = p.height;
      cyl(g, 0.17, 0.19, 0.05, 10, c, 0, 0.025, 0);
      cyl(g, 0.12, 0.13, H * 0.62, 10, c, 0, 0.05 + H * 0.31, 0);
      cyl(g, 0.155, 0.155, 0.05, 10, c, 0, 0.05 + H * 0.62, 0);
      const b = add(g, new THREE.SphereGeometry(0.13, 10, 5, 0, PI * 2, 0, PI / 2), cap, 0, 0.075 + H * 0.62, 0); b.scale.y = 0.9;
      cyl(g, 0.03, 0.03, 0.06, 5, cap, 0, 0.075 + H * 0.62 + 0.13, 0);
      const ny = 0.05 + H * 0.45;
      for (const s of [1, -1]) { cyl(g, 0.045, 0.05, 0.12, 8, c, s * 0.15, ny, 0, 0, 0, PI / 2); cyl(g, 0.055, 0.055, 0.03, 6, cap, s * 0.22, ny, 0, 0, 0, PI / 2); }
      cyl(g, 0.07, 0.075, 0.12, 8, c, 0, ny, 0.15, PI / 2);
      cyl(g, 0.08, 0.08, 0.03, 6, cap, 0, ny, 0.22, PI / 2);
      return g;
    },
  };

  props.utilityPole = {
    label: 'Utility Pole', category: 'Utilities',
    params: { height: R(7, 14, 0.1, 10), crossarms: R(1, 3, 1, 2), transformer: B(true), streetLamp: B(false), wires: B(true), wireSpan: R(5, 40, 1, 20), sag: R(0, 1.5, 0.05, 0.5, { wires: [true] }), woodColor: C('#5c4a3a') },
    build(p) {
      const g = new THREE.Group(), wood = mat(p.woodColor, { rough: 0.95 }), H = p.height, ins = mat('#9fb7c4', { rough: 0.3 }), wireM = mat('#151515');
      cyl(g, 0.12, 0.16, H, 8, wood, 0, H / 2, 0);
      const zs = [-1.0, -0.4, 0.4, 1.0], tops = [];
      for (let i = 0; i < p.crossarms; i++) {
        const y = H - 0.35 - i * 0.6;
        box(g, 0.1, 0.1, 2.4, wood, 0, y, 0);
        for (const z of zs) { cyl(g, 0.04, 0.05, 0.12, 8, ins, 0, y + 0.11, z); tops.push([y + 0.17, z]); }
      }
      if (p.transformer) {
        cyl(g, 0.25, 0.25, 0.8, 10, mat('#8a8f94', { metal: 0.5, rough: 0.5 }), 0, H - 2.0, 0.38);
        box(g, 0.06, 0.4, 0.2, mat('#5b6066'), 0, H - 1.9, 0.18);
      }
      if (p.streetLamp) {
        box(g, 0.06, 0.06, 1.6, mat('#5b6066'), 0, H - 3.0, 0.8);
        box(g, 0.25, 0.1, 0.5, mat('#5b6066'), 0, H - 3.0, 1.75);
        box(g, 0.2, 0.02, 0.38, lampMat('#ffd9a0', true), 0, H - 3.06, 1.75);
        g.add(propLight('#ffd9a0', 50, 18, 0, H - 3.3, 1.75));
      }
      if (p.wires) for (const [y0, z] of tops) {
        const pts = [];
        for (let i = 0; i <= 20; i++) { const x = -p.wireSpan / 2 + (i / 20) * p.wireSpan, t = Math.abs(x) / p.wireSpan; pts.push(new THREE.Vector3(x, y0 - 4 * p.sag * t * (1 - t), z)); }
        add(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.012, 4), wireM);
      }
      return g;
    },
  };

  props.electricalBox = {
    label: 'Electrical Box', category: 'Utilities',
    params: { width: R(0.5, 1.6, 0.05, 0.9), height: R(0.8, 1.8, 0.05, 1.3), depth: R(0.3, 0.8, 0.05, 0.45), color: C('#7d8a74'), vents: B(true), pad: B(true) },
    build(p) {
      const g = new THREE.Group(), c = mat(p.color, { metal: 0.3, rough: 0.6 }), dk = dark(), y0 = p.pad ? 0.1 : 0;
      if (p.pad) box(g, p.width + 0.3, 0.1, p.depth + 0.3, mat('#b8b4ab', { rough: 0.95 }), 0, 0.05, 0);
      box(g, p.width, p.height, p.depth, c, 0, y0 + p.height / 2, 0);
      box(g, p.width + 0.06, 0.04, p.depth + 0.06, c, 0, y0 + p.height + 0.02, 0);
      box(g, 0.01, p.height * 0.9, 0.01, dk, 0, y0 + p.height / 2, p.depth / 2 + 0.003);
      for (const s of [1, -1]) box(g, 0.03, 0.12, 0.03, dk, s * 0.06, y0 + p.height * 0.55, p.depth / 2 + 0.015);
      if (p.vents) for (const s of [1, -1]) for (let i = 0; i < 4; i++) box(g, p.width * 0.3, 0.015, 0.01, dk, s * p.width * 0.25, y0 + p.height * 0.8 + i * 0.04, p.depth / 2 + 0.005);
      const lab = decalMat(adTexture([{ text: 'DANGER', size: 0.35, bold: true }, { text: 'HIGH VOLTAGE', size: 0.22, bold: true }], '#f2c14e', '#111111', 1.5));
      box(g, 0.24, 0.16, 0.005, lab, -p.width * 0.25, y0 + p.height * 0.55, p.depth / 2 + 0.003);
      return g;
    },
  };

  props.acUnit = {
    label: 'AC Unit', category: 'Utilities',
    params: { type: S(['window', 'condenser', 'rooftop'], 'condenser'), color: C('#cfcfc9'), showWall: B(true, { type: ['window'] }) },
    build(p) {
      const g = new THREE.Group(), c = mat(p.color, { metal: 0.3, rough: 0.6 }), dk = dark();
      const grille = decalMat(louverTex(), { color: p.color, metal: 0.3, rough: 0.6, shared: true });
      const fan = (x, y, z, r) => { cyl(g, r, r, 0.02, 16, dk, x, y, z); box(g, r * 1.8, 0.01, 0.08, c, x, y + 0.015, z, 0, 0.4); box(g, 0.08, 0.01, r * 1.8, c, x, y + 0.015, z, 0, 0.4); };
      if (p.type === 'window') {
        refWall(g, 1.6, 2.4, p.showWall);
        box(g, 0.66, 0.42, 0.55, [c, c, c, c, grille, c], 0, 1.4, 0.18);
        box(g, 0.05, 0.05, 0.4, dk, -0.25, 1.17, 0.15, -0.6); box(g, 0.05, 0.05, 0.4, dk, 0.25, 1.17, 0.15, -0.6);
      } else if (p.type === 'condenser') {
        box(g, 0.95, 0.08, 0.95, mat('#b8b4ab', { rough: 0.95 }), 0, 0.04, 0);
        box(g, 0.78, 0.72, 0.78, [grille, grille, c, c, grille, grille], 0, 0.08 + 0.36, 0);
        box(g, 0.8, 0.03, 0.8, c, 0, 0.815, 0); fan(0, 0.83, 0, 0.3);
      } else {
        box(g, 2.4, 0.15, 1.6, dk, 0, 0.075, 0);
        box(g, 2.2, 1.1, 1.4, [c, c, c, c, grille, grille], 0, 0.15 + 0.55, 0);
        fan(-0.5, 1.26, 0, 0.4); fan(0.5, 1.26, 0, 0.4);
      }
      return g;
    },
  };

  props.waterTower = {
    label: 'Water Tower', category: 'Utilities',
    params: { legHeight: R(2, 8, 0.1, 4), radius: R(1, 3, 0.05, 1.8), tankHeight: R(2, 5, 0.1, 3.4), legs: R(4, 8, 1, 6), woodColor: C('#7a5a3c'), steelColor: C('#3a3a3a'), roofColor: C('#4a4038') },
    build(p) {
      const g = new THREE.Group(), wood = mat(p.woodColor, { rough: 0.95 }), st = mat(p.steelColor, { metal: 0.6, rough: 0.5 }), rf = mat(p.roofColor, { rough: 0.8 });
      const Rr = p.radius, LH = p.legHeight, TH = p.tankHeight;
      for (let i = 0; i < p.legs; i++) { const a = (i / p.legs) * PI * 2; box(g, 0.12, LH, 0.12, st, Math.cos(a) * Rr * 0.8, LH / 2, Math.sin(a) * Rr * 0.8); }
      torus(g, Rr * 0.8, 0.03, st, LH * 0.5);
      cyl(g, Rr + 0.15, Rr + 0.15, 0.12, 16, st, 0, LH, 0);
      cyl(g, Rr, Rr * 1.03, TH, 16, wood, 0, LH + 0.06 + TH / 2, 0);
      for (let i = 0; i < 4; i++) torus(g, Rr * 1.02, 0.025, st, LH + 0.3 + i * (TH - 0.5) / 3);
      add(g, new THREE.ConeGeometry(Rr * 1.08, Rr * 0.6, 16), rf, 0, LH + 0.06 + TH + Rr * 0.3, 0);
      cyl(g, 0.04, 0.08, 0.3, 8, st, 0, LH + TH + Rr * 0.6 + 0.2, 0);
      const lz = Rr * 1.08, top = LH + TH;
      for (const s of [1, -1]) box(g, 0.04, top, 0.04, st, s * 0.2, top / 2, lz);
      for (let y = 0.3; y < top; y += 0.35) box(g, 0.4, 0.025, 0.025, st, 0, y, lz);
      return g;
    },
  };

  // ================= COMMERCE & STOREFRONT =================
  props.awning = {
    label: 'Awning', category: 'Commerce & storefront',
    params: {
      style: S(['slope', 'box', 'dome'], 'slope'), width: R(1, 8, 0.1, 3), projection: R(0.5, 2.5, 0.05, 1.2), drop: R(0.3, 1.5, 0.05, 0.6, { style: ['slope', 'box'] }),
      mountHeight: R(2.2, 4, 0.05, 2.6), color: C('#2f6b3a'), stripes: B(true), color2: C('#f2f2f2', { stripes: [true] }), valanceText: T('CAFE'), showWall: B(true),
    },
    build(p) {
      const g = new THREE.Group(), W = p.width, P = p.projection, M = p.mountHeight;
      refWall(g, W + 0.8, M + 1.6, p.showWall);
      const solid = mat(p.color, { rough: 0.8 });
      const n = Math.max(2, Math.round(W / 0.3));
      const stripeV = p.stripes ? decalMat(stripeTex(p.color, p.color2, n, false), { rough: 0.8, double: true }) : solid;
      const stripeH = p.stripes ? decalMat(stripeTex(p.color, p.color2, n, true), { rough: 0.8, double: true }) : solid;
      const frame = mat('#2b2b2b', { metal: 0.5 });
      if (p.style === 'dome') {
        add(g, new THREE.CylinderGeometry(P, P, W, 14, 1, false, -PI / 2, PI / 2), stripeH, 0, M, 0, 0, 0, -PI / 2);
      } else {
        const D = p.drop, len = Math.hypot(P, D), ang = Math.atan2(D, P);
        const piv = new THREE.Group(); piv.position.set(0, M + D, 0.02); piv.rotation.x = ang; g.add(piv);
        box(piv, W, 0.02, len, [solid, solid, stripeV, solid, solid, solid], 0, 0, len / 2);
        box(g, W, 0.06, 0.06, frame, 0, M + D, 0.03);
        if (p.style === 'box') for (const s of [1, -1]) {
          const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0, D); sh.lineTo(P, 0); sh.closePath();
          add(g, new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: false }), solid, s * W / 2 - 0.01, M, 0.02, 0, -PI / 2);
        }
        const val = p.valanceText ? decalMat(adTexture([{ text: p.valanceText, size: 0.6, bold: true }], p.color, p.stripes ? p.color2 : '#ffffff', W / 0.25)) : solid;
        box(g, W, 0.25, 0.015, [solid, solid, solid, solid, val, solid], 0, M - 0.125, P + 0.02);
      }
      return g;
    },
  };

  props.bladeSign = {
    label: 'Blade Sign', category: 'Commerce & storefront',
    params: {
      shape: S(['rect', 'round', 'vertical'], 'rect'), text: T('BAR'), width: R(0.4, 1.5, 0.05, 0.8), height: R(0.3, 3, 0.05, 0.6),
      mountHeight: R(2.4, 8, 0.05, 3.2), bg: C('#1b1b1b'), fg: C('#ff5a5a'), lit: B(true), showWall: B(true),
    },
    build(p) {
      const g = new THREE.Group(), fr = mat('#2b2b2b', { metal: 0.5 }), M = p.mountHeight;
      refWall(g, 2, M + Math.max(1, p.height) + 0.6, p.showWall);
      if (p.shape === 'round') {
        const r = p.width / 2, cz = 0.3 + r;
        const tex = adTexture([{ text: p.text, size: 0.32, bold: true }], p.bg, p.fg, 1);
        const face = decalMat(tex, { lit: p.lit });
        cyl(g, r, r, 0.06, 24, fr, 0, M, cz, 0, 0, PI / 2);
        add(g, new THREE.CircleGeometry(r * 0.94, 24), face, 0.032, M, cz, 0, PI / 2);
        add(g, new THREE.CircleGeometry(r * 0.94, 24), face, -0.032, M, cz, 0, -PI / 2);
        box(g, 0.04, 0.04, cz + r, fr, 0, M + r + 0.06, (cz + r) / 2);
        return g;
      }
      const W = p.width, H = p.shape === 'vertical' ? Math.max(p.height, W * 2) : p.height, cz = 0.3 + W / 2;
      const lines = p.shape === 'vertical' ? p.text.split('').slice(0, 10).map(ch => ({ text: ch, size: 0.8 / Math.max(1, p.text.length), bold: true })) : [{ text: p.text, size: 0.55, bold: true }];
      const face = decalMat(adTexture(lines, p.bg, p.fg, W / H), { lit: p.lit });
      box(g, 0.08, H, W, [face, face, fr, fr, fr, fr], 0, M, cz);
      box(g, 0.04, 0.04, cz + W / 2, fr, 0, M + H / 2 + 0.06, (cz + W / 2) / 2);
      if (p.shape === 'vertical') box(g, 0.04, 0.04, cz + W / 2, fr, 0, M - H / 2 - 0.06, (cz + W / 2) / 2);
      return g;
    },
  };

  props.atm = {
    label: 'ATM', category: 'Commerce & storefront',
    params: { style: S(['kiosk', 'wall'], 'kiosk'), color: C('#2b4c7e'), screenColor: C('#5ab0ff'), lit: B(true), showWall: B(true, { style: ['wall'] }) },
    build(p) {
      const g = new THREE.Group(), c = mat(p.color, { metal: 0.4, rough: 0.5 }), dk = dark(), steel = mat('#a7abb0', { metal: 0.7, rough: 0.35 });
      const sign = decalMat(adTexture([{ text: 'ATM', size: 0.6, bold: true }], p.color, '#ffffff', 2.3), { lit: p.lit });
      const face = (z, y) => {
        box(g, 0.34, 0.26, 0.02, lampMat(p.screenColor, p.lit), 0, y + 0.3, z, -0.15);
        box(g, 0.22, 0.03, 0.12, steel, 0, y + 0.04, z + 0.04, 0.4);
        box(g, 0.12, 0.02, 0.02, dk, 0.15, y + 0.14, z);
        box(g, 0.3, 0.03, 0.03, dk, 0, y - 0.12, z);
      };
      if (p.style === 'wall') {
        refWall(g, 1.6, 2.6, p.showWall);
        box(g, 0.9, 1.1, 0.08, steel, 0, 1.25, 0.04);
        face(0.1, 1.05);
        box(g, 0.9, 0.3, 0.06, [c, c, c, c, sign, c], 0, 1.95, 0.03);
        return g;
      }
      box(g, 0.75, 1.55, 0.65, c, 0, 0.775, 0);
      box(g, 0.6, 0.7, 0.04, steel, 0, 1.1, 0.33);
      face(0.36, 1.0);
      box(g, 0.75, 0.32, 0.67, [c, c, c, c, sign, sign], 0, 1.71, 0);
      return g;
    },
  };

  props.vendingMachine = {
    label: 'Vending Machine', category: 'Commerce & storefront',
    params: { type: S(['soda', 'snack'], 'soda'), color: C('#c1121f'), brand: T('FIZZ'), lit: B(true), seed: R(1, 999, 1, 5, { type: ['snack'] }) },
    build(p) {
      const g = new THREE.Group(), c = mat(p.color, { metal: 0.3, rough: 0.5 }), dk = dark(), steel = mat('#a7abb0', { metal: 0.7, rough: 0.35 });
      for (const sx of [1, -1]) for (const sz of [1, -1]) box(g, 0.06, 0.05, 0.06, dk, sx * 0.4, 0.025, sz * 0.32);
      box(g, 0.95, 1.85, 0.8, c, 0, 0.05 + 0.925, 0);
      for (let i = 0; i < 6; i++) box(g, 0.1, 0.05, 0.02, steel, 0.33, 1.4 - i * 0.08, 0.405);
      box(g, 0.08, 0.1, 0.02, dk, 0.33, 0.85, 0.405);
      box(g, 0.5, 0.18, 0.04, dk, -0.12, 0.25, 0.39);
      if (p.type === 'soda') {
        const tex = adTexture([{ text: p.brand, size: 0.16, bold: true }, { text: 'ICE COLD', size: 0.05, bold: true }], p.color, '#ffffff', 0.62 / 1.35, { deco: true });
        box(g, 0.62, 1.35, 0.01, decalMat(tex, { lit: p.lit }), -0.12, 1.15, 0.405);
      } else {
        const r = rng(p.seed), pal = ['#f2c14e', '#e07a1f', '#2f7d32', '#1f4fa0', '#c1121f', '#8a5a35', '#e5e5e5'];
        box(g, 0.62, 1.2, 0.02, lampMat('#1a1d22', false), -0.12, 1.15, 0.2);
        for (let row = 0; row < 5; row++) {
          const y = 0.68 + row * 0.24;
          box(g, 0.62, 0.015, 0.35, steel, -0.12, y - 0.07, 0.24);
          for (let col = 0; col < 5; col++) box(g, 0.09, 0.12, 0.05, mat(pal[Math.floor(r() * pal.length)], { rough: 0.6 }), -0.37 + col * 0.125, y, 0.33);
        }
        box(g, 0.64, 1.25, 0.01, glass(), -0.12, 1.15, 0.405);
        if (p.lit) g.add(propLight('#e8f2ff', 2, 2.5, -0.12, 1.5, 0.3));
      }
      return g;
    },
  };

  props.foodCart = {
    label: 'Food Cart', category: 'Commerce & storefront',
    params: { style: S(['hotdog', 'pushcart'], 'hotdog'), color: C('#d9d9d9'), umbrella: B(true), umbrellaColor: C('#f2c14e', { umbrella: [true] }), umbrellaColor2: C('#1f4fa0', { umbrella: [true] }), sign: T('HOT DOGS') },
    build(p) {
      const g = new THREE.Group(), steel = mat(p.color, { metal: 0.7, rough: 0.3 }), dk = dark();
      const wheel = (x, z, r) => { cyl(g, r, r, 0.06, 14, dk, x, r, z, PI / 2); cyl(g, r * 0.4, r * 0.4, 0.07, 8, steel, x, r, z, PI / 2); };
      let topY;
      if (p.style === 'hotdog') {
        box(g, 1.6, 0.8, 0.75, steel, 0, 0.3 + 0.4, 0);
        wheel(-0.45, 0.42, 0.28); wheel(-0.45, -0.42, 0.28);
        box(g, 0.06, 0.3, 0.06, steel, 0.7, 0.15, 0);
        box(g, 0.04, 0.04, 0.8, steel, 1.0, 1.0, 0); box(g, 0.35, 0.03, 0.03, steel, 0.85, 1.0, 0.38); box(g, 0.35, 0.03, 0.03, steel, 0.85, 1.0, -0.38);
        for (let i = 0; i < 3; i++) box(g, 0.35, 0.04, 0.4, dk, -0.5 + i * 0.45, 1.12, 0);
        box(g, 1.4, 0.25, 0.01, glass(), 0, 1.25, 0.33, -0.3);
        const s = decalMat(adTexture([{ text: p.sign, size: 0.55, bold: true }], '#c1121f', '#ffffff', 1.5 / 0.3));
        box(g, 1.5, 0.3, 0.01, s, 0, 0.75, 0.38);
        topY = 1.1;
      } else {
        box(g, 1.2, 0.08, 0.7, mat('#8a5a35', { rough: 0.9 }), 0, 0.6, 0);
        for (const sx of [1, -1]) for (const sz of [1, -1]) wheel(sx * 0.45, sz * 0.38, 0.12);
        box(g, 0.04, 0.5, 0.6, steel, 0.6, 0.8, 0);
        for (const [x, c] of [[-0.3, '#2f7d32'], [0.15, '#e07a1f']]) { box(g, 0.4, 0.25, 0.5, mat('#b08a5a'), x, 0.765, 0); box(g, 0.36, 0.05, 0.46, mat(c, { rough: 0.9 }), x, 0.9, 0); }
        topY = 0.64;
      }
      if (p.umbrella) {
        cyl(g, 0.02, 0.02, 1.6, 6, steel, -0.2, topY + 0.8, 0);
        const tex = stripeTex(p.umbrellaColor, p.umbrellaColor2, 8, false);
        add(g, new THREE.ConeGeometry(1.1, 0.45, 8, 1, true), decalMat(tex, { double: true, rough: 0.8 }), -0.2, topY + 1.5, 0);
      }
      return g;
    },
  };

  props.cafeSet = {
    label: 'Cafe Set', category: 'Commerce & storefront',
    params: { tables: R(1, 4, 1, 2), chairs: R(0, 4, 1, 2), shape: S(['round', 'square'], 'round'), tableColor: C('#2b2b2b'), chairColor: C('#3b6e8f'), umbrella: B(false), umbrellaColor: C('#e8e2d0', { umbrella: [true] }) },
    build(p) {
      const g = new THREE.Group(), t = mat(p.tableColor, { metal: 0.5, rough: 0.4 }), ch = mat(p.chairColor, { metal: 0.3, rough: 0.6 });
      for (let i = 0; i < p.tables; i++) {
        const x = (i - (p.tables - 1) / 2) * 2.0;
        if (p.shape === 'round') cyl(g, 0.35, 0.35, 0.03, 16, t, x, 0.74, 0); else box(g, 0.7, 0.03, 0.7, t, x, 0.74, 0);
        cyl(g, 0.025, 0.025, 0.72, 6, t, x, 0.37, 0);
        cyl(g, 0.22, 0.25, 0.03, 12, t, x, 0.015, 0);
        for (let k = 0; k < p.chairs; k++) {
          const a = (k / p.chairs) * PI * 2 + PI / 4, cg = new THREE.Group();
          cg.position.set(x + Math.cos(a) * 0.62, 0, Math.sin(a) * 0.62);
          cg.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a)); g.add(cg);
          box(cg, 0.42, 0.03, 0.42, ch, 0, 0.45, 0);
          for (const sx of [1, -1]) for (const sz of [1, -1]) box(cg, 0.03, 0.45, 0.03, ch, sx * 0.18, 0.225, sz * 0.18);
          box(cg, 0.42, 0.38, 0.03, ch, 0, 0.66, -0.2, -0.1);
        }
        if (p.umbrella) {
          cyl(g, 0.02, 0.02, 2.2, 6, t, x, 1.1, 0);
          add(g, new THREE.ConeGeometry(1.2, 0.4, 8, 1, true), mat(p.umbrellaColor, { rough: 0.8 }), x, 2.1, 0);
        }
      }
      return g;
    },
  };

  props.shoppingCart = {
    label: 'Shopping Cart', category: 'Commerce & storefront',
    params: { count: R(1, 5, 1, 1), tipped: B(false), color: C('#b8bcc0'), handleColor: C('#c1121f') },
    build(p) {
      const g = new THREE.Group(), steel = mat(p.color, { metal: 0.8, rough: 0.3 }), dk = dark(), h = mat(p.handleColor, { rough: 0.5 });
      const wire = decalMat(wireTex(), { color: p.color, metal: 0.8, rough: 0.3, alpha: true, double: true, shared: true });
      for (let i = 0; i < p.count; i++) {
        const c = new THREE.Group(); c.position.z = -i * 0.25; c.position.y = i * 0.015; g.add(c);
        box(c, 0.5, 0.01, 0.8, wire, 0, 0.55, 0);
        for (const s of [1, -1]) box(c, 0.01, 0.42, 0.85, wire, s * 0.27, 0.77, 0);
        box(c, 0.55, 0.42, 0.01, wire, 0, 0.77, 0.43); box(c, 0.55, 0.42, 0.01, wire, 0, 0.77, -0.43);
        for (const s of [1, -1]) { box(c, 0.02, 0.02, 0.85, steel, s * 0.27, 0.98, 0); box(c, 0.02, 0.5, 0.02, steel, s * 0.2, 0.3, -0.38); box(c, 0.02, 0.02, 0.75, steel, s * 0.2, 0.08, 0); }
        cyl(c, 0.02, 0.02, 0.56, 8, h, 0, 1.0, -0.5, 0, 0, PI / 2);
        for (const sx of [1, -1]) for (const sz of [1, -1]) cyl(c, 0.05, 0.05, 0.03, 10, dk, sx * 0.2, 0.05, sz * 0.33, 0, 0, PI / 2);
      }
      if (p.tipped) {
        const w = new THREE.Group(); while (g.children.length) w.add(g.children[0]);
        w.rotation.z = PI / 2; g.add(w); w.updateMatrixWorld(true);
        w.position.y = -new THREE.Box3().setFromObject(w).min.y;
      }
      return g;
    },
  };

  props.palletStack = {
    label: 'Pallets & Boxes', category: 'Commerce & storefront',
    params: { pallets: R(1, 10, 1, 1), boxes: R(0, 18, 1, 8), wrap: B(false), seed: R(1, 999, 1, 9), woodColor: C('#b08a5a'), boxColor: C('#b58a5a') },
    build(p) {
      const g = new THREE.Group(), wood = mat(p.woodColor, { rough: 0.95 }), r = rng(p.seed);
      const pallet = y => {
        for (const z of [-0.45, 0, 0.45]) box(g, 1.2, 0.02, 0.1, wood, 0, y + 0.01, z);
        for (const x of [-0.55, 0, 0.55]) for (const z of [-0.45, 0, 0.45]) box(g, 0.1, 0.08, 0.1, wood, x, y + 0.06, z);
        for (let i = 0; i < 7; i++) box(g, 0.1, 0.02, 1.0, wood, -0.55 + i * (1.1 / 6), y + 0.11, 0);
      };
      for (let i = 0; i < p.pallets; i++) pallet(i * 0.125);
      const top = p.pallets * 0.125;
      const base = new THREE.Color(p.boxColor);
      let placed = 0, layer = 0, maxY = top;
      while (placed < p.boxes && layer < 6) {
        for (let ix = 0; ix < 3 && placed < p.boxes; ix++) for (let iz = 0; iz < 2 && placed < p.boxes; iz++) {
          const bw = 0.32 + r() * 0.06, bh = 0.25 + r() * 0.1, y = top + layer * 0.38;
          const col = base.clone().offsetHSL(0, 0, (r() - 0.5) * 0.08);
          box(g, bw, bh, 0.4 + r() * 0.06, mat('#' + col.getHexString(), { rough: 0.9, nocache: true }), -0.38 + ix * 0.38, y + bh / 2, -0.23 + iz * 0.46, 0, (r() - 0.5) * 0.15);
          maxY = Math.max(maxY, y + bh); placed++;
        }
        layer++;
      }
      if (p.wrap && p.boxes > 0) box(g, 1.22, maxY - top + 0.02, 1.02, mat('#dfe8ee', { opacity: 0.35, rough: 0.2, role: 'glass' }), 0, top + (maxY - top) / 2, 0);
      return g;
    },
  };


  // ================= API =================
  function defaults(id) {
    const out = {};
    for (const [k, s] of Object.entries(props[id].params)) out[k] = s.value;
    return out;
  }
  function build(preset) {
    const def = props[preset.prop];
    if (!def) throw new Error('Unknown prop: ' + preset.prop);
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
      for (const m of [].concat(o.material)) if (m.userData.disposable) { if (m.map && !m.userData.sharedMap) m.map.dispose(); m.dispose(); }
    });
  }
  return { VERSION, props, defaults, build, dispose };
}

export { createPropLibrary };
