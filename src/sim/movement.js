// Movement simulation. Runs at a fixed tick from input commands; holds plain data only.
// The renderer reads `state`; nothing in here touches the DOM, the camera or the keyboard.
// For co-op later: the same InputCommand objects can be sent over the network and
// replayed on the host through stepPlayer().
import * as THREE from 'three';

export const TICK = 1 / 60;

export const DEFAULT_PARAMS = {
  walkSpeed: 4.5, sprintSpeed: 7.5, crouchSpeed: 3.2,
  groundAccel: 20, airAccel: 6, friction: 5, stopSpeed: 1.5,
  gravity: 22, jumpHeight: 1.4, coyoteTime: 0.1, jumpBuffer: 0.1,
  maxSlope: 45, stepHeight: 0.3,
  standHeight: 1.8, crouchHeight: 1.1, crouchTime: 0.15, radius: 0.35,
  slide: true, slideMinSpeed: 5.5, slideBoost: 1.4, slideMaxSpeed: 14, slideFriction: 0.8, slideSteer: 2,
};

// An input command: everything the player intends for one tick.
export function makeCommand() {
  return { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false, sprint: false };
}

export function makePlayer(spawn) {
  return {
    pos: new THREE.Vector3().copy(spawn), vel: new THREE.Vector3(),
    yaw: 0, pitch: 0, height: DEFAULT_PARAMS.standHeight,
    onGround: false, sliding: false, sprinting: false, crouched: false,
    coyote: 0, jumpBufferT: 0, prevJump: false, prevCrouch: false,
    airTime: 0, jumpStartY: spawn.y, jumpStart: new THREE.Vector3().copy(spawn), apex: spawn.y,
    // events for the presentation layer, cleared by the renderer
    events: { landed: 0, jumped: false },
    lastJump: null, // { height, distance, airTime }
  };
}

// ---------- collision ----------
const _seg = new THREE.Line3(), _box = new THREE.Box3(), _tri = new THREE.Vector3(), _cap = new THREE.Vector3(), _dir = new THREE.Vector3(), _n = new THREE.Vector3(), _c = new THREE.Vector3();

// Moves a capsule (feet at `feet`, total height `h`) by `delta` and pushes it out of the collider.
// Contacts with walkable surfaces no higher than `stepH` above the feet are resolved straight up
// ("flat feet"), which is what lets the capsule walk up steps and over ledges at ramp tops.
// Returns { feet, ground, groundNormal, normals }.
function moveAndCollide(bvh, feet, delta, h, r, cosSlope, stepH = 0) {
  _seg.start.set(feet.x + delta.x, feet.y + delta.y + r, feet.z + delta.z);
  _seg.end.set(_seg.start.x, feet.y + delta.y + h - r, _seg.start.z);
  let ground = false;
  const groundNormal = new THREE.Vector3(0, 1, 0), normals = [];
  for (let iter = 0; iter < 3; iter++) {
    _box.makeEmpty(); _box.expandByPoint(_seg.start); _box.expandByPoint(_seg.end);
    _box.min.addScalar(-r); _box.max.addScalar(r);
    let pushed = false;
    bvh.shapecast({
      intersectsBounds: b => b.intersectsBox(_box),
      intersectsTriangle: tri => {
        const d = tri.closestPointToSegment(_seg, _tri, _cap);
        if (d < r) {
          tri.getNormal(_n);
          const feetY = _seg.start.y - r;
          if (_n.y >= cosSlope && _tri.y <= _seg.start.y + 0.01 && _tri.y - feetY <= stepH + 0.01) {
            const hd = Math.hypot(_seg.start.x - _tri.x, _seg.start.z - _tri.z);
            const lift = Math.sqrt(Math.max(0, r * r - hd * hd)) - (_seg.start.y - _tri.y);
            if (lift > 0) { _seg.start.y += lift; _seg.end.y += lift; pushed = true; }
            ground = true; groundNormal.copy(_n);
            return false;
          }
          // a low riser (its top within step height of the feet): let the walkable top surface lift us instead
          if (stepH > 0 && Math.max(tri.a.y, tri.b.y, tri.c.y) - feetY <= stepH + 0.01) return false;
          const depth = r - d;
          if (d > 1e-6) _dir.subVectors(_cap, _tri).normalize(); else _dir.copy(_n);
          _seg.start.addScaledVector(_dir, depth); _seg.end.addScaledVector(_dir, depth);
          pushed = true;
          if (_n.y >= cosSlope && _dir.y > 0.05) { ground = true; groundNormal.copy(_n); }
          normals.push(_dir.clone());
        }
      },
    });
    if (!pushed) break;
  }
  return { feet: new THREE.Vector3(_seg.start.x, _seg.start.y - r, _seg.start.z), ground, groundNormal, normals };
}

// Is there room for the head (top sphere of a capsule of height h)?
function headBlocked(bvh, feet, h, r) {
  _c.set(feet.x, feet.y + h - r, feet.z);
  _box.min.set(_c.x - r, _c.y - r, _c.z - r); _box.max.set(_c.x + r, _c.y + r, _c.z + r);
  let hit = false;
  bvh.shapecast({
    intersectsBounds: b => b.intersectsBox(_box),
    intersectsTriangle: tri => { tri.closestPointToPoint(_c, _tri); if (_tri.distanceTo(_c) < r - 0.005) { hit = true; return true; } },
  });
  return hit;
}

// ---------- movement helpers (Quake-style) ----------
function accelerate(vel, wishDir, wishSpeed, accel, dt) {
  const cur = vel.x * wishDir.x + vel.z * wishDir.z;
  const add = wishSpeed - cur;
  if (add <= 0) return;
  const amt = Math.min(accel * wishSpeed * dt, add);
  vel.x += wishDir.x * amt; vel.z += wishDir.z * amt;
}
function applyFriction(vel, friction, stopSpeed, dt) {
  const sp = Math.hypot(vel.x, vel.z);
  if (sp < 1e-4) { vel.x = vel.z = 0; return; }
  const drop = Math.max(sp, stopSpeed) * friction * dt;
  const k = Math.max(0, sp - drop) / sp;
  vel.x *= k; vel.z *= k;
}

const _wish = new THREE.Vector3(), _delta = new THREE.Vector3();

// One fixed tick for one player.
export function stepPlayer(s, cmd, P, bvh, dt = TICK) {
  const cosSlope = Math.cos(THREE.MathUtils.degToRad(P.maxSlope)), r = P.radius;
  s.yaw = cmd.yaw; s.pitch = cmd.pitch;
  const wasGround = s.onGround, prevVelY = s.vel.y;
  const hSpeed = Math.hypot(s.vel.x, s.vel.z);

  // --- crouch / slide state ---
  const crouchPressed = cmd.crouch && !s.prevCrouch;
  if (P.slide && !s.sliding && s.onGround && crouchPressed && hSpeed >= P.slideMinSpeed) {
    s.sliding = true;
    const target = Math.min(P.slideMaxSpeed, hSpeed * P.slideBoost), k = target / hSpeed;
    s.vel.x *= k; s.vel.z *= k;
  }
  if (s.sliding && (!cmd.crouch || (s.onGround && hSpeed < P.crouchSpeed + 0.2))) s.sliding = false;
  const wantLow = cmd.crouch || s.sliding;
  const targetH = wantLow ? P.crouchHeight : P.standHeight;
  const rate = (P.standHeight - P.crouchHeight) / Math.max(0.01, P.crouchTime) * dt;
  if (targetH < s.height) {
    const nh = Math.max(targetH, s.height - rate);
    if (!s.onGround) s.pos.y += s.height - nh; // tuck legs in the air (crouch-jump)
    s.height = nh;
  } else if (targetH > s.height) {
    if (!headBlocked(bvh, s.pos, targetH, r)) s.height = Math.min(targetH, s.height + rate); // stand only if there is room
  }
  s.crouched = s.height < P.standHeight - 0.05;

  // --- wish direction ---
  const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw), rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
  _wish.set(fx * cmd.moveZ + rx * cmd.moveX, 0, fz * cmd.moveZ + rz * cmd.moveX);
  const wl = _wish.length(); if (wl > 1) _wish.divideScalar(wl);
  const wishLen = Math.min(1, wl); if (wl > 0) _wish.normalize();
  s.sprinting = cmd.sprint && cmd.moveZ > 0.1 && !s.crouched && !s.sliding;
  const maxSpeed = s.crouched && !s.sliding ? P.crouchSpeed : s.sprinting ? P.sprintSpeed : P.walkSpeed;
  const wishSpeed = maxSpeed * wishLen;

  // --- jump (coyote time + input buffer) ---
  if (cmd.jump && !s.prevJump) s.jumpBufferT = P.jumpBuffer + 1e-6;
  s.coyote = s.onGround ? P.coyoteTime + 1e-6 : s.coyote - dt;
  let jumped = false;
  if (s.jumpBufferT > 0 && s.coyote > 0 && !headBlocked(bvh, s.pos.clone().setY(s.pos.y + 0.1), s.height, r)) {
    s.vel.y = Math.sqrt(2 * P.gravity * P.jumpHeight);
    s.onGround = false; s.coyote = 0; s.jumpBufferT = 0; jumped = true;
    s.sliding = false;
    s.events.jumped = true;
    s.jumpStartY = s.pos.y; s.jumpStart.copy(s.pos); s.apex = s.pos.y;
  }
  s.jumpBufferT -= dt;

  // --- friction / acceleration ---
  if (s.onGround && !jumped) {
    applyFriction(s.vel, s.sliding ? P.slideFriction : P.friction, P.stopSpeed, dt);
    if (s.sliding) accelerate(s.vel, _wish, wishSpeed * 0.5, P.slideSteer, dt);
    else accelerate(s.vel, _wish, wishSpeed, P.groundAccel, dt);
  } else {
    accelerate(s.vel, _wish, wishSpeed, P.airAccel, dt);
  }

  // --- gravity (midpoint integration: exact jump arcs at any tick rate) ---
  const vy0 = s.vel.y;
  if (s.onGround && !jumped) s.vel.y = Math.min(s.vel.y, 0) - P.gravity * dt * 0.1;
  else s.vel.y -= P.gravity * dt;

  // --- move + collide, with step-up and ground snap ---
  _delta.copy(s.vel).multiplyScalar(dt);
  if (!(s.onGround && !jumped)) _delta.y = (vy0 + s.vel.y) * 0.5 * dt;
  const start = s.pos.clone();
  const stepH = wasGround && !jumped ? P.stepHeight : 0.08;
  let res = moveAndCollide(bvh, start, _delta, s.height, r, cosSlope, stepH);
  if (!res.ground && wasGround && !jumped && s.vel.y <= 0) {
    const snap = moveAndCollide(bvh, res.feet, new THREE.Vector3(0, -0.3, 0), s.height, r, cosSlope, 0.3);
    if (snap.ground) res = snap;
  }
  s.pos.copy(res.feet);
  s.onGround = res.ground;

  // remove velocity going into surfaces we touched
  for (const n of res.normals) {
    const into = s.vel.dot(n);
    if (into < 0) s.vel.addScaledVector(n, -into);
  }
  if (s.onGround && s.vel.y < 0) s.vel.y = 0;

  // --- telemetry ---
  if (!s.onGround) { s.airTime += dt; s.apex = Math.max(s.apex, s.pos.y); }
  if (s.onGround && !wasGround) {
    s.events.landed = Math.max(s.events.landed, -prevVelY);
    if (s.airTime > 0.15) s.lastJump = { height: s.apex - s.jumpStartY, distance: Math.hypot(s.pos.x - s.jumpStart.x, s.pos.z - s.jumpStart.z), airTime: s.airTime };
    s.airTime = 0;
  }
  if (s.onGround) { s.jumpStart.copy(s.pos); s.jumpStartY = s.pos.y; s.apex = s.pos.y; }

  s.prevJump = cmd.jump; s.prevCrouch = cmd.crouch;
}
