import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Reads the JSON chunk of a GLB (no three.js needed)
const glb = f => { const b = readFileSync(new URL('../assets/models/' + f, import.meta.url)); const len = b.readUInt32LE(12); return JSON.parse(b.subarray(20, 20 + len).toString('utf8')); };
const names = j => new Set((j.nodes || []).map(n => n.name));

test('every Blender zombie is skinned to the bone names the game animates', () => {
  const BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'shoulderL', 'elbowL', 'wristL', 'shoulderR', 'elbowR', 'wristR', 'thighL', 'kneeL', 'ankleL', 'thighR', 'kneeR', 'ankleR'];
  for (const v of ['gown', 'coverall', 'hood']) {
    const j = glb(`zombie_${v}.glb`), joints = new Set(j.skins[0].joints.map(i => j.nodes[i].name));
    for (const b of BONES) assert.ok(joints.has(b), `${v}: joint ${b}`);
    const prim = j.meshes[0].primitives[0];
    assert.ok(prim.attributes.JOINTS_0 !== undefined && prim.attributes.JOINTS_1 === undefined, `${v}: four influences per vertex`);
    assert.ok(j.images && j.images.length === 1, `${v}: one painted atlas`);
  }
});

test('props, fixtures and pickups carry the nodes the game looks for', () => {
  const have = new Set(readdirSync(new URL('../assets/models/', import.meta.url)));
  for (const f of ['crate', 'drum', 'gurney', 'chair', 'table', 'table_sheet', 'shelf', 'locker', 'cabinet', 'iv', 'camera', 'speaker',
    'lamp_cage', 'lamp_tube', 'lamp_red', 'lamp_bulb', 'pick_brick', 'pick_bottle', 'pick_pipe', 'pick_bandage', 'pick_ammo']) assert.ok(have.has(f + '.glb'), f);
  const cam = names(glb('camera.glb')); assert.ok(cam.has('head') && cam.has('led'), 'camera head and led');
  for (const l of ['lamp_cage', 'lamp_tube', 'lamp_red', 'lamp_bulb']) assert.ok([...names(glb(l + '.glb'))].some(n => n.startsWith('glow')), `${l} glow`);
});

test('free-standing props stand on the ground at the size the physics expects', () => {
  const box = j => { let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (const m of j.meshes) for (const p of m.primitives) { const a = j.accessors[p.attributes.POSITION]; lo = lo.map((v, i) => Math.min(v, a.min[i])); hi = hi.map((v, i) => Math.max(v, a.max[i])); } return { lo, hi }; };
  const c = box(glb('crate.glb')); assert.ok(Math.abs(c.lo[1]) < 0.01 && Math.abs(c.hi[1] - 0.9) < 0.03, `crate ${c.lo[1]}..${c.hi[1]}`);
  const d = box(glb('drum.glb')); assert.ok(Math.abs(d.lo[1]) < 0.02 && Math.abs(d.hi[1] - 0.9) < 0.04, `drum ${d.lo[1]}..${d.hi[1]}`);
});
