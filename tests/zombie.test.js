import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createZombieKit, ZOMBIE_VARIANTS } from '../src/assets/zombie.js';

const ZK = createZombieKit();
const finite = o => { o.updateMatrixWorld(true); let ok = true; o.traverse(n => { for (const v of n.matrixWorld.elements) if (!Number.isFinite(v)) ok = false; }); return ok; };

test('every zombie variant builds a skinned body with hit zones on the bones', () => {
  for (const v of ZOMBIE_VARIANTS) {
    const z = ZK.build(v, 3, 1.8), rig = z.userData.rig;
    assert.ok(rig.joints.head && rig.joints.elbowL && rig.joints.kneeR, `${v}: joints the gore code severs at`);
    const zones = new Set(z.userData.zones.map(m => m.userData.zone));
    for (const k of ['head', 'torso', 'arm', 'leg']) assert.ok(zones.has(k), `${v}: ${k} zone`);
    let tris = 0; z.traverse(o => { if (o.isSkinnedMesh) tris += o.geometry.index.count / 3; });
    assert.ok(tris > 800 && tris < 4000, `${v}: low-poly budget, got ${tris}`);
  }
});

test('the head sits at the requested height and the feet on the floor', () => {
  const z = ZK.build('gown', 1, 1.8); z.updateMatrixWorld(true);
  const box = new THREE.Box3(); z.traverse(o => { if (o.isSkinnedMesh) { o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox); } });
  assert.ok(Math.abs(box.max.y - 1.8) < 0.12, `top at ${box.max.y.toFixed(2)}`);
  assert.ok(box.min.y > -0.02 && box.min.y < 0.03, `feet at ${box.min.y.toFixed(3)}`);
});

test('every animation state poses without NaN, including attacks, hits, crawl and death', () => {
  const z = ZK.build('coverall', 2, 1.75), st = ZK.makeState(2);
  const run = s => { for (let i = 0; i < 40; i++) ZK.animate(z, st, 1 / 30); assert.ok(finite(z), s); };
  for (const [l, u] of [['idle', 'free'], ['walk', 'free'], ['walk', 'reach'], ['run', 'reach']]) { ZK.setMove(st, l, u); run(l + u); }
  for (const k of ['swipeL', 'swipeR', 'grab']) { ZK.attack(st, k); run(k); }
  for (const zone of ['head', 'torso', 'arm', 'leg']) { ZK.hit(st, zone, [0, -1], 1, 1.4); run('hit ' + zone); }
  ZK.setCrawl(st); run('crawl'); ZK.attack(st, 'grab'); run('crawl attack'); ZK.kill(st, 'torso', [0, -1]); run('dead crawler');
});

test('severing hides the limb and hands back a posed gib once', () => {
  const z = ZK.build('hood', 4, 1.8);
  const gib = z.userData.severPart('elbowL');
  assert.ok(gib && gib.children.length >= 2, 'a gib with the forearm and fingers');
  assert.equal(z.userData.parts.farmL.visible, false);
  assert.equal(z.userData.severPart('elbowL'), null, 'nothing left to sever the second time');
  assert.ok(z.userData.severPart('head'), 'head comes off');
});
