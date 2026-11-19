import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSewer } from '../src/world/sewer.js';
import { makeSurvival, stepSurvival, makeSurvivalInput, lookTarget } from '../src/sim/survival.js';
import { PRESETS } from '../src/sim/gun.js';

const def = JSON.parse(readFileSync(new URL('../data/sewer/gallery-1.json', import.meta.url)));
const level = buildSewer(def, { visuals: false });
const fresh = () => { const w = makeSurvival({ def, collider: level.collider, bounds: level.bounds, pistolStats: PRESETS.pistol, seed: 5, layout: level }); w.player.hp = 1e6; for (const z of w.zombies) z.staggerT = 999; return w; };
const run = (w, n, patch = {}) => { const all = []; for (let i = 0; i < n; i++) all.push(...stepSurvival(w, Object.assign(makeSurvivalInput(), typeof patch === 'function' ? patch(i) : patch))); return all; };
const crateNear = (w, x, z) => w.phys.bodies.find(o => o.kind === 'crate' && Math.hypot(o.body.position.x - x, o.body.position.z - z) < 0.6);

test('crates, drums and junk are loose bodies that settle on the floor', () => {
  const w = fresh(); run(w, 90);
  const kinds = new Set(w.phys.bodies.map(o => o.kind));
  for (const k of ['crate', 'barrel', 'can', 'card', 'pistol', 'brick']) assert.ok(kinds.has(k), k);
  for (const o of w.phys.bodies) assert.ok(o.body.position.y > -0.4 && o.body.position.y < 2.5, `${o.kind} at ${o.body.position.y.toFixed(2)}`);
  const c = crateNear(w, 21, 15); assert.ok(c && Math.abs(c.body.position.y - 0.45) < 0.05, 'crate rests on the floor');
});

test('a kick sends a crate sliding', () => {
  const w = fresh(), c = crateNear(w, 27, 43); run(w, 5);
  w.player.body.pos.set(25.7, 0.05, 43); const x0 = c.body.position.x;
  const ev = run(w, 60, i => ({ kick: i === 0, yaw: -Math.PI / 2, pitch: -0.2 }));
  assert.ok(ev.some(e => e.type === 'propHit' && e.kind === 'crate'), 'kick connects');
  assert.ok(c.body.position.x - x0 > 0.3, `moved ${(c.body.position.x - x0).toFixed(2)} m`);
});

test('walking into a crate shoves it and the player does not pass through', () => {
  const w = fresh(), c = crateNear(w, 27, 43); run(w, 5);
  w.player.body.pos.set(25.4, 0.05, 43); const x0 = c.body.position.x;
  let closest = 9;
  for (let i = 0; i < 90; i++) { run(w, 1, { moveZ: 1, yaw: -Math.PI / 2 }); closest = Math.min(closest, Math.hypot(w.player.body.pos.x - c.body.position.x, w.player.body.pos.z - c.body.position.z)); }
  assert.ok(c.body.position.x - x0 > 0.2, `crate moved ${(c.body.position.x - x0).toFixed(2)} m`);
  assert.ok(closest > 0.6, `the player never walks into the crate (closest ${closest.toFixed(2)} m)`);
});

test('looking at an item names it, and E takes that item', () => {
  const w = fresh(); run(w, 20);
  const k = w.pickups.find(q => q.kind === 'pistol'), b = w.player.body;
  b.pos.set(k.pos[0], 0.05, k.pos[2] + 1.4); run(w, 2);
  const ex = b.pos.x, ey = b.pos.y + b.height - 0.12, ez = b.pos.z;
  const aim = { yaw: Math.atan2(-(k.pos[0] - ex), -(k.pos[2] - ez)), pitch: Math.atan2(k.pos[1] + 0.05 - ey, Math.hypot(k.pos[0] - ex, k.pos[2] - ez)) };
  w.player.yaw = aim.yaw; w.player.pitch = aim.pitch;
  assert.equal(lookTarget(w).pickup, k);
  run(w, 2, { use: true, ...aim });
  assert.ok(k.taken && w.player.pistol);
});

test('a thrown brick lands as a physical pickup', () => {
  const w = fresh(); run(w, 5); w.player.bricks = 1; w.player.body.pos.set(17, 0.05, 5);
  const ev = run(w, 120, i => ({ throwKind: i === 0 ? 'brick' : null, yaw: -Math.PI / 2, pitch: 0.1 }));
  const thud = ev.find(e => e.type === 'thud'); assert.ok(thud && thud.pickup, 'landed');
  assert.ok(thud.pickup.phys, 'has a body'); assert.ok(thud.pickup.pos[1] > -0.3 && thud.pickup.pos[1] < 0.3, `rests at ${thud.pickup.pos[1].toFixed(2)}`);
});
