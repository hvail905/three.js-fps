// gore.js : blood and dismemberment for the character library's box rigs (render-only).
//   wound(): a dark entry wound stuck to the hit body part, with a streak that runs down the part
//            over a few seconds and drips that fall to the floor and leave spots.
//   spatter(): blood thrown onto walls and floors behind a hit, with runs on vertical surfaces.
//   sever(): hides a limb (joint subtree), throws it as a tumbling gib, caps the stump, sprays.
//   pool(): a spreading pool under a body.
// floorAt(x, z, fromY) -> floor height, supplied by the caller (raycast against the level).
import * as THREE from 'three';

function splatTexture(seed) {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'); let a = seed; const r = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(S / 2, S / 2, S * 0.22, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 18; i++) { const ang = r() * Math.PI * 2, d = S * (0.15 + r() * 0.3), rr = S * (0.02 + r() * 0.07); g.beginPath(); g.arc(S / 2 + Math.cos(ang) * d, S / 2 + Math.sin(ang) * d, rr, 0, Math.PI * 2); g.fill(); }
  for (let i = 0; i < 6; i++) { const ang = r() * Math.PI * 2; g.save(); g.translate(S / 2, S / 2); g.rotate(ang); g.fillRect(0, -S * 0.015, S * (0.25 + r() * 0.2), S * 0.03); g.restore(); }
  const t = new THREE.CanvasTexture(c); return t;
}
function streakTexture() {
  const W = 32, H = 128, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.75, 'rgba(255,255,255,0.85)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.beginPath(); g.moveTo(W * 0.2, 0); g.lineTo(W * 0.8, 0); g.lineTo(W * 0.62, H * 0.9); g.arc(W * 0.5, H * 0.9, W * 0.13, 0, Math.PI); g.closePath(); g.fill();
  return new THREE.CanvasTexture(c);
}

export function createGore(scene, { floorAt, max = { decals: 500, drips: 300, gibs: 24 } } = {}) {
  const textures = [11, 23, 37, 51].map(splatTexture), streakTex = streakTexture();
  // wet, dark blood: low roughness so it catches the flashlight
  const bloodMat = i => new THREE.MeshStandardMaterial({ color: 0x4a0606, roughness: 0.25, metalness: 0.0, transparent: true, alphaMap: textures[i % textures.length], depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mats = [0, 1, 2, 3].map(bloodMat);
  const streakMat = new THREE.MeshStandardMaterial({ color: 0x3d0505, roughness: 0.2, transparent: true, alphaMap: streakTex, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.DoubleSide });
  const woundMat = new THREE.MeshStandardMaterial({ color: 0x1a0202, roughness: 0.35, transparent: true, alphaMap: textures[2], depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const stumpMat = new THREE.MeshStandardMaterial({ color: 0x5a0a0a, roughness: 0.4, emissive: 0x100000 });
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xd8cfb8, roughness: 0.6 });
  const plane = new THREE.PlaneGeometry(1, 1), streakGeo = new THREE.PlaneGeometry(1, 1).translate(0, -0.5, 0);
  const dropGeo = new THREE.SphereGeometry(1, 5, 4), dropMat = new THREE.MeshStandardMaterial({ color: 0x4a0606, roughness: 0.2 });

  const decals = [], wounds = [], drips = [], gibs = [], streaks = [], pools = [];
  const tmp = new THREE.Vector3(), tmpN = new THREE.Vector3(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 0, 1);
  // instanced drops: one draw call for every falling drop
  const dropMesh = new THREE.InstancedMesh(dropGeo, dropMat, max.drips); dropMesh.count = 0; dropMesh.frustumCulled = false; scene.add(dropMesh);
  const m4 = new THREE.Matrix4();

  function addDecal(point, normal, size, rotate = Math.random() * Math.PI * 2) {
    const d = new THREE.Mesh(plane, mats[(Math.random() * 4) | 0]);
    tmpN.copy(normal).normalize();
    d.position.copy(point).addScaledVector(tmpN, 0.006);
    d.quaternion.setFromUnitVectors(up, tmpN); d.rotateZ(rotate);
    d.scale.set(size, size, 1); d.renderOrder = 2;
    scene.add(d); decals.push(d);
    if (decals.length > max.decals) { const o = decals.shift(); scene.remove(o); }
    return d;
  }
  // a run on a vertical surface: grows downward over `time` seconds
  function addRun(point, normal, length, width, time) {
    const s = new THREE.Mesh(streakGeo, streakMat);
    tmpN.copy(normal).setY(0).normalize();
    s.position.copy(point).addScaledVector(tmpN, 0.007);
    s.lookAt(s.position.clone().add(tmpN));
    s.scale.set(width, 0.001, 1); s.renderOrder = 3;
    scene.add(s); streaks.push({ mesh: s, len: length, t: 0, time, parent: null });
    decals.push(s); if (decals.length > max.decals) { const o = decals.shift(); scene.remove(o); }
  }
  function drop(pos, vel = null, size = 0.012) {
    if (drips.length >= max.drips) drips.shift();
    drips.push({ p: pos.clone(), v: vel ? vel.clone() : new THREE.Vector3(0, -0.2, 0), s: size, floor: floorAt(pos.x, pos.z, pos.y) });
  }

  // nearest zone mesh of the hit region on a character, in world space
  function nearestZoneMesh(obj, zone, point) {
    let best = null, bd = Infinity;
    obj.updateMatrixWorld(true);
    for (const m of obj.userData.zones || []) {
      if (zone && m.userData.zone !== zone) continue;
      if (!m.visible || !isShown(m)) continue;
      m.getWorldPosition(tmp); const d = tmp.distanceTo(point);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }
  function isShown(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }

  // a wound stuck to the body part, plus a run down the part, plus drips for a while
  function wound(obj, zone, point, dir, strength = 1) {
    const mesh = nearestZoneMesh(obj, zone, point) || nearestZoneMesh(obj, null, point); if (!mesh) return;
    // put the wound on the box surface facing the shooter
    const local = mesh.worldToLocal(point.clone());
    mesh.geometry.computeBoundingBox(); const bb = mesh.geometry.boundingBox;
    const back = mesh.worldToLocal(point.clone().sub(dir)).sub(local).normalize(); // toward the shooter, local
    const ax = Math.abs(back.x), ay = Math.abs(back.y), az = Math.abs(back.z);
    const n = ax > ay && ax > az ? new THREE.Vector3(Math.sign(back.x), 0, 0) : ay > az ? new THREE.Vector3(0, Math.sign(back.y), 0) : new THREE.Vector3(0, 0, Math.sign(back.z));
    local.clamp(bb.min, bb.max);
    if (n.x) local.x = n.x > 0 ? bb.max.x : bb.min.x; if (n.y) local.y = n.y > 0 ? bb.max.y : bb.min.y; if (n.z) local.z = n.z > 0 ? bb.max.z : bb.min.z;
    const w = new THREE.Mesh(plane, woundMat);
    w.position.copy(local).addScaledVector(n, 0.003); w.quaternion.setFromUnitVectors(up, n); w.rotateZ(Math.random() * 6);
    const s = (0.05 + Math.random() * 0.04) * strength; w.scale.set(s, s, 1); w.renderOrder = 4; mesh.add(w);
    // the run: down the part's local -Y on the same face (sides only; on top/bottom faces it just pools)
    if (!n.y) {
      const run = new THREE.Mesh(streakGeo, streakMat);
      run.position.copy(local).addScaledVector(n, 0.004);
      run.rotation.set(0, Math.atan2(n.x, n.z), 0); // plane faces out of the face, grows down the part's -Y
      run.scale.set(0.03 * strength + 0.02, 0.001, 1); run.renderOrder = 4; mesh.add(run);
      streaks.push({ mesh: run, len: Math.min(0.55, (bb.max.y - bb.min.y) * 0.5 + local.y - bb.min.y), t: 0, time: 2 + Math.random() * 2, parent: mesh });
    }
    wounds.push({ mesh, local: local.clone(), n, t: 0, life: 6 + Math.random() * 6, next: Math.random() * 0.3, rate: 0.25 + Math.random() * 0.4 });
    if (wounds.length > 80) wounds.shift();
  }

  // spray and spatter from a hit: floor splats under the body, wall spatter behind it
  function spatter(point, dir, { raycast, amount = 1 }) {
    for (let i = 0; i < 6 * amount; i++) drop(point, new THREE.Vector3(dir.x * 2 + (Math.random() - 0.5) * 2, Math.random() * 1.8, dir.z * 2 + (Math.random() - 0.5) * 2), 0.01 + Math.random() * 0.015);
    if (raycast) {
      const h = raycast(point, dir, 2.6);
      if (h) {
        addDecal(h.point, h.normal, 0.25 + Math.random() * 0.35 * amount);
        if (Math.abs(h.normal.y) < 0.5) for (let k = 0; k < 1 + amount * 2; k++) addRun(h.point.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.25)), h.normal, 0.3 + Math.random() * 0.9, 0.025 + Math.random() * 0.04, 2 + Math.random() * 4);
      }
    }
    const fy = floorAt(point.x, point.z, point.y);
    addDecal(new THREE.Vector3(point.x + (Math.random() - 0.5) * 0.6, fy, point.z + (Math.random() - 0.5) * 0.6), new THREE.Vector3(0, 1, 0), 0.2 + Math.random() * 0.3 * amount);
  }

  // remove a limb: hide the joint subtree, throw a copy as a gib, cap the stump, spray
  function sever(obj, jointName, dir) {
    const j = obj.userData.rig.joints[jointName]; if (!j || !j.visible) return;
    obj.updateMatrixWorld(true);
    const gib = j.clone(true); gib.traverse(o => { if (o.isMesh) { o.castShadow = true; o.userData.zone = null; } });
    j.matrixWorld.decompose(gib.position, gib.quaternion, gib.scale);
    scene.add(gib);
    const v = new THREE.Vector3(dir.x * 3.5 + (Math.random() - 0.5) * 2, 2 + Math.random() * 2, dir.z * 3.5 + (Math.random() - 0.5) * 2);
    gibs.push({ o: gib, v, w: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14), rest: false, t: 0, bleed: 3, next: 0 });
    if (gibs.length > max.gibs) { const g = gibs.shift(); scene.remove(g.o); }
    j.visible = false;
    // stump: raw cap with a bit of bone, on the parent at the joint
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.03, 0.08), stumpMat); cap.position.copy(j.position); j.parent.add(cap);
    const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.05, 6), boneMat); bone.position.copy(j.position).add(new THREE.Vector3(0, -0.02, 0)); j.parent.add(bone);
    const wp = new THREE.Vector3(); j.getWorldPosition(wp);
    for (let i = 0; i < 26; i++) drop(wp, new THREE.Vector3((Math.random() - 0.5) * 3 + dir.x * 2, Math.random() * 3, (Math.random() - 0.5) * 3 + dir.z * 2), 0.012 + Math.random() * 0.02);
    // the stump keeps pumping for a while
    wounds.push({ mesh: j.parent, local: j.position.clone(), n: new THREE.Vector3(0, -1, 0), t: 0, life: 10, next: 0, rate: 0.06, heavy: true });
  }

  function pool(pos, size = 1.2) { const d = addDecal(new THREE.Vector3(pos.x, floorAt(pos.x, pos.z, pos.y + 0.5), pos.z), new THREE.Vector3(0, 1, 0), 0.1); pools.push({ d, t: 0, size: size * (0.8 + Math.random() * 0.5) }); }

  function update(dt) {
    // wounds and stumps drip while they bleed
    for (let i = wounds.length - 1; i >= 0; i--) {
      const w = wounds[i]; w.t += dt; w.next -= dt;
      if (w.t > w.life || !isShown(w.mesh)) { if (w.t > w.life) wounds.splice(i, 1); continue; }
      if (w.next <= 0) {
        w.next = w.rate * (1 + w.t / w.life * 2) * (0.5 + Math.random());
        const p = w.mesh.localToWorld(w.local.clone());
        drop(p, w.heavy ? new THREE.Vector3((Math.random() - 0.5) * 0.6, -0.2 - Math.random() * 0.5, (Math.random() - 0.5) * 0.6) : null, w.heavy ? 0.016 : 0.01);
      }
    }
    // runs grow down
    for (let i = streaks.length - 1; i >= 0; i--) {
      const s = streaks[i]; s.t += dt; const k = Math.min(1, s.t / s.time), e = 1 - Math.pow(1 - k, 2.2);
      s.mesh.scale.y = Math.max(0.001, s.len * e);
      if (k >= 1) streaks.splice(i, 1);
    }
    // drops: fall, splat on the floor
    let n = 0;
    for (let i = drips.length - 1; i >= 0; i--) {
      const d = drips[i]; d.v.y -= 9.81 * dt; d.p.addScaledVector(d.v, dt);
      if (d.p.y <= d.floor + 0.002) { if (Math.random() < 0.5) addDecal(new THREE.Vector3(d.p.x, d.floor, d.p.z), new THREE.Vector3(0, 1, 0), d.s * 6 + Math.random() * 0.05); drips.splice(i, 1); continue; }
      m4.makeScale(d.s * 0.8, d.s * 1.6, d.s * 0.8).setPosition(d.p); dropMesh.setMatrixAt(n++, m4);
    }
    dropMesh.count = n; dropMesh.instanceMatrix.needsUpdate = true;
    // gibs: tumble, bounce, settle, bleed a little
    for (const g of gibs) {
      if (g.rest) continue;
      g.t += dt; g.v.y -= 9.81 * dt; g.o.position.addScaledVector(g.v, dt);
      g.o.rotation.x += g.w.x * dt; g.o.rotation.y += g.w.y * dt; g.o.rotation.z += g.w.z * dt;
      const fy = floorAt(g.o.position.x, g.o.position.z, g.o.position.y + 0.3) + 0.05;
      if (g.o.position.y < fy) {
        g.o.position.y = fy;
        if (Math.abs(g.v.y) > 1.2) { addDecal(new THREE.Vector3(g.o.position.x, fy - 0.05, g.o.position.z), new THREE.Vector3(0, 1, 0), 0.18 + Math.random() * 0.15); g.v.y *= -0.3; g.v.x *= 0.5; g.v.z *= 0.5; g.w.multiplyScalar(0.5); }
        else { g.rest = true; g.o.rotation.x = Math.round(g.o.rotation.x / (Math.PI / 2)) * Math.PI / 2; g.o.rotation.z = Math.round(g.o.rotation.z / (Math.PI / 2)) * Math.PI / 2; }
      }
      g.next -= dt; if (g.bleed > 0 && g.next <= 0) { g.next = 0.08; g.bleed -= 0.08; drop(g.o.position.clone(), new THREE.Vector3((Math.random() - 0.5), Math.random(), (Math.random() - 0.5)), 0.012); }
    }
    // pools spread
    for (let i = pools.length - 1; i >= 0; i--) { const p = pools[i]; p.t += dt; const s = p.size * Math.min(1, Math.sqrt(p.t / 6)); p.d.scale.set(s, s, 1); if (p.t > 6) pools.splice(i, 1); }
  }
  function clear() {
    for (const d of decals) scene.remove(d); for (const g of gibs) scene.remove(g.o);
    decals.length = wounds.length = drips.length = gibs.length = streaks.length = pools.length = 0; dropMesh.count = 0;
  }
  return { wound, spatter, sever, pool, drop, addDecal, addRun, update, clear, stats: () => ({ decals: decals.length, drips: drips.length, gibs: gibs.length, wounds: wounds.length }) };
}
