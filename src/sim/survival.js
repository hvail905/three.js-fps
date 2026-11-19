// survival.js : rules for the sewer survival prototype. Plain data, fixed 60 Hz tick, returns events.
// Reuses the player controller (movement.js), the gun (gun.js) and A* on a nav grid (ai.js).
// Zombies: hunt by sound and short sight, swarm, stagger, lose limbs; can't follow into crawl vents.
import * as THREE from 'three';
import { TICK, DEFAULT_PARAMS, makeCommand, makePlayer, stepPlayer } from './movement.js';
import { makeGunState, stepGun, damageAt } from './gun.js';
import { makeWorld as makeNav, findPath, rng } from './ai.js';
import { HUMANOID_HITBOXES } from './world.js';
import { makePhysProps, PHYS_KINDS } from './physprops.js';

const SURF_INDEX = { concrete: 0, metal: 1, wood: 2, glass: 3, dirt: 4, asphalt: 5, water: 6, flesh: 7 }; // matches SURFACES in world/level.js

export { TICK };

export const SURVIVAL_RULES = {
  player: { maxHp: 100, bandageHeal: 35, bandageTime: 1.4, carry: { brick: 3, bottle: 3, bandage: 3 } },
  melee: {
    fists: { damage: 9, range: 1.35, windup: 0.09, recover: 0.38, stagger: 0.3, noise: 5 },
    pipe: { damage: 26, range: 1.8, windup: 0.16, recover: 0.55, stagger: 0.7, noise: 7, durability: 14 },
  },
  kick: { damage: 5, range: 1.6, cone: 0.9, push: 2.4, cooldown: 0.9, stagger: 1.0, windup: 0.12, noise: 5, propImpulse: 95 },
  props: { pipeImpulse: 30, fistImpulse: 12, bulletImpulse: 14, brickImpulse: 22, noise: 6 }, // loose physical objects
  throw: {
    brick: { damage: 24, speed: 14, stagger: 0.9, noise: 11, cooldown: 0.6 },
    bottle: { damage: 9, speed: 16, stagger: 0.45, noise: 16, cooldown: 0.5 },
  },
  pistol: { magStart: 6, ammoPickup: 6 },
  // per-zombie body: overall hp and per-limb hp. A limb at 0 comes off. Head off or hp 0 = dead.
  zombie: {
    hp: 140, head: 40, arm: 45, leg: 55,
    walk: 0.9, run: 3.1, crawl: 0.7, turn: 6,
    sight: 11, sightLit: 19, fov: 130, awareRate: 2.2,
    attackRange: 1.45, attackReach: 1.9, windup: 0.55, damage: 16, cooldown: 1.1, crawlerDamage: 9,
    stagger: 0.7, loseTime: 7, searchTime: 8, bluntSever: 0.55,
  },
  noise: { gunshot: 42, sprint: 9, walk: 3.2, water: 1.8, crouch: 0 },
};

const LIMB_OF = (box) => box.part === 'arm' || box.part === 'leg' ? box.part + (box.x > 0 ? 'L' : 'R') : box.part;
const arr = v => [v.x, v.y, v.z];

// def: level data (data/sewer/*.json). level: buildSewer() output (collider, bounds). pistolStats from data/weapons.
// layout (optional): buildSewer() output; its dynamics (crates, barrels, junk) and staticBoxes go into the physics world.
export function makeSurvival({ def, collider, bounds, moveParams = DEFAULT_PARAMS, pistolStats, rules = SURVIVAL_RULES, seed = 1, layout = null }) {
  const C = def.cell, cc = ([c, r]) => [c * C + C / 2, r * C + C / 2];
  const bvh = collider.bvh, box = new THREE.Box3(), ident = new THREE.Matrix4();
  // nav: a 0.5 m grid; cells where a standing body (0.4 - 1.7 m) hits geometry are blocked, so vents (1.25 m) are off-limits to zombies
  const nav = makeNav({ width: bounds.width, depth: bounds.depth, x0: bounds.x0, z0: bounds.z0, cell: 0.5, blockedFn: (x, z, R) => { box.min.set(x - R, 0.4, z - R); box.max.set(x + R, 1.7, z + R); return bvh.intersectsBox(box, ident); } });
  const S = { ...pistolStats, magSize: 12 };
  const [px, pz] = cc(def.player.cell);
  const R = rng(seed);
  const world = {
    time: 0, tick: 0, def, rules, collider, nav, rand: R, P: { ...moveParams }, pistolStats: S,
    player: {
      body: makePlayer(new THREE.Vector3(px, 0.05, pz)), yaw: (def.player.yaw || 0) * Math.PI / 180, pitch: 0,
      hp: rules.player.maxHp, maxHp: rules.player.maxHp, alive: true, escaped: false,
      slot: 'fists', pipe: null, pistol: null, reserve: 0, bricks: 0, bottles: 0, bandages: 0,
      action: null, kickCd: 0, throwCd: 0, lastNoise: 0, stepAcc: 0,
    },
    zombies: (def.zombies || []).map((z, i) => makeZombie(i + 1, cc(z.cell), (z.yaw || 0) * Math.PI / 180, rules, R)),
    pickups: (def.pickups || []).map((p, i) => ({ id: i + 1, kind: p.kind, pos: [...cc(p.cell)], taken: false })),
    thrown: [], noises: [], triggers: new Set(), nextId: 1000,
    stats: { kills: 0, severed: 0, shots: 0, hits: 0, damageTaken: 0 },
  };
  world.player.body.yaw = world.player.yaw;
  for (const p of world.pickups) p.pos = [p.pos[0], groundY(world, p.pos[0], p.pos[1]), p.pos[1]];
  world.phys = makePhysProps({ def, statics: layout ? layout.staticBoxes : [], dynamics: layout ? layout.dynamics : [], rand: R });
  for (const k of world.pickups) k.phys = world.phys.add(k.kind, k.pos, { yaw: R() * 6, ref: k });
  for (const z of world.zombies) z.pos.y = groundY(world, z.pos.x, z.pos.z);
  return world;
}

function makeZombie(id, [x, z], yaw, rules, R) {
  const Z = rules.zombie;
  return {
    id, pos: new THREE.Vector3(x, 0, z), yaw, height: 1.65 + R() * 0.3, speed: 0, alive: true,
    hp: Z.hp, limbs: { head: Z.head, armL: Z.arm, armR: Z.arm, legL: Z.leg, legR: Z.leg }, lost: {},
    state: 'idle', stateT: R() * 3, awareness: 0, target: null, lastSeen: -99, path: [], pathT: 0,
    attackT: 0, cooldown: 0, staggerT: 0, knock: null, crawl: false, wanderT: 1 + R() * 4, groanT: 1 + R() * 6,
  };
}

export function makeSurvivalInput() {
  return { ...makeCommand(), attack: false, aim: false, reload: false, kick: false, throwKind: null, use: false, heal: false, slot: null, light: true };
}

// ---------------------------------------------------------------- queries
// What the player is looking at within reach: a pickup to take, or a loose prop to shove or kick.
// Shared by the sim (use) and the presentation (prompt), so the prompt always names what E will take.
export function lookTarget(world) {
  const p = world.player, o = eye(p), d = viewDir(p);
  let pickup = null, best = 0.86;
  for (const k of world.pickups) {
    if (k.taken) continue;
    const c = new THREE.Vector3(k.pos[0], k.pos[1] + 0.05, k.pos[2]), to = c.sub(o), dist = to.length();
    if (dist > 2.2) continue;
    const dot = to.normalize().dot(d) + (dist < 0.9 ? 0.08 : 0); // things at your feet count even off-centre
    if (dot > best) { best = dot; pickup = k; }
  }
  if (!pickup) { let bd = 0.75; for (const k of world.pickups) if (!k.taken) { const dd = Math.hypot(k.pos[0] - p.body.pos.x, k.pos[2] - p.body.pos.z); if (dd < bd) { bd = dd; pickup = k; } } } // standing on it
  else { const w = castWorld(world, o, new THREE.Vector3(pickup.pos[0], pickup.pos[1] + 0.05, pickup.pos[2]).sub(o).normalize(), 2.2); const dd = Math.hypot(pickup.pos[0] - o.x, pickup.pos[1] + 0.05 - o.y, pickup.pos[2] - o.z); if (w && w.dist < dd - 0.15) pickup = null; }
  const ph = world.phys ? world.phys.raycast(arr(o), arr(d), 2.0) : null, wall = castWorld(world, o, d, 2.0);
  const prop = ph && ph.obj.heavy && (!wall || ph.dist < wall.dist) ? ph.obj : null;
  return { pickup, prop };
}
const _ray = new THREE.Ray(), _down = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
export function groundY(world, x, z, from = 2) {
  _down.origin.set(x, from, z);
  const h = world.collider.bvh.raycastFirst(_down, THREE.DoubleSide, 0, from + 2);
  return h ? h.point.y : 0;
}
function castWorld(world, origin, dir, maxDist) {
  _ray.origin.copy(origin); _ray.direction.copy(dir);
  const h = world.collider.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, maxDist);
  if (!h) return null;
  const n = h.face ? h.face.normal.clone() : new THREE.Vector3(0, 1, 0); if (n.dot(dir) > 0) n.negate();
  return { dist: h.distance, point: h.point.clone(), normal: n, surface: world.collider.triSurface[h.faceIndex] ?? 0 };
}
function los(world, a, b) { const d = b.clone().sub(a), len = d.length(); if (len < 0.05) return true; _ray.origin.copy(a); _ray.direction.copy(d.multiplyScalar(1 / len)); return !world.collider.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, len - 0.05); }
function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z, b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r, disc = b * b - cc;
  if (disc < 0) return null; const s = Math.sqrt(disc), t0 = -b - s, t1 = -b + s; return t0 >= 0 ? t0 : t1 >= 0 ? 0 : null;
}
// zombie hitboxes follow its height, crawling (lying low) and missing limbs
const _c = new THREE.Vector3();
function hitboxCenter(z, b, out) {
  const k = z.height / 1.8, cy = Math.cos(z.yaw), sy = Math.sin(z.yaw);
  if (z.crawl) { // body lies along its facing, chest up front, about 0.35 m off the floor
    const along = (b.y - 1.0) * k * 0.9;
    return out.set(z.pos.x + b.x * k * cy + Math.sin(z.yaw) * along, z.pos.y + 0.25 + (b.part === 'head' ? 0.15 : 0), z.pos.z - b.x * k * sy + Math.cos(z.yaw) * along);
  }
  return out.set(z.pos.x + b.x * k * cy, z.pos.y + b.y * k, z.pos.z - b.x * k * sy);
}
export function castZombies(world, origin, dir, maxDist) {
  let best = null;
  for (const z of world.zombies) {
    if (!z.alive) continue;
    _c.set(z.pos.x, z.pos.y + 0.9, z.pos.z);
    const bt = raySphere(origin, dir, _c, 1.3); if (bt === null || bt > maxDist) continue;
    for (const b of HUMANOID_HITBOXES) {
      const limb = LIMB_OF(b); if (z.lost[limb]) continue;
      if (b.part === 'leg' && b.y < 0.5 && z.lost[limb]) continue;
      hitboxCenter(z, b, _c);
      const t = raySphere(origin, dir, _c, b.r * z.height / 1.8 * 1.1);
      if (t !== null && t <= maxDist && (!best || t < best.dist)) best = { z, box: b, limb, dist: t };
    }
  }
  if (best) best.point = origin.clone().addScaledVector(dir, best.dist);
  return best;
}
const eye = p => new THREE.Vector3(p.body.pos.x, p.body.pos.y + p.body.height - 0.12, p.body.pos.z);
function viewDir(p) { return new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(p.pitch, p.yaw, 0, 'YXZ')); }
function noise(world, pos, r, kind) { if (r > 0) world.noises.push({ x: pos.x ?? pos[0], z: pos.z ?? pos[2], r, kind, t: world.time }); }

// ---------------------------------------------------------------- damage
// blunt: melee and thrown objects sever limbs less readily than bullets
function damageZombie(world, ev, z, limb, zone, dmg, { dir, point, blunt = false, stagger = 0, by = 'player', source }) {
  const Z = world.rules.zombie;
  if (!z.alive) return;
  z.hp -= dmg;
  const cy = Math.cos(z.yaw), sy = Math.sin(z.yaw), local = [dir.x * cy - dir.z * sy, dir.x * sy + dir.z * cy];
  let severed = null;
  if (limb in z.limbs) {
    z.limbs[limb] -= dmg * (blunt ? Z.bluntSever : 1);
    if (z.limbs[limb] <= 0 && !z.lost[limb]) { z.lost[limb] = true; severed = limb; world.stats.severed++; if (limb.startsWith('leg')) { z.crawl = true; } }
  }
  // hit reactions: alert, face the attacker, stagger on heavy blows
  z.awareness = 1; z.lastSeen = world.time; z.target = arr(world.player.body.pos);
  if (z.state === 'idle' || z.state === 'investigate' || z.state === 'search') setZState(z, 'chase');
  if (stagger > 0 && !z.crawl) { z.staggerT = Math.max(z.staggerT, stagger); z.attackT = 0; }
  const killed = z.hp <= 0 || z.lost.head;
  ev.push({ type: 'zhit', zombie: z.id, limb, zone, part: limb.replace(/[LR]$/, '') === 'torso' ? 'torso' : limb.replace(/[LR]$/, ''), side: limb.endsWith('L') ? 1 : -1, dmg, point: arr(point), dir: arr(dir), local, severed, killed, blunt, source });
  if (killed) { z.alive = false; z.hp = 0; z.state = 'dead'; world.stats.kills++; ev.push({ type: 'zdied', zombie: z.id, limb, local, crawl: z.crawl }); }
}

// ---------------------------------------------------------------- step
export function stepSurvival(world, inp) {
  const ev = [], p = world.player, RU = world.rules;
  world.noises = world.noises.filter(n => world.time - n.t < 0.6);
  if (p.alive && !p.escaped) stepPlayerSurvival(world, inp || makeSurvivalInput(), ev);
  stepThrown(world, ev);
  if (world.tick % 2 === 0) for (const z of world.zombies) if (z.alive) stepZombie(world, z, ev, TICK * 2, inp ? inp.light : true);
  // loose objects: the player and every zombie shove what they walk into, then the physics world steps
  {
    const b = p.body, [cx, cz] = world.phys.pushCircle(b.pos.x, b.pos.z, 0.36, b.vel.x, b.vel.z, b.pos.y + 0.05, b.pos.y + b.height, 1);
    b.pos.x += cx; b.pos.z += cz;
    for (const z of world.zombies) if (z.alive) {
      const vx = z.pos.x - (z.px ?? z.pos.x), vz = z.pos.z - (z.pz ?? z.pos.z); z.px = z.pos.x; z.pz = z.pos.z;
      const [zx, zz] = world.phys.pushCircle(z.pos.x, z.pos.z, z.crawl ? 0.3 : 0.32, vx / TICK, vz / TICK, z.pos.y + 0.05, z.pos.y + (z.crawl ? 0.4 : 1.6), 1.2);
      z.pos.x += zx * 0.5; z.pos.z += zz * 0.5; // zombies lean through clutter: they mostly win
    }
    world.phys.step(TICK);
    for (const bm of world.phys.bumps) { ev.push({ type: 'propBump', ...bm, surface: SURF_INDEX[PHYS_KINDS[bm.kind].surface] }); if (bm.power > 0.5) noise(world, { x: bm.point[0], z: bm.point[2] }, RU.props.noise * bm.power, 'clatter'); }
    for (const k of world.pickups) if (k.phys) { const q = k.phys.body.position; k.pos[0] = q.x; k.pos[1] = q.y - k.phys.half[1]; k.pos[2] = q.z; }
  }
  // keep the player out of zombie bodies
  for (const z of world.zombies) if (z.alive) {
    const dx = p.body.pos.x - z.pos.x, dz = p.body.pos.z - z.pos.z, d = Math.hypot(dx, dz), min = z.crawl ? 0.5 : 0.65;
    if (d > 0.001 && d < min) { p.body.pos.x += dx / d * (min - d); p.body.pos.z += dz / d * (min - d); }
  }
  world.time += TICK; world.tick++;
  return ev;
}

function stepPlayerSurvival(world, inp, ev) {
  const p = world.player, RU = world.rules, body = p.body;
  // weapon slot switching: 0 fists, 1 pipe, 2 pistol
  if (inp.slot !== null && inp.slot !== undefined && !p.action) {
    const want = ['fists', 'pipe', 'pistol'][inp.slot];
    if (want && want !== p.slot && (want === 'fists' || p[want])) { p.slot = want; ev.push({ type: 'slot', slot: want }); }
  }
  const aimK = p.slot === 'pistol' && p.pistol ? p.pistol.ads : 0;
  const PP = { ...world.P, walkSpeed: world.P.walkSpeed * (1 - 0.35 * aimK) };
  const busy = p.action && p.action.kind === 'heal';
  const cmd = { moveX: inp.moveX, moveZ: inp.moveZ, yaw: inp.yaw, pitch: inp.pitch, jump: inp.jump && !busy, crouch: inp.crouch, sprint: inp.sprint && !inp.aim && !busy };
  if (busy) { cmd.moveX *= 0.4; cmd.moveZ *= 0.4; }
  const wasX = body.pos.x, wasZ = body.pos.z;
  stepPlayer(body, cmd, PP, world.collider.bvh, TICK);
  p.yaw = inp.yaw; p.pitch = inp.pitch;

  // footsteps: surface + noise every ~0.6 m (sprinting is loud, crouching silent, water splashes)
  const moved = Math.hypot(body.pos.x - wasX, body.pos.z - wasZ);
  p.stepAcc += moved;
  const stride = body.sprinting ? 0.85 : 0.65;
  if (body.onGround && p.stepAcc > stride) {
    p.stepAcc = 0;
    const inWater = body.pos.y < -0.1, crouched = body.height < world.P.standHeight - 0.3;
    const r = crouched ? RU.noise.crouch : (body.sprinting ? RU.noise.sprint : RU.noise.walk) * (inWater ? RU.noise.water : 1);
    noise(world, body.pos, r, 'footsteps');
    ev.push({ type: 'step', surface: inWater ? 'water' : world.def.map[Math.floor(body.pos.z / world.def.cell)]?.[Math.floor(body.pos.x / world.def.cell)] === 'v' ? 'metal' : 'concrete', sprint: !!body.sprinting, crouch: crouched });
  }

  // pickups (use) and triggers
  if (inp.use) { const best = lookTarget(world).pickup; if (best) take(world, best, ev); }
  const cellC = Math.floor(body.pos.x / world.def.cell), cellR = Math.floor(body.pos.z / world.def.cell);
  for (const t of world.def.triggers || []) {
    if (world.triggers.has(t.id)) continue;
    const [c0, r0, c1, r1] = t.cells;
    if (cellC >= c0 && cellC <= c1 && cellR >= r0 && cellR <= r1) {
      world.triggers.add(t.id); ev.push({ type: 'trigger', id: t.id });
      if (t.kind === 'exit') { p.escaped = true; ev.push({ type: 'escaped', time: world.time }); }
    }
  }

  // bandage
  p.kickCd -= TICK; p.throwCd -= TICK;
  if (p.action) {
    p.action.t += TICK;
    const a = p.action;
    if (a.kind === 'heal' && a.t >= RU.player.bandageTime) { p.hp = Math.min(p.maxHp, p.hp + RU.player.bandageHeal); p.action = null; ev.push({ type: 'healed', hp: p.hp }); }
    else if ((a.kind === 'melee' || a.kind === 'kick') && !a.done && a.t >= a.windup) { a.done = true; resolveMelee(world, a, ev); }
    if (p.action && a.kind !== 'heal' && a.t >= a.windup + a.recover) p.action = null;
  }
  if (inp.heal && !p.action && p.bandages > 0 && p.hp < p.maxHp) { p.bandages--; p.action = { kind: 'heal', t: 0 }; ev.push({ type: 'healStart' }); }

  // kick: pushes everything in front back and staggers it
  if (inp.kick && !p.action && p.kickCd <= 0) {
    p.kickCd = RU.kick.cooldown; p.action = { kind: 'kick', t: 0, windup: RU.kick.windup, recover: 0.3 };
    ev.push({ type: 'kick' });
  }
  // throw
  if (inp.throwKind && !p.action && p.throwCd <= 0) {
    const key = inp.throwKind === 'brick' ? 'bricks' : 'bottles';
    if (p[key] > 0) {
      p[key]--; const T = RU.throw[inp.throwKind]; p.throwCd = T.cooldown;
      const dir = viewDir(p); dir.y += 0.12; dir.normalize();
      const o = eye(p).addScaledVector(dir, 0.4);
      world.thrown.push({ id: world.nextId++, kind: inp.throwKind, pos: o, vel: dir.multiplyScalar(T.speed).add(new THREE.Vector3(body.vel.x, 0, body.vel.z).multiplyScalar(0.5)), life: 4, spin: (world.rand() - 0.5) * 20 });
      ev.push({ type: 'throw', kind: inp.throwKind });
    }
  }

  // weapons
  if (p.slot === 'pistol' && p.pistol) {
    const g = p.pistol, S = world.pistolStats, before = g.ammo;
    const wantReload = inp.reload && p.reserve > 0 && g.ammo < S.magSize;
    const res = stepGun(g, S, { trigger: inp.attack && !p.action, ads: inp.aim && !body.sprinting, reload: wantReload }, { speed: Math.hypot(body.vel.x, body.vel.z), onGround: body.onGround }, TICK);
    if (res.event === 'reloadStart' && p.reserve <= 0) { g.reloadT = 0; g.ammo = before; } // nothing to load
    else if (res.event === 'reloadStart') { g.reloadFrom = before; ev.push({ type: 'reloadStart' }); }
    if (res.event === 'reloadDone') { const take = Math.min(p.reserve, S.magSize - (g.reloadFrom ?? 0)); g.ammo = (g.reloadFrom ?? 0) + take; p.reserve -= take; ev.push({ type: 'reloadDone', ammo: g.ammo, reserve: p.reserve }); }
    if (res.event === 'dry') ev.push({ type: 'dry' });
    if (res.shots.length) {
      world.stats.shots++;
      const o = eye(p); noise(world, o, RU.noise.gunshot, 'gunshot');
      const shot = { type: 'shot', origin: arr(o), recoil: res.recoil, ends: [] }; ev.push(shot);
      for (const s of res.shots) {
        const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(inp.pitch + s.pitch, inp.yaw + s.yaw, 0, 'YXZ'));
        const w = castWorld(world, o, dir, 150), ph = world.phys.raycast(arr(o), arr(dir), w ? w.dist : 150), zh = castZombies(world, o, dir, ph ? ph.dist : w ? w.dist : 150);
        if (ph && !zh) { world.phys.blast(ph.point, arr(dir), RU.props.bulletImpulse, 0.1, x => x === ph.obj); ev.push({ type: 'impact', point: ph.point, normal: ph.normal, surface: SURF_INDEX[PHYS_KINDS[ph.obj.kind].surface], dir: arr(dir), prop: ph.obj.id }); shot.ends.push(ph.point); }
        else if (zh) { world.stats.hits++; const dmg = damageAt(S, zh.dist, zh.box.zone) * (zh.box.zone === 'head' ? 1.0 : 1); damageZombie(world, ev, zh.z, zh.limb, zh.box.zone, dmg, { dir, point: zh.point, stagger: 0.35, source: 'bullet' }); shot.ends.push(arr(zh.point)); }
        else if (w) { ev.push({ type: 'impact', point: arr(w.point), normal: arr(w.normal), surface: w.surface, dir: arr(dir) }); shot.ends.push(arr(w.point)); }
        else shot.ends.push(arr(o.clone().addScaledVector(dir, 150)));
      }
    }
  } else if (inp.attack && !p.action && (p.slot === 'fists' || p.slot === 'pipe')) {
    const M = RU.melee[p.slot];
    p.action = { kind: 'melee', weapon: p.slot, t: 0, windup: M.windup, recover: M.recover };
    ev.push({ type: 'swing', weapon: p.slot });
  }
}

function take(world, k, ev) {
  const p = world.player, cap = world.rules.player.carry;
  const add = (key, n, max) => { if (p[key] >= max) return false; p[key] = Math.min(max, p[key] + n); return true; };
  let ok = true;
  switch (k.kind) {
    case 'pipe': if (p.pipe && p.pipe.durability >= world.rules.melee.pipe.durability) ok = false; else { p.pipe = { durability: world.rules.melee.pipe.durability }; p.slot = 'pipe'; } break;
    case 'pistol': if (p.pistol) { p.reserve += world.rules.pistol.magStart; } else { p.pistol = makeGunState(world.pistolStats); p.pistol.ammo = world.rules.pistol.magStart; p.slot = 'pistol'; } break;
    case 'ammo': p.reserve += world.rules.pistol.ammoPickup; break;
    case 'brick': ok = add('bricks', 1, cap.brick); break;
    case 'bottle': ok = add('bottles', 1, cap.bottle); break;
    case 'bandage': ok = add('bandages', 1, cap.bandage); break;
  }
  if (ok) { k.taken = true; if (k.phys) { world.phys.remove(k.phys); k.phys = null; } ev.push({ type: 'pickup', id: k.id, kind: k.kind, slot: p.slot }); }
  else ev.push({ type: 'pickupFull', kind: k.kind });
}

function resolveMelee(world, a, ev) {
  const p = world.player, RU = world.rules, o = eye(p), dir = viewDir(p);
  if (a.kind === 'kick') {
    const K = RU.kick; let hitAny = false;
    const fwd = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    for (const z of world.zombies) {
      if (!z.alive) continue;
      const dx = z.pos.x - p.body.pos.x, dz = z.pos.z - p.body.pos.z, d = Math.hypot(dx, dz);
      if (d > K.range || (dx * fwd.x + dz * fwd.z) / Math.max(d, 1e-3) < Math.cos(K.cone)) continue;
      hitAny = true;
      z.knock = { vx: fwd.x * K.push / 0.25, vz: fwd.z * K.push / 0.25, t: 0.25 };
      damageZombie(world, ev, z, 'torso', 'body', K.damage, { dir: fwd, point: new THREE.Vector3(z.pos.x, z.pos.y + 1.0, z.pos.z), blunt: true, stagger: K.stagger, source: 'kick' });
    }
    const foot = [p.body.pos.x + fwd.x * 0.85, p.body.pos.y + 0.45, p.body.pos.z + fwd.z * 0.85];
    const knocked = world.phys.blast(foot, [fwd.x, 0.15, fwd.z], K.propImpulse, 0.75);
    for (const o of knocked) ev.push({ type: 'propHit', id: o.id, kind: o.kind, point: [o.body.position.x, o.body.position.y, o.body.position.z], surface: SURF_INDEX[PHYS_KINDS[o.kind].surface], power: o.heavy ? 1 : 0.4, source: 'kick' });
    if (knocked.length) hitAny = true;
    noise(world, p.body.pos, hitAny ? K.noise : 0, 'melee');
    ev.push({ type: 'kickResolve', hit: hitAny });
    return;
  }
  const M = RU.melee[a.weapon];
  // the swing connects with whatever the view ray finds within reach; a near miss still clips a body in front
  let zh = castZombies(world, o, dir, M.range);
  if (!zh) for (const z of world.zombies) {
    if (!z.alive) continue;
    const c = new THREE.Vector3(z.pos.x, z.pos.y + (z.crawl ? 0.3 : 1.2), z.pos.z), to = c.clone().sub(o), d = to.length();
    if (d < M.range + 0.25 && to.normalize().dot(dir) > 0.8) { zh = { z, box: { part: 'torso', zone: 'body', x: 0 }, limb: 'torso', point: c, dist: d }; break; }
  }
  const w = castWorld(world, o, dir, M.range), ph = world.phys.raycast(arr(o), arr(dir), M.range);
  if (ph && (!w || ph.dist < w.dist) && (!zh || ph.dist < zh.dist - 0.05)) {
    world.phys.blast(ph.point, arr(dir), a.weapon === 'pipe' ? RU.props.pipeImpulse : RU.props.fistImpulse, 0.15, x => x === ph.obj);
    ev.push({ type: 'propHit', id: ph.obj.id, kind: ph.obj.kind, point: ph.point, normal: ph.normal, surface: SURF_INDEX[PHYS_KINDS[ph.obj.kind].surface], power: a.weapon === 'pipe' ? 0.8 : 0.4, source: a.weapon });
    noise(world, new THREE.Vector3(...ph.point), RU.props.noise, 'melee'); wear(world, a.weapon, 0.5, ev);
  } else if (zh && (!w || zh.dist <= w.dist + 0.1)) {
    const mult = zh.box.zone === 'head' ? 1.5 : zh.box.zone === 'limb' ? 0.9 : 1;
    damageZombie(world, ev, zh.z, zh.limb, zh.box.zone, M.damage * mult, { dir, point: zh.point, blunt: true, stagger: M.stagger, source: a.weapon });
    noise(world, zh.point, M.noise, 'melee');
    wear(world, a.weapon, 1, ev);
  } else if (w) {
    ev.push({ type: 'meleeWall', weapon: a.weapon, point: arr(w.point), normal: arr(w.normal), surface: w.surface });
    noise(world, w.point, M.noise, 'melee');
    wear(world, a.weapon, 0.5, ev);
  } else ev.push({ type: 'whiff', weapon: a.weapon });
}
function wear(world, weapon, amount, ev) {
  const p = world.player;
  if (weapon !== 'pipe' || !p.pipe) return;
  p.pipe.durability -= amount;
  if (p.pipe.durability <= 0) { p.pipe = null; p.slot = 'fists'; ev.push({ type: 'broke', weapon: 'pipe' }); }
}

function stepThrown(world, ev) {
  for (let i = world.thrown.length - 1; i >= 0; i--) {
    const t = world.thrown[i], T = world.rules.throw[t.kind], start = t.pos.clone();
    t.vel.y -= 9.81 * TICK; t.pos.addScaledVector(t.vel, TICK); t.life -= TICK;
    const seg = t.pos.clone().sub(start), len = seg.length(); seg.normalize();
    const w = castWorld(world, start, seg, len), zh = castZombies(world, start, seg, w ? w.dist : len), ph = world.phys.raycast(arr(start), arr(seg), w ? w.dist : len);
    if (ph && (!zh || ph.dist < zh.dist)) {
      world.phys.blast(ph.point, arr(seg), RU.props.brickImpulse * (t.kind === 'bottle' ? 0.4 : 1), 0.1, x => x === ph.obj);
      ev.push({ type: 'propHit', id: ph.obj.id, kind: ph.obj.kind, point: ph.point, surface: SURF_INDEX[PHYS_KINDS[ph.obj.kind].surface], power: 0.6, source: t.kind });
      landThrown(world, t, new THREE.Vector3(...ph.point), new THREE.Vector3(...ph.normal), ev, false); world.thrown.splice(i, 1); continue;
    }
    if (zh) {
      damageZombie(world, ev, zh.z, zh.limb, zh.box.zone, T.damage * (zh.box.zone === 'head' ? 1.4 : 1), { dir: seg, point: zh.point, blunt: true, stagger: T.stagger, source: t.kind });
      landThrown(world, t, zh.point, new THREE.Vector3(0, 1, 0), ev, true); world.thrown.splice(i, 1); continue;
    }
    if (w || t.life <= 0) { landThrown(world, t, w ? w.point : t.pos, w ? w.normal : new THREE.Vector3(0, 1, 0), ev, false); world.thrown.splice(i, 1); continue; }
    ev.push({ type: 'thrownMove', id: t.id, kind: t.kind, pos: arr(t.pos), spin: t.spin });
  }
}
function landThrown(world, t, point, normal, ev, hitZombie) {
  const T = world.rules.throw[t.kind];
  noise(world, point, T.noise, t.kind); // a thrown object is a distraction: zombies go to the sound
  if (t.kind === 'bottle') ev.push({ type: 'shatter', id: t.id, point: arr(point), normal: arr(normal) });
  else {
    // bricks can be picked up again where they land
    const y = groundY(world, point.x, point.z, point.y + 0.3);
    const k = { id: world.nextId++, kind: 'brick', pos: [point.x + normal.x * 0.15, Math.max(y, point.y + normal.y * 0.1), point.z + normal.z * 0.15], taken: false };
    k.phys = world.phys.add('brick', [k.pos[0], k.pos[1], k.pos[2]], { yaw: world.rand() * 6, vel: [t.vel.x * 0.25 + normal.x, Math.abs(t.vel.y) * 0.15 + 1, t.vel.z * 0.25 + normal.z], ref: k });
    world.pickups.push(k);
    ev.push({ type: 'thud', id: t.id, point: arr(point), pickup: k, hitZombie });
  }
}

// ---------------------------------------------------------------- zombie brain
function setZState(z, s) { if (z.state !== s) { z.state = s; z.stateT = 0; z.path = []; z.pathT = 0; } }
function turnTo(z, target, rate) { let d = target - z.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; z.yaw += Math.max(-rate, Math.min(rate, d)); }
function freeAt(world, x, z) { const N = world.nav, c = Math.floor((x - N.x0) / N.cell), r = Math.floor((z - N.z0) / N.cell); return c >= 0 && r >= 0 && c < N.cols && r < N.rows && !N.blocked[r * N.cols + c]; }
function moveTo(world, z, tx, tz, speed, dt) {
  z.pathT -= dt;
  const goal = z.pathGoal;
  if (!z.path.length || z.pathT <= 0 || !goal || Math.hypot(goal[0] - tx, goal[1] - tz) > 1.0) { z.path = findPath(world.nav, z.pos.x, z.pos.z, tx, tz); z.pathGoal = [tx, tz]; z.pathT = 0.6; }
  if (!z.path.length) return true;
  const [wx, wz] = z.path[0], dx = wx - z.pos.x, dz = wz - z.pos.z, d = Math.hypot(dx, dz), step = speed * dt;
  turnTo(z, Math.atan2(dx, dz), world.rules.zombie.turn * dt);
  if (d <= step) { z.pos.x = wx; z.pos.z = wz; z.path.shift(); } else { z.pos.x += dx / d * step; z.pos.z += dz / d * step; }
  return !z.path.length;
}
function stepZombie(world, z, ev, dt, playerLight) {
  const Z = world.rules.zombie, p = world.player, pp = p.body.pos;
  z.stateT += dt; z.cooldown -= dt;
  const ox = z.pos.x, oz = z.pos.z;
  // knockback and stagger take priority over thinking
  if (z.knock) {
    const nx = z.pos.x + z.knock.vx * dt, nz = z.pos.z + z.knock.vz * dt;
    if (freeAt(world, nx, nz)) { z.pos.x = nx; z.pos.z = nz; }
    z.knock.t -= dt; if (z.knock.t <= 0) z.knock = null;
  }
  if (z.staggerT > 0) { z.staggerT -= dt; finishMove(world, z, ox, oz, dt); return; }

  // perception: short sight in the dark (longer if your light is on), hearing by noise radius
  const zEye = new THREE.Vector3(z.pos.x, z.pos.y + (z.crawl ? 0.4 : 1.55), z.pos.z), pChest = new THREE.Vector3(pp.x, pp.y + p.body.height * 0.7, pp.z);
  const dx = pp.x - z.pos.x, dz = pp.z - z.pos.z, d = Math.hypot(dx, dz);
  let ang = Math.atan2(dx, dz) - z.yaw; while (ang > Math.PI) ang -= 2 * Math.PI; while (ang < -Math.PI) ang += 2 * Math.PI;
  const range = playerLight ? Z.sightLit : Z.sight;
  const seeing = p.alive && !p.escaped && d < range && (Math.abs(ang) < Z.fov * Math.PI / 360 || d < 2.2) && los(world, zEye, pChest);
  if (seeing) { z.awareness = Math.min(1, z.awareness + dt * Z.awareRate * (1.4 - d / range)); if (z.awareness >= 1) { z.lastSeen = world.time; z.target = [pp.x, pp.y, pp.z]; } }
  else z.awareness = Math.max(z.state === 'chase' ? 0.5 : 0, z.awareness - dt * 0.2);
  if (!seeing || z.awareness < 1) for (const n of world.noises) {
    if (Math.hypot(n.x - z.pos.x, n.z - z.pos.z) > n.r) continue;
    if (z.state === 'idle' || z.state === 'search' || z.state === 'investigate') { z.target = [n.x, 0, n.z]; setZState(z, n.kind === 'gunshot' ? 'chase' : 'investigate'); if (n.kind === 'gunshot') z.lastSeen = world.time; }
  }
  if (seeing && z.awareness >= 1 && z.state !== 'chase' && z.state !== 'attack') { setZState(z, 'chase'); ev.push({ type: 'zalert', zombie: z.id }); }

  // groans: occasional, more often when hunting
  z.groanT -= dt; if (z.groanT <= 0) { z.groanT = (z.state === 'chase' ? 1.5 : 4) + world.rand() * 5; ev.push({ type: 'groan', zombie: z.id, pos: [z.pos.x, z.pos.y + 1.5, z.pos.z], angry: z.state === 'chase' || z.state === 'attack' }); }

  const speed = z.crawl ? Z.crawl : null;
  switch (z.state) {
    case 'idle': {
      z.wanderT -= dt;
      if (z.wanderT <= 0) { z.wanderT = 3 + world.rand() * 6; const a = world.rand() * Math.PI * 2; z.target = [z.pos.x + Math.cos(a) * 3, 0, z.pos.z + Math.sin(a) * 3]; }
      if (z.target && !moveTo(world, z, z.target[0], z.target[2], speed ?? Z.walk * 0.6, dt)) {} else z.target = null;
      break;
    }
    case 'investigate': {
      if (!z.target || moveTo(world, z, z.target[0], z.target[2], speed ?? Z.walk * 1.4, dt)) { if (z.stateT > 4) setZState(z, 'search'); }
      break;
    }
    case 'chase': {
      if (!z.target) { setZState(z, 'search'); break; }
      const reach = z.crawl ? 1.1 : Z.attackRange;
      if (seeing && d < reach && p.alive) { setZState(z, 'attack'); z.attackT = 0; break; }
      moveTo(world, z, z.target[0], z.target[2], speed ?? Z.run, dt);
      if (!seeing && world.time - z.lastSeen > Z.loseTime) { setZState(z, 'search'); ev.push({ type: 'zlost', zombie: z.id }); }
      break;
    }
    case 'attack': {
      turnTo(z, Math.atan2(dx, dz), Z.turn * dt);
      if (z.cooldown > 0) { if (d > Z.attackReach) setZState(z, 'chase'); break; }
      if (z.attackT === 0) ev.push({ type: 'zwindup', zombie: z.id });
      z.attackT += dt;
      if (z.attackT >= Z.windup) {
        z.attackT = 0; z.cooldown = Z.cooldown;
        const facing = Math.abs(ang) < 1.1, reach = z.crawl ? 1.4 : Z.attackReach;
        if (p.alive && !p.escaped && d < reach && facing) {
          const armsLeft = (z.lost.armL ? 0 : 1) + (z.lost.armR ? 0 : 1);
          const dmg = z.crawl ? Z.crawlerDamage : Z.damage * (armsLeft === 2 ? 1 : armsLeft === 1 ? 0.75 : 0.55);
          p.hp -= dmg; world.stats.damageTaken += dmg; p.action = p.action && p.action.kind === 'heal' ? null : p.action; // a hit interrupts bandaging
          ev.push({ type: 'hurt', zombie: z.id, dmg, hp: Math.max(0, p.hp), from: [z.pos.x, z.pos.y, z.pos.z] });
          if (p.hp <= 0) { p.hp = 0; p.alive = false; ev.push({ type: 'died', time: world.time }); }
        } else ev.push({ type: 'zmiss', zombie: z.id });
        if (d > reach) setZState(z, 'chase');
      }
      break;
    }
    case 'search': {
      if (!z.searchPts || z.stateT < dt * 1.5) { const c = z.target || [z.pos.x, 0, z.pos.z]; z.searchPts = [c, [c[0] + (world.rand() - 0.5) * 8, 0, c[2] + (world.rand() - 0.5) * 8]]; }
      if (z.searchPts.length) { const t = z.searchPts[0]; if (moveTo(world, z, t[0], t[2], speed ?? Z.walk, dt)) z.searchPts.shift(); }
      if (z.stateT > Z.searchTime) { z.target = null; z.awareness = 0; setZState(z, 'idle'); }
      break;
    }
  }
  // separation
  for (const o of world.zombies) if (o !== z && o.alive) { const ex = z.pos.x - o.pos.x, ez = z.pos.z - o.pos.z, e = Math.hypot(ex, ez); if (e > 0 && e < 0.7) { const nx = z.pos.x + ex / e * (0.7 - e) * 0.5, nz = z.pos.z + ez / e * (0.7 - e) * 0.5; if (freeAt(world, nx, nz)) { z.pos.x = nx; z.pos.z = nz; } } }
  finishMove(world, z, ox, oz, dt);
}
function finishMove(world, z, ox, oz, dt) {
  z.speed = Math.hypot(z.pos.x - ox, z.pos.z - oz) / dt;
  if (z.speed > 0.01) z.pos.y = groundY(world, z.pos.x, z.pos.z, z.pos.y + 1);
}
