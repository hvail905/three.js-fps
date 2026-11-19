function createCharacterLibrary(THREE) {
  const VERSION = 1;
  const PI = Math.PI;

  // ---------- materials ----------
  const cache = new Map();
  function mat(color, o = {}) {
    const key = color + JSON.stringify(o);
    if (!cache.has(key)) { const m = new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.8, metalness: o.metal ?? 0.02, flatShading: true }); m.userData.role = o.role || 'solid'; cache.set(key, m); }
    return cache.get(key);
  }
  // ---------- simple procedural textures (cached) ----------
  const texCache = new Map();
  function canvasTex(key, draw, size = 128) {
    if (texCache.has(key)) return texCache.get(key);
    const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; texCache.set(key, t); return t;
  }
  const shade = (hex, d) => '#' + new THREE.Color(hex).offsetHSL(0, 0, d).getHexString();
  function texMat(key, draw, o = {}) {
    if (cache.has('tex' + key)) return cache.get('tex' + key);
    const m = new THREE.MeshStandardMaterial({ map: canvasTex(key, draw), roughness: o.rough ?? 0.8, flatShading: true }); m.userData.role = 'solid'; cache.set('tex' + key, m); return m;
  }
  const faceMat = (skin, mask) => texMat('face' + skin + mask, (g, n) => {
    g.fillStyle = mask === 'balaclava' ? '#1a1a1a' : skin; g.fillRect(0, 0, n, n);
    if (mask === 'balaclava') { g.fillStyle = skin; g.fillRect(n * 0.18, n * 0.32, n * 0.64, n * 0.16); }
    g.fillStyle = shade(skin, -0.25); if (mask !== 'balaclava') { g.fillRect(n * 0.22, n * 0.3, n * 0.2, n * 0.04); g.fillRect(n * 0.58, n * 0.3, n * 0.2, n * 0.04); } // brows
    g.fillStyle = '#f2efe8'; g.fillRect(n * 0.24, n * 0.37, n * 0.16, n * 0.07); g.fillRect(n * 0.6, n * 0.37, n * 0.16, n * 0.07); // eyes
    g.fillStyle = '#2a1d14'; g.fillRect(n * 0.3, n * 0.37, n * 0.07, n * 0.07); g.fillRect(n * 0.65, n * 0.37, n * 0.07, n * 0.07);
    if (mask !== 'balaclava') { g.fillStyle = shade(skin, -0.12); g.fillRect(n * 0.45, n * 0.46, n * 0.1, n * 0.16); g.fillStyle = shade(skin, -0.3); g.fillRect(n * 0.36, n * 0.72, n * 0.28, n * 0.04); }
  });
  const topMat = (color, kind, collar) => texMat('top' + color + kind + collar, (g, n) => {
    g.fillStyle = color; g.fillRect(0, 0, n, n);
    const dk = shade(color, -0.14), lt = shade(color, 0.08);
    if (collar) { g.fillStyle = dk; g.beginPath(); g.moveTo(n * 0.3, 0); g.lineTo(n * 0.5, n * 0.22); g.lineTo(n * 0.7, 0); g.fill(); }
    if (kind === 'jacket') { g.fillStyle = dk; g.fillRect(n * 0.485, 0, n * 0.03, n); g.fillStyle = lt; g.fillRect(n * 0.12, n * 0.62, n * 0.26, n * 0.04); g.fillRect(n * 0.62, n * 0.62, n * 0.26, n * 0.04); }
    else if (kind === 'vest') { g.fillStyle = dk; for (let y = n * 0.15; y < n; y += n * 0.13) g.fillRect(n * 0.08, y, n * 0.84, n * 0.035); g.fillStyle = shade(color, -0.2); g.fillRect(n * 0.15, n * 0.55, n * 0.2, n * 0.28); g.fillRect(n * 0.4, n * 0.55, n * 0.2, n * 0.28); g.fillRect(n * 0.65, n * 0.55, n * 0.2, n * 0.28); }
    else { g.fillStyle = dk; for (let y = n * 0.3; y < n * 0.9; y += n * 0.18) g.fillRect(n * 0.49, y, n * 0.03, n * 0.03); g.fillRect(n * 0.15, n * 0.35, n * 0.18, n * 0.02); }
    g.fillStyle = shade(color, -0.08); g.fillRect(0, n * 0.94, n, n * 0.06);
  });
  const pantsMat = color => texMat('pants' + color, (g, n) => { g.fillStyle = color; g.fillRect(0, 0, n, n); g.fillStyle = shade(color, -0.12); g.fillRect(n * 0.47, 0, n * 0.06, n); g.fillStyle = shade(color, 0.05); g.fillRect(n * 0.15, n * 0.1, n * 0.25, n * 0.03); });
  const R = (min, max, step, value, when) => ({ type: 'range', min, max, step, value, when });
  const C = (value, when) => ({ type: 'color', value, when });
  const B = (value, when) => ({ type: 'bool', value, when });
  const S = (options, value, when) => ({ type: 'select', options, value, when });

  // ---------- rig + mesh ----------
  // Joint names (for the game): root, hips, spine, chest, neck, head, shoulderL/R, elbowL/R, wristL/R, thighL/R, kneeL/R, ankleL/R
  function build(p) {
    const H = p.height, bw = p.build; // build: 0.8 thin .. 1.4 heavy
    const L = {
      foot: 0.045 * H, shin: 0.245 * H, thigh: 0.245 * H, pelvis: 0.07 * H, spine: 0.14 * H, chest: 0.16 * H, neck: 0.035 * H, head: 0.125 * H * p.headSize,
      upper: 0.17 * H, fore: 0.155 * H, hand: 0.055 * H, hipW: 0.055 * H * bw, shoulderW: 0.115 * H * (0.85 + bw * 0.15),
    };
    const skin = mat(p.skinColor, { rough: 0.7 }), shirt = mat(p.shirtColor), pants = mat(p.pantsColor), shoes = mat(p.shoeColor, { rough: 0.6 });
    const jacket = p.jacket ? mat(p.jacketColor) : shirt, gloves = p.gloves ? mat('#1c1c1c') : skin;
    const topColor = p.jacket ? p.jacketColor : p.shirtColor, topKind = p.jacket ? 'jacket' : 'shirt';
    const frontTop = topMat(topColor, topKind, false), frontChest = topMat(topColor, topKind, true), pantsFront = pantsMat(p.pantsColor);
    const sixTop = f => [jacket, jacket, jacket, jacket, f, jacket];
    const root = new THREE.Group(), joints = {}, zones = [];
    const J = (name, parent, x, y, z) => { const g = new THREE.Group(); g.name = name; g.position.set(x, y, z); parent.add(g); joints[name] = g; return g; };
    const seg = (parent, w, h, d, m, y, zone, x = 0, z = 0) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; mesh.userData.zone = zone; parent.add(mesh); if (zone) zones.push(mesh); return mesh; };

    const legLen = L.foot + L.shin + L.thigh;
    const hips = J('hips', J('root', root, 0, 0, 0), 0, legLen, 0);
    seg(hips, L.hipW * 2 + 0.08 * bw, L.pelvis, 0.2 * bw, pants, L.pelvis / 2 - 0.02, 'torso');
    const spine = J('spine', hips, 0, L.pelvis, 0);
    seg(spine, L.shoulderW * 1.5 * (0.9 + bw * 0.1), L.spine, 0.2 * bw, sixTop(frontTop), L.spine / 2, 'torso');
    const chest = J('chest', spine, 0, L.spine, 0);
    seg(chest, L.shoulderW * 2, L.chest, 0.23 * bw, sixTop(frontChest), L.chest / 2, 'torso');
    if (p.vest) { const v = mat(p.vestColor, { rough: 0.9 }), vt = topMat(p.vestColor, 'vest', false); seg(chest, L.shoulderW * 1.7, L.chest * 0.95, 0.27 * bw, [v, v, v, v, vt, vt], L.chest * 0.48, 'torso'); seg(spine, L.shoulderW * 1.5, L.spine * 0.7, 0.25 * bw, v, L.spine * 0.6, 'torso'); for (const x of [-0.07, 0, 0.07]) seg(spine, 0.06, 0.1, 0.05, v, L.spine * 0.55, null, x * H / 1.8, 0.14 * bw); }
    if (p.backpack) seg(chest, L.shoulderW * 1.4, L.chest * 1.2, 0.16, mat(p.vestColor, { rough: 0.9 }), L.chest * 0.45, 'torso', 0, -0.2 * bw);
    const neck = J('neck', chest, 0, L.chest, 0);
    seg(neck, 0.08 * H / 1.8, L.neck + 0.02, 0.08 * H / 1.8, skin, L.neck / 2, 'head');
    const head = J('head', neck, 0, L.neck, 0);
    const hs = L.head;
    const headSide = p.mask === 'balaclava' ? mat('#1a1a1a') : skin;
    seg(head, hs * 0.78, hs, hs * 0.86, [headSide, headSide, headSide, headSide, faceMat(p.skinColor, p.mask), headSide], hs / 2, 'head');
    if (p.mask === 'gasmask') { seg(head, hs * 0.6, hs * 0.5, 0.12, mat('#2a2a2a'), hs * 0.35, 'head', 0, hs * 0.42); seg(head, hs * 0.25, hs * 0.25, 0.1, mat('#555'), hs * 0.2, null, 0, hs * 0.55); }
    if (p.hair === 'short' && !p.helmet && p.mask !== 'balaclava') seg(head, hs * 0.82, hs * 0.22, hs * 0.9, mat(p.hairColor), hs * 0.92, 'head');
    if (p.hair === 'long' && !p.helmet && p.mask !== 'balaclava') { seg(head, hs * 0.84, hs * 0.25, hs * 0.92, mat(p.hairColor), hs * 0.92, 'head'); seg(head, hs * 0.84, hs * 0.75, hs * 0.2, mat(p.hairColor), hs * 0.5, 'head', 0, -hs * 0.42); }
    if (p.hair === 'cap' && !p.helmet) { seg(head, hs * 0.84, hs * 0.22, hs * 0.92, mat(p.jacketColor), hs * 0.95, 'head'); seg(head, hs * 0.7, 0.02, hs * 0.4, mat(p.jacketColor), hs * 0.85, null, 0, hs * 0.55); }
    if (p.helmet) { seg(head, hs * 0.95, hs * 0.45, hs * 1.02, mat(p.vestColor, { rough: 0.7 }), hs * 0.95, 'head'); seg(head, hs * 1.0, 0.03, hs * 1.08, mat(p.vestColor, { rough: 0.7 }), hs * 0.72, null); }

    for (const [s, side] of [[1, 'L'], [-1, 'R']]) {
      const sh = J('shoulder' + side, chest, s * L.shoulderW, L.chest * 0.88, 0);
      sh.rotation.z = s * 0.08;
      seg(sh, 0.085 * bw, L.upper, 0.09 * bw, jacket, -L.upper / 2, 'arm');
      const el = J('elbow' + side, sh, 0, -L.upper, 0);
      seg(el, 0.075 * bw, L.fore, 0.08 * bw, p.jacket && p.sleeves ? jacket : p.sleeves ? shirt : skin, -L.fore / 2, 'arm');
      const wr = J('wrist' + side, el, 0, -L.fore, 0);
      seg(wr, 0.06, L.hand, 0.07, gloves, -L.hand / 2, 'arm');
      const th = J('thigh' + side, hips, s * L.hipW, 0, 0);
      seg(th, 0.12 * bw, L.thigh, 0.13 * bw, [pants, pants, pants, pants, pantsFront, pants], -L.thigh / 2, 'leg');
      const kn = J('knee' + side, th, 0, -L.thigh, 0);
      seg(kn, 0.1 * bw, L.shin, 0.11 * bw, pants, -L.shin / 2, 'leg');
      const an = J('ankle' + side, kn, 0, -L.shin, 0);
      seg(an, 0.1 * bw, L.foot, 0.24, shoes, -L.foot / 2, 'leg', 0, 0.05);
    }
    // weapon placeholder held in the right hand (for aim poses)
    if (p.carryWeapon) {
      // rifle slung on the chest: aim raises it to the shoulder, other clips hold it at low ready
      const gun = new THREE.Group(); gun.name = 'heldWeapon';
      const gm = mat('#1e1e1e', { metal: 0.4, rough: 0.5 });
      seg(gun, 0.05, 0.08, 0.8, gm, 0, null, 0, 0.22); seg(gun, 0.04, 0.12, 0.05, gm, -0.08, null, 0, 0.02); seg(gun, 0.035, 0.14, 0.06, gm, -0.09, null, 0, 0.2);
      gun.position.set(-L.shoulderW * 0.45, L.chest * 0.72, 0.16);
      chest.add(gun); joints.heldWeapon = gun;
    }
    root.userData.rig = { joints, L, legLen, rest: Object.fromEntries(Object.entries(joints).map(([k, j]) => [k, j.rotation.toArray().slice(0, 3)])) };
    root.userData.zones = zones;
    return root;
  }

  // ---------- procedural animation (layered) ----------
  // state: { legs, upper, t, hit?, dead?, rate } -- legs: idle|walk|run|crouch|crouchWalk|strafeL|strafeR ; upper: free|carry|aim
  const LEGS = ['idle', 'walk', 'run', 'crouch', 'crouchWalk', 'strafeL', 'strafeR'];
  const UPPER = ['free', 'carry', 'aim'];
  // arm angles solved numerically so both hands meet the rifle (see lab notes)
  const AIM = { R: [-0.3, 0.23, -1.7], L: [-1.25, -0.78, -0.1] };
  const CARRY = { R: [0.25, 0.83, -1.7], L: [-0.35, -0.48, -1.0] };
  function pose(st, rig) {
    const P = {}, s = Math.sin, L = rig.L, t = st.t;
    const add = (k, x = 0, y = 0, z = 0) => { const p = P[k] || (P[k] = [0, 0, 0]); p[0] += x; p[1] += y; p[2] += z; };
    let hipsY = 0, rootRot = [0, 0, 0], phase = 0, moving = false, run = false;
    // ----- legs -----
    const lg = st.legs;
    if (lg === 'walk' || lg === 'run' || lg === 'crouchWalk') {
      run = lg === 'run'; const cr = lg === 'crouchWalk'; moving = true;
      const f = run ? 1.45 : cr ? 0.8 : 0.95; phase = t * f * PI * 2;
      const amp = run ? 0.85 : 0.45, kneeB = run ? 1.3 : 0.6;
      for (const [side, o] of [['L', 0], ['R', PI]]) {
        const q = phase + o, base = cr ? -1.1 : 0;
        add('thigh' + side, base - amp * s(q) - (run ? 0.15 : 0));
        add('knee' + side, (cr ? 1.9 : 0.05) + kneeB * Math.max(0, s(q + 1.2)) * (cr ? 0.5 : 1));
        add('ankle' + side, (cr ? -0.6 : 0) + 0.25 * Math.max(0, -s(q)));
      }
      hipsY = (cr ? -L.thigh * 0.55 : 0) + Math.abs(s(phase)) * (run ? 0.05 : 0.025) - (run ? 0.03 : 0);
      add('spine', run ? 0.22 : cr ? 0.35 : 0.04, s(phase) * 0.08);
      add('chest', 0, -s(phase) * 0.12);
      add('head', run ? -0.15 : cr ? -0.25 : 0);
    } else if (lg === 'crouch') {
      for (const side of ['L', 'R']) { add('thigh' + side, -1.15); add('knee' + side, 1.95); add('ankle' + side, -0.7); }
      hipsY = -L.thigh * 0.58; add('spine', 0.3); add('head', -0.25);
    } else if (lg === 'strafeL' || lg === 'strafeR') {
      moving = true; const dir = lg === 'strafeL' ? 1 : -1; phase = t * 1.1 * PI * 2;
      // lead leg steps out, trail leg follows: alternating abduction with knee lift
      const lead = dir > 0 ? 'L' : 'R', trail = dir > 0 ? 'R' : 'L';
      add('thigh' + lead, -0.1, 0, dir * 0.32 * Math.max(0, s(phase))); add('knee' + lead, 0.25 + 0.5 * Math.max(0, s(phase)));
      add('thigh' + trail, -0.1, 0, dir * 0.22 * Math.max(0, -s(phase))); add('knee' + trail, 0.25 + 0.5 * Math.max(0, -s(phase)));
      hipsY = -0.04 + Math.abs(s(phase)) * 0.02; add('spine', 0.08, 0, -dir * 0.04 * s(phase));
    } else {
      add('chest', s(t * 1.6) * 0.03); add('head', 0, s(t * 0.4) * 0.15);
    }
    // ----- upper body -----
    const up = rig.joints.heldWeapon ? st.upper : st.upper === 'aim' ? 'aim' : 'free';
    if (up === 'aim') {
      const sway = s(t * 1.1) * 0.012 * (moving ? 2 : 1);
      add('spine', 0.05, 0.25); add('chest', sway, 0.1); add('head', 0.05 - (P.head ? P.head[0] : 0) * 0.7, -0.3);
      add('shoulderR', AIM.R[0], 0, AIM.R[1]); add('elbowR', AIM.R[2]);
      add('shoulderL', AIM.L[0], 0, AIM.L[1]); add('elbowL', AIM.L[2]);
      add('heldWeapon', 0.05 - (P.spine ? P.spine[0] - 0.05 : 0) * 0.8, -0.35, 0); // keep the muzzle level while the spine leans
      if (P.chest) P.chest[1] -= (moving ? s(phase) * -0.12 : 0); // cancel walk twist so the aim stays steady
    } else if (up === 'carry') {
      add('shoulderR', CARRY.R[0], 0, CARRY.R[1]); add('elbowR', CARRY.R[2]);
      add('shoulderL', CARRY.L[0], 0, CARRY.L[1]); add('elbowL', CARRY.L[2]);
      add('heldWeapon', 0.75 + (run ? s(phase * 2) * 0.05 : 0), 0.35, 0);
    } else {
      const arm = run ? 0.75 : moving ? 0.35 : 0.05;
      add('shoulderL', arm * s(phase), 0, 0.12); add('shoulderR', -arm * s(phase), 0, -0.12);
      add('elbowL', run ? -1.5 : -0.2 - 0.2 * Math.max(0, s(phase))); add('elbowR', run ? -1.5 : -0.2 - 0.2 * Math.max(0, -s(phase)));
      if (rig.joints.heldWeapon) add('heldWeapon', 0.75, 0.35, 0);
    }
    // ----- hit reaction (additive): bend away from the bullet, by zone -----
    if (st.hit && !st.dead) {
      const h = st.hit, ht = t - h.t, k = Math.exp(-ht * 5) * Math.sin(Math.min(ht * 16, PI)) * h.power;
      const dx = h.dir[0], dz = h.dir[1], side = h.side > 0 ? 'L' : 'R';
      if (h.zone === 'head') { add('head', dz * 0.9 * k, 0, -dx * 0.6 * k); add('chest', dz * 0.2 * k); add('neck', dz * 0.3 * k); }
      else if (h.zone === 'arm') { add('shoulder' + side, -dz * 0.9 * k, 0, h.side * 0.5 * k); add('chest', 0, h.side * 0.3 * k); add('spine', dz * 0.12 * k); }
      else if (h.zone === 'leg') { add('knee' + side, 1.0 * k); add('thigh' + side, -0.35 * k); hipsY -= 0.12 * k; add('spine', 0.2 * k, 0, -dx * 0.15 * k); }
      else { add('spine', dz * 0.45 * k, -dx * 0.25 * k, -dx * 0.35 * k); add('chest', dz * 0.3 * k); add('head', dz * 0.35 * k); add('shoulderL', 0.3 * k, 0, 0.3 * k); add('shoulderR', 0.3 * k, 0, -0.3 * k); }
      if (ht > 0.9) st.hit = null;
    }
    // ----- death: fall away from the shot; leg hits crumple first, head shots go limp -----
    if (st.dead) {
      const d = st.dead, dt2 = t - d.t, dx = d.dir[0], dz = d.dir[1];
      const dur = d.zone === 'head' ? 0.6 : d.zone === 'leg' ? 1.3 : 0.9;
      const k = Math.min(1, dt2 / dur), e = k * k * (3 - 2 * k);
      for (const k2 of Object.keys(P)) if (!k2.startsWith('heldWeapon')) P[k2] = P[k2].map(v => v * (1 - e)); // let go of the current pose
      const buckle = d.zone === 'leg' ? Math.min(1, dt2 / 0.45) : Math.min(1, k * 2);
      add('kneeL', 1.5 * buckle * (1 - e * 0.7)); add('kneeR', 1.3 * buckle * (1 - e * 0.6));
      add('thighL', -0.6 * buckle * (1 - e)); add('thighR', -0.4 * buckle * (1 - e));
      add('head', dz * 0.6 * e, 0.4 * e); add('spine', dz * 0.3 * e);
      const limp = d.zone === 'head' ? 0.2 : 1;
      add('shoulderL', 0.3 * limp, 0, 0.5 + 1.1 * e * limp); add('shoulderR', -0.2 * limp, 0, -0.5 - 0.9 * e * limp); add('elbowL', -0.3); add('elbowR', -0.6);
      hipsY = -rig.legLen * 0.75 * Math.min(1, d.zone === 'leg' ? buckle : k * 1.6);
      const fall = d.zone === 'leg' ? Math.max(0, (dt2 - 0.35) / (dur - 0.35)) : k, fe = Math.min(1, fall) ** 2 * (3 - 2 * Math.min(1, fall));
      // dominant axis decides backward/forward vs sideways
      if (Math.abs(dz) >= Math.abs(dx)) rootRot = [(PI / 2) * Math.sign(dz || -1) * fe, 0, -dx * 0.4 * fe];
      else rootRot = [dz * 0.4 * fe, 0, -Math.sign(dx) * (PI / 2) * fe];
      if (d.zone === 'leg') rootRot[0] = Math.abs(rootRot[0]) * 0.9 + (Math.abs(dz) >= Math.abs(dx) ? 0 : 0); // crumpling falls forward over the knees
    }
    return { P, hipsY, rootRot };
  }
  function animate(root, st, dt, opts = {}) {
    const rig = root.userData.rig;
    st.t = (st.t || 0) + dt * (opts.rate || st.rate || 1);
    st.blend = Math.min(1, (st.blend ?? 1) + dt / 0.22);
    const cur = pose(st, rig), from = st.from, w = from && st.blend < 1 ? st.blend : 1;
    for (const [name, j] of Object.entries(rig.joints)) {
      const rest = rig.rest[name], a = cur.P[name] || [0, 0, 0], b = (from && from.P[name]) || [0, 0, 0];
      j.rotation.set(rest[0] + b[0] + (a[0] - b[0]) * w, rest[1] + b[1] + (a[1] - b[1]) * w, rest[2] + b[2] + (a[2] - b[2]) * w);
    }
    const hy = from ? from.hipsY + (cur.hipsY - from.hipsY) * w : cur.hipsY;
    rig.joints.hips.position.y = rig.legLen + hy;
    const rr = from ? from.rootRot.map((v, i) => v + (cur.rootRot[i] - v) * w) : cur.rootRot;
    rig.joints.root.rotation.set(...rr);
    st.last = cur;
  }
  const crossfade = st => { st.from = st.last || null; st.blend = 0; };
  function setLegs(st, legs) { if (st.legs !== legs) { crossfade(st); st.legs = legs; } }
  function setUpper(st, upper) { if (st.upper !== upper) { crossfade(st); st.upper = upper; } }
  // dir: bullet travel direction in the character's local space [x, z]; side: +1 if the hit point is on the character's left (+x)
  function hit(st, zone, dir, side, power = 1) { st.hit = { zone, dir, side, power, t: st.t || 0 }; }
  function kill(st, zone, dir) { crossfade(st); st.dead = { zone, dir, t: st.t || 0 }; st.hit = null; }
  function revive(st) { crossfade(st); st.dead = null; st.hit = null; }
  // legacy single-clip API
  function play(st, clip) { if (LEGS.includes(clip)) setLegs(st, clip); else if (clip === 'aim') setUpper(st, 'aim'); }
  const CLIPS = LEGS;

  // ---------- archetypes ----------
  function schema(d) {
    return {
      height: R(1.5, 2.05, 0.01, d.height ?? 1.78), build: R(0.8, 1.45, 0.01, d.build ?? 1), headSize: R(0.85, 1.2, 0.01, 1),
      skinColor: C(d.skinColor ?? '#c69c7a'), hair: S(['none', 'short', 'long', 'cap'], d.hair ?? 'short'), hairColor: C(d.hairColor ?? '#2b1d14'),
      shirtColor: C(d.shirtColor ?? '#7a8a9a'), sleeves: B(d.sleeves ?? true), pantsColor: C(d.pantsColor ?? '#2f3640'), shoeColor: C(d.shoeColor ?? '#1c1c1c'),
      jacket: B(d.jacket ?? false), jacketColor: C(d.jacketColor ?? '#3a3a3a'),
      vest: B(d.vest ?? false), helmet: B(d.helmet ?? false), backpack: B(d.backpack ?? false), vestColor: C(d.vestColor ?? '#4a5240'),
      mask: S(['none', 'balaclava', 'gasmask'], d.mask ?? 'none'), gloves: B(d.gloves ?? false), carryWeapon: B(d.carryWeapon ?? false),
      headMult: R(1, 4, 0.05, d.headMult ?? 2), torsoMult: R(0.5, 1.5, 0.05, 1), armMult: R(0.3, 1, 0.05, 0.75), legMult: R(0.3, 1, 0.05, 0.75),
      health: R(25, 400, 5, d.health ?? 100),
    };
  }
  const ARCH = {
    civilian: { label: 'Civilian', shirtColor: '#c9a46b', pantsColor: '#3b4a63', hair: 'short', health: 60 },
    civilianB: { label: 'Civilian (long hair)', height: 1.66, build: 0.9, shirtColor: '#8c3b4a', pantsColor: '#2a2a2a', hair: 'long', hairColor: '#5a3a22', skinColor: '#8d5f45', health: 60 },
    thug: { label: 'Thug', build: 1.15, jacket: true, jacketColor: '#1f1f1f', pantsColor: '#2f3a4a', hair: 'cap', mask: 'balaclava', gloves: true, carryWeapon: true, health: 90 },
    guard: { label: 'Security guard', jacket: true, jacketColor: '#2a3550', shirtColor: '#c8ced6', pantsColor: '#1f2533', hair: 'cap', vest: true, vestColor: '#1f2533', carryWeapon: true, health: 110 },
    soldier: { label: 'Soldier', jacket: true, jacketColor: '#5a6048', pantsColor: '#4f5540', vest: true, helmet: true, backpack: true, vestColor: '#3f4532', gloves: true, carryWeapon: true, headMult: 1.6, health: 140 },
    heavy: { label: 'Heavy', height: 1.95, build: 1.4, jacket: true, jacketColor: '#2a2a2a', pantsColor: '#252525', vest: true, helmet: true, mask: 'gasmask', vestColor: '#1d1d1d', gloves: true, carryWeapon: true, headMult: 1.4, health: 300 },
    medic: { label: 'Medic', shirtColor: '#e8e8e8', jacket: true, jacketColor: '#b8362f', pantsColor: '#2a3540', backpack: true, vestColor: '#b8362f', hair: 'short', health: 90 },
  };
  const props = {};
  for (const [id, d] of Object.entries(ARCH)) props[id] = { label: d.label, category: 'Characters', params: schema(d), build };

  function defaults(id) { const o = {}; for (const [k, s] of Object.entries(props[id].params)) o[k] = s.value; return o; }

  // ---------- believable variation ----------
  // Proportions stay inside human ranges and correlate (head size follows height); colors come from curated palettes per archetype.
  const SKIN = ['#f1d3bd', '#e8bf9f', '#d6a27e', '#c69c7a', '#b07a55', '#8d5f45', '#6b4430', '#4a2f22'];
  const HAIR = [['#1a1410', 30], ['#2b1d14', 25], ['#4a3222', 18], ['#6b4a2e', 9], ['#8a5a32', 5], ['#c9a46b', 6], ['#8c8c8c', 5], ['#d9d9d9', 2]];
  const PAL = {
    civilian: { tops: ['#c9a46b', '#7a8a9a', '#8c3b4a', '#3b5a7a', '#5a6b3a', '#d9d4c8', '#2f2f2f', '#a65a3a'], pants: ['#3b4a63', '#2a2a2a', '#5a5048', '#6b6b6b', '#2f3a4a'], gear: {} },
    civilianB: { tops: ['#8c3b4a', '#d9a6b0', '#3b5a7a', '#e8e2d0', '#5a3a6b', '#2f5a4a'], pants: ['#2a2a2a', '#3b4a63', '#6b5a48'], gear: {} },
    thug: { tops: ['#1f1f1f', '#2a2a2a', '#3a2a22', '#2f3a2a', '#1f2533'], pants: ['#2f3a4a', '#222', '#3a3a3a'], gear: { mask: ['none', 'balaclava'], hair: ['cap', 'short', 'none'] } },
    guard: { tops: ['#2a3550', '#1f2533', '#2a2a2a'], pants: ['#1f2533', '#222'], gear: { hair: ['cap', 'short'] } },
    soldier: { tops: ['#5a6048', '#4f5540', '#6b6450', '#3f4532'], pants: ['#4f5540', '#5a5a48', '#3f4532'], gear: { helmet: [true], backpack: [true, false] } },
    heavy: { tops: ['#2a2a2a', '#1d1d1d', '#3a3a34'], pants: ['#252525', '#2a2a2a'], gear: { helmet: [true], mask: ['gasmask', 'balaclava'] } },
    medic: { tops: ['#b8362f', '#2f6b9a', '#e8e8e8'], pants: ['#2a3540', '#2a2a2a'], gear: { backpack: [true] } },
  };
  function randomize(id, seed = Math.random() * 1e9) {
    let a = seed >>> 0 || 1; const r = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const pick = arr => arr[Math.floor(r() * arr.length)];
    const weighted = list => { let x = r() * list.reduce((s, [, w]) => s + w, 0); for (const [v, w] of list) if ((x -= w) <= 0) return v; return list[0][0]; };
    const gauss = () => (r() + r() + r() - 1.5) / 0.5; // ~N(0,1), bounded
    const base = defaults(id), pal = PAL[id] || PAL.civilian, p = { ...base };
    const heavy = id === 'heavy';
    p.height = +Math.min(2.02, Math.max(1.55, (heavy ? 1.9 : base.height) + gauss() * 0.06)).toFixed(2);
    p.build = +Math.min(1.45, Math.max(0.82, (heavy ? 1.35 : base.build) + gauss() * 0.08)).toFixed(2);
    p.headSize = +(1 + (1.78 - p.height) * 0.12 + gauss() * 0.02).toFixed(2); // shorter people read with slightly larger heads
    p.skinColor = pick(SKIN); p.hairColor = weighted(HAIR);
    const topKey = p.jacket ? 'jacketColor' : 'shirtColor'; p[topKey] = pick(pal.tops); if (p.jacket) p.shirtColor = pick(['#c8ced6', '#e8e2d0', '#2a2a2a', '#7a8a9a']);
    p.pantsColor = pick(pal.pants);
    if (!['soldier', 'heavy', 'guard'].includes(id)) p.hair = pick(['short', 'short', 'long', 'cap', 'none']);
    for (const [k, opts] of Object.entries(pal.gear)) p[k] = pick(opts);
    if (id === 'soldier' || id === 'heavy') p.vestColor = shade(p.jacketColor || p.shirtColor, -0.06);
    return p;
  }
  function buildPreset(preset) {
    const p = Object.assign(defaults(preset.prop), preset.params || {});
    const g = build(p); g.name = preset.prop;
    g.userData.preset = { prop: preset.prop, version: VERSION, params: p };
    g.userData.damage = { head: p.headMult, torso: p.torsoMult, arm: p.armMult, leg: p.legMult, health: p.health };
    return g;
  }
  function dispose(obj) { obj.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); }
  return { VERSION, props, defaults, build: buildPreset, dispose, animate, play, setLegs, setUpper, hit, kill, revive, randomize, CLIPS, LEGS, UPPER };
}

export { createCharacterLibrary };
