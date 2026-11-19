// physprops.js : loose physical objects for the survival sim (cannon-es, no rendering, no DOM).
// Crates and barrels can be shoved and kicked over, junk scatters, pickups fall and bounce.
// The level itself is static boxes: closed grid cells, floor slabs per height, and the solid dressing
// the level builder reports. Bodies are plain data the presentation layer copies transforms from.
import * as CANNON from 'cannon-es';

// kind -> shape and mass. Sizes are full extents in metres; 'cyl' is [radius, height].
export const PHYS_KINDS = {
  crate: { box: [0.9, 0.9, 0.9], mass: 28, heavy: true, surface: 'wood' },
  barrel: { cyl: [0.3, 0.9], mass: 32, heavy: true, surface: 'metal' },
  card: { box: [0.4, 0.3, 0.32], mass: 1.5, surface: 'wood' },
  can: { cyl: [0.033, 0.12], mass: 0.25, surface: 'metal' },
  brick: { box: [0.2, 0.065, 0.1], mass: 2.5, surface: 'concrete' },
  bottle: { cyl: [0.035, 0.24], mass: 0.5, surface: 'glass' },
  pipe: { box: [0.05, 0.05, 0.6], mass: 2, surface: 'metal' },
  pistol: { box: [0.04, 0.13, 0.2], mass: 1, surface: 'metal' },
  ammo: { box: [0.12, 0.06, 0.08], mass: 0.6, surface: 'metal' },
  bandage: { cyl: [0.04, 0.09], mass: 0.2, surface: 'flesh' },
};

export function makePhysProps({ def, statics = [], dynamics = [], rand = Math.random }) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0), allowSleep: true });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.solver.iterations = 8;
  const mat = new CANNON.Material('prop');
  world.defaultContactMaterial.friction = 0.45; world.defaultContactMaterial.restitution = 0.15;
  world.addContactMaterial(new CANNON.ContactMaterial(mat, mat, { friction: 0.4, restitution: 0.2 }));

  // ---- static level from the grid: closed cells as runs, floor slabs as runs of equal height
  const C = def.cell, map = def.map, rows = map.length, cols = map[0].length, H = def.heights;
  const hOf = ch => H[ch] || H['.'];
  const addStatic = (cx, cy, cz, hx, hy, hz, q) => { const b = new CANNON.Body({ mass: 0, material: mat }); b.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz))); b.position.set(cx, cy, cz); if (q) b.quaternion.set(q[0], q[1], q[2], q[3]); world.addBody(b); };
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      const ch = map[r][c], closed = ch === '#', key = closed ? '#' : String(hOf(ch).floor);
      let e = c; while (e + 1 < cols && (map[r][e + 1] === '#') === closed && (closed || String(hOf(map[r][e + 1]).floor) === key)) e++;
      const x0 = c * C, x1 = (e + 1) * C, z0 = r * C, z1 = z0 + C;
      if (closed) addStatic((x0 + x1) / 2, 4, (z0 + z1) / 2, (x1 - x0) / 2, 6, C / 2);
      else { const f = hOf(ch).floor; addStatic((x0 + x1) / 2, f - 0.5, (z0 + z1) / 2, (x1 - x0) / 2, 0.5, C / 2); }
      c = e + 1;
    }
  }
  for (const s of statics) addStatic(s.c[0], s.c[1], s.c[2], s.h[0], s.h[1], s.h[2], s.q);

  // ---- dynamic bodies
  const bodies = [], bumps = []; let nextId = 1, time = 0;
  function add(kind, pos, { yaw = 0, vel = null, ref = null } = {}) {
    const K = PHYS_KINDS[kind]; if (!K) return null;
    const b = new CANNON.Body({ mass: K.mass, material: mat, linearDamping: 0.05, angularDamping: 0.2, allowSleep: true, sleepSpeedLimit: 0.15, sleepTimeLimit: 0.4 });
    let half;
    if (K.box) { half = K.box.map(v => v / 2); b.addShape(new CANNON.Box(new CANNON.Vec3(...half))); }
    else { const [rad, h] = K.cyl; half = [rad, h / 2, rad]; b.addShape(new CANNON.Cylinder(rad, rad, h, 10)); }
    b.position.set(pos[0], pos[1] + half[1] + 0.002, pos[2]); b.quaternion.setFromEuler(0, yaw, 0);
    if (vel) { b.velocity.set(vel[0], vel[1], vel[2]); b.angularVelocity.set((rand() - 0.5) * 6, (rand() - 0.5) * 6, (rand() - 0.5) * 6); } else b.sleep();
    world.addBody(b);
    const o = { id: nextId++, kind, body: b, half, heavy: !!K.heavy, ref, lastBump: -1 };
    b.addEventListener('collide', e => { // knocks and landings, for sound and noise
      const v = Math.abs(e.contact.getImpactVelocityAlongNormal()); if (v < 1.3 || time - o.lastBump < 0.12) return;
      o.lastBump = time; bumps.push({ id: o.id, kind, power: Math.min(1.5, v / 4), point: [b.position.x, b.position.y, b.position.z] });
    });
    bodies.push(o); return o;
  }
  function remove(o) { world.removeBody(o.body); const i = bodies.indexOf(o); if (i >= 0) bodies.splice(i, 1); }
  for (const d of dynamics) d.phys = add(d.kind, d.pos, { yaw: d.yaw || 0, ref: d });

  // A moving circle (a body walking through) shoves what it touches. Heavy things slide away at a fraction
  // of the walker's speed and push the walker back out; light things get kicked aside.
  // Returns the correction to apply to the circle's position.
  function pushCircle(x, z, radius, vx, vz, y0, y1, strength = 1) {
    let cx = 0, cz = 0;
    for (const o of bodies) {
      const p = o.body.position, rx = Math.max(o.half[0], o.half[2]) * (o.heavy ? 0.92 : 1);
      if (p.y + o.half[1] < y0 || p.y - o.half[1] > y1) continue;
      const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz), min = radius + rx;
      if (d >= min || d < 1e-4) continue;
      const nx = dx / d, nz = dz / d, into = vx * nx + vz * nz, overlap = min - d;
      if (o.heavy) {
        cx -= nx * overlap; cz -= nz * overlap;
        if (into > 0.1) { o.body.wakeUp(); const sp = into * 0.55 * strength; o.body.velocity.x = nx * sp; o.body.velocity.z = nz * sp; }
      } else if (Math.hypot(vx, vz) > 0.3) {
        o.body.wakeUp(); o.body.velocity.set(nx * (1 + into * 1.1) + vx * 0.4, 0.8 + rand() * 0.8, nz * (1 + into * 1.1) + vz * 0.4);
        o.body.angularVelocity.set((rand() - 0.5) * 8, (rand() - 0.5) * 8, (rand() - 0.5) * 8);
      }
    }
    return [cx, cz];
  }
  // An impulse at a point, falling off with distance: kicks, swings, bullets, landing bricks.
  function blast(point, dir, impulse, radius, filter = null) {
    const hits = [];
    for (const o of bodies) {
      if (filter && !filter(o)) continue;
      const p = o.body.position, d = Math.hypot(p.x - point[0], p.y - point[1], p.z - point[2]);
      if (d > radius + Math.max(...o.half)) continue;
      const k = impulse * Math.max(0.25, 1 - d / (radius + 0.5));
      o.body.wakeUp();
      // the impulse lands at the hit point (relative to the centre), clamped inside the body so it spins without flinging
      const rp = new CANNON.Vec3(point[0] - p.x, point[1] - p.y, point[2] - p.z), lim = Math.max(...o.half); if (rp.length() > lim) rp.scale(lim / rp.length(), rp);
      o.body.applyImpulse(new CANNON.Vec3(dir[0] * k, dir[1] * k + k * 0.25, dir[2] * k), rp);
      hits.push(o);
    }
    return hits;
  }
  // First dynamic body along a ray (bullets, swings, sight of the prompt).
  const _from = new CANNON.Vec3(), _to = new CANNON.Vec3(), _res = new CANNON.RaycastResult();
  function raycast(o, d, maxDist) {
    _from.set(o[0], o[1], o[2]); _to.set(o[0] + d[0] * maxDist, o[1] + d[1] * maxDist, o[2] + d[2] * maxDist);
    _res.reset(); world.raycastClosest(_from, _to, { skipBackfaces: true, collisionFilterMask: -1 }, _res);
    if (!_res.hasHit || !_res.body || _res.body.mass === 0) return null;
    const ob = bodies.find(x => x.body === _res.body); if (!ob) return null;
    return { obj: ob, dist: _res.distance, point: [_res.hitPointWorld.x, _res.hitPointWorld.y, _res.hitPointWorld.z], normal: [_res.hitNormalWorld.x, _res.hitNormalWorld.y, _res.hitNormalWorld.z] };
  }
  function step(dt) {
    bumps.length = 0; time += dt;
    world.step(dt);
    for (const o of bodies) if (o.body.position.y < -20) { o.body.position.y = 1; o.body.velocity.setZero(); } // never lose anything through the floor
  }
  return { world, bodies, bumps, add, remove, pushCircle, blast, raycast, step };
}
