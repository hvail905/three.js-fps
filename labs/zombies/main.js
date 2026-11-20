// Zombie Lab: the skinned experiment subjects, their painted atlases and every animation, on a lit turntable.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createZombieKit, ZOMBIE_VARIANTS, setZombieModels } from '../../src/assets/zombie.js';
import { loadGalleryModels } from '../../src/assets/gallery-models.js';
import { PIXEL_TEXTURES } from '../../src/world/pixeltex.js';
import { createGore } from '../../src/fx/gore.js';

const AUTOTEST = location.hash === '#autotest';
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: AUTOTEST });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b0c0c); scene.fog = new THREE.Fog(0x0b0c0c, 8, 22);
const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100); camera.position.set(1.6, 1.5, 2.8);
const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 1, 0); controls.update();
// sewer-like lighting: warm caged lamp key, teal fill, cold rim
scene.add(new THREE.HemisphereLight(0x2c4a48, 0x1a140e, 0.9));
const key = new THREE.SpotLight(0xffc27a, 60, 12, 0.7, 0.6, 1.6); key.position.set(2, 3, 2.2); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); scene.add(key, key.target);
const rim = new THREE.PointLight(0x9fc8d0, 8, 8, 1.6); rim.position.set(-1.8, 2.2, -2); scene.add(rim);
const fl = PIXEL_TEXTURES.floor(); fl.map.repeat.set(5, 5); fl.normalMap.repeat.set(5, 5);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial({ map: fl.map, normalMap: fl.normalMap, roughness: 0.5 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const gore = createGore(scene, { floorAt: () => 0 });

const USE_MODELS = !location.search.includes('procedural');
if (USE_MODELS) setZombieModels(await loadGalleryModels({ only: ZOMBIE_VARIANTS.map(v => 'zombie_' + v) }));
const ZK = createZombieKit();
let bodies = [], variant = 'gown', seed = 1, lineup = false, move = 'idle', upper = 'free', crawl = false;
function spawn() {
  for (const b of bodies) { scene.remove(b.obj); ZK.dispose(b.obj); } bodies = []; gore.clear();
  const list = lineup ? ZOMBIE_VARIANTS.map((v, i) => [v, seed + i, (i - 1) * 1.1]) : [[variant, seed, 0]];
  for (const [v, sd, x] of list) {
    const obj = ZK.build(v, sd, 1.72 + (sd % 3) * 0.06); obj.position.x = x; scene.add(obj);
    const st = ZK.makeState(sd); ZK.setMove(st, move, upper); if (crawl) ZK.setCrawl(st); bodies.push({ obj, st });
  }
}
const ZONE_JOINT = { arm: 'elbowL', leg: 'kneeL', head: 'head' };
const act = {
  idle: () => { move = 'idle'; upper = 'free'; bodies.forEach(b => ZK.setMove(b.st, move, upper)); },
  shamble: () => { move = 'walk'; upper = 'free'; bodies.forEach(b => ZK.setMove(b.st, move, upper)); },
  'walk+reach': () => { move = 'walk'; upper = 'reach'; bodies.forEach(b => ZK.setMove(b.st, move, upper)); },
  run: () => { move = 'run'; upper = 'reach'; bodies.forEach(b => ZK.setMove(b.st, move, upper)); },
  swipeL: () => bodies.forEach(b => ZK.attack(b.st, 'swipeL')), swipeR: () => bodies.forEach(b => ZK.attack(b.st, 'swipeR')), grab: () => bodies.forEach(b => ZK.attack(b.st, 'grab')),
  'hit head': () => hitAll('head', 1.2), 'hit torso': () => hitAll('torso', 1.4), 'hit arm': () => hitAll('arm', 1), 'hit leg': () => hitAll('leg', 1.2),
  'sever arm': () => bodies.forEach(b => gore.sever(b.obj, 'elbowL', new THREE.Vector3(1, 0, -0.5))),
  'sever head': () => bodies.forEach(b => gore.sever(b.obj, 'head', new THREE.Vector3(0, 0.3, -1))),
  'sever leg': () => bodies.forEach(b => { gore.sever(b.obj, 'kneeL', new THREE.Vector3(0.5, 0, -1)); ZK.setCrawl(b.st); }),
  crawl: () => { crawl = true; move = 'walk'; bodies.forEach(b => { ZK.setCrawl(b.st); ZK.setMove(b.st, 'walk', 'reach'); }); },
  die: () => bodies.forEach(b => ZK.kill(b.st, 'torso', [0, -1])), 'die (legs)': () => bodies.forEach(b => ZK.kill(b.st, 'leg', [0, -1])),
  reset: () => { crawl = false; move = 'idle'; upper = 'free'; spawn(); },
};
function hitAll(zone, power) {
  for (const b of bodies) {
    ZK.hit(b.st, zone, [0, -1], 1, power);
    const wp = new THREE.Vector3(); const j = b.obj.userData.rig.joints[{ head: 'head', torso: 'chest', arm: 'elbowL', leg: 'thighL' }[zone]]; j.getWorldPosition(wp); wp.y += zone === 'head' ? 0.12 : -0.05; wp.z += 0.12;
    gore.wound(b.obj, zone, wp, new THREE.Vector3(0, 0, -1), 1);
  }
}
const bar = document.getElementById('bar');
const btn = (label, fn, group) => { const b = document.createElement('button'); b.textContent = label; b.onclick = () => { fn(); if (group) { for (const o of bar.querySelectorAll(`[data-g="${group}"]`)) o.classList.remove('on'); b.classList.add('on'); } }; if (group) b.dataset.g = group; bar.appendChild(b); return b; };
const sep = () => { const d = document.createElement('div'); d.className = 'sep'; bar.appendChild(d); };
for (const v of ZOMBIE_VARIANTS) btn(v, () => { variant = v; lineup = false; spawn(); }, 'v').classList.toggle('on', v === variant);
btn('lineup', () => { lineup = true; spawn(); }, 'v'); btn('seed +', () => { seed++; spawn(); }); sep();
for (const [k, fn] of Object.entries(act)) btn(k, fn);
spawn();

const info = document.getElementById('info');
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  for (const b of bodies) ZK.animate(b.obj, b.st, dt);
  gore.update(dt); controls.update(); renderer.render(scene, camera);
  let tris = 0; for (const b of bodies) b.obj.traverse(o => { if (o.isSkinnedMesh && o.visible) tris += o.geometry.index.count / 3; });
  info.textContent = `${lineup ? 'lineup' : variant}  seed ${seed}  ${move}${upper === 'reach' ? '+reach' : ''}${crawl ? ' crawl' : ''}\n${tris} triangles on screen`;
});
if (AUTOTEST) window.__z = { act, spawn, camera, controls, get bodies() { return bodies; }, set(v, s, l) { variant = v; seed = s; lineup = l; spawn(); } };
