import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { PRESETS } from '../src/sim/gun.js';
import { VIEW_DEFAULTS } from '../src/render/camera-feel.js';
import { PRIMS, MARKERS } from '../src/world/level.js';
import { createPropLibrary } from '../src/assets/props.js';
import { createVehicleLibrary } from '../src/assets/vehicles.js';
import { createFacadeLibrary } from '../src/assets/facades.js';

const json = p => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const files = dir => readdirSync(new URL(dir, import.meta.url)).filter(f => f.endsWith('.json')).map(f => [f, json(dir + f)]);

test('look files are valid and respect the bloom trim lock (0.6)', () => {
  for (const [f, j] of files('../data/looks/')) {
    assert.equal(j.kind, 'lookSettings', f);
    assert.equal(typeof j.name, 'string', f);
    if ('bloomTrim' in j.look) assert.ok(j.look.bloomTrim <= 0.6, `${f} bloomTrim ${j.look.bloomTrim}`);
  }
});

test('weapon files match the gun sim presets', () => {
  const ids = files('../data/weapons/').map(([f, j]) => { assert.equal(j.kind, 'weaponStats', f); assert.deepEqual(j.stats, PRESETS[j.id], f); return j.id; });
  assert.deepEqual(ids.sort(), Object.keys(PRESETS).sort());
});

test('movement view settings match the camera feel defaults', () => {
  assert.deepEqual(json('../data/movement/standard.json').view, VIEW_DEFAULTS);
});

test('level files reference only things that exist and have the markers a round needs', () => {
  const kits = { props: createPropLibrary(THREE), vehicles: createVehicleLibrary(THREE), facades: createFacadeLibrary(THREE) };
  for (const [f, L] of files('../data/levels/')) {
    assert.equal(L.kind, 'level', f);
    for (const r of L.objects) {
      if (r.type === 'prim') assert.ok(PRIMS[r.kind], `${f} #${r.id} prim ${r.kind}`);
      else if (r.type === 'marker') assert.ok(MARKERS[r.kind], `${f} #${r.id} marker ${r.kind}`);
      else assert.ok(kits[r.kit] && kits[r.kit].props[r.kind], `${f} #${r.id} ${r.kit}/${r.kind}`);
      assert.equal(r.pos.length, 3);
    }
    assert.equal(L.objects.filter(r => r.kind === 'playerSpawn').length, 1, `${f} needs one player spawn`);
    assert.ok(L.objects.some(r => r.kind === 'enemySpawn'), `${f} needs enemy spawns`);
  }
});

test('AI profile matches the AI sim defaults', async () => {
  const { DEFAULT_AI } = await import('../src/sim/ai.js');
  const j = json('../data/ai/default.json');
  assert.equal(j.kind, 'aiProfile');
  assert.deepEqual(j.params, DEFAULT_AI);
});
