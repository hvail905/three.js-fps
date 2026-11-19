import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSewer } from '../src/world/sewer.js';
import { makeSurvival, stepSurvival, makeSurvivalInput, SURVIVAL_RULES } from '../src/sim/survival.js';
import { PRESETS } from '../src/sim/gun.js';

const def = JSON.parse(readFileSync(new URL('../data/sewer/gallery-1.json', import.meta.url)));
const level = buildSewer(def, { visuals: false });
const fresh = () => makeSurvival({ def, collider: level.collider, bounds: level.bounds, pistolStats: PRESETS.pistol, seed: 5 });
const run = (w, ticks, patch = {}) => { const all = []; for (let i = 0; i < ticks; i++) all.push(...stepSurvival(w, Object.assign(makeSurvivalInput(), typeof patch === 'function' ? patch(i) : patch))); return all; };
const aimAt = (w, x, y, z) => { const b = w.player.body, ex = b.pos.x, ey = b.pos.y + b.height - 0.12, ez = b.pos.z, dx = x - ex, dy = y - ey, dz = z - ez; return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) }; };
// put the player 4 m north of zombie 0 on the channel walkway and freeze the zombie in place
function standoff() {
  const w = fresh(), z = w.zombies[0];
  w.player.body.pos.set(33, 0.1, 23); z.pos.set(33, 0, 27); z.yaw = Math.PI; z.staggerT = 999; w.player.hp = 1e6;
  run(w, 10);
  return { w, z };
}

test('the sewer map builds a closed level: the player stands on the floor and walls stop them', () => {
  const w = fresh();
  run(w, 30);
  assert.ok(w.player.body.onGround && Math.abs(w.player.body.pos.y) < 0.05);
  run(w, 240, { moveX: -1 }); // walk west into the cell wall
  assert.ok(w.player.body.pos.x > 2.2, `stopped by the wall at x ${w.player.body.pos.x.toFixed(2)}`);
});

test('pickups go into the inventory; the pistol arrives with six rounds', () => {
  const w = fresh(), p = w.player;
  const take = kind => { const k = w.pickups.find(q => q.kind === kind && !q.taken); p.body.pos.set(k.pos[0], 0.1, k.pos[2]); run(w, 2, { use: true }); };
  take('pipe'); take('pistol'); take('brick'); take('bottle'); take('bandage');
  assert.equal(p.pipe.durability, SURVIVAL_RULES.melee.pipe.durability);
  assert.equal(p.pistol.ammo, SURVIVAL_RULES.pistol.magStart);
  assert.equal(p.bricks + p.bottles + p.bandages, 3);
});

test('a pistol hit on a weakened leg takes it off, and the zombie crawls', () => {
  const { w, z } = standoff(), p = w.player;
  const k = w.pickups.find(q => q.kind === 'pistol'); p.body.pos.set(k.pos[0], 0.1, k.pos[2]); run(w, 2, { use: true });
  p.body.pos.set(33, 0.1, 23); run(w, 5);
  z.limbs.legL = z.limbs.legR = 1;
  const ev = run(w, 40, i => ({ attack: i < 2, ...aimAt(w, 33, 0.74 * z.height / 1.8, 27) }));
  const sev = ev.find(e => e.type === 'zhit' && e.severed);
  assert.ok(sev && sev.severed.startsWith('leg'), 'a leg came off');
  assert.ok(z.crawl);
});

test('heavy damage to the head kills; the death event follows the hit', () => {
  const { w, z } = standoff(), p = w.player;
  const k = w.pickups.find(q => q.kind === 'pistol'); p.body.pos.set(k.pos[0], 0.1, k.pos[2]); run(w, 2, { use: true });
  p.body.pos.set(33, 0.1, 23); run(w, 5);
  z.limbs.head = 1;
  const ev = run(w, 30, i => ({ attack: i < 2, ...aimAt(w, 33, 1.66 * z.height / 1.8, 27) }));
  assert.ok(ev.some(e => e.type === 'zhit' && e.severed === 'head'));
  assert.ok(ev.some(e => e.type === 'zdied'));
  assert.equal(z.alive, false);
});

test('the pipe wears out and breaks back to fists', () => {
  const { w, z } = standoff(), p = w.player;
  p.pipe = { durability: 2 }; p.slot = 'pipe'; p.body.pos.set(33, 0.1, 25.6);
  const ev = run(w, 240, i => ({ attack: i % 50 === 0, ...aimAt(w, 33, 1.2, 27) }));
  assert.ok(ev.some(e => e.type === 'broke'));
  assert.equal(p.pipe, null); assert.equal(p.slot, 'fists');
});

test('a kick pushes a zombie back and staggers it', () => {
  const { w, z } = standoff(), p = w.player;
  z.staggerT = 0; p.body.pos.set(33, 0.1, 25.8); const before = z.pos.z;
  run(w, 30, i => ({ kick: i === 0, ...aimAt(w, 33, 1.2, 27) }));
  assert.ok(z.pos.z > before + 1, `pushed from ${before} to ${z.pos.z.toFixed(2)}`);
});

test('gunfire draws zombies; a quiet crouched player in the dark stays unnoticed', () => {
  const w = fresh(), z = w.zombies[1]; // a pump-hall zombie
  w.player.body.pos.set(33, 0.1, 24); w.player.hp = 1e6;
  run(w, 200, { crouch: true, light: false });
  assert.notEqual(z.state, 'chase', 'nothing heard or seen');
  const k = w.pickups.find(q => q.kind === 'pistol'); w.player.body.pos.set(k.pos[0], 0.1, k.pos[2]); run(w, 2, { use: true });
  run(w, 3, { attack: true, pitch: 0.3 });
  run(w, 20);
  assert.ok(['chase', 'investigate'].includes(z.state), `after a gunshot: ${z.state}`);
});

test('zombies cannot path into the crawl vent', () => {
  const w = fresh(), N = w.nav;
  const blocked = (x, z) => N.blocked[Math.floor((z - N.z0) / N.cell) * N.cols + Math.floor((x - N.x0) / N.cell)];
  // vent row 11 runs from column 19 to 29: x 38..60, z 22..24
  for (const x of [42, 48, 54]) assert.equal(blocked(x, 23), 1, `vent at x ${x}`);
  assert.equal(blocked(33, 23), 0, 'the walkway next to it is open');
});

test('a zombie that reaches the player hurts them; enough hurt is death', () => {
  const w = fresh(), z = w.zombies[0];
  w.player.body.pos.set(33, 0.1, 25); z.pos.set(33, 0, 26.6); z.yaw = Math.PI; w.player.hp = 30;
  const ev = run(w, 60 * 8);
  assert.ok(ev.some(e => e.type === 'hurt'));
  assert.ok(ev.some(e => e.type === 'died') && !w.player.alive);
});

test('reaching the gate ends the gallery', () => {
  const w = fresh();
  w.player.body.pos.set(33 * 2 + 1, 0.1, 19 * 2 + 1);
  const ev = run(w, 5);
  assert.ok(ev.some(e => e.type === 'escaped') && w.player.escaped);
});
