import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { makeWorld, addPlayer, addActor, stepWorld, makeInput, eyePosition } from '../src/sim/world.js';
import { PRESETS, damageAt } from '../src/sim/gun.js';

// flat floor, optionally a wall: plain geometry, no renderer
function collider(extra = []) {
  const parts = [new THREE.BoxGeometry(200, 1, 200).translate(0, -0.5, 0), ...extra].map(g => g.toNonIndexed());
  const pos = [].concat(...parts.map(g => Array.from(g.attributes.position.array)));
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return { bvh: new MeshBVH(geo), triSurface: new Uint8Array(pos.length / 9) };
}
function setup({ loadout = ['rifle'], walls = [], targets = [[0, 0, -15]] } = {}) {
  const world = makeWorld({ collider: collider(walls), weapons: PRESETS, loadout });
  const me = addPlayer(world, { pos: [0, 0.05, 0] });
  for (const t of targets) addActor(world, { pos: t });
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
