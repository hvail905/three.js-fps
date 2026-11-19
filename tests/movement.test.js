import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { TICK, DEFAULT_PARAMS, makeCommand, makePlayer, stepPlayer } from '../src/sim/movement.js';

const data = JSON.parse(readFileSync(new URL('../data/movement/standard.json', import.meta.url)));

test('data/movement/standard.json matches the sim defaults', () => {
  assert.deepEqual(data.sim, DEFAULT_PARAMS);
});

function floor() {
  const g = new THREE.BoxGeometry(200, 1, 200).translate(0, -0.5, 0).toNonIndexed();
  const clean = new THREE.BufferGeometry(); clean.setAttribute('position', g.attributes.position);
  return new MeshBVH(clean);
}

test('jump apex reaches jumpHeight within 3 cm', () => {
  const bvh = floor(), P = { ...DEFAULT_PARAMS };
  const pl = makePlayer(new THREE.Vector3(0, 0.05, 0));
  const cmd = makeCommand();
  for (let i = 0; i < 30; i++) stepPlayer(pl, cmd, P, bvh, TICK);
  const base = pl.pos.y; let apex = base;
  cmd.jump = true; stepPlayer(pl, cmd, P, bvh, TICK); cmd.jump = false;
  for (let i = 0; i < 120; i++) { stepPlayer(pl, cmd, P, bvh, TICK); apex = Math.max(apex, pl.pos.y); }
  assert.ok(Math.abs(apex - base - P.jumpHeight) < 0.03, `apex ${(apex - base).toFixed(3)} m vs ${P.jumpHeight}`);
});

test('walking settles at walkSpeed', () => {
  const bvh = floor(), P = { ...DEFAULT_PARAMS };
  const pl = makePlayer(new THREE.Vector3(0, 0.05, 0));
  const cmd = makeCommand(); cmd.moveZ = 1;
  for (let i = 0; i < 180; i++) stepPlayer(pl, cmd, P, bvh, TICK);
  const v = Math.hypot(pl.vel.x, pl.vel.z);
  assert.ok(Math.abs(v - P.walkSpeed) < 0.05, `speed ${v.toFixed(3)}`);
});
