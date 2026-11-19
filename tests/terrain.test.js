import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTerrain, LAYOUTS } from '../src/world/terrain.js';

const hash = arr => { let h = 2166136261; const u = new Uint32Array(arr.buffer); for (const v of u) h = Math.imul(h ^ v, 16777619) >>> 0; return h; };

test('same seed and settings rebuild the identical map (co-op relies on this)', () => {
  const a = generateTerrain({ seed: 42, res: 129 }), b = generateTerrain({ seed: 42, res: 129 });
  assert.equal(hash(a.heights), hash(b.heights));
  assert.equal(hash(a.splat), hash(b.splat));
  assert.equal(JSON.stringify(a.scatter), JSON.stringify(b.scatter));
});

test('different seeds give different maps', () => {
  assert.notEqual(hash(generateTerrain({ seed: 1, res: 129 }).heights), hash(generateTerrain({ seed: 2, res: 129 }).heights));
});

test('every layout produces finite data', () => {
  for (const L of Object.keys(LAYOUTS)) for (const seed of [1, 7, 1337]) {
    const T = generateTerrain({ layout: L, ...LAYOUTS[L].p, seed, res: 129 });
    for (const arr of [T.heights, T.splat, T.normals]) assert.ok(arr.every(Number.isFinite), `${L} seed ${seed}`);
  }
});
