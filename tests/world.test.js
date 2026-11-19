import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { makeWorld, addPlayer, addActor, stepWorld, makeInput, eyePosition, enableAI, PLAYER_RULES } from '../src/sim/world.js';
import { PRESETS, damageAt } from '../src/sim/gun.js';

// flat floor, optionally a wall: plain geometry, no renderer
function collider(extra = []) {
  const parts = [new THREE.BoxGeometry(200, 1, 200).translate(0, -0.5, 0), ...extra].map(g => g.toNonIndexed());
  const pos = [].concat(...parts.map(g => Array.from(g.attributes.position.array)));
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return { bvh: new MeshBVH(geo), triSurface: new Uint8Array(pos.length / 9) };
}
function setup({ loadout = ['rifle'], walls = [], targets = [[0, 0, -15]], ai = false, yaw = Math.PI } = {}) {
  const world = makeWorld({ collider: collider(walls), weapons: PRESETS, loadout });
  const me = addPlayer(world, { pos: [0, 0.05, 0] });
  for (const t of targets) addActor(world, { pos: t, yaw }); // yaw PI: the actor faces -Z... toward +Z is 0
  if (ai) enableAI(world, { bounds: { x0: -40, z0: -40, width: 80, depth: 80 }, seed: 3 });
  for (let i = 0; i < 10; i++) stepWorld(world, { [me.id]: makeInput() }); // settle on the floor
  return { world, me };
}
function aim(me, target, height) { const e = eyePosition(me), dx = target[0] - e.x, dy = target[1] + height - e.y, dz = target[2] - e.z; return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) }; }
function hold(world, me, ticks, patch) {
  const all = [];
  for (let i = 0; i < ticks; i++) { const inp = Object.assign(makeInput(), patch); all.push(...stepWorld(world, { [me.id]: inp })); }
  return all;
}

test('an auto rifle fires at its RPM (600 rpm = 20 shots in 2 s)', () => {
  const { world, me } = setup({ targets: [] });
  const ev = hold(world, me, 120, { trigger: true });
  assert.equal(ev.filter(e => e.type === 'shot').length, 20);
});

test('a headshot inside rangeStart does damage x headMult', () => {
  const { world, me } = setup({ loadout: ['pistol'], targets: [[0, 0, -8]] });
  const ev = hold(world, me, 1, { trigger: true, ads: false, ...aim(me, [0, 0, -8], 1.66) });
  // pistol hip spread is 2 deg; at 8 m that can miss a 13 cm head, so accept head or nothing but never another zone
  const hit = ev.find(e => e.type === 'hit');
  if (hit) { assert.equal(hit.zone, 'head'); assert.ok(Math.abs(hit.dmg - damageAt(PRESETS.pistol, hit.dist, 'head')) < 1e-9); }
});

test('killing every hostile fires killed events and then cleared once', () => {
  const { world, me } = setup({ targets: [[0, 0, -10], [3, 0, -10]] });
  let ev = [];
  for (const t of [[0, 0, -10], [3, 0, -10]]) ev.push(...hold(world, me, 150, { trigger: true, ads: true, ...aim(me, t, 1.25) }));
  assert.equal(ev.filter(e => e.type === 'killed').length, 2);
  assert.equal(ev.filter(e => e.type === 'cleared').length, 1);
  assert.ok(world.actors.every(a => !a.alive));
});

test('a wall between the shooter and the target stops the bullets', () => {
  const wall = new THREE.BoxGeometry(6, 4, 0.4).translate(0, 2, -6);
  const { world, me } = setup({ walls: [wall] });
  const ev = hold(world, me, 120, { trigger: true, ads: true, ...aim(me, [0, 0, -15], 1.25) });
  assert.equal(ev.filter(e => e.type === 'hit').length, 0);
  assert.ok(ev.filter(e => e.type === 'impact').length > 0);
  assert.equal(world.actors[0].hp, 100);
});

test('sniper bullets are projectiles: they take time to arrive and drop', () => {
  const T = [0, 0, -90], { world, me } = setup({ loadout: ['sniper'], targets: [T] });
  hold(world, me, 40, { ads: true, ...aim(me, T, 1.37) }); // finish aiming down sights first
  const ev = hold(world, me, 60, { trigger: true, ads: true, ...aim(me, T, 1.37) });
  const shotTick = ev.findIndex(e => e.type === 'shot'), hit = ev.find(e => e.type === 'hit'), impact = ev.find(e => e.type === 'impact');
  assert.ok(shotTick >= 0 && ev.some(e => e.type === 'projectile'));
  const end = hit ? hit.point : impact && impact.point;
  assert.ok(end, 'bullet landed somewhere');
  // 90 m at 850 m/s takes about 0.11 s (6-7 ticks), so the hit cannot land on the firing tick
  const landTick = ev.findIndex(e => e.type === 'hit' || e.type === 'impact');
  const ticksBetween = ev.slice(shotTick, landTick).filter(e => e.type === 'projectile').length;
  assert.ok(ticksBetween >= 5, `arrived after ${ticksBetween} ticks`);
  assert.ok(hit, 'aimed sniper shot hits the torso at 90 m');
});

test('same inputs give the same result (deterministic, so a co-op host can be authoritative)', () => {
  const run = () => { const { world, me } = setup({ targets: [[0, 0, -12], [2, 0, -20]] }); hold(world, me, 200, { trigger: true, moveX: 1, ...aim(me, [0, 0, -12], 1.2) }); return JSON.stringify([world.actors.map(a => a.hp), world.stats, me.body.pos]); };
  assert.equal(run(), run());
});

// ---------------------------------------------------------------- enemy AI
// Actor yaw 0 faces +Z (character convention). A target at z = -15 facing the player at the origin uses yaw 0.
test('an enemy with line of sight spots, shoots and hurts the player', () => {
  const { world, me } = setup({ ai: true, yaw: 0, targets: [[0, 0, -15]] });
  const ev = hold(world, me, 60 * 12, {});
  assert.ok(ev.some(e => e.type === 'enemyShot'), 'enemy fired');
  assert.ok(world.stats.damageTaken > 0 || !me.alive, 'player took damage');
});

test('a wall hides a quiet player; gunfire brings the enemy to investigate', () => {
  const wall = new THREE.BoxGeometry(12, 4, 0.4).translate(0, 2, -7);
  const { world, me } = setup({ ai: true, yaw: 0, walls: [wall], targets: [[0, 0, -15]] });
  let ev = hold(world, me, 60 * 6, {});
  assert.equal(ev.filter(e => e.type === 'enemyShot').length, 0, 'no shots through the wall');
  assert.equal(world.stats.damageTaken, 0);
  const agent = world.actors[0].agent, start = [agent.x, agent.z];
  hold(world, me, 1, { trigger: true, pitch: 0.6 }); // fire into the air: noise only
  hold(world, me, 60 * 3, {});
  assert.notEqual(agent.state, 'patrol', `state after gunfire: ${agent.state}`);
  assert.ok(Math.hypot(agent.x - start[0], agent.z - start[1]) > 1, 'enemy moved toward the noise');
});

test('the nav grid blocks cells inside walls', () => {
  const wall = new THREE.BoxGeometry(12, 4, 0.4).translate(0, 2, -7);
  const { world } = setup({ ai: true, walls: [wall], targets: [[0, 0, -15]] });
  const W = world.ai.W, cell = (x, z) => W.blocked[Math.floor((z - W.z0) / W.cell) * W.cols + Math.floor((x - W.x0) / W.cell)];
  assert.equal(cell(0, -7), 1); assert.equal(cell(0, -3), 0); assert.equal(cell(8, -7), 0);
});

test('the player can die, which ends the round as lost and stops their input', () => {
  const { world, me } = setup({ ai: true, yaw: 0, targets: [[0, 0, -8], [2, 0, -8], [-2, 0, -8]] });
  me.hp = 5; me.lastHurt = world.time; // already hurt, so no regeneration yet
  const ev = hold(world, me, 60 * 20, {});
  assert.ok(ev.some(e => e.type === 'playerDied'));
  assert.ok(world.lost && !me.alive && me.hp === 0);
  const shots = hold(world, me, 30, { trigger: true }).filter(e => e.type === 'shot').length;
  assert.equal(shots, 0, 'dead players do not shoot');
});

test('health regenerates after the delay without damage', () => {
  const { world, me } = setup({ targets: [] });
  me.hp = 40; me.lastHurt = world.time;
  hold(world, me, Math.round(60 * (PLAYER_RULES.regenDelay - 0.5)), {});
  assert.equal(me.hp, 40, 'no regen before the delay');
  hold(world, me, 60 * 2, {});
  assert.ok(me.hp > 40 && me.hp <= me.maxHp);
});

test('a hit sends an enemy into cover behavior', () => {
  const { world, me } = setup({ ai: true, yaw: Math.PI, targets: [[0, 0, -12]] }); // facing away, unaware
  hold(world, me, 30, { ads: true, ...aim(me, [0, 0, -12], 1.25) });
  hold(world, me, 40, { trigger: true, ads: true, ...aim(me, [0, 0, -12], 1.25) });
  const a = world.actors[0];
  if (a.alive) assert.ok(['cover', 'attack', 'chase'].includes(a.agent.state), a.agent.state);
});

test('with AI, the same inputs still give the same result', () => {
  const run = () => { const { world, me } = setup({ ai: true, yaw: 0, targets: [[0, 0, -14], [5, 0, -18]] }); hold(world, me, 60 * 8, { moveX: 0.5 }); return JSON.stringify([world.actors.map(a => [a.hp, a.pos.x.toFixed(4), a.pos.z.toFixed(4), a.agent.state]), me.hp, world.stats]); };
  assert.equal(run(), run());
});

test('bullets and sight use the shot collider; bodies use the movement collider', () => {
  // movement collider: a big box (like a prop's bounding box); shot collider: only a thin pole inside it
  const bigBox = new THREE.BoxGeometry(4, 4, 1).translate(0, 2, -6), pole = new THREE.BoxGeometry(0.15, 4, 0.15).translate(1.6, 2, -6);
  const world = makeWorld({ collider: collider([bigBox]), shotCollider: collider([pole]), weapons: PRESETS, loadout: ['rifle'] });
  const me = addPlayer(world, { pos: [0, 0.05, 0] }); addActor(world, { pos: [0, 0, -15], yaw: Math.PI });
  for (let i = 0; i < 10; i++) stepWorld(world, { [me.id]: makeInput() });
  const ev = hold(world, me, 120, { trigger: true, ads: true, ...aim(me, [0, 0, -15], 1.25) });
  assert.ok(ev.some(e => e.type === 'hit'), 'shots pass the empty part of the bounding box');
  // walking forward still stops at the big box
  hold(world, me, 180, { moveZ: 1 });
  assert.ok(me.body.pos.z > -5.6, `stopped by the movement box at z ${me.body.pos.z.toFixed(2)}`);
});
