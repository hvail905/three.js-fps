function createFacadeLibrary(THREE) {
  const VERSION = 1;
  const PI = Math.PI;

  // ---------- materials ----------
  const matCache = new Map();
  function mat(color, o = {}) {
    const key = color + '|' + JSON.stringify(o);
    if (matCache.has(key)) return matCache.get(key);
    const transparent = o.opacity != null && o.opacity < 1;
    const m = new THREE.MeshStandardMaterial({
      color, roughness: o.rough ?? 0.8, metalness: o.metal ?? 0.05, flatShading: true,
      transparent, opacity: o.opacity ?? 1, depthWrite: !transparent,
      emissive: o.emissive ?? 0x000000, emissiveIntensity: o.emissiveIntensity ?? 1,
    });
    m.userData.role = o.role || 'solid';
    matCache.set(key, m);
    return m;
  }

  // Procedural wall textures, drawn in the wall color. tile = meters covered by one texture repeat.
  const TILE = { brick: 1.0, brownstone: 1.2, concrete: 3.0, stucco: 2.0, metal: 1.0 };
  const texCache = new Map();
  function rngS(seed) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function wallTexture(kind, color) {
    const key = kind + color;
    if (texCache.has(key)) return texCache.get(key);
    const N = 512, c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'), base = new THREE.Color(color), r = rngS(1234);
    const shade = d => base.clone().offsetHSL(0, 0, d).getStyle();
    if (kind === 'brick') {
      g.fillStyle = shade(0.22); g.fillRect(0, 0, N, N);
      const rows = 13, bh = N / rows, bw = N / 5, m = 4;
      for (let y = 0; y < rows; y++) for (let x = -1; x < 6; x++) {
        g.fillStyle = shade((r() - 0.5) * 0.09);
        g.fillRect(x * bw + (y % 2) * bw / 2 + m / 2, y * bh + m / 2, bw - m, bh - m);
      }
    } else if (kind === 'brownstone') {
      g.fillStyle = shade(-0.06); g.fillRect(0, 0, N, N);
      const rows = 4, bh = N / rows, bw = N / 2;
      for (let y = 0; y < rows; y++) for (let x = -1; x < 3; x++) {
        g.fillStyle = shade((r() - 0.5) * 0.05);
        g.fillRect(x * bw + (y % 2) * bw / 2 + 2, y * bh + 2, bw - 4, bh - 4);
      }
    } else if (kind === 'concrete') {
      g.fillStyle = shade(0); g.fillRect(0, 0, N, N);
      for (let i = 0; i < 2500; i++) { g.fillStyle = shade((r() - 0.5) * 0.06); g.fillRect(r() * N, r() * N, 3, 3); }
      g.fillStyle = shade(-0.15); g.fillRect(0, 0, N, 3); g.fillRect(0, 0, 3, N);
      for (let i = 0; i < 6; i++) { g.fillStyle = shade(-0.08); g.beginPath(); g.arc(N * (0.25 + 0.5 * (i % 2)), N * (0.17 + 0.33 * Math.floor(i / 2)), 4, 0, PI * 2); g.fill(); }
    } else if (kind === 'stucco') {
      g.fillStyle = shade(0); g.fillRect(0, 0, N, N);
      for (let i = 0; i < 6000; i++) { g.fillStyle = shade((r() - 0.5) * 0.07); g.fillRect(r() * N, r() * N, 2 + r() * 3, 2 + r() * 3); }
    } else { // metal: corrugated
      const ribs = 8;
      for (let x = 0; x < N; x++) { const t = Math.sin((x / N) * ribs * PI * 2); g.fillStyle = shade(t * 0.08); g.fillRect(x, 0, 1, N); }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    texCache.set(key, t);
    if (texCache.size > 32) { const k = texCache.keys().next().value; texCache.get(k).dispose(); texCache.delete(k); }
    return t;
  }
  const wallMats = new Map();
  function wallMat(kind, color) {
    const key = kind + color;
    if (wallMats.has(key)) return wallMats.get(key);
    const m = new THREE.MeshStandardMaterial({ map: wallTexture(kind, color), roughness: kind === 'metal' ? 0.5 : 0.92, metalness: kind === 'metal' ? 0.35 : 0 });
    m.userData.role = 'solid'; m.userData.tile = TILE[kind];
    wallMats.set(key, m);
    if (wallMats.size > 32) { const k = wallMats.keys().next().value; wallMats.get(k).dispose(); wallMats.delete(k); }
    return m;
  }
  // World-space UVs so texture courses line up across separate wall pieces.
  function worldUV(geo, ox, oy, oz, tile) {
    const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + ox, y = pos.getY(i) + oy, z = pos.getZ(i) + oz;
      const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i));
      if (nz >= nx && nz >= ny) uv.setXY(i, x / tile, y / tile);
      else if (nx >= ny) uv.setXY(i, z / tile, y / tile);
      else uv.setXY(i, x / tile, z / tile);
    }
    uv.needsUpdate = true;
    return geo;
  }

  function add(parent, geo, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    parent.add(m); return m;
  }
  const box = (p, w, h, d, m, x, y, z, rx, ry, rz) => add(p, new THREE.BoxGeometry(w, h, d), m, x, y, z, rx, ry, rz);
  // textured wall block (x,y,z = center)
  function wbox(p, w, h, d, m, x, y, z) {
    if (w <= 0.001 || h <= 0.001 || d <= 0.001) return null;
    const geo = new THREE.BoxGeometry(w, h, d);
    if (m.userData.tile) worldUV(geo, x, y, z, m.userData.tile);
    return add(p, geo, m, x, y, z);
  }
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
    let size = H * 0.6; g.font = `900 ${size}px Arial, Helvetica, sans-serif`;
    const mw = g.measureText(text).width; if (mw > W * 0.92) { size *= (W * 0.92) / mw; g.font = `900 ${size}px Arial, Helvetica, sans-serif`; }
    g.fillText(text, W / 2, H / 2);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, emissive: lit ? 0xffffff : 0, emissiveMap: lit ? t : null, emissiveIntensity: lit ? 0.7 : 0 });
    m.userData.role = 'decal'; m.userData.disposable = true;
    return m;
  }
  function stripeMat(c1, c2, n, horizontal) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? c2 : c1; if (horizontal) g.fillRect(0, (i * 256) / n, 256, 256 / n + 1); else g.fillRect((i * 256) / n, 0, 256 / n + 1, 256); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, side: THREE.DoubleSide });
    m.userData.role = 'decal'; m.userData.disposable = true;
    return m;
  }

  const R = (min, max, step, value, when) => ({ type: 'range', min, max, step, value, when });
  const C = (value, when) => ({ type: 'color', value, when });
  const B = (value, when) => ({ type: 'bool', value, when });
  const S = (options, value, when) => ({ type: 'select', options, value, when });
  const T = (value, when) => ({ type: 'text', value, when });

  // ---------- facade builder ----------
  // Front face of the wall sits at z = 0; the wall runs back to z = -T. Origin is ground center.
  function buildFacade(p) {
    const g = new THREE.Group(), r = rng(p.seed);
    const bays = p.bays, bw = p.bayWidth, Wt = bays * bw, T = 0.35;
    const GF = p.groundFloorHeight, FH = p.floorHeight, floors = p.floors;
    const roofY = GF + (floors - 1) * FH;
    const wall = wallMat(p.material, p.wallColor);
    const trim = mat(p.trimColor, { rough: 0.7 }), accent = mat(p.accentColor, { rough: 0.6 });
    const gl = mat(p.glassColor, { rough: 0.08, metal: 0.5, opacity: 0.82, role: 'glass' });
    const interior = mat('#0d0f12', { rough: 1 }), iron = mat('#1c1c1c', { metal: 0.5, rough: 0.6 });
    const bayX = i => -Wt / 2 + (i + 0.5) * bw;
    const doorBay = Math.min(p.doorBay, bays - 1);

    // A bay-wide wall band with an optional rectangular (or arched) opening.
    function bayWall(xc, w, y0, y1, open) {
      if (!open) { wbox(g, w, y1 - y0, T, wall, xc, (y0 + y1) / 2, -T / 2); return; }
      const ow = open.w, side = (w - ow) / 2, oy0 = open.y0, oy1 = open.y1;
      wbox(g, side, y1 - y0, T, wall, xc - w / 2 + side / 2, (y0 + y1) / 2, -T / 2);
      wbox(g, side, y1 - y0, T, wall, xc + w / 2 - side / 2, (y0 + y1) / 2, -T / 2);
      wbox(g, ow, oy0 - y0, T, wall, xc, (y0 + oy0) / 2, -T / 2);
      wbox(g, ow, y1 - oy1, T, wall, xc, (oy1 + y1) / 2, -T / 2);
      if (open.arch) {
        const rr = ow / 2, s = new THREE.Shape();
        s.moveTo(-rr, 0); s.lineTo(-rr, rr); s.lineTo(rr, rr); s.lineTo(rr, 0); s.absarc(0, 0, rr * 0.985, 0, PI, false);
        const geo = new THREE.ExtrudeGeometry(s, { depth: T, bevelEnabled: false, curveSegments: 8 });
        geo.translate(0, 0, -T);
        worldUV(geo, xc, oy1 - rr, 0, wall.userData.tile);
        add(g, geo, wall, xc, oy1 - rr, 0);
      }
    }

    // Glass, darkness behind it, frame, divisions, sill, lintel, shutters, AC.
    function fillWindow(xc, w, y0, y1, arch, opts = {}) {
      const h = y1 - y0, rev = 0.12, cy = (y0 + y1) / 2;
      box(g, w, h, 0.02, interior, xc, cy, -T + 0.02);
      box(g, w, h, 0.02, gl, xc, cy, -rev);
      if (arch) {
        const rr = w / 2;
        add(g, new THREE.CircleGeometry(rr, 12, 0, PI), interior, xc, y1 - rr, -T + 0.03);
        add(g, new THREE.CircleGeometry(rr, 12, 0, PI), gl, xc, y1 - rr, -rev + 0.011);
      }
      if (p.windowFrames) {
        const f = 0.05, fz = -rev + 0.02;
        box(g, w, f, 0.05, trim, xc, y0 + f / 2, fz);
        if (!arch) box(g, w, f, 0.05, trim, xc, y1 - f / 2, fz);
        for (const s of [1, -1]) box(g, f, arch ? h - w / 2 : h, 0.05, trim, xc + s * (w / 2 - f / 2), arch ? y0 + (h - w / 2) / 2 : cy, fz);
        if (p.divisions === 'sash' || p.divisions === 'cross') box(g, w, 0.04, 0.04, trim, xc, arch ? y0 + (h - w / 2) / 2 : cy, fz);
        if (p.divisions === 'cross') box(g, 0.04, arch ? h - w / 2 : h, 0.04, trim, xc, arch ? y0 + (h - w / 2) / 2 : cy, fz);
      }
      if (p.sills && !opts.noSill) box(g, w + 0.12, 0.06, 0.14, trim, xc, y0 - 0.03, 0.03);
      if (p.lintels && !opts.noLintel) {
        if (arch) add(g, new THREE.TorusGeometry(w / 2 + 0.06, 0.07, 4, 12, PI), trim, xc, y1 - w / 2, 0.01);
        else { box(g, w + 0.18, 0.16, 0.07, trim, xc, y1 + 0.08, 0.02); box(g, 0.14, 0.2, 0.09, trim, xc, y1 + 0.08, 0.03); }
      }
      if (p.shutters && !arch && !opts.noShutter) for (const s of [1, -1]) box(g, w * 0.48, h * 0.98, 0.03, accent, xc + s * (w / 2 + w * 0.26), cy, 0.03);
      if (!opts.noAC && r() < p.acUnits) {
        const ac = mat('#cfcfc9', { metal: 0.3, rough: 0.6 });
        box(g, Math.min(0.62, w * 0.9), 0.38, 0.55, ac, xc, y0 + 0.22, 0.1);
      }
    }

    function fillDoor(xc, w, y0, h, kind) {
      const rev = 0.15;
      box(g, w, h, 0.02, interior, xc, y0 + h / 2, -T + 0.02);
      const dm = kind === 'glass' ? gl : kind === 'steel' ? mat('#6f757a', { metal: 0.6, rough: 0.5 }) : accent;
      const dh = kind === 'glass' ? h : Math.min(h, 2.3);
      box(g, w - 0.1, dh - 0.05, 0.05, dm, xc, y0 + dh / 2, -rev);
      if (kind === 'glass') box(g, w - 0.1, dh * 0.9, 0.02, gl, xc, y0 + dh / 2, -rev + 0.03);
      if (kind === 'wood') for (let i = 0; i < 2; i++) box(g, (w - 0.3) / 2, dh * 0.35, 0.02, mat(p.accentColor, { rough: 0.5 }), xc + (i ? 1 : -1) * (w - 0.1) / 4, y0 + dh * (0.3 + i * 0), -rev + 0.035);
      box(g, 0.04, 0.12, 0.05, mat('#b08d57', { metal: 0.8, rough: 0.3 }), xc + w * 0.3, y0 + 1.05, -rev + 0.05);
      if (h > dh + 0.1) box(g, w - 0.1, h - dh - 0.08, 0.02, gl, xc, y0 + dh + (h - dh) / 2, -rev);
      for (const s of [1, -1]) box(g, 0.06, h, 0.06, trim, xc + s * (w / 2 - 0.03), y0 + h / 2, -0.03);
      box(g, w, 0.08, 0.08, trim, xc, y0 + h - 0.04, -0.02);
    }

    function fillRollup(xc, w, y0, h) {
      const mtl = wallMat('metal', '#9aa0a5');
      wbox(g, w, h, 0.04, mtl, xc, y0 + h / 2, -0.12);
      box(g, w + 0.1, 0.25, 0.3, mat('#6f757a', { metal: 0.5 }), xc, y0 + h + 0.12, 0.05);
      for (const s of [1, -1]) box(g, 0.12, h, 0.15, mat('#e0b020', { rough: 0.6 }), xc + s * (w / 2 + 0.06), y0 + h / 2, 0.075);
    }

    // ---------- ground floor ----------
    if (p.groundFloor === 'storefront') {
      const pier = 0.35, signH = Math.min(0.8, GF * 0.2), openW = Wt - pier * 2, topY = GF - signH;
      wbox(g, pier, GF, T, wall, -Wt / 2 + pier / 2, GF / 2, -T / 2);
      wbox(g, pier, GF, T, wall, Wt / 2 - pier / 2, GF / 2, -T / 2);
      box(g, openW, signH, T + 0.06, trim, 0, GF - signH / 2, -T / 2 + 0.03);
      if (p.signText) box(g, openW * 0.85, signH * 0.72, 0.02, textMat(p.signText, p.signBg, p.signFg, (openW * 0.85) / (signH * 0.72), p.signLit), 0, GF - signH / 2, 0.065);
      box(g, openW, topY, 0.02, interior, 0, topY / 2, -T + 0.02);
      const dw = Math.max(0.4, Math.min(1.1, bw - 0.3, openW - 0.1)), dx = Math.max(-openW / 2 + dw / 2, Math.min(openW / 2 - dw / 2, bayX(doorBay))), bulk = 0.5;
      // bulkhead segments around the door
      const segs = [[-openW / 2, dx - dw / 2], [dx + dw / 2, openW / 2]];
      for (const [a, b] of segs) if (b - a > 0.02) {
        box(g, b - a, bulk, 0.2, trim, (a + b) / 2, bulk / 2, -0.12);
        box(g, b - a, topY - bulk - 0.05, 0.02, gl, (a + b) / 2, bulk + (topY - bulk - 0.05) / 2, -0.18);
      }
      box(g, openW, 0.06, 0.08, trim, 0, topY - 0.55, -0.15);
      for (let i = 0; i <= bays; i++) { const x = -Wt / 2 + i * bw; if (x > -openW / 2 && x < openW / 2) box(g, 0.06, topY, 0.1, trim, x, topY / 2, -0.15); }
      fillDoor(dx, dw, 0, topY - 0.6, 'glass');
      if (p.rollShutter > 0) {
        const sh = (topY - 0.05) * p.rollShutter, mtl = wallMat('metal', '#9aa0a5');
        wbox(g, openW, sh, 0.04, mtl, 0, topY - sh / 2, 0.02);
        box(g, openW, 0.18, 0.22, mat('#6f757a', { metal: 0.5 }), 0, topY - 0.09, 0.08);
      }
      if (p.awning !== 'none') {
        const P = 1.2, D = 0.55, M = topY - 0.12 - D, len = Math.hypot(P, D), ang = Math.atan2(D, P);
        const solid = mat(p.awningColor, { rough: 0.8 });
        const stripes = p.awningStripes ? stripeMat(p.awningColor, p.awningColor2, Math.max(2, Math.round(openW / 0.3)), false) : solid;
        const piv = new THREE.Group(); piv.position.set(0, M + D, 0.02); piv.rotation.x = ang; g.add(piv);
        box(piv, openW, 0.02, len, [solid, solid, stripes, solid, solid, solid], 0, 0, len / 2);
        box(g, openW, 0.22, 0.015, solid, 0, M - 0.11, P + 0.02);
        if (p.awning === 'box') for (const s of [1, -1]) {
          const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0, D); sh.lineTo(P, 0); sh.closePath();
          add(g, new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: false }), solid, s * openW / 2 - 0.01, M, 0.02, 0, -PI / 2);
        }
      }
    } else if (p.groundFloor === 'residential') {
      const stoopH = p.stoop ? Math.min(1.0, GF * 0.25) : 0.1;
      for (let i = 0; i < bays; i++) {
        const xc = bayX(i);
        if (i === doorBay) {
          const dw = Math.min(1.2, bw - 0.4), dh = Math.min(GF - stoopH - 0.3, 2.9);
          bayWall(xc, bw, 0, GF, { w: dw, y0: stoopH, y1: stoopH + dh });
          fillDoor(xc, dw, stoopH, dh, 'wood');
          if (p.stoop) {
            const n = Math.max(2, Math.round(stoopH / 0.18)), sh = stoopH / n, stone = mat(p.trimColor, { rough: 0.9 });
            box(g, dw + 0.6, stoopH, 1.0, stone, xc, stoopH / 2, 0.5);
            for (let k = 0; k < n - 1; k++) box(g, dw + 0.4, sh * (k + 1), 0.3, stone, xc, (sh * (k + 1)) / 2, 1.0 + (n - 2 - k) * 0.3 + 0.15);
            for (const s of [1, -1]) box(g, 0.04, 0.9, 0.04, iron, xc + s * (dw / 2 + 0.25), stoopH + 0.45, 0.95);
          }
        } else {
          const y0 = stoopH + 0.6, y1 = Math.min(GF - 0.35, y0 + FH * p.windowHeight), ww = p.windowStyle === 'arched' ? Math.min(bw * p.windowWidth, (y1 - y0) * 1.2) : bw * p.windowWidth;
          bayWall(xc, bw, 0, GF, { w: ww, y0, y1, arch: p.windowStyle === 'arched' });
          fillWindow(xc, ww, y0, y1, p.windowStyle === 'arched');
        }
      }
    } else if (p.groundFloor === 'loading') {
      for (let i = 0; i < bays; i++) {
        const xc = bayX(i);
        if (i === doorBay) {
          bayWall(xc, bw, 0, GF, { w: 1.0, y0: 0, y1: 2.2 }); fillDoor(xc, 1.0, 0, 2.2, 'steel');
        } else if (i % 2 === 0) {
          const dw = Math.max(1, bw - 0.6), dh = Math.min(GF - 0.6, 3.8);
          bayWall(xc, bw, 0, GF, { w: dw, y0: 0, y1: dh }); fillRollup(xc, dw, 0, dh);
        } else {
          const ww = bw * 0.5, y0 = GF - 1.6, y1 = GF - 0.5;
          bayWall(xc, bw, 0, GF, { w: ww, y0, y1 }); fillWindow(xc, ww, y0, y1, false, { noAC: true, noShutter: true });
        }
      }
    } else { // blank
      for (let i = 0; i < bays; i++) {
        const xc = bayX(i);
        if (i === doorBay) { bayWall(xc, bw, 0, GF, { w: 1.0, y0: 0, y1: 2.2 }); fillDoor(xc, 1.0, 0, 2.2, 'steel'); }
        else bayWall(xc, bw, 0, GF, null);
      }
    }

    // ---------- upper floors ----------
    const upperH = roofY - GF;
    if (floors > 1) {
      if (p.windowStyle === 'curtain') {
        box(g, Wt, upperH, 0.02, interior, 0, GF + upperH / 2, -T + 0.02);
        box(g, Wt - 0.1, upperH, 0.03, gl, 0, GF + upperH / 2, -0.06);
        for (let i = 0; i <= bays; i++) box(g, 0.08, upperH, 0.14, trim, -Wt / 2 + i * bw, GF + upperH / 2, -0.02);
        for (let f = 1; f < floors; f++) {
          const y0 = GF + (f - 1) * FH;
          box(g, Wt, 0.9, 0.06, mat(p.trimColor, { rough: 0.4, metal: 0.4 }), 0, y0 + 0.45, -0.03);
          box(g, Wt, 0.06, 0.14, trim, 0, y0 + 0.9, -0.02);
        }
      } else {
        for (let f = 1; f < floors; f++) {
          const y0 = GF + (f - 1) * FH, y1 = y0 + FH;
          const wh = FH * p.windowHeight, sill = y0 + (FH - wh) * 0.45, head = sill + wh;
          if (p.windowStyle === 'ribbon') {
            const endP = 0.4, ww = Wt - endP * 2;
            wbox(g, Wt, sill - y0, T, wall, 0, (y0 + sill) / 2, -T / 2);
            wbox(g, Wt, y1 - head, T, wall, 0, (head + y1) / 2, -T / 2);
            for (const s of [1, -1]) wbox(g, endP, head - sill, T, wall, s * (Wt / 2 - endP / 2), (sill + head) / 2, -T / 2);
            box(g, ww, wh, 0.02, interior, 0, (sill + head) / 2, -T + 0.02);
            box(g, ww, wh, 0.02, gl, 0, (sill + head) / 2, -0.1);
            for (let i = 1; i < bays; i++) box(g, 0.06, wh, 0.06, trim, -Wt / 2 + i * bw, (sill + head) / 2, -0.08);
            if (p.sills) box(g, ww, 0.06, 0.12, trim, 0, sill - 0.03, 0.03);
          } else {
            const arch = p.windowStyle === 'arched', ww = arch ? Math.min(bw * p.windowWidth, wh * 1.2) : bw * p.windowWidth;
            for (let i = 0; i < bays; i++) {
              bayWall(bayX(i), bw, y0, y1, { w: ww, y0: sill, y1: head, arch });
              fillWindow(bayX(i), ww, sill, head, arch);
            }
          }
          if (p.bandCourses) box(g, Wt + 0.04, 0.12, 0.08, trim, 0, y0, 0.03);
        }
        if (p.pilasters && p.windowStyle !== 'ribbon') for (let i = 0; i <= bays; i++) box(g, 0.28, upperH, 0.1, trim, -Wt / 2 + i * bw, GF + upperH / 2, 0.05);
      }
    }

    // ---------- roofline: cornice + parapet ----------
    let top = roofY;
    if (p.cornice !== 'none') {
      const ch = 0.35;
      if (p.cornice === 'stepped') {
        box(g, Wt + 0.1, 0.15, 0.15, trim, 0, roofY + 0.075, 0.05);
        box(g, Wt + 0.2, 0.15, 0.3, trim, 0, roofY + 0.225, 0.12);
        box(g, Wt + 0.3, 0.12, 0.45, trim, 0, roofY + 0.36, 0.2);
        top = roofY + 0.42;
      } else {
        if (p.cornice === 'bracketed') {
          box(g, Wt, 0.45, 0.05, trim, 0, roofY - 0.225, 0.025);
          const n = Math.max(2, Math.round(Wt / 0.7));
          for (let i = 0; i <= n; i++) box(g, 0.12, 0.38, 0.32, trim, -Wt / 2 + 0.1 + i * ((Wt - 0.2) / n), roofY - 0.19, 0.16);
        }
        box(g, Wt + 0.3, ch, 0.5, trim, 0, roofY + ch / 2, 0.2);
        top = roofY + ch;
      }
    }
    // wall fills the roofline zone behind the cornice and rises as the parapet
    const parTop = Math.max(top, roofY + p.parapet);
    wbox(g, Wt, parTop - roofY, T, wall, 0, (roofY + parTop) / 2, -T / 2);
    if (p.parapet > 0) box(g, Wt + 0.08, 0.08, T + 0.08, trim, 0, parTop + 0.04, -T / 2);

    // ---------- side returns + roof (turns the facade into a building chunk) ----------
    if (p.sideDepth > T + 0.05) {
      const D = p.sideDepth;
      for (const s of [1, -1]) wbox(g, T, parTop, D - T, wall, s * (Wt / 2 - T / 2), parTop / 2, -T - (D - T) / 2);
      box(g, Wt - 2 * T, 0.2, D - T, mat('#4a4a4a', { rough: 0.95 }), 0, roofY - 0.1, -T - (D - T) / 2);
      wbox(g, Wt, parTop, T, wall, 0, parTop / 2, -D + T / 2);
    }

    // ---------- fire escape ----------
    if (p.fireEscape && floors > 1 && p.windowStyle !== 'curtain') {
      const b0 = Math.min(p.fireEscapeBay, Math.max(0, bays - 2)), span = Math.min(2, bays);
      const fw = span * bw - 0.3, fx = -Wt / 2 + (b0 + span / 2) * bw, depth = 0.9;
      for (let f = 1; f < floors; f++) {
        const y = GF + (f - 1) * FH + 0.15;
        box(g, fw, 0.05, depth, iron, fx, y, depth / 2 + 0.05);
        box(g, fw, 0.04, 0.04, iron, fx, y + 0.95, depth + 0.03);
        box(g, fw, 0.04, 0.04, iron, fx, y + 0.5, depth + 0.03);
        for (const s of [1, -1]) { box(g, 0.04, 0.95, 0.04, iron, fx + s * fw / 2, y + 0.475, depth + 0.03); box(g, 0.04, 0.04, depth, iron, fx + s * fw / 2, y + 0.95, depth / 2 + 0.05); }
        for (let k = 1; k < 6; k++) box(g, 0.02, 0.95, 0.02, iron, fx - fw / 2 + (k * fw) / 6, y + 0.475, depth + 0.03);
        if (f < floors - 1) {
          const len = Math.hypot(fw * 0.6, FH), ang = Math.atan2(FH, fw * 0.6);
          const st = new THREE.Group(); st.position.set(fx, y + FH / 2, depth / 2 + 0.05); st.rotation.z = ang * (f % 2 ? 1 : -1); g.add(st);
          for (const s of [1, -1]) box(st, len, 0.06, 0.03, iron, 0, 0, s * 0.3);
          for (let k = 0; k < 8; k++) box(st, 0.03, 0.03, 0.6, iron, -len / 2 + (k + 0.5) * (len / 8), 0, 0);
        }
      }
      const yb = GF + 0.15;
      // retracted drop ladder: stays above a storefront sign and awning
      for (const s of [1, -1]) box(g, 0.04, 0.9, 0.04, iron, fx + fw / 2 - 0.35 + s * 0.2, yb + 0.45 - 0.1, depth - 0.1);
      for (let k = 0; k < 3; k++) box(g, 0.44, 0.03, 0.03, iron, fx + fw / 2 - 0.35, yb + 0.1 + k * 0.3, depth - 0.1);
    }
    return g;
  }

  // ---------- archetypes: same schema, different defaults ----------
  function schema(d) {
    return {
      floors: R(1, 12, 1, d.floors), floorHeight: R(2.8, 4.6, 0.05, d.floorHeight), groundFloorHeight: R(3, 6, 0.05, d.groundFloorHeight),
      bays: R(1, 10, 1, d.bays), bayWidth: R(1.2, 4, 0.05, d.bayWidth), sideDepth: R(0.35, 15, 0.05, d.sideDepth ?? 0.35),
      material: S(['brick', 'brownstone', 'concrete', 'stucco', 'metal'], d.material), wallColor: C(d.wallColor),
      trimColor: C(d.trimColor), accentColor: C(d.accentColor ?? '#2e3b2f'), glassColor: C(d.glassColor ?? '#2c3e4a'),
      windowStyle: S(['rect', 'arched', 'ribbon', 'curtain'], d.windowStyle),
      windowWidth: R(0.25, 0.9, 0.01, d.windowWidth ?? 0.5, { windowStyle: ['rect', 'arched'] }),
      windowHeight: R(0.3, 0.85, 0.01, d.windowHeight ?? 0.6, { windowStyle: ['rect', 'arched', 'ribbon'] }),
      windowFrames: B(d.windowFrames ?? true, { windowStyle: ['rect', 'arched'] }),
      divisions: S(['none', 'sash', 'cross'], d.divisions ?? 'sash', { windowStyle: ['rect', 'arched'] }),
      sills: B(d.sills ?? true, { windowStyle: ['rect', 'arched', 'ribbon'] }), lintels: B(d.lintels ?? true, { windowStyle: ['rect', 'arched'] }),
      shutters: B(d.shutters ?? false, { windowStyle: ['rect'] }), acUnits: R(0, 0.8, 0.05, d.acUnits ?? 0, { windowStyle: ['rect', 'arched'] }),
      groundFloor: S(['storefront', 'residential', 'loading', 'blank'], d.groundFloor),
      doorBay: R(0, 9, 1, d.doorBay ?? 0),
      stoop: B(d.stoop ?? false, { groundFloor: ['residential'] }),
      signText: T(d.signText ?? '', { groundFloor: ['storefront'] }), signBg: C(d.signBg ?? '#1b1b1b', { groundFloor: ['storefront'] }),
      signFg: C(d.signFg ?? '#ffffff', { groundFloor: ['storefront'] }), signLit: B(d.signLit ?? false, { groundFloor: ['storefront'] }),
      rollShutter: R(0, 1, 0.05, d.rollShutter ?? 0, { groundFloor: ['storefront'] }),
      awning: S(['none', 'slope', 'box'], d.awning ?? 'none', { groundFloor: ['storefront'] }),
      awningColor: C(d.awningColor ?? '#2f6b3a', { groundFloor: ['storefront'] }), awningStripes: B(d.awningStripes ?? false, { groundFloor: ['storefront'] }),
      awningColor2: C(d.awningColor2 ?? '#f2f2f2', { groundFloor: ['storefront'] }),
      cornice: S(['none', 'simple', 'bracketed', 'stepped'], d.cornice), parapet: R(0, 2, 0.05, d.parapet),
      bandCourses: B(d.bandCourses ?? false), pilasters: B(d.pilasters ?? false),
      fireEscape: B(d.fireEscape ?? false), fireEscapeBay: R(0, 8, 1, d.fireEscapeBay ?? 0, { fireEscape: [true] }),
      seed: R(1, 999, 1, d.seed ?? 7),
    };
  }
  const ARCH = {
    brownstone: { label: 'Brownstone', floors: 4, floorHeight: 3.2, groundFloorHeight: 3.4, bays: 3, bayWidth: 2.0, material: 'brownstone', wallColor: '#6e4a3a', trimColor: '#5a3c2f', accentColor: '#2e1f18', windowStyle: 'rect', windowWidth: 0.5, windowHeight: 0.62, groundFloor: 'residential', stoop: true, cornice: 'bracketed', parapet: 0.3, acUnits: 0.1 },
    tenement: { label: 'Tenement', floors: 5, floorHeight: 3.0, groundFloorHeight: 3.8, bays: 4, bayWidth: 1.6, material: 'brick', wallColor: '#8a3b2e', trimColor: '#d8d2c4', accentColor: '#2a3b2f', windowStyle: 'rect', windowWidth: 0.5, windowHeight: 0.6, groundFloor: 'storefront', doorBay: 3, signText: 'DELI & GROCERY', signBg: '#1f4f2f', awning: 'slope', awningColor: '#2f6b3a', awningStripes: true, cornice: 'bracketed', parapet: 0.4, bandCourses: true, fireEscape: true, fireEscapeBay: 1, acUnits: 0.3 },
    warehouse: { label: 'Warehouse', floors: 3, floorHeight: 4.2, groundFloorHeight: 5, bays: 6, bayWidth: 3.0, material: 'brick', wallColor: '#9a5a42', trimColor: '#c9c2b3', windowStyle: 'arched', windowWidth: 0.55, windowHeight: 0.55, divisions: 'cross', groundFloor: 'loading', doorBay: 1, cornice: 'stepped', parapet: 1.0, pilasters: true },
    stripMall: { label: 'Strip Mall', floors: 1, floorHeight: 3.2, groundFloorHeight: 4.2, bays: 6, bayWidth: 3.0, material: 'stucco', wallColor: '#d8cbb3', trimColor: '#7a6a55', windowStyle: 'rect', groundFloor: 'storefront', doorBay: 2, signText: 'NAIL SALON', signBg: '#ffffff', signFg: '#c1121f', signLit: true, cornice: 'simple', parapet: 1.2 },
    office: { label: 'Office Tower', floors: 8, floorHeight: 3.6, groundFloorHeight: 5, bays: 7, bayWidth: 2.2, material: 'concrete', wallColor: '#b5b2aa', trimColor: '#555b61', glassColor: '#3d5566', windowStyle: 'curtain', groundFloor: 'storefront', doorBay: 3, signText: 'LOBBY', signBg: '#2b2b2b', cornice: 'none', parapet: 0.8 },
    cornerShop: { label: 'Corner Shop', floors: 3, floorHeight: 3.0, groundFloorHeight: 3.6, bays: 3, bayWidth: 1.8, material: 'stucco', wallColor: '#b9c4a8', trimColor: '#efe9dc', accentColor: '#3b5a7a', windowStyle: 'rect', shutters: true, groundFloor: 'storefront', doorBay: 0, signText: 'BODEGA 24H', signBg: '#f2c14e', signFg: '#1b1b1b', signLit: true, awning: 'box', awningColor: '#c1121f', rollShutter: 0.35, acUnits: 0.4, cornice: 'simple', parapet: 0.5 },
  };
  const props = {};
  for (const [id, d] of Object.entries(ARCH)) props[id] = { label: d.label, category: 'Facades', params: schema(d), build: buildFacade };

  // ================= API =================
  function defaults(id) {
    const out = {};
    for (const [k, s] of Object.entries(props[id].params)) out[k] = s.value;
    return out;
  }
  function build(preset) {
    const def = props[preset.prop];
    if (!def) throw new Error('Unknown facade: ' + preset.prop);
    const p = Object.assign(defaults(preset.prop), preset.params || {});
    const g = def.build(p);
    g.name = preset.prop;
    g.userData.preset = { prop: preset.prop, version: VERSION, params: p };
    g.userData.alignFront = true;
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

export { createFacadeLibrary };
