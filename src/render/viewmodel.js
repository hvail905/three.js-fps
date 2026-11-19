// viewmodel.js : the first-person weapon (weapon library model + simple arms + muzzle flash),
// drawn in its own scene and camera so it never clips into walls. Used by the Gun lab and the game.
import * as THREE from 'three';

export function createViewmodel(WLIB) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(55, 1, 0.05, 10);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.6); scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.8); key.position.set(1, 2, 1.5); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 1.1); fill.position.set(-1, 0.6, 2); scene.add(fill);
  const root = new THREE.Group(); scene.add(root);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff2c0 })); flash.visible = false;
  let weapon = null;
  function arm(parent, [x, y, z], side) { const a = buildArm(side, 'grip'); a.position.set(x, y, z); parent.add(a); }
  function setWeapon(id) {
    flash.removeFromParent();
    if (weapon) { root.remove(weapon); WLIB.dispose(weapon); weapon = null; }
    if (!id) return null;
    weapon = WLIB.build({ prop: id });
    const an = weapon.userData.anchors;
    arm(weapon, an.grip, 1); if (an.support) arm(weapon, an.support, -1);
    if (an.muzzle) { flash.position.set(...an.muzzle); flash.position.z -= 0.03; weapon.add(flash); }
    root.add(weapon);
    return weapon;
  }
  // Muzzle position in world space, for tracers and muzzle particles.
  function muzzleWorld(mainCamera, out = new THREE.Vector3()) {
    if (!weapon || !root.visible || !weapon.userData.anchors.muzzle) return out.set(0.12, -0.12, -0.3).applyQuaternion(mainCamera.quaternion).add(mainCamera.position);
    root.updateMatrixWorld(true); mainCamera.updateMatrixWorld(true);
    return out.set(...weapon.userData.anchors.muzzle).applyMatrix4(weapon.matrixWorld).applyMatrix4(mainCamera.matrixWorld);
  }
  // Dim the weapon's private lights to roughly match the world (0 = night, 1 = day).
  function setLight(day) { const k = 0.25 + 0.75 * day; hemi.intensity = 1.6 * k; key.intensity = 1.8 * k; fill.intensity = 1.1 * k; }
  return { scene, camera, root, flash, setWeapon, muzzleWorld, setLight, get weapon() { return weapon; } };
}


// ---------------------------------------------------------------- first-person arms
// Painted, low-poly forearm and hand. The group's origin is the grip point (centre of the closed hand);
// the forearm runs back toward the camera. mode: 'grip' wraps the fingers round a handle, 'fist' clenches them.
let ARM_MATS = null;
function armMats() {
  if (ARM_MATS || typeof document === 'undefined') return ARM_MATS || {};
  const paint = (w, h, fn) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); fn(g, w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }; // smooth filtering: hands sit inches from the lens
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const sleeve = paint(64, 64, (g, w, h) => {
    g.fillStyle = '#3c3a30'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) { const x = rnd() * w; const gr = g.createLinearGradient(x - 4, 0, x + 4, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.4)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - 4, 0, 8, h); }
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '20,16,10' : '90,84,66'},0.35)`; g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 6, 1 + rnd() * 3); }
    g.fillStyle = 'rgba(70,10,6,0.6)'; g.fillRect(40, 48, 9, 6); g.fillRect(43, 54, 2, 8); // old blood near the cuff
    g.fillStyle = '#2a2820'; g.fillRect(0, 56, w, 8); // cuff
  });
  const skin = paint(64, 64, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#a88a70'); gr.addColorStop(1, '#7a6050'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 14; i++) { const x = rnd() * w, y = rnd() * h, r = 4 + rnd() * 10, rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, `rgba(${rnd() < 0.5 ? '60,40,28' : '150,120,96'},0.35)`); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2); }
    const sc = g.createRadialGradient(20, 10, 0, 20, 10, 9); sc.addColorStop(0, 'rgba(90,24,16,0.7)'); sc.addColorStop(1, 'rgba(90,24,16,0)'); g.fillStyle = sc; g.fillRect(8, 0, 26, 22); // a scrape
  });
  const knuckle = paint(64, 64, (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#7a6050'); gr.addColorStop(0.5, '#9c7e66'); gr.addColorStop(1, '#7a6050'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(40,24,16,0.65)'; for (let y = 15; y < h; y += 16) g.fillRect(0, y, w, 2); const sc = g.createRadialGradient(40, 8, 0, 40, 8, 8); sc.addColorStop(0, 'rgba(100,20,14,0.6)'); sc.addColorStop(1, 'rgba(100,20,14,0)'); g.fillStyle = sc; g.fillRect(30, 0, 20, 16); });
  ARM_MATS = { sleeve: new THREE.MeshStandardMaterial({ map: sleeve, roughness: 0.95 }), skin: new THREE.MeshStandardMaterial({ map: skin, roughness: 0.7 }), knuckle: new THREE.MeshStandardMaterial({ map: knuckle, roughness: 0.75 }) };
  return ARM_MATS;
}
export function buildArm(side = 1, mode = 'grip') {
  const M = armMats(), g = new THREE.Group();
  const box = (w, h, d, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.set(rx, ry, rz); g.add(b); return b; };
  // palm block, a row of knuckles, curled fingers folded under, thumb across (fist) or along the handle (grip)
  const fist = mode === 'fist';
  box(0.052, 0.072, 0.07, M.skin, side * 0.004, -0.008, 0.03);
  box(0.054, 0.062, 0.03, M.knuckle, 0, -0.004, -0.018); // curled fingers, front face
  for (let i = 0; i < 4; i++) box(0.012, 0.014, 0.016, M.skin, -side * 0.006 + side * (i - 1.5) * 0.0, 0.019 - i * 0.015, -0.03).position.x = -side * 0.024; // knuckles along the leading edge
  if (fist) box(0.016, 0.042, 0.02, M.skin, side * 0.004, 0.012, -0.038, 0, 0, side * 1.1); // thumb clamped over the fingers
  else box(0.017, 0.018, 0.045, M.skin, side * 0.022, 0.03, -0.004, 0.25, -side * 0.35, 0); // thumb wrapped over the handle
  // wrist and forearm back toward the camera, with a rolled cuff
  const from = new THREE.Vector3(side * 0.01, -0.02, 0.06), to = from.clone().add(new THREE.Vector3(side * 0.07, -0.19, 0.42)), d = to.clone().sub(from);
  const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.042, d.length(), 9, 1, true), M.sleeve); fore.position.copy(from).add(to).multiplyScalar(0.5); fore.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()); g.add(fore);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.03, 9), M.sleeve); cuff.position.copy(from).addScaledVector(d.clone().normalize(), 0.02); cuff.quaternion.copy(fore.quaternion); g.add(cuff);
  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.05, 8), M.skin); wrist.position.copy(from).addScaledVector(d.clone().normalize(), -0.012); wrist.quaternion.copy(fore.quaternion); g.add(wrist);
  g.traverse(o => { if (o.isMesh) o.castShadow = false; });
  return g;
}
