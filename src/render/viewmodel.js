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
  const skin = new THREE.MeshStandardMaterial({ color: 0xc69c7a, roughness: 0.8, flatShading: true });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x3a4436, roughness: 0.95, flatShading: true });
  let weapon = null;
  function arm(parent, [x, y, z], side) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.06, 0.08), skin); h.position.set(x + side * 0.004, y - 0.01, z + 0.01); parent.add(h);
    const from = new THREE.Vector3(x, y - 0.02, z + 0.05), to = from.clone().add(new THREE.Vector3(side * 0.06, -0.2, 0.42)), d = to.clone().sub(from);
    const a = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.038, d.length(), 8), sleeve); a.position.copy(from).add(to).multiplyScalar(0.5); a.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); parent.add(a);
  }
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
