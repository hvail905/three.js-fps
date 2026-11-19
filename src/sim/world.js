// world.js : the game simulation. One fixed tick advances players, weapons, projectiles and actors,
// and returns the events that happened during that tick ("shot", "hit", "impact", "killed", ...).
// Rendering, audio and HUD only react to those events; nothing here touches the DOM or a renderer.
// That split is what lets a co-op host run this same code and send events to clients.
//
// Collision comes from the level: { bvh (three-mesh-bvh), triSurface (Uint8Array) }.
//   collider: what bodies stand on and bump into (props as boxes).
//   shotCollider: what bullets and line of sight hit (exact prop shapes). Defaults to collider.
import * as THREE from 'three';
import { TICK, DEFAULT_PARAMS, makeCommand, makePlayer, stepPlayer } from './movement.js';
import { makeGunState, stepGun, damageAt } from './gun.js';
import { makeWorld as makeAIWorld, stepAgents, onAgentHit, killAgent, addNoise, DEFAULT_AI, AI_TICK } from './ai.js';

export { TICK };
export const MAX_RANGE = 400;
// Player health: regenerates after a few seconds without taking damage.
export const PLAYER_RULES = { maxHp: 100, regenDelay: 4, regenRate: 14 };

// Humanoid hitboxes as spheres, in meters for a 1.8 m person, in the character's local frame
// (feet at the origin, facing +Z like the character library; rotated by the actor's yaw).
// zone: damage class used by the gun (head | body | limb). part: what reacts visually (head | torso | arm | leg).
export const HUMANOID_HITBOXES = [
  { part: 'head', zone: 'head', x: 0, y: 1.66, r: 0.13 },
  { part: 'torso', zone: 'body', x: 0, y: 1.37, r: 0.21 },
  { part: 'torso', zone: 'body', x: 0, y: 1.1, r: 0.2 },
  { part: 'arm', zone: 'limb', x: 0.27, y: 1.28, r: 0.09 },
  { part: 'arm', zone: 'limb', x: -0.27, y: 1.28, r: 0.09 },
  { part: 'arm', zone: 'limb', x: 0.3, y: 1.02, r: 0.08 },
  { part: 'arm', zone: 'limb', x: -0.3, y: 1.02, r: 0.08 },
  { part: 'leg', zone: 'limb', x: 0.11, y: 0.74, r: 0.14 },
  { part: 'leg', zone: 'limb', x: -0.11, y: 0.74, r: 0.14 },
  { part: 'leg', zone: 'limb', x: 0.11, y: 0.3, r: 0.12 },
  { part: 'leg', zone: 'limb', x: -0.11, y: 0.3, r: 0.12 },
];

export function makeInput() {
  return { ...makeCommand(), trigger: false, ads: false, reload: false, weapon: null };
}

// weapons: { id: statsObject } from data/weapons. loadout: weapon ids in slot order.
export function makeWorld({ collider, shotCollider = collider, moveParams = DEFAULT_PARAMS, weapons, loadout }) {
  return { time: 0, tick: 0, collider, shotCollider, P: { ...moveParams }, weapons, loadout: [...loadout], players: [], actors: [], projectiles: [], nextId: 1, cleared: false, lost: false, ai: null, stats: { shots: 0, bullets: 0, hits: 0, kills: 0, heads: 0, damageTaken: 0 } };
}

export function addPlayer(world, { pos, yaw = 0 }) {
  const p = {
    id: world.nextId++, body: makePlayer(new THREE.Vector3(...pos)), hp: PLAYER_RULES.maxHp, maxHp: PLAYER_RULES.maxHp, alive: true, lastHurt: -99, yaw, pitch: 0,
    slot: 0, guns: Object.fromEntries(world.loadout.map(id => [id, makeGunState(world.weapons[id])])),
  };
  p.body.yaw = yaw;
  world.players.push(p);
  return p;
}

// A damageable humanoid. Brains come later (src/sim/ai.js); for now actors stand where they spawn.
export function addActor(world, { pos, yaw = 0, hp = 100, height = 1.8, team = 'enemy', kind = 'dummy' }) {
  const a = { id: world.nextId++, kind, team, pos: new THREE.Vector3(...pos), yaw, hp, maxHp: hp, height, alive: true, crouch: false, speed: 0, state: 'idle', agent: null };
  world.actors.push(a);
  return a;
}

export const currentWeapon = (world, p) => world.loadout[p.slot];
export const eyePosition = (p, out = new THREE.Vector3()) => out.set(p.body.pos.x, p.body.pos.y + p.body.height - 0.12, p.body.pos.z);

const _ray = new THREE.Ray(), _v = new THREE.Vector3(), _c = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const arr = v => [v.x, v.y, v.z];

// Nearest actor hitbox along a ray, within maxDist. Returns { actor, box, dist, point } or null.
function castActors(world, origin, dir, maxDist) {
  let best = null;
  for (const a of world.actors) {
    if (!a.alive) continue;
    const k = a.height / 1.8, ky = k * (a.crouch ? 0.62 : 1), cy = Math.cos(a.yaw), sy = Math.sin(a.yaw);
    // broad phase: a bounding sphere around the whole body
    _c.set(a.pos.x, a.pos.y + a.height * 0.5, a.pos.z);
    const bt = raySphere(origin, dir, _c, a.height * 0.6); if (bt === null || bt > maxDist) continue;
    for (const b of HUMANOID_HITBOXES) {
      const lx = b.x * k; // rotate the local offset by the actor's yaw
      _c.set(a.pos.x + lx * cy, a.pos.y + b.y * ky, a.pos.z - lx * sy);
      const t = raySphere(origin, dir, _c, b.r * k);
      if (t !== null && t <= maxDist && (!best || t < best.dist)) best = { actor: a, box: b, dist: t };
    }
  }
  if (best) best.point = origin.clone().addScaledVector(dir, best.dist);
  return best;
}
function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r, disc = b * b - cc;
  if (disc < 0) return null;
  const s = Math.sqrt(disc), t0 = -b - s, t1 = -b + s;
  return t0 >= 0 ? t0 : t1 >= 0 ? 0 : null;
}
function castWorld(world, origin, dir, maxDist) {
  _ray.origin.copy(origin); _ray.direction.copy(dir);
  const h = world.shotCollider.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, maxDist);
  if (!h) return null;
  const n = h.face ? h.face.normal.clone() : new THREE.Vector3(0, 1, 0);
  if (n.dot(dir) > 0) n.negate();
  return { dist: h.distance, point: h.point.clone(), normal: n, surface: world.shotCollider.triSurface[h.faceIndex] ?? 0 };
}

// Resolve one bullet path segment: hits the nearest of world geometry and actor hitboxes.
function resolveSegment(world, ev, shooter, S, origin, dir, maxDist, travelled) {
  const w = castWorld(world, origin, dir, maxDist);
  const a = castActors(world, origin, dir, w ? w.dist : maxDist);
  if (a) {
    const actor = a.actor, dist = travelled + a.dist;
    const dmg = damageAt(S, dist, a.box.zone);
    actor.hp -= dmg; world.stats.hits++; if (a.box.zone === 'head') world.stats.heads++;
    // bullet direction in the actor's own frame (x right, z back), for directional reactions
    const cy = Math.cos(actor.yaw), sy = Math.sin(actor.yaw);
    const local = [dir.x * cy - dir.z * sy, dir.x * sy + dir.z * cy];
    const killed = actor.hp <= 0;
    ev.push({ type: 'hit', by: shooter.id, actor: actor.id, zone: a.box.zone, part: a.box.part, side: Math.sign(a.box.x) || 1, dmg, dist, point: arr(a.point), dir: arr(dir), local, killed });
    if (actor.agent && world.ai) onAgentHit(world.ai.W, actor.agent, origin.x - dir.x * travelled, origin.z - dir.z * travelled);
    if (killed) {
      actor.hp = 0; actor.alive = false; world.stats.kills++;
      if (actor.agent && world.ai) killAgent(world.ai.W, actor.agent);
      ev.push({ type: 'killed', by: shooter.id, actor: actor.id, zone: a.box.zone, part: a.box.part, local });
    }
    return { end: a.point, hit: true };
  }
  if (w) { ev.push({ type: 'impact', by: shooter.id, point: arr(w.point), normal: arr(w.normal), surface: w.surface, dir: arr(dir) }); return { end: w.point, hit: true }; }
  return { end: origin.clone().addScaledVector(dir, maxDist), hit: false };
}

// ---------------------------------------------------------------- enemy AI
// Turns every enemy actor into an agent driven by src/sim/ai.js, on a nav grid rasterized from the
// level collider (cells where a 0.4 m capsule would hit geometry between 0.4 m and 1.7 m are blocked),
// with line of sight cast against the same collider. bounds: { x0, z0, width, depth } in meters.
export function enableAI(world, { bounds, patrol = [], params = {}, seed = 1 }) {
  // walking uses the movement collider; seeing uses the bullet collider, so sight matches where shots go
  const bvh = world.collider.bvh, sight = world.shotCollider.bvh, box = new THREE.Box3(), ident = new THREE.Matrix4(), ray = new THREE.Ray(), d = new THREE.Vector3();
  const blockedFn = (x, z, R) => { box.min.set(x - R, 0.4, z - R); box.max.set(x + R, 1.7, z + R); return bvh.intersectsBox(box, ident); };
  const losFn = (ax, az, ah, bx, bz, bh) => {
    d.set(bx - ax, bh - ah, bz - az); const len = d.length(); if (len < 0.05) return true;
    ray.origin.set(ax, ah, az); ray.direction.copy(d).multiplyScalar(1 / len);
    return !sight.raycastFirst(ray, THREE.DoubleSide, 0, len - 0.05);
  };
  const enemies = world.actors.filter(a => a.team === 'enemy');
  const W = makeAIWorld({ width: bounds.width, depth: bounds.depth, x0: bounds.x0, z0: bounds.z0, cell: 0.5, spawns: enemies.map(a => [a.pos.x, a.pos.z, a.yaw]), patrol, seed, blockedFn, losFn });
  W.player = { x: 0, z: 0, vx: 0, vz: 0, crouch: false, hp: 100, alive: true, moving: false, running: false };
  enemies.forEach((a, i) => { a.agent = W.agents[i]; a.agent.actor = a.id; });
  world.ai = { W, P: { ...DEFAULT_AI, ...params }, acc: 0, enemies };
  return world.ai;
}
const _down = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
function groundAt(world, x, z, fallback) {
  _down.origin.set(x, 2.5, z);
  const h = world.collider.bvh.raycastFirst(_down, THREE.DoubleSide, 0, 4);
  return h ? h.point.y : fallback;
}
function stepAI(world, ev) {
  const A = world.ai, W = A.W, p = world.players[0];
  A.acc += TICK;
  while (A.acc >= AI_TICK - 1e-9) {
    A.acc -= AI_TICK;
    // the agents chase the (first) player; co-op would pick the nearest or most threatening one
    if (p) {
      const pl = W.player, hs = Math.hypot(p.body.vel.x, p.body.vel.z);
      pl.x = p.body.pos.x; pl.z = p.body.pos.z; pl.alive = p.alive; pl.hp = p.hp;
      pl.crouch = p.body.height < world.P.standHeight - 0.3; pl.moving = hs > 0.5; pl.running = !!p.body.sprinting;
    }
    W.t += AI_TICK;
    const hpBefore = W.player.hp;
    stepAgents(W, A.P, AI_TICK);
    for (const s of W.shots) {
      if (s.t !== W.t || s.by === 'player') continue;
      const actor = A.enemies[s.by]; if (!actor || !actor.alive) continue;
      const fy = actor.pos.y + (actor.crouch ? 0.95 : 1.42) * actor.height / 1.8;
      const from = new THREE.Vector3(actor.pos.x, fy, actor.pos.z), to = s.hit && p ? eyePosition(p).add(new THREE.Vector3(0, -0.35, 0)) : new THREE.Vector3(s.to[0], 1.1, s.to[1]);
      const dir = to.clone().sub(from).normalize(); from.addScaledVector(dir, 0.5);
      const e = { type: 'enemyShot', actor: actor.id, from: arr(from), to: arr(to), hit: !!s.hit };
      if (!s.hit) { const w = castWorld(world, from, dir, 80); if (w) { e.to = arr(w.point); e.normal = arr(w.normal); e.surface = w.surface; } else e.to = arr(from.clone().addScaledVector(dir, 80)); }
      ev.push(e);
    }
    const dmg = hpBefore - W.player.hp;
    if (p && p.alive && dmg > 0) {
      p.hp = Math.max(0, p.hp - dmg); p.lastHurt = world.time; world.stats.damageTaken += dmg;
      const src = W.shots.filter(s => s.t === W.t && s.hit).map(s => A.enemies[s.by]).find(Boolean);
      ev.push({ type: 'playerHurt', player: p.id, dmg, hp: p.hp, from: src ? arr(src.pos) : null });
      if (p.hp <= 0) { p.alive = false; world.lost = true; ev.push({ type: 'playerDied', player: p.id, time: world.time }); }
    }
    W.player.hp = p ? p.hp : W.player.hp;
    for (const a of A.enemies) {
      const g = a.agent; if (!a.alive) continue;
      const nx = g.x, nz = g.z;
      a.speed = Math.hypot(nx - a.pos.x, nz - a.pos.z) / AI_TICK;
      a.pos.set(nx, groundAt(world, nx, nz, a.pos.y), nz);
      a.yaw = g.yaw; a.crouch = !!g.crouch; a.state = g.state; a.aiming = g.state === 'cover' || g.state === 'attack' || g.state === 'chase';
    }
  }
}

// inputs: Map or object keyed by player id -> makeInput() shape. Returns this tick's events.
export function stepWorld(world, inputs) {
  const ev = [], P = world.P;
  for (const p of world.players) {
    if (!p.alive) continue;
    const inp = (inputs instanceof Map ? inputs.get(p.id) : inputs[p.id]) || makeInput();
    if (inp.weapon !== null && inp.weapon !== undefined && inp.weapon !== p.slot && world.loadout[inp.weapon]) {
      p.slot = inp.weapon; ev.push({ type: 'weaponSwitched', player: p.id, weapon: world.loadout[p.slot] });
    }
    const wid = world.loadout[p.slot], S = world.weapons[wid], g = p.guns[wid];
    const adsK = 1 + (S.adsMoveMult - 1) * g.ads;
    const PP = { ...P, walkSpeed: P.walkSpeed * adsK, crouchSpeed: P.crouchSpeed * adsK };
    const cmd = { moveX: inp.moveX, moveZ: inp.moveZ, yaw: inp.yaw, pitch: inp.pitch, jump: inp.jump, crouch: inp.crouch, sprint: inp.sprint && g.ads < 0.2 && !inp.ads };
    stepPlayer(p.body, cmd, PP, world.collider.bvh, TICK);
    p.yaw = inp.yaw; p.pitch = inp.pitch;

    const res = stepGun(g, S, { trigger: inp.trigger && !p.body.sprinting, ads: inp.ads && !p.body.sprinting, reload: inp.reload }, { speed: Math.hypot(p.body.vel.x, p.body.vel.z), onGround: p.body.onGround }, TICK);
    if (res.event) ev.push({ type: res.event, player: p.id, weapon: wid });
    if (res.shots.length) {
      world.stats.shots++; world.stats.bullets += res.shots.length;
      const origin = eyePosition(p);
      if (world.ai) addNoise(world.ai.W, origin.x, origin.z, 35, 'gunshot');
      const shot = { type: 'shot', player: p.id, weapon: wid, origin: arr(origin), spread: res.spread, recoil: res.recoil, paths: [] };
      ev.push(shot);
      for (const s of res.shots) {
        _e.set(inp.pitch + s.pitch, inp.yaw + s.yaw, 0);
        const dir = new THREE.Vector3(0, 0, -1).applyEuler(_e);
        if (S.projectile) { world.projectiles.push({ id: world.nextId++, owner: p.id, weapon: wid, pos: origin.clone(), vel: dir.multiplyScalar(S.muzzleVelocity), travelled: 0, life: 3, start: arr(origin) }); shot.paths.push({ projectile: true }); continue; }
        const r = resolveSegment(world, ev, p, S, origin, dir, MAX_RANGE, 0);
        shot.paths.push({ end: arr(r.end), hit: r.hit });
      }
    }
    if (world.ai && p.body.sprinting && p.body.onGround && world.tick % 20 === 0) addNoise(world.ai.W, p.body.pos.x, p.body.pos.z, 9, 'footsteps');
    if (p.hp < p.maxHp && world.time - p.lastHurt > PLAYER_RULES.regenDelay) p.hp = Math.min(p.maxHp, p.hp + PLAYER_RULES.regenRate * TICK);
  }
  if (world.ai) stepAI(world, ev);
  // projectiles: gravity, then a ray along this tick's segment
  for (let i = world.projectiles.length - 1; i >= 0; i--) {
    const b = world.projectiles[i], S = world.weapons[b.weapon], shooter = world.players.find(p => p.id === b.owner) || { id: b.owner };
    const start = b.pos.clone();
    b.vel.y -= 9.81 * S.gravityMult * TICK; b.pos.addScaledVector(b.vel, TICK); b.life -= TICK;
    const seg = b.pos.clone().sub(start), len = seg.length(); seg.normalize();
    const r = resolveSegment(world, ev, shooter, S, start, seg, len, b.travelled);
    b.travelled += len;
    ev.push({ type: 'projectile', id: b.id, from: arr(start), to: arr(r.hit ? r.end : b.pos), done: r.hit || b.life <= 0 });
    if (r.hit || b.life <= 0) world.projectiles.splice(i, 1);
  }
  if (!world.cleared && world.actors.some(a => a.team === 'enemy') && world.actors.every(a => a.team !== 'enemy' || !a.alive)) {
    world.cleared = true; ev.push({ type: 'cleared', time: world.time });
  }
  world.time += TICK; world.tick++;
  return ev;
}
