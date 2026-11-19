// camera-feel.js : first-person camera presentation tuned in the Movement lab.
// Head bob, landing dip, strafe tilt and sprint/slide FOV, driven by the movement sim's state.
// Render-only: reads the player, never changes simulation state (except clearing its presentation events).
import * as THREE from 'three';

const lerp = THREE.MathUtils.lerp, D2R = THREE.MathUtils.degToRad;

export const VIEW_DEFAULTS = { fov: 75, sprintFov: 12, slideFov: 6, bobAmount: 0.025, bobRate: 0.6, strafeTilt: 1.5, landDip: 1.0, sensitivity: 2.2, invertY: false, crouchToggle: false, weaponSway: 0.5 };

export function createCameraFeel() {
  const fx = { bobPhase: 0, bobAmp: 0, sprintBlend: 0, slideBlend: 0, dip: 0, dipVel: 0, roll: 0, eye: 1.7, bobX: 0, bobY: 0 };
  const last = new THREE.Vector3(); let first = true;
  // pos: interpolated feet position; height: interpolated capsule height; player: sim state (vel, onGround,
  // sliding, sprinting, events); V: view settings; P: movement params; fovScale: 1 normally, lower when aiming.
  function update(camera, dt, { pos, height, player, yaw, pitch, V, P, fovOverride = null }) {
    const hSpeed = Math.hypot(player.vel.x, player.vel.z);
    const moved = first ? 0 : Math.hypot(pos.x - last.x, pos.z - last.z);
    last.copy(pos); first = false;

    // head bob: phase advances with distance walked, amplitude follows speed while grounded
    const grounded = player.onGround && !player.sliding;
    fx.bobAmp = lerp(fx.bobAmp, grounded ? Math.min(1, hSpeed / Math.max(0.1, P.walkSpeed)) : 0, Math.min(1, dt * 8));
    if (moved < 2) fx.bobPhase += moved * Math.PI * V.bobRate;
    fx.bobY = Math.abs(Math.sin(fx.bobPhase)) * V.bobAmount * fx.bobAmp;
    fx.bobX = Math.cos(fx.bobPhase) * V.bobAmount * 0.5 * fx.bobAmp;

    // landing dip (spring), substepped so long frames stay stable
    if (player.events.landed > 0) { fx.dipVel -= Math.min(player.events.landed * 0.12, 1.2) * V.landDip; player.events.landed = 0; }
    player.events.jumped = false;
    for (let n = Math.ceil(dt / 0.005), h = dt / n, i = 0; i < n; i++) { fx.dipVel += (-fx.dip * 180 - fx.dipVel * 18) * h; fx.dip += fx.dipVel * h; }

    fx.sprintBlend = lerp(fx.sprintBlend, player.sprinting && hSpeed > P.walkSpeed * 0.9 ? 1 : 0, Math.min(1, dt * 6));
    fx.slideBlend = lerp(fx.slideBlend, player.sliding ? 1 : 0, Math.min(1, dt * 10));

    // strafe tilt from lateral velocity
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const lateral = (player.vel.x * rx + player.vel.z * rz) / Math.max(1, P.walkSpeed);
    fx.roll = lerp(fx.roll, -lateral * D2R(V.strafeTilt) - fx.slideBlend * D2R(4), Math.min(1, dt * 8));

    fx.eye = height - 0.12;
    camera.position.set(pos.x + fx.bobX * Math.cos(yaw), pos.y + fx.eye + fx.bobY - V.bobAmount * 0.5 * fx.bobAmp + fx.dip * 0.1, pos.z - fx.bobX * Math.sin(yaw));
    camera.rotation.set(pitch, yaw, fx.roll, 'YXZ');
    const fov = fovOverride ?? (V.fov + V.sprintFov * fx.sprintBlend + V.slideFov * fx.slideBlend);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    return fx;
  }
  return { fx, update, reset() { first = true; } };
}
