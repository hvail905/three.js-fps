// game/main.js : the playable slice. Everything here is presentation and input; the rules live in
// src/sim/world.js. Each fixed tick: sample input -> stepWorld -> react to the returned events.
import * as THREE from 'three';
import layout from '../data/levels/city-block.json';
import movementData from '../data/movement/standard.json';
import aiData from '../data/ai/default.json';
import { createPropLibrary } from '../src/assets/props.js';
import { createVehicleLibrary } from '../src/assets/vehicles.js';
import { createFacadeLibrary } from '../src/assets/facades.js';
import { createWeaponLibrary } from '../src/assets/weapons.js';
import { createCharacterLibrary } from '../src/assets/characters.js';
import { createLevelKit, SURFACES } from '../src/world/level.js';
import { createLook, LOOK_DEFAULT } from '../src/render/look.js';
import { createViewmodel } from '../src/render/viewmodel.js';
import { mergeStatic } from '../src/render/merge.js';
import { createCameraFeel, VIEW_DEFAULTS } from '../src/render/camera-feel.js';
import { ParticleSystem, EFFECTS } from '../src/fx/particles.js';
import { SOUNDS, SPACES, playSound, impulse } from '../src/audio/sfx.js';
import { DEFAULT_PARAMS } from '../src/sim/movement.js';
import { currentSpread } from '../src/sim/gun.js';
import { makeWorld, addPlayer, addActor, stepWorld, makeInput, TICK, currentWeapon, eyePosition, enableAI } from '../src/sim/world.js';

const AUTOTEST = location.hash === '#autotest';
const $ = id => document.getElementById(id);
const D2R = THREE.MathUtils.degToRad, lerp = THREE.MathUtils.lerp;
const readLS = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };

// ---------------------------------------------------------------- settings (data files, then lab overrides)
// Labs share this site's storage, so anything you tuned and left in a lab is picked up here.
const mv = readLS('movelab.v2');
const P = { ...DEFAULT_PARAMS, ...movementData.sim, ...(mv && mv.sim || {}) };
const V = { ...VIEW_DEFAULTS, ...movementData.view, ...(mv && mv.view || {}) };
const WEAPONS = {}, LABELS = {};
for (const f of Object.values(import.meta.glob('../data/weapons/*.json', { eager: true, import: 'default' }))) { WEAPONS[f.id] = { ...f.stats }; LABELS[f.id] = f.label; }
const gl = readLS('gunlab.v1'); if (gl) for (const id in WEAPONS) Object.assign(WEAPONS[id], gl[id] || {});
const AI_PARAMS = { ...aiData.params, ...(readLS('ailab.params') || {}) };
const LOADOUT = ['rifle', 'smg', 'shotgun', 'pistol', 'sniper', 'revolver'].filter(id => WEAPONS[id]);
const LOOKS = {};
for (const [path, f] of Object.entries(import.meta.glob('../data/looks/*.json', { eager: true, import: 'default' }))) LOOKS[path.split('/').pop().replace('.json', '')] = f;
const vfx = readLS('vfxlab.v2');
if (vfx) LOOKS['effects-lab'] = { name: 'Effects lab (current)', look: vfx };

// ---------------------------------------------------------------- renderer, look, level
const root = $('root');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: AUTOTEST, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;
root.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(V.fov, 1, 0.05, 1500);
const look = createLook(renderer, scene, camera, { shadowExtent: 45, overlayParent: root });

const KITS = { props: createPropLibrary(THREE), vehicles: createVehicleLibrary(THREE), facades: createFacadeLibrary(THREE) };
const WLIB = createWeaponLibrary(THREE), CLIB = createCharacterLibrary(THREE);
const LK = createLevelKit(THREE, KITS);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x34373b, roughness: 0.9 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const tLoad = performance.now();
const level = LK.buildLevel(layout);
const loadMs = performance.now() - tLoad;
scene.add(level.root);
// static level geometry merged by material: one draw call per material instead of one per piece
const mergeInfo = mergeStatic(level.root);

const VM = createViewmodel(WLIB);
look.addOverlay(VM.scene, VM.camera);
const ps = new ParticleSystem(scene);
const feel = createCameraFeel();

let lookKey = readLS('game.look.v2') || 'day';
if (!LOOKS[lookKey]) lookKey = Object.keys(LOOKS)[0];
function applyLook() {
  const st = look.apply(LOOKS[lookKey].look);
  const lampOn = Math.max(st.night, st.warm * 0.4);
  for (const l of level.lights) l.intensity = lerp(0, 28, lampOn);
  for (const m of level.lampMats) m.emissiveIntensity = lerp(0.2, 1.6, st.night);
  VM.setLight(1 - st.night * 0.35);
}
$('lookSel').innerHTML = Object.entries(LOOKS).sort((a, b) => (a[0] === 'day' ? -1 : b[0] === 'day' ? 1 : a[0] === 'dusk-base' ? -1 : b[0] === 'dusk-base' ? 1 : a[1].name.localeCompare(b[1].name))).map(([k, f]) => `<option value="${k}">${f.name}</option>`).join('');
$('lookSel').value = lookKey;
$('lookSel').onchange = () => { lookKey = $('lookSel').value; try { localStorage.setItem('game.look.v2', JSON.stringify(lookKey)); } catch (e) {} applyLook(); };
applyLook();

// ---------------------------------------------------------------- audio
let audio = null;
function initAudio() {
  if (audio) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const master = ctx.createGain(); master.gain.value = 0.8;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 4;
  master.connect(comp); comp.connect(ctx.destination);
  const space = SPACES['open street'], dry = ctx.createGain(), wet = ctx.createGain(), conv = ctx.createConvolver();
  conv.buffer = impulse(ctx, space.decay, space); wet.gain.value = space.wet;
  dry.connect(master); conv.connect(wet); wet.connect(master);
  audio = { ctx, dry, conv };
}
const GUNSHOT = { pistol: 'pistol', revolver: 'pistol', smg: 'smg', rifle: 'rifle', shotgun: 'shotgun', sniper: 'sniper' };
const RELOAD = { shotgun: 'shell', sniper: 'bolt', revolver: 'shell' };
const IMPACT = { concrete: 'concrete', metal: 'metal', wood: 'wood', glass: 'glass', dirt: 'dirt', asphalt: 'concrete' };
function sound(id, preset, pos = null, tweak = null) {
  if (!audio) return;
  const s = SOUNDS[id], params = { ...(s.presets[preset] || Object.values(s.presets)[0]), ...(tweak || {}) };
  const { ctx } = audio, voice = ctx.createGain(); let tail = voice;
  if (pos) {
    const pan = ctx.createPanner(); pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = 3; pan.maxDistance = 300; pan.rolloffFactor = 1.1;
    pan.positionX.value = pos[0]; pan.positionY.value = pos[1]; pan.positionZ.value = pos[2];
    voice.connect(pan); tail = pan;
  }
  tail.connect(audio.dry); tail.connect(audio.conv);
  const dur = playSound(ctx, voice, ctx.currentTime + 0.005, id, params);
  setTimeout(() => voice.disconnect(), (dur + 2) * 1000);
}
const _fwd = new THREE.Vector3();
function updateListener() {
  if (!audio) return;
  const L = audio.ctx.listener; camera.getWorldDirection(_fwd);
  if (L.positionX) { L.positionX.value = camera.position.x; L.positionY.value = camera.position.y; L.positionZ.value = camera.position.z; L.forwardX.value = _fwd.x; L.forwardY.value = _fwd.y; L.forwardZ.value = _fwd.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
  else { L.setPosition(camera.position.x, camera.position.y, camera.position.z); L.setOrientation(_fwd.x, _fwd.y, _fwd.z, 0, 1, 0); }
}

// ---------------------------------------------------------------- round state
// nav bounds from the level's own records, padded
const NAV_BOUNDS = (() => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const r of layout.objects) if (r.type === 'marker' || r.type === 'prim') { x0 = Math.min(x0, r.pos[0]); x1 = Math.max(x1, r.pos[0]); z0 = Math.min(z0, r.pos[2]); z1 = Math.max(z1, r.pos[2]); }
  return { x0: x0 - 4, z0: z0 - 4, width: x1 - x0 + 8, depth: z1 - z0 + 8 };
})();
const HOSTILES = ['soldier', 'thug', 'heavy', 'soldier', 'thug', 'soldier', 'heavy'];
let world = null, me = null, roundStart = 0, ended = false;
const actorVis = new Map();
const lookYP = { yaw: 0, pitch: 0 }, recoilOff = { yaw: 0, pitch: 0 };
const prevPos = new THREE.Vector3(); let prevHeight = 1.8;
function startRound() {
  for (const v of actorVis.values()) { scene.remove(v.obj); CLIB.dispose(v.obj); }
  actorVis.clear();
  world = makeWorld({ collider: level.collider, shotCollider: level.shotCollider, moveParams: P, weapons: WEAPONS, loadout: LOADOUT });
  const sp = level.markers.find(m => m.kind === 'playerSpawn') || { pos: [0, 0, 0], rotY: 0 };
  me = addPlayer(world, { pos: [sp.pos[0], sp.pos[1] + 0.05, sp.pos[2]], yaw: D2R(sp.rotY) });
  lookYP.yaw = D2R(sp.rotY); lookYP.pitch = 0; recoilOff.yaw = recoilOff.pitch = 0;
  level.markers.filter(m => m.kind === 'enemySpawn').forEach((m, i) => {
    const id = HOSTILES[i % HOSTILES.length], params = CLIB.randomize(id, 1000 + i * 7919);
    // marker arrows point the way the camera would face; characters are modeled facing +Z, so turn them around
    const a = addActor(world, { pos: m.pos, yaw: D2R(m.rotY) + Math.PI, height: params.height || 1.8 });
    const obj = CLIB.build({ prop: id, params });
    obj.position.set(...m.pos); obj.rotation.y = a.yaw; scene.add(obj);
    actorVis.set(a.id, { obj, actor: a, prev: a.pos.clone(), prevYaw: a.yaw, anim: { legs: 'idle', upper: 'carry', t: i * 0.7, rate: 0.9 + (i % 3) * 0.08 } });
  });
  // enemies think on a nav grid covering the playable street; patrol markers give them routes
  enableAI(world, { bounds: NAV_BOUNDS, patrol: level.markers.filter(m => m.kind === 'patrolPoint').map(m => [m.pos[0], m.pos[2]]), params: AI_PARAMS, seed: 7 });
  prevPos.copy(me.body.pos); prevHeight = me.body.height; feel.reset();
  setWeaponVisual(); roundStart = 0; ended = false;
  $('banner').style.display = 'none'; $('feed').innerHTML = ''; deadT = 0; hurtT = 0; VM.root.visible = true;
}

// ---------------------------------------------------------------- input
const keys = {}; let locked = AUTOTEST, trigger = false, adsHeld = false, reloadReq = false, jumpLatch = false, weaponReq = null, crouchToggled = false;
const swayIn = { x: 0, y: 0 }, sway = { x: 0, y: 0 };
const canvas = renderer.domElement;
function requestLock() { initAudio(); if (audio && audio.ctx.state === 'suspended') audio.ctx.resume(); try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
$('bPlay').onclick = requestLock;
$('bRestart').onclick = () => { startRound(); requestLock(); };
$('bDebug').onclick = () => { const d = $('dbg'); d.style.display = d.style.display === 'block' ? 'none' : 'block'; $('bDebug').textContent = d.style.display === 'block' ? 'Hide stats' : 'Show stats'; };
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  $('menu').classList.toggle('hidden', locked);
  $('bPlay').textContent = world && world.time > 0 ? 'Resume' : 'Click to play';
  if (!locked) { trigger = adsHeld = false; for (const k in keys) keys[k] = false; }
});
document.addEventListener('mousemove', e => {
  if (!locked) return;
  const s = V.sensitivity * 0.001 * (adsBlend > 0.5 ? camera.fov / V.fov : 1);
  lookYP.yaw -= e.movementX * s;
  lookYP.pitch = Math.max(-1.55, Math.min(1.55, lookYP.pitch - e.movementY * s * (V.invertY ? -1 : 1)));
  swayIn.x += e.movementX; swayIn.y += e.movementY;
});
document.addEventListener('mousedown', e => { if (!locked) return; if (e.button === 0) trigger = true; if (e.button === 2) adsHeld = true; });
document.addEventListener('mouseup', e => { if (e.button === 0) trigger = false; if (e.button === 2) adsHeld = false; });
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('wheel', e => { if (!locked || !me) return; weaponReq = (me.slot + (e.deltaY > 0 ? 1 : -1) + LOADOUT.length) % LOADOUT.length; }, { passive: true });
addEventListener('keydown', e => {
  if (e.code === 'Enter' && (ended || !locked)) { startRound(); if (!locked) requestLock(); return; }
  if (!locked) return;
  if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'KeyR'].includes(e.code)) e.preventDefault();
  if (!keys[e.code]) {
    if (e.code === 'Space') jumpLatch = true;
    if (e.code === 'KeyR') reloadReq = true;
    if (e.code === 'KeyC' && V.crouchToggle) crouchToggled = !crouchToggled;
    const n = parseInt(e.key, 10); if (n >= 1 && n <= LOADOUT.length) weaponReq = n - 1;
  }
  keys[e.code] = true;
});
addEventListener('keyup', e => { keys[e.code] = false; });
function sampleInput() {
  const i = makeInput();
  i.moveZ = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0); i.moveX = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  i.sprint = !!(keys.ShiftLeft || keys.ShiftRight); i.jump = !!keys.Space || jumpLatch;
  i.crouch = V.crouchToggle ? crouchToggled : !!keys.KeyC;
  i.yaw = lookYP.yaw; i.pitch = lookYP.pitch; i.trigger = trigger && locked; i.ads = adsHeld && locked;
  i.reload = reloadReq; i.weapon = weaponReq;
  return i;
}

// ---------------------------------------------------------------- effects: tracers, decals, muzzle light
const tracers = [], decals = [];
const tracerMat = new THREE.LineBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.9, depthWrite: false });
function addTracer(a, b, life = 0.07, color = null) {
  const g = new THREE.BufferGeometry().setFromPoints([a, b]), l = new THREE.Line(g, tracerMat.clone());
  if (color !== null) l.material.color.set(color);
  scene.add(l); tracers.push({ l, t: life, life });
}
const decalMat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false });
const decalGeo = new THREE.CircleGeometry(0.03, 8);
function addDecal(point, normal) {
  const d = new THREE.Mesh(decalGeo, decalMat), n = new THREE.Vector3(...normal);
  d.position.set(...point).addScaledVector(n, 0.004); d.lookAt(d.position.clone().add(n)); scene.add(d);
  decals.push(d); if (decals.length > 300) scene.remove(decals.shift());
}
const muzzleLight = new THREE.PointLight(0xffc070, 0, 9, 1.8); scene.add(muzzleLight);
let flashT = 0, kick = 0, hitT = 0, hurtT = 0, hurtDir = 0, hurtDirT = 0, deadT = 0;
// a few reusable lights for enemy muzzle flashes (fixed count, so shaders never recompile)
const flashLights = [0, 1, 2].map(() => { const l = new THREE.PointLight(0xffb060, 0, 10, 1.8); scene.add(l); return l; });
let flashIdx = 0;
function flashAt(p) { const l = flashLights[flashIdx++ % flashLights.length]; l.position.copy(p); l.intensity = 10; }
const projTrail = new Map();

// ---------------------------------------------------------------- events from the simulation
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
function onEvents(events) {
  for (const e of events) {
    switch (e.type) {
      case 'shot': {
        if (e.player !== me.id) break;
        if (!roundStart) roundStart = world.time;
        lookYP.pitch += e.recoil.up; lookYP.yaw += e.recoil.side; recoilOff.pitch += e.recoil.up; recoilOff.yaw += e.recoil.side;
        kick = 1; flashT = 0.05;
        const muzzle = VM.muzzleWorld(camera, tmpA);
        camera.getWorldDirection(tmpB);
        EFFECTS.muzzle(ps, muzzle, tmpB, WEAPONS[e.weapon].pellets > 1 ? 0.8 : 0.5);
        muzzleLight.position.copy(muzzle); muzzleLight.intensity = 14;
        for (const p of e.paths) if (!p.projectile && Math.random() < (WEAPONS[e.weapon].pellets > 1 ? 0.35 : 0.6)) addTracer(muzzle.clone(), new THREE.Vector3(...p.end));
        sound('gunshot', GUNSHOT[e.weapon] || 'rifle');
        break;
      }
      case 'impact': {
        const surf = SURFACES[e.surface] || 'concrete', p = new THREE.Vector3(...e.point), n = new THREE.Vector3(...e.normal);
        if (surf === 'metal' || surf === 'glass') EFFECTS.sparks(ps, p, n, 0.8);
        if (surf !== 'metal' && surf !== 'glass') EFFECTS.dust(ps, p, n, 0.8, surf === 'wood' ? 0x8a6a48 : surf === 'dirt' ? 0x6b5238 : 0xb8b0a0);
        if (surf === 'concrete' || surf === 'asphalt') EFFECTS.sparks(ps, p, n, 0.25);
        addDecal(e.point, e.normal);
        sound('impact', IMPACT[surf] || 'concrete', e.point, { power: 0.6 });
        break;
      }
      case 'hit': {
        const v = actorVis.get(e.actor);
        if (v && !e.killed) CLIB.hit(v.anim, e.part, e.local, e.side, Math.min(1.4, 0.6 + e.dmg / 40));
        EFFECTS.dust(ps, new THREE.Vector3(...e.point), new THREE.Vector3(...e.dir).negate(), 0.5, 0x6e1212);
        sound('impact', 'body', e.point, { power: 0.7 });
        sound('ui', e.killed ? 'kill' : 'hitmarker', null, { volume: 0.5 });
        hitT = 0.18; $('hm').classList.toggle('kill', e.killed);
        break;
      }
      case 'killed': {
        const v = actorVis.get(e.actor); if (v) CLIB.kill(v.anim, e.part, e.local);
        const left = world.actors.filter(a => a.alive && a.team === 'enemy').length;
        feed(`Hostile down${e.zone === 'head' ? ' · headshot' : ''} · ${left} left`);
        break;
      }
      case 'reloadStart': sound('reload', RELOAD[e.weapon] || 'magazine', null, { speed: 1.1 }); break;
      case 'dry': sound('ui', 'click', null, { volume: 0.5 }); break;
      case 'weaponSwitched': setWeaponVisual(); break;
      case 'projectile': {
        const pts = projTrail.get(e.id) || [VM.muzzleWorld(camera, new THREE.Vector3())];
        pts.push(new THREE.Vector3(...e.to)); projTrail.set(e.id, pts);
        if (e.done) { const g = new THREE.BufferGeometry().setFromPoints(pts), l = new THREE.Line(g, tracerMat.clone()); scene.add(l); tracers.push({ l, t: 0.25, life: 0.25 }); projTrail.delete(e.id); }
        break;
      }
      case 'enemyShot': {
        const from = new THREE.Vector3(...e.from), to = new THREE.Vector3(...e.to);
        EFFECTS.muzzle(ps, from, to.clone().sub(from).normalize(), 0.45);
        flashAt(from);
        if (Math.random() < 0.7) addTracer(from, to, 0.08, 0xff9a6a);
        if (!e.hit && e.normal) { const surf = SURFACES[e.surface] || 'concrete'; EFFECTS.dust(ps, to, new THREE.Vector3(...e.normal), 0.5, 0xb8b0a0); addDecal(e.to, e.normal); if (to.distanceTo(camera.position) < 12) sound('impact', IMPACT[surf] || 'concrete', e.to, { power: 0.5 }); }
        else if (!e.hit && to.distanceTo(camera.position) < 25) sound('impact', 'concrete', e.to, { power: 0.25 }); // near miss crack
        sound('gunshot', 'rifle', e.from);
        break;
      }
      case 'playerHurt': {
        hurtT = 0.45;
        if (e.from) { const dx = e.from[0] - me.body.pos.x, dz = e.from[2] - me.body.pos.z; hurtDir = Math.atan2(-dx, -dz) - lookYP.yaw; hurtDirT = 1.2; }
        sound('impact', 'body', null, { power: 0.45 });
        break;
      }
      case 'playerDied': {
        ended = true; deadT = 0.001; VM.root.visible = false; trigger = adsHeld = false;
        const s = world.stats, acc = s.bullets ? Math.round(100 * s.hits / s.bullets) : 0;
        $('banner').querySelector('h1').textContent = 'YOU DIED';
        $('banner').style.display = 'block';
        $('banner').querySelector('p').textContent = `${s.kills} of ${world.actors.length} down · ${acc}% accuracy · Enter to restart`;
        break;
      }
      case 'cleared': {
        ended = true;
        const t = world.time - (roundStart || 0), s = world.stats, acc = s.bullets ? Math.round(100 * s.hits / s.bullets) : 0;
        $('banner').querySelector('h1').textContent = 'BLOCK CLEARED';
        $('banner').style.display = 'block';
        $('banner').querySelector('p').textContent = `${fmtTime(t)} · ${s.kills} down · ${s.heads} headshots · ${acc}% accuracy · ${Math.round(s.damageTaken)} damage taken · Enter to restart`;
        sound('ui', 'confirm');
        break;
      }
    }
  }
}
function feed(text) { const d = document.createElement('div'); d.textContent = text; $('feed').prepend(d); setTimeout(() => d.remove(), 3600); }
const fmtTime = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
function setWeaponVisual() {
  const wid = currentWeapon(world, me);
  VM.setWeapon(wid);
  $('slots').innerHTML = LOADOUT.map((id, i) => `<span class="${i === me.slot ? 'on' : ''}">${i + 1} ${LABELS[id] || id}</span>`).join('');
}

// ---------------------------------------------------------------- loop
let acc = 0, adsBlend = 0;
const clock = new THREE.Clock(), pos = new THREE.Vector3();
let fps = 0, frames = 0, fpsT = 0;
function resize() {
  const w = root.clientWidth, h = root.clientHeight;
  renderer.setSize(w, h, false); look.setSize(w, h);
  camera.aspect = VM.camera.aspect = w / h; camera.updateProjectionMatrix(); VM.camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
startRound(); resize();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (locked) {
    acc += dt; let n = 0;
    while (acc >= TICK && n++ < 8) {
      prevPos.copy(me.body.pos); prevHeight = me.body.height;
      for (const v of actorVis.values()) { v.prev.copy(v.actor.pos); v.prevYaw = v.actor.yaw; }
      const events = stepWorld(world, { [me.id]: sampleInput() });
      reloadReq = false; jumpLatch = false; weaponReq = null;
      onEvents(events);
      // recoil recovery, as in the Gun lab
      const S = WEAPONS[currentWeapon(world, me)], rec = Math.min(1, S.recoilRecovery * TICK);
      const dp = recoilOff.pitch * rec, dy = recoilOff.yaw * rec;
      lookYP.pitch -= dp; recoilOff.pitch -= dp; lookYP.yaw -= dy; recoilOff.yaw -= dy;
      acc -= TICK;
    }
    if (n >= 8) acc = 0;
  }
  present(dt, locked ? acc / TICK : 1);
  frames++; fpsT += dt; if (fpsT > 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; }
});

function present(dt, alpha) {
  pos.lerpVectors(prevPos, me.body.pos, alpha);
  let height = lerp(prevHeight, me.body.height, alpha);
  if (deadT > 0) { deadT += dt; height = lerp(height, 0.45, Math.min(1, deadT * 2.5)); }
  const wid = currentWeapon(world, me), S = WEAPONS[wid], g = me.guns[wid];
  const vm = VM.weapon && VM.weapon.userData.viewmodel, t = vm && vm.ads ? g.ads : 0;
  adsBlend = t;
  feel.update(camera, dt, { pos, height, player: me.body, yaw: lookYP.yaw, pitch: lookYP.pitch, V, P, fovOverride: t > 0.001 ? lerp(V.fov, vm.ads.cameraFov, t) : null });
  if (deadT > 0) camera.rotation.z = lerp(0, 1.2, Math.min(1, deadT * 2));
  // viewmodel: Gun lab hip/ADS/kick/reload, plus Movement lab bob, sway and sprint pose
  if (vm && me.alive) {
    const fx = feel.fx, hp = vm.hip.position, hr = vm.hip.rotationDeg, ap = vm.ads ? vm.ads.position : hp;
    sway.x = lerp(sway.x, Math.max(-40, Math.min(40, swayIn.x)), Math.min(1, dt * 10));
    sway.y = lerp(sway.y, Math.max(-40, Math.min(40, swayIn.y)), Math.min(1, dt * 10));
    swayIn.x = 0; swayIn.y = 0;
    kick = Math.max(0, kick - dt * 10); flashT -= dt;
    const reloadDip = g.reloadT > 0 ? Math.sin(Math.min(1, g.reloadT / 0.4) * Math.PI / 2) : 0;
    const s = V.weaponSway * (1 - t), sb = fx.sprintBlend * (1 - t);
    VM.root.position.set(
      lerp(hp[0], ap[0], t) + fx.bobX * 0.6 * s - sway.x * 0.0004 * s - sb * 0.04,
      lerp(hp[1], ap[1], t) - reloadDip * 0.12 - fx.bobY * 0.6 * s + sway.y * 0.0004 * s - sb * 0.04 + fx.dip * 0.06 * (1 - t),
      lerp(hp[2], ap[2], t) + kick * 0.04 * (vm.kick || 1) + sb * 0.03);
    VM.root.rotation.set(
      D2R(lerp(hr[0], 0, t)) + kick * 0.1 * (vm.kick || 1) - reloadDip * 0.6 - sb * 0.25 + sway.y * 0.0012 * s,
      D2R(lerp(hr[1], 0, t)) + sb * 0.55 + sway.x * 0.0012 * s,
      D2R(lerp(hr[2], 0, t)) + reloadDip * 0.4 + sb * 0.2 + fx.roll * 1.5 * (1 - t), 'XYZ');
    VM.flash.visible = flashT > 0;
    const scoped = vm.ads && vm.ads.overlay === 'scope' && t > 0.85;
    VM.root.visible = !scoped; $('scope').style.display = scoped ? 'block' : 'none';
  }
  muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 300);
  for (let i = tracers.length - 1; i >= 0; i--) { const tr = tracers[i]; tr.t -= dt; tr.l.material.opacity = Math.max(0, tr.t / tr.life) * 0.9; if (tr.t <= 0) { scene.remove(tr.l); tr.l.geometry.dispose(); tr.l.material.dispose(); tracers.splice(i, 1); } }
  for (const v of actorVis.values()) {
    const a = v.actor;
    v.obj.position.lerpVectors(v.prev, a.pos, alpha);
    let dy = a.yaw - v.prevYaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    v.obj.rotation.y = v.prevYaw + dy * alpha;
    if (a.alive) {
      // legs from speed and crouch; strafe when moving mostly sideways relative to facing
      const vx = a.pos.x - v.prev.x, vz = a.pos.z - v.prev.z, cy = Math.cos(a.yaw), sy = Math.sin(a.yaw);
      const lx = vx * cy - vz * sy, lz = vx * sy + vz * cy;
      let legs = a.crouch ? (a.speed > 0.3 ? 'crouchWalk' : 'crouch') : a.speed > 3 ? 'run' : a.speed > 0.3 ? 'walk' : 'idle';
      if (!a.crouch && a.speed > 0.3 && a.speed <= 3 && Math.abs(lx) > Math.abs(lz) * 1.2) legs = lx > 0 ? 'strafeL' : 'strafeR';
      CLIB.setLegs(v.anim, legs); CLIB.setUpper(v.anim, a.aiming ? 'aim' : 'carry');
    }
    CLIB.animate(v.obj, v.anim, dt * v.anim.rate);
  }
  for (const l of flashLights) l.intensity = Math.max(0, l.intensity - dt * 220);
  ps.update(dt);
  look.follow(pos); look.tick(dt);
  updateListener();
  hud(g, S, t);
  renderer.info.reset(); look.render();
}

function hud(g, S, t) {
  const spread = currentSpread(g, S, { speed: Math.hypot(me.body.vel.x, me.body.vel.z), onGround: me.body.onGround });
  const gap = Math.max(3, Math.tan(D2R(spread)) / Math.tan(D2R(camera.fov / 2)) * innerHeight / 2);
  const xs = $('xh').children;
  [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(([dx, dy], i) => {
    const v = dx === 0;
    Object.assign(xs[i].style, { width: v ? '2px' : '9px', height: v ? '9px' : '2px', left: (dx * (gap + 4.5) - (v ? 1 : 4.5)) + 'px', top: (dy * (gap + 4.5) - (v ? 4.5 : 1)) + 'px' });
  });
  $('xh').style.opacity = String(1 - Math.min(1, t * 2));
  hitT -= 1 / 60; $('hm').style.opacity = String(Math.max(0, hitT / 0.18));
  const a = $('ammo');
  a.querySelector('b').textContent = g.ammo; a.querySelector('small').textContent = '/ ' + S.magSize;
  a.querySelector('.wname').textContent = `${LABELS[currentWeapon(world, me)] || ''} · ${S.mode}`;
  const r = a.querySelector('.reload'); r.style.display = g.reloadT > 0 ? 'block' : 'none';
  if (g.reloadT > 0) r.firstChild.style.width = (100 * (1 - g.reloadT / (g.ammo === 0 ? S.reloadEmptyTime : S.reloadTime))) + '%';
  $('health').querySelector('span').textContent = Math.ceil(me.hp); const hb = $('health').querySelector('i'); hb.style.width = (100 * me.hp / me.maxHp) + '%'; hb.style.background = me.hp < 35 ? '#ef4444' : me.hp < 65 ? '#f2c14e' : '#7ddc7a';
  hurtT = Math.max(0, hurtT - 1 / 60); hurtDirT = Math.max(0, hurtDirT - 1 / 60);
  $('hurt').style.opacity = String(Math.min(1, hurtT * 1.6 + (me.alive ? Math.max(0, (40 - me.hp) / 60) : 0.6)));
  const dd = $('dmgdir'); dd.style.opacity = String(Math.min(1, hurtDirT)); dd.style.transform = `translate(-50%, -50%) rotate(${-(hurtDir) }rad)`;
  const total = world.actors.filter(x => x.team === 'enemy').length, left = world.actors.filter(x => x.team === 'enemy' && x.alive).length;
  const el = roundStart ? world.time - roundStart : 0;
  $('obj').innerHTML = ended ? '' : `CLEAR THE BLOCK · hostiles <b>${left}</b> / ${total} · ${fmtTime(el)}`;
  if ($('dbg').style.display === 'block' && world.ai) $('dbg').dataset.ai = world.ai.enemies.map(a => a.alive ? a.state[0].toUpperCase() : '-').join('');
  if ($('dbg').style.display === 'block') {
    const i = renderer.info.render;
    $('dbg').textContent = `${fps.toFixed(0)} fps · ${i.calls} draw calls · ${(i.triangles / 1000).toFixed(0)}k tris · ${level.lights.length} lamp lights · ${mergeInfo.meshesBefore} meshes merged to ${mergeInfo.meshesAfter}\npos ${me.body.pos.x.toFixed(1)} ${me.body.pos.y.toFixed(2)} ${me.body.pos.z.toFixed(1)} · ${Math.hypot(me.body.vel.x, me.body.vel.z).toFixed(1)} m/s · look ${LOOKS[lookKey].name}\nenemies ${world.ai ? world.ai.enemies.map(a => a.alive ? a.state : 'down').join(' · ') : ''}`;
  }
}

// ---------------------------------------------------------------- headless test hook
if (AUTOTEST) {
  $('menu').classList.add('hidden');
  window.__game = {
    keys, lookYP, get world() { return world; }, get me() { return me; }, LOADOUT,
    set trigger(v) { trigger = v; }, set ads(v) { adsHeld = v; }, reload() { reloadReq = true; }, weapon(i) { weaponReq = i; },
    setLook(k) { lookKey = k; applyLook(); }, restart: startRound, debug(on) { $('dbg').style.display = on ? 'block' : 'none'; },
    // point the view at an actor's chest (or head)
    aimAt(i, part = 'chest') {
      const a = world.actors[i], e = eyePosition(me), y = a.pos.y + a.height * (part === 'head' ? 0.92 : 0.7);
      const dx = a.pos.x - e.x, dy = y - e.y, dz = a.pos.z - e.z;
      lookYP.yaw = Math.atan2(-dx, -dz); lookYP.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    },
    get ai() { return world.ai; }, colliders: () => ({ move: level.collider.geometry.attributes.position.count / 3, shot: level.shotCollider.geometry.attributes.position.count / 3 }), loadMs: () => loadMs, godMode(on) { if (on) { me.maxHp = me.hp = 1e6; } else { me.maxHp = 100; me.hp = 100; } },
    teleport(x, z) { me.body.pos.set(x, 0.2, z); me.body.vel.set(0, 0, 0); prevPos.copy(me.body.pos); },
  };
}
