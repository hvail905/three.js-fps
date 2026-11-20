// proto/sewer/main.js : the survival horror prototype. Input and presentation only;
// rules live in src/sim/survival.js and return events each tick.
import * as THREE from 'three';
import def from '../../data/sewer/gallery-1.json';
import movementData from '../../data/movement/standard.json';
import pistolData from '../../data/weapons/pistol.json';
import { createWeaponLibrary } from '../../src/assets/weapons.js';
import { createZombieKit, ZOMBIE_VARIANTS, setZombieModels } from '../../src/assets/zombie.js';
import { loadGalleryModels } from '../../src/assets/gallery-models.js';
import { setPropModels } from '../../src/world/sewer-props.js';
import { buildSewer } from '../../src/world/sewer.js';
import { SURFACES } from '../../src/world/level.js';
import { createLook } from '../../src/render/look.js';
import { createViewmodel, buildArm } from '../../src/render/viewmodel.js';
import { createCameraFeel, VIEW_DEFAULTS } from '../../src/render/camera-feel.js';
import { ParticleSystem, EFFECTS } from '../../src/fx/particles.js';
import { createGore } from '../../src/fx/gore.js';
import { SOUNDS, SPACES, playSound, impulse } from '../../src/audio/sfx.js';
import { DEFAULT_PARAMS } from '../../src/sim/movement.js';
import { makeGunState } from '../../src/sim/gun.js';
import { makeSurvival, stepSurvival, makeSurvivalInput, groundY, lookTarget, TICK, SURVIVAL_RULES } from '../../src/sim/survival.js';

const AUTOTEST = location.hash === '#autotest';
const $ = id => document.getElementById(id);
const D2R = THREE.MathUtils.degToRad, lerp = THREE.MathUtils.lerp;
const readLS = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
const mv = readLS('movelab.v2');
const P = { ...DEFAULT_PARAMS, ...movementData.sim, ...(mv && mv.sim || {}) };
const V = { ...VIEW_DEFAULTS, ...movementData.view, ...(mv && mv.view || {}) };
// slower, heavier pace for this level; slide thresholds scale too so a sprint can still drop into a slide
const PACE = def.pace ?? 1;
for (const k of ['walkSpeed', 'sprintSpeed', 'crouchSpeed', 'slideMinSpeed', 'slideMaxSpeed']) P[k] *= PACE;
const LOOKS = {};
for (const [path, f] of Object.entries(import.meta.glob('../../data/looks/*.json', { eager: true, import: 'default' }))) LOOKS[path.split('/').pop().replace('.json', '')] = f;

// ---------------------------------------------------------------- renderer, level, look
const root = $('root');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: AUTOTEST, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;
root.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(V.fov, 1, 0.03, 200);
scene.add(camera);
const look = createLook(renderer, scene, camera, { shadowExtent: 10, overlayParent: root });
look.sun.castShadow = false;
// Blender-built models first (props, fixtures, pickups, zombies); every one has a procedural fallback
const MODELS = await loadGalleryModels({ onProgress: f => { const el = document.getElementById('loading'); if (el) el.textContent = `loading ${Math.round(f * 100)}%`; } });
setPropModels(MODELS); setZombieModels(MODELS);
const level = buildSewer(def);
scene.add(level.root);
let lookKey = readLS('sewer.look') || 'sewer'; if (!LOOKS[lookKey]) lookKey = 'sewer';
function applyLook() { const st = look.apply(LOOKS[lookKey].look); look.sun.intensity = 0; look.hemi.intensity = def.ambient ?? (0.03 + 0.05 * (1 - st.night)); if (def.ambientSky) { look.hemi.color.set(def.ambientSky); look.hemi.groundColor.set(def.ambientGround || '#000000'); } VM.setLight(def.viewLight ?? 0.35); }
$('lookSel').innerHTML = Object.entries(LOOKS).map(([k, f]) => `<option value="${k}">${f.name}</option>`).join('');
$('lookSel').value = lookKey;
$('lookSel').onchange = () => { lookKey = $('lookSel').value; try { localStorage.setItem('sewer.look', JSON.stringify(lookKey)); } catch (e) {} applyLook(); };

// the flashlight is the main light: a shadowed spot hanging just right of the eyes
const flash = new THREE.SpotLight(0xfff1dc, 130, 28, 0.48, 0.7, 1.8);
flash.castShadow = true; flash.shadow.mapSize.set(1024, 1024); flash.shadow.bias = -0.0008; flash.shadow.camera.near = 0.1;
flash.position.set(0.18, -0.12, 0.35); camera.add(flash); // set back from the lens so things at arm's length do not blow out flash.target.position.set(0.05, -0.05, -1); camera.add(flash.target);
const fill = new THREE.PointLight(0xc8d4ff, 1.6, 6, 2); camera.add(fill); // faint bounce so walls next to you are not pure black
let lightOn = true;

const WLIB = createWeaponLibrary(THREE), ZK = createZombieKit();
const VM = createViewmodel(WLIB);
look.addOverlay(VM.scene, VM.camera);
applyLook();
const ps = new ParticleSystem(scene);
const feel = createCameraFeel();
const floorRay = new THREE.Raycaster(), worldRay = new THREE.Raycaster();
const floorAt = (x, z, fromY = 2) => { floorRay.set(new THREE.Vector3(x, fromY + 0.3, z), new THREE.Vector3(0, -1, 0)); floorRay.far = 6; const h = level.collider.bvh.raycastFirst(floorRay.ray, THREE.DoubleSide, 0, 6); return h ? h.point.y : 0; };
const raycast = (o, dir, far) => { worldRay.set(o, dir.clone().normalize()); const h = level.collider.bvh.raycastFirst(worldRay.ray, THREE.DoubleSide, 0, far); if (!h) return null; const n = h.face.normal.clone(); if (n.dot(dir) > 0) n.negate(); return { point: h.point, normal: n }; };
const gore = createGore(scene, { floorAt });

// ---------------------------------------------------------------- audio
let audio = null;
function initAudio() {
  if (audio) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const master = ctx.createGain(); master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5;
  master.connect(comp); comp.connect(ctx.destination);
  // concrete tunnels: long, dark reverb
  const space = { ...SPACES.garage, decay: 2.8, wet: 0.42, tone: 2600 }, dry = ctx.createGain(), wet = ctx.createGain(), conv = ctx.createConvolver();
  conv.buffer = impulse(ctx, space.decay, space); wet.gain.value = space.wet;
  dry.connect(master); conv.connect(wet); wet.connect(master);
  // ambience: water flow (filtered noise, slowly breathing), deep rumble
  const loop = (kind, f, q, g) => { const len = ctx.sampleRate * 3, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0); let last = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; d[i] = kind === 'brown' ? (last = (last + 0.02 * w) / 1.02) * 3.5 : w; } const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; const fl = ctx.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = f; fl.Q.value = q; const gg = ctx.createGain(); gg.gain.value = g; s.connect(fl); fl.connect(gg); gg.connect(dry); gg.connect(conv); s.start(); return { gg, fl }; };
  const water = loop('white', 900, 0.5, 0.0), rumble = loop('brown', 70, 0.7, 0.18);
  // fluorescent tubes hum at mains frequency, quietly, from where they hang
  for (const L of level.lights) if (L.kind === 'tube') {
    const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain(), pan = ctx.createPanner(), wp = new THREE.Vector3();
    o.type = 'sawtooth'; o.frequency.value = 120; lp.type = 'lowpass'; lp.frequency.value = 520; g.gain.value = 0.012;
    pan.panningModel = 'HRTF'; pan.refDistance = 1.2; pan.rolloffFactor = 1.6; L.light.getWorldPosition(wp); pan.positionX.value = wp.x; pan.positionY.value = wp.y; pan.positionZ.value = wp.z;
    o.connect(lp); lp.connect(g); g.connect(pan); pan.connect(dry); o.start(); L.buzz = g;
  }
  audio = { ctx, dry, conv, water, rumble };
}
function sound(id, preset, pos = null, tweak = null) {
  if (!audio) return 0;
  const s = SOUNDS[id], params = { ...(s.presets[preset] || Object.values(s.presets)[0]), ...(tweak || {}) };
  const { ctx } = audio, voice = ctx.createGain(); let tail = voice;
  if (pos) { const pan = ctx.createPanner(); pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = 2; pan.maxDistance = 80; pan.rolloffFactor = 1.3; pan.positionX.value = pos[0]; pan.positionY.value = pos[1]; pan.positionZ.value = pos[2]; voice.connect(pan); tail = pan; }
  tail.connect(audio.dry); tail.connect(audio.conv);
  const dur = playSound(ctx, voice, ctx.currentTime + 0.005, id, params);
  setTimeout(() => voice.disconnect(), (dur + 3) * 1000);
  return dur;
}
function drip(pos) { // a single water drop into a puddle
  if (!audio) return; const { ctx } = audio, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(), pan = ctx.createPanner();
  pan.panningModel = 'HRTF'; pan.refDistance = 1.5; pan.positionX.value = pos[0]; pan.positionY.value = pos[1]; pan.positionZ.value = pos[2];
  const f = 700 + Math.random() * 900; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 2.4, t + 0.05);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.12, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  o.connect(g); g.connect(pan); pan.connect(audio.dry); pan.connect(audio.conv); o.start(t); o.stop(t + 0.12);
}
const _fwd = new THREE.Vector3();
function updateListener() {
  if (!audio) return;
  const L = audio.ctx.listener; camera.getWorldDirection(_fwd); const p = new THREE.Vector3(); camera.getWorldPosition(p);
  if (L.positionX) { L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z; L.forwardX.value = _fwd.x; L.forwardY.value = _fwd.y; L.forwardZ.value = _fwd.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
  else { L.setPosition(p.x, p.y, p.z); L.setOrientation(_fwd.x, _fwd.y, _fwd.z, 0, 1, 0); }
  // the water gets louder near the channel
  let near = 99; const C = def.cell, pc = Math.floor(p.x / C), pr = Math.floor(p.z / C);
  for (let dr = -4; dr <= 4; dr++) for (let dc = -4; dc <= 4; dc++) if (def.map[pr + dr] && def.map[pr + dr][pc + dc] === '~') near = Math.min(near, Math.hypot(dc, dr) * C);
  audio.water.gg.gain.value = lerp(audio.water.gg.gain.value, 0.22 * Math.max(0, 1 - near / 10), 0.05);
}

// ---------------------------------------------------------------- the voice
const voiceQueue = []; let voiceT = 0, speaking = false;
// the intercom crackles from whichever speaker is nearest (speech synthesis itself cannot be positioned)
function nearestSpeaker() {
  const p = camera.getWorldPosition(new THREE.Vector3()); let best = null, bd = 1e9;
  for (const v of level.speakers) { const d = Math.hypot(v[0] - p.x, v[1] - p.y, v[2] - p.z); if (d < bd) { bd = d; best = v; } }
  return best;
}
function say(lines) { for (const l of lines) voiceQueue.push(l); }
function voiceTick(dt) {
  voiceT -= dt;
  if (voiceT > 0) return;
  if (!voiceQueue.length) { if (speaking) { speaking = false; $('sub').style.opacity = 0; sound('intercom', 'close', nearestSpeaker()); } return; }
  const line = voiceQueue.shift();
  if (!speaking) sound('intercom', 'open', nearestSpeaker());
  speaking = true;
  $('sub').querySelector('span').textContent = line; $('sub').style.opacity = 1;
  voiceT = 1.2 + line.split(/\s+/).length * 0.36;
  if ($('optVoice').checked && 'speechSynthesis' in window) {
    try {
      const u = new SpeechSynthesisUtterance(line); u.rate = 0.82; u.pitch = 0.45; u.volume = 0.9;
      const vs = speechSynthesis.getVoices(), pick = vs.find(v => /en-GB/i.test(v.lang) && /male|daniel|george|arthur/i.test(v.name)) || vs.find(v => /^en/i.test(v.lang));
      if (pick) u.voice = pick;
      speechSynthesis.speak(u);
    } catch (e) {}
  }
}
function note(text, time = 2.2) { const n = $('note'); n.textContent = text; n.style.opacity = 1; clearTimeout(note.h); note.h = setTimeout(() => n.style.opacity = 0, time * 1000); }

// ---------------------------------------------------------------- zombies (characters)
const JOINT = { head: 'head', armL: 'elbowL', armR: 'elbowR', legL: 'kneeL', legR: 'kneeR' };
const ZONE = { head: 'head', torso: 'torso', armL: 'arm', armR: 'arm', legL: 'leg', legR: 'leg' };

// ---------------------------------------------------------------- pickups
const PICK_LABEL = { pipe: 'length of pipe', pistol: 'pistol', ammo: 'pistol rounds', brick: 'brick', bottle: 'bottle', bandage: 'bandage' };
// Usable things stand apart from the grime the way Gloomwood's do: cleaner, slightly warmer and brighter
// materials, a faint self-light so they never sink fully into shadow, and a glint that catches the eye
// from across a room every few seconds. Meshes are centred so they turn about their physics body.
const glintTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); const r = g.createRadialGradient(16, 16, 0, 16, 16, 16); r.addColorStop(0, 'rgba(255,250,230,1)'); r.addColorStop(0.15, 'rgba(255,230,180,0.6)'); r.addColorStop(1, 'rgba(255,220,160,0)'); g.fillStyle = r; g.fillRect(0, 0, 32, 32); g.fillStyle = 'rgba(255,250,235,0.9)'; g.fillRect(15, 2, 2, 28); g.fillRect(2, 15, 28, 2); return new THREE.CanvasTexture(c); })();
const glintMat = new THREE.SpriteMaterial({ map: glintTex, color: 0xffe8c0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
function pickupMesh(kind) {
  let m;
  const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: o.r ?? 0.6, metalness: o.m ?? 0, emissive: o.e ?? color, emissiveIntensity: o.ei ?? 0.2, transparent: !!o.t, opacity: o.t ?? 1 });
  const model = MODELS['pick_' + kind];
  if (model) { m = model.scene.clone(true); m.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.emissive = new THREE.Color(0xffffff); o.material.emissiveMap = o.material.map; o.material.emissiveIntensity = 0.22; } }); } // the painted model, faintly self-lit
  else if (kind === 'pipe' || kind === 'pistol') { m = WLIB.build({ prop: kind }); m.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.multiplyScalar(2.2); o.material.metalness = Math.min(o.material.metalness, 0.35); o.material.roughness = Math.min(o.material.roughness, 0.45); o.material.emissive = o.material.color.clone(); o.material.emissiveIntensity = 0.25; } }); } // oiled, clean metal against the grime
  else if (kind === 'brick') m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.065, 0.1), M(0x9a4a32, { r: 0.85 }));
  else if (kind === 'bottle') { m = new THREE.Group(); m.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.17, 10), M(0x3a8a3a, { r: 0.08, m: 0.1, t: 0.85, ei: 0.2 })), new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.03, 0.07, 8).translate(0, 0.12, 0), M(0x3a8a3a, { r: 0.08, t: 0.85, ei: 0.2 }))); m.children[0].position.y = -0.0; m.position.y = -0.03; }
  else if (kind === 'ammo') { m = new THREE.Group(); m.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.08), M(0x6a6038)), new THREE.Mesh(new THREE.BoxGeometry(0.122, 0.025, 0.082), M(0xc8a030, { ei: 0.25 }))); }
  else { m = new THREE.Group(); m.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.09, 12), M(0xe8e2d4, { r: 0.9, ei: 0.2 })), new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.092, 0.082), M(0xb02018, { ei: 0.3 }))); } // bandage roll with a red cross band
  m.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  // centre on the bounding box so physics rotation pivots correctly
  const inner = new THREE.Group(); inner.add(m); const bb = new THREE.Box3().setFromObject(inner), c = bb.getCenter(new THREE.Vector3()); m.position.sub(c);
  inner.scale.setScalar(1.35); // drawn a little larger than life so they read at a glance; physics keeps the true size
  const g = new THREE.Group(); g.add(inner);
  const sp = new THREE.Sprite(glintMat.clone()); sp.scale.setScalar(0.12); sp.material.opacity = 0; g.add(sp); g.userData.glint = sp; g.userData.phase = Math.random() * 10;
  return g;
}
const PROP_HINT = { crate: 'crate', barrel: 'drum' };

// ---------------------------------------------------------------- round
let world = null, zvis = new Map(), pvis = new Map(), thrownVis = new Map(), ended = false, deadT = 0;
const lookYP = { yaw: 0, pitch: 0 }, recoilOff = { yaw: 0, pitch: 0 };
const prevPos = new THREE.Vector3(); let prevHeight = 1.8;
function startRound() {
  for (const v of zvis.values()) { scene.remove(v.obj); ZK.dispose(v.obj); } zvis.clear();
  for (const d of level.dynamics) d.synced = false;
  for (const v of pvis.values()) scene.remove(v); pvis.clear();
  for (const v of thrownVis.values()) scene.remove(v); thrownVis.clear();
  gore.clear();
  world = makeSurvival({ def, collider: level.collider, bounds: level.bounds, moveParams: P, pistolStats: pistolData.stats, seed: 11, layout: level });
  lookYP.yaw = world.player.yaw; lookYP.pitch = -0.05; recoilOff.yaw = recoilOff.pitch = 0;
  world.zombies.forEach((z, i) => {
    const obj = ZK.build(ZOMBIE_VARIANTS[i % ZOMBIE_VARIANTS.length], 3 + i * 7, z.height); obj.position.copy(z.pos); obj.rotation.y = z.yaw; scene.add(obj);
    zvis.set(z.id, { obj, z, prev: z.pos.clone(), prevYaw: z.yaw, anim: ZK.makeState(i + 1) });
  });
  for (const k of world.pickups) addPickupVis(k);
  prevPos.copy(world.player.body.pos); prevHeight = world.player.body.height; feel.reset();
  ended = false; deadT = 0; $('banner').style.display = 'none'; voiceQueue.length = 0; voiceT = 0;
  setHeld();
}
function addPickupVis(k) { const m = pickupMesh(k.kind); scene.add(m); pvis.set(k.id, m); syncPickup(k, m); }
function syncPickup(k, m) { if (k.phys) { const b = k.phys.body; m.position.set(b.position.x, b.position.y, b.position.z); m.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w); } else m.position.set(k.pos[0], k.pos[1] + 0.04, k.pos[2]); }

// ---------------------------------------------------------------- viewmodel: fists, pipe, pistol
// fists: two painted arms held up in a guard; each hand animates on its own
const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x2c2a24, roughness: 0.95, flatShading: true });
const fists = new THREE.Group(), fistR = buildArm(1, 'fist'), fistL = buildArm(-1, 'fist');
const FIST_REST = { R: [0.12, -0.1, -0.38, 0.05, 0.45, -0.15], L: [-0.14, -0.12, -0.42, 0.05, -0.5, 0.15] }; // knuckles toward the target, slightly turned in
fistR.position.set(...FIST_REST.R.slice(0, 3)); fistL.position.set(...FIST_REST.L.slice(0, 3)); fistR.scale.setScalar(0.85); fistL.scale.setScalar(0.85); fists.add(fistR, fistL);
const boot = new THREE.Group(); { const bm = new THREE.MeshStandardMaterial({ color: 0x1e1c1a, roughness: 0.7, flatShading: true }); const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.3), bm); const sole = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.03, 0.31), new THREE.MeshStandardMaterial({ color: 0x0c0b0a, roughness: 0.9 })); sole.position.y = -0.06; const toe = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.07, 0.06), bm); toe.position.set(0, -0.01, -0.16); const l = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.5, 8), sleeveMat); l.position.set(0, 0.27, 0.08); boot.add(b, sole, toe, l); boot.visible = false; VM.scene.add(boot); }
function setHeld() {
  const s = world.player.slot;
  VM.setWeapon(s === 'fists' ? null : s);
  if (s === 'fists') VM.root.add(fists); else fists.removeFromParent();
}
let swingT = -1, swingKind = 'fists', swingSide = 1, kickT = -1, throwT = -1, kick = 0, flashT = 0, hitStop = 0;

// ---------------------------------------------------------------- input
const keys = {}; let locked = AUTOTEST, attack = false, aimHeld = false, once = {};
const swayIn = { x: 0, y: 0 }, sway = { x: 0, y: 0 };
const canvas = renderer.domElement;
function requestLock() { initAudio(); if (audio && audio.ctx.state === 'suspended') audio.ctx.resume(); try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
$('bPlay').onclick = requestLock;
$('bRestart').onclick = () => { startRound(); requestLock(); };
$('bDebug').onclick = () => { const d = $('dbg'); d.style.display = d.style.display === 'block' ? 'none' : 'block'; };
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  $('menu').classList.toggle('hidden', locked);
  $('bPlay').textContent = world && world.time > 0 ? 'Resume' : 'Click to begin';
  if (!locked) { attack = aimHeld = false; for (const k in keys) keys[k] = false; if ('speechSynthesis' in window) speechSynthesis.pause(); } else if ('speechSynthesis' in window) speechSynthesis.resume();
});
document.addEventListener('mousemove', e => {
  if (!locked) return;
  const s = V.sensitivity * 0.001 * (aimBlend > 0.5 ? camera.fov / V.fov : 1);
  lookYP.yaw -= e.movementX * s; lookYP.pitch = Math.max(-1.55, Math.min(1.55, lookYP.pitch - e.movementY * s * (V.invertY ? -1 : 1)));
  swayIn.x += e.movementX; swayIn.y += e.movementY;
});
document.addEventListener('mousedown', e => { if (!locked) return; if (e.button === 0) attack = true; if (e.button === 2) aimHeld = true; });
document.addEventListener('mouseup', e => { if (e.button === 0) attack = false; if (e.button === 2) aimHeld = false; });
document.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('keydown', e => {
  if (e.code === 'Enter' && (ended || !locked)) { startRound(); if (!locked) requestLock(); return; }
  if (!locked) return;
  if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'KeyR', 'KeyQ', 'KeyE', 'KeyF', 'KeyG', 'KeyT', 'KeyH'].includes(e.code)) e.preventDefault();
  if (!keys[e.code]) {
    once[e.code] = true;
    if (e.code === 'KeyF') { lightOn = !lightOn; sound('ui', 'click', null, { volume: 0.3, pitch: 0.7 }); }
  }
  keys[e.code] = true;
});
addEventListener('keyup', e => { keys[e.code] = false; });
function sampleInput() {
  const i = makeSurvivalInput();
  i.moveZ = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0); i.moveX = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  i.sprint = !!(keys.ShiftLeft || keys.ShiftRight); i.jump = !!once.Space; i.crouch = !!keys.KeyC;
  i.yaw = lookYP.yaw; i.pitch = lookYP.pitch; i.attack = attack && locked; i.aim = aimHeld && locked;
  i.reload = !!once.KeyR; i.use = !!once.KeyE; i.kick = !!once.KeyQ; i.heal = !!once.KeyH;
  i.throwKind = once.KeyG ? 'brick' : once.KeyT ? 'bottle' : null;
  i.slot = once.Digit1 ? 0 : once.Digit2 ? 1 : once.Digit3 ? 2 : null;
  i.light = lightOn;
  once = {};
  return i;
}

// ---------------------------------------------------------------- events
const tmpV = new THREE.Vector3(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _p2 = new THREE.Vector3(), _off = new THREE.Vector3(), _m4 = new THREE.Matrix4(), _one = new THREE.Vector3(1, 1, 1);
let hurtT = 0, shake = 0, hitT = 0, splatAlpha = 0;
const splat = $('splat'), sctx = splat.getContext('2d');
function bloodOnScreen(amount) {
  splat.width = innerWidth / 2; splat.height = innerHeight / 2;
  sctx.clearRect(0, 0, splat.width, splat.height);
  for (let i = 0; i < 6 + amount * 10; i++) {
    const edge = Math.random() < 0.5, x = edge ? (Math.random() < 0.5 ? Math.random() * 0.25 : 1 - Math.random() * 0.25) * splat.width : Math.random() * splat.width, y = edge ? Math.random() * splat.height : (Math.random() < 0.5 ? Math.random() * 0.25 : 1 - Math.random() * 0.25) * splat.height;
    const r = 6 + Math.random() * 40; sctx.fillStyle = `rgba(${90 + Math.random() * 40 | 0},0,0,${0.5 + Math.random() * 0.4})`;
    sctx.beginPath(); sctx.arc(x, y, r, 0, 7); sctx.fill();
    for (let k = 0; k < 4; k++) { sctx.fillRect(x - 1.5, y, 3, r * (1 + Math.random() * 3)); }
  }
  splatAlpha = Math.min(1, 0.5 + amount * 0.5);
}
function onEvents(evs) {
  for (const e of evs) {
    switch (e.type) {
      case 'shot': {
        lookYP.pitch += e.recoil.up; lookYP.yaw += e.recoil.side; recoilOff.pitch += e.recoil.up; recoilOff.yaw += e.recoil.side;
        kick = 1; flashT = 0.06; shake = Math.max(shake, 0.6);
        const m = VM.muzzleWorld(camera, new THREE.Vector3()); camera.getWorldDirection(tmpV);
        EFFECTS.muzzle(ps, m, tmpV, 0.45); EFFECTS.dust(ps, m.clone().addScaledVector(tmpV, 0.6), tmpV, 0.35, 0x2a2826); // dark smoke: particles are unlit, so keep them dim in the dark
        muzzleLight.position.copy(m); muzzleLight.intensity = 60;
        sound('gunshot', 'pistol', null, { tail: 0.9, tailLength: 1.2, slap: 0.7 });
        break;
      }
      case 'impact': {
        const p = new THREE.Vector3(...e.point), n = new THREE.Vector3(...e.normal), surf = SURFACES[e.surface];
        if (surf === 'water') { EFFECTS.dust(ps, p, n, 0.6, 0x3a4234); sound('footstep', 'water', e.point, { count: 1, weight: 0.4 }); }
        else { EFFECTS.dust(ps, p, n, 0.5, 0x3a3832); EFFECTS.sparks(ps, p, n, surf === 'metal' ? 0.8 : 0.3); gore.addDecal(p, n, 0.05); sound('impact', surf === 'metal' ? 'metal' : 'concrete', e.point, { power: 0.6 }); }
        break;
      }
      case 'zhit': {
        const v = zvis.get(e.zombie); if (!v) break;
        const p = new THREE.Vector3(...e.point), d = new THREE.Vector3(...e.dir), strength = e.source === 'bullet' ? 1 : e.blunt ? 0.7 : 1;
        gore.wound(v.obj, ZONE[e.limb], p, d, strength);
        gore.spatter(p, d, { raycast, amount: e.source === 'bullet' ? 1.2 : 0.6 });
        EFFECTS.dust(ps, p, d.clone().negate(), 0.5, 0x3a0404);
        if (e.severed) { gore.sever(v.obj, JOINT[e.severed], d); sound('impact', 'body', e.point, { power: 1.1 }); if (e.severed.startsWith('leg')) note('it goes down'); }
        if (!e.killed) ZK.hit(v.anim, ZONE[e.limb], e.local, e.side, Math.min(1.6, 0.6 + e.dmg / 22) * (e.blunt ? 1.2 : 1));
        sound('impact', 'body', e.point, { power: e.blunt ? 0.9 : 0.7 });
        if (e.source === 'pipe') sound('impact', 'metal', e.point, { power: 0.25 });
        hitT = 0.2; $('hm').classList.toggle('kill', !!e.killed);
        if (e.source === 'pipe' || e.source === 'fists' || e.source === 'kick') { hitStop = e.source === 'pipe' ? 0.085 : 0.05; shake = Math.max(shake, e.source === 'pipe' ? 0.35 : 0.2); } // contact: freeze the swing for a beat
        break;
      }
      case 'zdied': {
        const v = zvis.get(e.zombie); if (!v) break;
        ZK.kill(v.anim, ZONE[e.limb] || 'torso', e.local); // crawlers die where they lie
        setTimeout(() => gore.pool(v.z.pos, 1.3), 700);
        break;
      }
      case 'swing': swingT = 0; swingKind = e.weapon; swingSide = -swingSide; sound('swing', e.weapon === 'pipe' ? 'pipe' : 'fist'); break;
      case 'kick': kickT = 0; sound('swing', 'kick'); break;
      case 'kickResolve': if (e.hit) { sound('impact', 'body', null, { power: 0.9 }); shake = Math.max(shake, 0.3); } break;
      case 'meleeWall': { const p = new THREE.Vector3(...e.point), n = new THREE.Vector3(...e.normal); EFFECTS.dust(ps, p, n, 0.3, 0x3a3832); if (e.weapon === 'pipe') EFFECTS.sparks(ps, p, n, 0.5); sound('impact', e.weapon === 'pipe' ? 'metal' : 'concrete', e.point, { power: 0.5 }); break; }
      case 'whiff': break;
      case 'broke': note('THE PIPE BREAKS'); sound('impact', 'metal', null, { power: 1 }); setHeld(); break;
      case 'slot': setHeld(); break;
      case 'reloadStart': sound('reload', 'magazine', null, { speed: 1 }); break;
      case 'dry': sound('ui', 'click', null, { volume: 0.5, pitch: 0.6 }); note('EMPTY'); break;
      case 'throw': throwT = 0; sound('swing', 'throw'); break;
      case 'thrownMove': { let m = thrownVis.get(e.id); if (!m) { m = pickupMesh(e.kind); scene.add(m); thrownVis.set(e.id, m); } m.position.set(...e.pos); m.rotation.x += e.spin * TICK; break; }
      case 'shatter': { const m = thrownVis.get(e.id); if (m) { scene.remove(m); thrownVis.delete(e.id); } const p = new THREE.Vector3(...e.point); EFFECTS.sparks(ps, p, new THREE.Vector3(...e.normal), 0.8); sound('impact', 'glass', e.point, { power: 1 }); break; }
      case 'propHit': {
        const pt = new THREE.Vector3(...e.point), n = new THREE.Vector3(...(e.normal || [0, 1, 0])), surf = SURFACES[e.surface];
        EFFECTS.dust(ps, pt, n, 0.4 + e.power * 0.4, surf === 'wood' ? 0x5a4630 : 0x3a3832); if (surf === 'metal') EFFECTS.sparks(ps, pt, n, 0.3 * e.power);
        sound('impact', surf === 'metal' ? 'metal' : surf === 'wood' ? 'wood' : 'concrete', e.point, { power: 0.5 + e.power * 0.6 });
        if (e.source === 'pipe' || e.source === 'fists') { hitStop = 0.05; shake = Math.max(shake, 0.18); }
        break;
      }
      case 'propBump': { const surf = SURFACES[e.surface]; sound('impact', surf === 'metal' ? 'metal' : surf === 'wood' ? 'wood' : surf === 'glass' ? 'glass' : 'concrete', e.point, { power: 0.25 + e.power * 0.5 }); break; }
      case 'thud': { const m = thrownVis.get(e.id); if (m) { scene.remove(m); thrownVis.delete(e.id); } sound('impact', 'concrete', e.point, { power: 0.8 }); if (e.pickup) addPickupVis(e.pickup); break; }
      case 'pickup': { const m = pvis.get(e.id); if (m) { scene.remove(m); pvis.delete(e.id); } sound('reload', 'bolt', null, { speed: 1.6, weight: 0.3 }); note(`Took the ${PICK_LABEL[e.kind]}`, 1.4); if (e.kind === 'pipe' || e.kind === 'pistol') setHeld(); break; }
      case 'pickupFull': note(`Can't carry more`, 1.2); break;
      case 'healStart': note('Bandaging...', 1.4); sound('swing', 'fist', null, { weight: 0.1, speed: 0.5 }); break;
      case 'healed': note('Bleeding stopped', 1.2); break;
      case 'step': sound('footstep', e.surface === 'water' ? 'water' : e.surface === 'metal' ? 'metal' : 'concrete', null, { count: 1, weight: e.sprint ? 0.85 : e.crouch ? 0.25 : 0.5 }); break;
      case 'groan': sound('groan', e.angry ? (Math.random() < 0.6 ? 'snarl' : 'gurgle') : (Math.random() < 0.7 ? 'moan' : 'gurgle'), e.pos); break;
      case 'zalert': { const z = world.zombies.find(q => q.id === e.zombie); if (z) sound('groan', 'snarl', [z.pos.x, z.pos.y + 1.5, z.pos.z], { pitch: 140, length: 0.9 }); break; }
      case 'zwindup': { const v = zvis.get(e.zombie); if (v) ZK.attack(v.anim); break; }
      case 'zmiss': break;
      case 'hurt': {
        hurtT = 0.6; shake = Math.max(shake, 1); bloodOnScreen(e.dmg / 20);
        lookYP.pitch += (Math.random() - 0.3) * 0.08; lookYP.yaw += (Math.random() - 0.5) * 0.1;
        sound('impact', 'body', null, { power: 1 }); sound('groan', 'moan', null, { pitch: 150, length: 0.35, rasp: 0.2, vowel: 1 });
        break;
      }
      case 'trigger': { const t = def.triggers.find(x => x.id === e.id); if (t && t.voice) say(t.voice); break; }
      case 'died': {
        ended = true; deadT = 0.001; VM.root.visible = false; attack = aimHeld = false;
        say([def.deathLines[Math.floor(Math.random() * def.deathLines.length)]]);
        $('banner').querySelector('h1').textContent = 'YOU DIED';
        $('banner').querySelector('p').textContent = `${world.stats.kills} put down · ${world.stats.severed} limbs taken · Enter to try again`;
        setTimeout(() => { if (ended) $('banner').style.display = 'block'; }, 1200);
        break;
      }
      case 'escaped': {
        ended = true;
        $('banner').querySelector('h1').textContent = 'GALLERY CLEARED';
        $('banner').querySelector('p').textContent = `${fmt(e.time)} · ${world.stats.kills} put down · ${world.stats.severed} limbs taken · end of prototype · Enter to replay`;
        setTimeout(() => { $('banner').style.display = 'block'; }, 2500);
        break;
      }
    }
  }
}
const fmt = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const muzzleLight = new THREE.PointLight(0xffc27a, 0, 14, 1.6); scene.add(muzzleLight);

// ---------------------------------------------------------------- loop
let acc = 0, aimBlend = 0, dripT = 0;
const clock = new THREE.Clock(), pos = new THREE.Vector3();
let fps = 0, frames = 0, fpsT = 0;
function resize() { const w = root.clientWidth, h = root.clientHeight; renderer.setSize(w, h, false); look.setSize(w, h); camera.aspect = VM.camera.aspect = w / h; camera.updateProjectionMatrix(); VM.camera.updateProjectionMatrix(); }
addEventListener('resize', resize);
startRound(); resize();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (locked) {
    acc += dt; let n = 0;
    while (acc >= TICK && n++ < 8) {
      prevPos.copy(world.player.body.pos); prevHeight = world.player.body.height;
      for (const v of zvis.values()) { v.prev.copy(v.z.pos); v.prevYaw = v.z.yaw; }
      onEvents(stepSurvival(world, sampleInput()));
      if (world.player.pistol && world.player.slot === 'pistol') { const rec = Math.min(1, world.pistolStats.recoilRecovery * TICK), dp = recoilOff.pitch * rec, dy = recoilOff.yaw * rec; lookYP.pitch -= dp; recoilOff.pitch -= dp; lookYP.yaw -= dy; recoilOff.yaw -= dy; }
      acc -= TICK;
    }
    if (n >= 8) acc = 0;
    voiceTick(dt);
    dripT -= dt; if (dripT <= 0) { dripT = 0.4 + Math.random() * 1.6; const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 8, p = world.player.body.pos; drip([p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r]); }
  }
  present(dt, locked ? acc / TICK : 1);
  frames++; fpsT += dt; if (fpsT > 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; }
});

function present(dt, alpha) {
  const pl = world.player, body = pl.body;
  pos.lerpVectors(prevPos, body.pos, alpha);
  let height = lerp(prevHeight, body.height, alpha);
  if (deadT > 0) { deadT += dt; height = lerp(height, 0.35, Math.min(1, deadT * 2)); }
  const g = pl.pistol, vm = VM.weapon && VM.weapon.userData.viewmodel, t = pl.slot === 'pistol' && vm && vm.ads && g ? g.ads : 0;
  aimBlend = t;
  feel.update(camera, dt, { pos, height, player: body, yaw: lookYP.yaw, pitch: lookYP.pitch, V, P, fovOverride: t > 0.001 ? lerp(V.fov, vm.ads.cameraFov, t) : null });
  // camera shake from shots and hits
  shake = Math.max(0, shake - dt * 3);
  if (shake > 0) { camera.rotation.x += (Math.random() - 0.5) * 0.012 * shake; camera.rotation.y += (Math.random() - 0.5) * 0.012 * shake; }
  if (deadT > 0) camera.rotation.z = lerp(0, 1.3, Math.min(1, deadT * 1.5));
  camera.updateMatrixWorld();
  flash.visible = lightOn; flash.intensity = lightOn ? 115 * (0.96 + Math.random() * 0.04) : 0; fill.intensity = lightOn ? 1.6 : 0.4;

  // viewmodel: hip pose + bob/sway + melee swings, kicks and throws
  const fx = feel.fx, s = V.weaponSway * (1 - t), sb = fx.sprintBlend * (1 - t);
  sway.x = lerp(sway.x, Math.max(-40, Math.min(40, swayIn.x)), Math.min(1, dt * 10)); sway.y = lerp(sway.y, Math.max(-40, Math.min(40, swayIn.y)), Math.min(1, dt * 10)); swayIn.x = swayIn.y = 0;
  kick = Math.max(0, kick - dt * 10); flashT -= dt;
  const hp = vm ? vm.hip.position : [0, 0, 0], hr = vm ? vm.hip.rotationDeg : [0, 0, 0], ap = vm && vm.ads ? vm.ads.position : hp;
  let swX = 0, swY = 0, swZ = 0, swRx = 0, swRy = 0, swRz = 0;
  // melee: anticipation, a fast strike, follow-through, recovery. A hit freezes the motion briefly (hit-stop).
  const adv = hitStop > 0 ? 0 : dt; hitStop = Math.max(0, hitStop - dt);
  const ease = (x, p = 3) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), p), smooth = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
  const keyed = (tt, keys) => { // keys: [[time, [x,y,z,rx,ry,rz]], ...], eased between
    if (tt <= keys[0][0]) return keys[0][1]; for (let i = 1; i < keys.length; i++) if (tt <= keys[i][0]) { const [t0, a0] = keys[i - 1], [t1, a1, e] = keys[i], k = (e || smooth)((tt - t0) / (t1 - t0)); return a0.map((v, j) => v + (a1[j] - v) * k); } return keys[keys.length - 1][1]; };
  let fR = [0, 0, 0, 0, 0, 0], fL = [0, 0, 0, 0, 0, 0];
  if (swingT >= 0) {
    const M = SURVIVAL_RULES.melee[swingKind], W = M.windup, total = W + M.recover; swingT += adv;
    if (swingKind === 'pipe') { // over the right shoulder, then a diagonal chop down to the left
      [swX, swY, swZ, swRx, swRy, swRz] = keyed(swingT, [
        [0, [0, 0, 0, 0, 0, 0]], [W, [0.06, 0.08, 0.06, 0.65, -0.55, 0.2], x => ease(x, 2)],
        [W + 0.09, [-0.2, -0.1, -0.1, -0.55, 1.05, -0.3], x => ease(x, 4)], [W + 0.2, [-0.25, -0.15, -0.06, -0.35, 1.25, -0.4], x => ease(x, 2)],
        [total, [0, 0, 0, 0, 0, 0]]]);
    } else { // alternate jabs and hooks: pull back, drive through the centre line
      const S = swingSide > 0 ? 'R' : 'L', sg = swingSide;
      const k = keyed(swingT, [[0, [0, 0, 0, 0, 0, 0]], [W, [sg * 0.03, -0.02, 0.07, 0.15, sg * 0.2, 0], x => ease(x, 2)],
        [W + 0.08, [-sg * 0.1, 0.04, -0.24, -0.15, -sg * 0.35, -sg * 0.3], x => ease(x, 4)], [W + 0.16, [-sg * 0.11, 0.03, -0.22, -0.1, -sg * 0.3, -sg * 0.25]], [total, [0, 0, 0, 0, 0, 0]]]);
      if (S === 'R') fR = k; else fL = k;
      swRz = -sg * 0.05 * Math.sin(Math.min(1, swingT / (W + 0.1)) * Math.PI); // a little body roll into the punch
    }
    if (swingT > total) swingT = -1;
  }
  if (world.player.slot === 'pipe') { swY += 0.07; swX -= 0.02; } // lift the pipe so the gripping hand shows
  if (AUTOTEST && window.__vmPose) [swX, swY, swZ, swRx, swRy, swRz] = window.__vmPose;
  let gripRot = [0, 0, 0];
  if (world.player.slot === 'pipe' || world.player.slot === 'fists') { gripRot = [swRx, swRy, swRz]; swRx = swRy = swRz = 0; }
  if (VM.weapon) VM.weapon.rotation.set(gripRot[0], gripRot[1], gripRot[2], 'YXZ');
  fistR.position.set(FIST_REST.R[0] + fR[0], FIST_REST.R[1] + fR[1], FIST_REST.R[2] + fR[2]); fistR.rotation.set(FIST_REST.R[3] + fR[3], FIST_REST.R[4] + fR[4], FIST_REST.R[5] + fR[5]);
  fistL.position.set(FIST_REST.L[0] + fL[0], FIST_REST.L[1] + fL[1], FIST_REST.L[2] + fL[2]); fistL.rotation.set(FIST_REST.L[3] + fL[3], FIST_REST.L[4] + fL[4], FIST_REST.L[5] + fL[5]);
  if (throwT >= 0) { // wind back past the ear, then whip forward and down
    throwT += adv; [swX, swY, swZ, swRx, swRy, swRz] = keyed(throwT, [[0, [0, 0, 0, 0, 0, 0]], [0.16, [0.08, 0.16, 0.12, -0.9, -0.2, 0.3], x => ease(x, 2)], [0.26, [-0.06, -0.12, -0.2, 0.6, 0.2, -0.2], x => ease(x, 4)], [0.5, [0, 0, 0, 0, 0, 0]]]);
    if (throwT > 0.5) throwT = -1;
  }
  const reloadDip = g && g.reloadT > 0 && pl.slot === 'pistol' ? Math.sin(Math.min(1, g.reloadT / 0.4) * Math.PI / 2) : 0;
  const healDip = pl.action && pl.action.kind === 'heal' ? 1 : 0;
  VM.root.position.set(lerp(hp[0], ap[0], t) + fx.bobX * 0.6 * s - sway.x * 0.0004 * s - sb * 0.04 + swX, lerp(hp[1], ap[1], t) - reloadDip * 0.12 - healDip * 0.25 - fx.bobY * 0.6 * s + sway.y * 0.0004 * s - sb * 0.04 + fx.dip * 0.06 + swY, lerp(hp[2], ap[2], t) + kick * 0.05 + sb * 0.03 + swZ);
  VM.root.rotation.set(D2R(lerp(hr[0], 0, t)) + kick * 0.15 - reloadDip * 0.6 - sb * 0.25 + sway.y * 0.0012 * s + swRx, D2R(lerp(hr[1], 0, t)) + sb * 0.55 + sway.x * 0.0012 * s + swRy, D2R(lerp(hr[2], 0, t)) + reloadDip * 0.4 + sb * 0.2 + fx.roll * 1.5 + swRz, 'XYZ');
  VM.flash.visible = flashT > 0 && pl.slot === 'pistol';
  VM.root.visible = deadT === 0;
  if (kickT >= 0) { // chamber the knee, stamp out, pull back
    kickT += adv; const [bx, by, bz, brx] = keyed(kickT, [[0, [0.06, -0.95, -0.1, -0.2]], [0.14, [0.05, -0.55, -0.18, -0.9], x => ease(x, 2)], [0.22, [0.04, -0.42, -0.62, -0.15], x => ease(x, 5)], [0.3, [0.04, -0.44, -0.58, -0.2]], [0.5, [0.06, -0.95, -0.1, -0.2]]]);
    boot.visible = true; boot.position.set(bx, by, bz); boot.rotation.x = brx; if (kickT > 0.5) { kickT = -1; boot.visible = false; } }

  // zombies: interpolate, animate, lunge on attack windup, crawl when legless
  for (const v of zvis.values()) {
    const z = v.z;
    v.obj.position.lerpVectors(v.prev, z.pos, alpha);
    let dy = z.yaw - v.prevYaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    v.obj.rotation.y = v.prevYaw + dy * alpha;
    if (z.alive) {
      if (z.crawl && !v.anim.crawl) ZK.setCrawl(v.anim);
      const legs = z.speed > 2 ? 'run' : z.speed > 0.15 ? 'walk' : 'idle';
      ZK.setMove(v.anim, legs, z.state === 'chase' || z.state === 'attack' ? 'reach' : 'free');
      v.anim.rate = (z.state === 'chase' ? 1.0 : 0.75) * (0.88 + (z.id % 3) * 0.07) * (z.crawl ? 0.8 : 1);
    }
    ZK.animate(v.obj, v.anim, dt);
  }
  // loose physical objects follow their bodies
  for (const d of level.dynamics) {
    const o = d.phys; if (!o) continue; const b = o.body; if (b.sleepState === 2 && d.synced) continue;
    _q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w); _p.set(b.position.x, b.position.y, b.position.z);
    if (d.group) { _off.set(0, -o.half[1], 0).applyQuaternion(_q); d.group.position.copy(_p).add(_off); d.group.quaternion.copy(_q); }
    else if (d.inst) { _m4.compose(_p, _q, _one); d.inst.setMatrixAt(d.index, _m4); d.inst.instanceMatrix.needsUpdate = true; }
    d.synced = true;
  }
  // pickups: follow their bodies, glint now and then when in view, and the one you look at gets the prompt
  const aimed = lookTarget(world), camPos = camera.getWorldPosition(_p2);
  for (const k of world.pickups) {
    const m = pvis.get(k.id); if (!m) continue; syncPickup(k, m);
    const dist = m.position.distanceTo(camPos), ph = (world.time + m.userData.phase) % 1.9, flash = ph < 0.3 ? Math.sin(ph / 0.3 * Math.PI) : 0;
    m.userData.glint.material.opacity = dist < 12 ? flash * Math.min(1, (12 - dist) / 4) * (aimed.pickup === k ? 0.4 : 0.9) : 0;
    m.userData.glint.position.set(0, 0.03, 0); m.userData.glint.scale.setScalar(0.08 + dist * 0.012);
  }
  const prompt = aimed.pickup ? `E  take ${PICK_LABEL[aimed.pickup.kind]}` : aimed.prop ? `Q  kick the ${PROP_HINT[aimed.prop.kind] || aimed.prop.kind}   ·   walk into it to shove` : '';
  $('prompt').style.opacity = prompt && !ended ? 1 : 0; if (prompt) $('prompt').textContent = prompt;
  // flickering bulbs
  // lights: tubes stutter in bursts, bulbs sag and brown out, cages and emergency lamps hold steady
  for (const L of level.lights) {
    let f = 1;
    if (L.flicker > 0) {
      if (L.kind === 'tube') { L.burst = (L.burst || 0) - dt; if (L.burst <= 0 && Math.random() < L.flicker * dt * 0.6) L.burst = 0.15 + Math.random() * 0.5; if (L.burst > 0) f = Math.random() < 0.5 ? 0.05 : 1; }
      else { L.sag = lerp(L.sag ?? 1, Math.random() < L.flicker * 0.05 ? 0.25 + Math.random() * 0.4 : 1, 0.15); f = L.sag; }
    }
    if (L.kind === 'red') f *= 0.75 + 0.25 * Math.sin(world.time * 3 + L.phase);
    L.light.intensity = L.base * f; if (L.bulb) L.bulb.material.emissiveIntensity = (L.kind === 'tube' ? 0.8 : 2.2) * f; if (L.buzz) L.buzz.gain.value = 0.012 * f;
  }
  // cameras: turn to follow the player inside their arc, otherwise sweep slowly; the LED blinks
  { const pp = camera.getWorldPosition(new THREE.Vector3());
    for (const cam of level.cameras) {
      const lp = cam.group.worldToLocal(pp.clone()).sub(cam.head.position), dist = lp.length();
      let yaw = Math.sin(world.time * 0.3 + cam.phase) * 0.9, pitch = 0.35;
      if (dist < 16 && lp.z > 0.2) { yaw = Math.max(-1.3, Math.min(1.3, Math.atan2(lp.x, lp.z))); pitch = Math.atan2(-lp.y, Math.hypot(lp.x, lp.z)); }
      cam.head.rotation.order = 'YXZ'; cam.head.rotation.y = lerp(cam.head.rotation.y, yaw, Math.min(1, dt * 2.5)); cam.head.rotation.x = lerp(cam.head.rotation.x, pitch, Math.min(1, dt * 2.5));
      cam.led.material.emissiveIntensity = (world.time + cam.phase) % 1.4 < 0.18 ? 4 : 0.3;
    } }
  muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 600);
  if (level.water) level.water.material.normalMap.offset.set(0, (world.time * 0.08) % 1);
  ps.update(dt); gore.update(dt);
  look.tick(dt); updateListener();
  hud(dt);
  renderer.info.reset(); look.render();
}

function hud(dt) {
  const p = world.player;
  hurtT = Math.max(0, hurtT - dt); hitT = Math.max(0, hitT - dt); splatAlpha = Math.max(0, splatAlpha - dt * 0.25);
  $('hurt').style.opacity = String(Math.min(1, hurtT * 1.4 + (p.alive ? Math.max(0, (45 - p.hp) / 55) : 0.8)));
  $('splat').style.opacity = String(splatAlpha);
  $('hm').style.opacity = String(hitT / 0.2);
  $('hp').querySelector('i').style.width = Math.max(0, p.hp) + '%';
  const inv = $('inv');
  if (p.slot === 'pistol' && p.pistol) { inv.querySelector('.w').textContent = `${p.pistol.ammo} | ${p.reserve}`; inv.querySelector('.dur').style.display = 'none'; }
  else if (p.slot === 'pipe' && p.pipe) { inv.querySelector('.w').textContent = 'PIPE'; inv.querySelector('.dur').style.display = 'block'; inv.querySelector('.dur i').style.width = (100 * p.pipe.durability / SURVIVAL_RULES.melee.pipe.durability) + '%'; }
  else { inv.querySelector('.w').textContent = 'FISTS'; inv.querySelector('.dur').style.display = 'none'; }
  inv.querySelector('.items').textContent = `brick ${p.bricks} · bottle ${p.bottles} · bandage ${p.bandages}${p.pistol && p.slot !== 'pistol' ? ` · rounds ${p.pistol.ammo + p.reserve}` : ''}`;
  if ($('dbg').style.display === 'block') {
    const i = renderer.info.render, gs = gore.stats();
    $('dbg').textContent = `${fps.toFixed(0)} fps · ${i.calls} calls · ${(i.triangles / 1000).toFixed(0)}k tris\npos ${p.body.pos.x.toFixed(1)} ${p.body.pos.y.toFixed(2)} ${p.body.pos.z.toFixed(1)} · hp ${p.hp.toFixed(0)} · light ${lightOn ? 'on' : 'off'}\nzombies ${world.zombies.map(z => z.alive ? z.state + (z.crawl ? '/crawl' : '') : 'dead').join(' · ')}\ngore ${gs.decals} decals · ${gs.drips} drops · ${gs.gibs} gibs · ${gs.wounds} wounds`;
  }
}

// ---------------------------------------------------------------- headless test hook
if (AUTOTEST) {
  $('menu').classList.add('hidden');
  window.__s = {
    get world() { return world; }, lookYP, keys, gore, pvis: () => pvis,
    set attack(v) { attack = v; }, set aim(v) { aimHeld = v; }, press(code) { once[code] = true; },
    debug(on) { $('dbg').style.display = on ? 'block' : 'none'; },
    teleport(x, z, yaw) { world.player.body.pos.set(x, 0.1, z); world.player.body.vel.set(0, 0, 0); prevPos.copy(world.player.body.pos); if (yaw !== undefined) lookYP.yaw = yaw; },
    give() { const p = world.player; p.pipe = { durability: 14 }; p.pistol = p.pistol || makeGunState(world.pistolStats); p.reserve = 12; p.bricks = 3; p.bottles = 3; p.bandages = 2; },
    aimAt(i, h = 1.25) { const z = world.zombies[i], b = world.player.body, ex = b.pos.x, ey = b.pos.y + b.height - 0.12, ez = b.pos.z, dx = z.pos.x - ex, dy = z.pos.y + h * z.height / 1.8 - ey, dz = z.pos.z - ez; lookYP.yaw = Math.atan2(-dx, -dz); lookYP.pitch = Math.atan2(dy, Math.hypot(dx, dz)); },
    god() { world.player.hp = world.player.maxHp = 1e6; },
    slot(n) { world.player.slot = n; setHeld(); },
    light(v) { lightOn = v; },
  };
}
