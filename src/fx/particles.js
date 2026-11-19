// GPU-drawn, CPU-simulated particle system: one THREE.Points per blend mode.
// Each particle: position, velocity, age, life, size (start->end), color (start->end), alpha curve, drag, gravity.
import * as THREE from 'three';

const VERT = `
attribute float aSize; attribute vec4 aColor;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (600.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
varying vec4 vColor; uniform float uSoft;
void main() {
  vec2 c = gl_PointCoord - 0.5; float d = length(c) * 2.0;
  if (d > 1.0) discard;
  float a = vColor.a * smoothstep(1.0, uSoft, d);
  gl_FragColor = vec4(vColor.rgb, a);
}`;

export class ParticleSystem {
  constructor(scene, max = 6000) {
    this.max = max; this.pools = {};
    for (const mode of ['add', 'alpha']) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(max * 3), 3));
      geo.setAttribute('aSize', new THREE.Float32BufferAttribute(new Float32Array(max), 1));
      geo.setAttribute('aColor', new THREE.Float32BufferAttribute(new Float32Array(max * 4), 4));
      const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uSoft: { value: mode === 'add' ? 0.0 : 0.3 } }, transparent: true, depthWrite: false, blending: mode === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending });
      const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = mode === 'add' ? 2 : 1;
      scene.add(pts);
      this.pools[mode] = { pts, list: [] };
    }
    this.scale = 1;
  }
  get count() { return this.pools.add.list.length + this.pools.alpha.list.length; }
  emit(o) {
    const pool = this.pools[o.blend || 'alpha'];
    if (pool.list.length >= this.max) return;
    pool.list.push({
      p: o.pos.clone(), v: o.vel ? o.vel.clone() : new THREE.Vector3(), age: 0, life: o.life,
      s0: o.size0, s1: o.size1 ?? o.size0, c0: new THREE.Color(o.color0), c1: new THREE.Color(o.color1 ?? o.color0),
      a0: o.alpha0 ?? 1, a1: o.alpha1 ?? 0, drag: o.drag ?? 0, grav: o.gravity ?? 0, fadeIn: o.fadeIn ?? 0,
    });
  }
  update(dt) {
    for (const pool of Object.values(this.pools)) {
      const L = pool.list;
      for (let i = L.length - 1; i >= 0; i--) {
        const q = L[i]; q.age += dt;
        if (q.age >= q.life) { L[i] = L[L.length - 1]; L.pop(); continue; }
        q.v.y -= q.grav * dt; q.v.multiplyScalar(Math.max(0, 1 - q.drag * dt)); q.p.addScaledVector(q.v, dt);
      }
      const g = pool.pts.geometry, P = g.attributes.position.array, Sz = g.attributes.aSize.array, Cl = g.attributes.aColor.array;
      const c = new THREE.Color();
      for (let i = 0; i < L.length; i++) {
        const q = L[i], t = q.age / q.life;
        P[i * 3] = q.p.x; P[i * 3 + 1] = q.p.y; P[i * 3 + 2] = q.p.z;
        Sz[i] = (q.s0 + (q.s1 - q.s0) * t) * this.scale;
        c.copy(q.c0).lerp(q.c1, t);
        const fade = q.fadeIn > 0 ? Math.min(1, q.age / q.fadeIn) : 1;
        Cl[i * 4] = c.r; Cl[i * 4 + 1] = c.g; Cl[i * 4 + 2] = c.b; Cl[i * 4 + 3] = (q.a0 + (q.a1 - q.a0) * t) * fade;
      }
      g.setDrawRange(0, L.length);
      g.attributes.position.needsUpdate = g.attributes.aSize.needsUpdate = g.attributes.aColor.needsUpdate = true;
    }
  }
}

// ---------- effect recipes ----------
const R = (a, b) => a + Math.random() * (b - a);
const rv = (s) => new THREE.Vector3(R(-s, s), R(-s, s), R(-s, s));
export const EFFECTS = {
  muzzle(ps, pos, dir, k = 1) {
    for (let i = 0; i < 6; i++) ps.emit({ blend: 'add', pos, vel: dir.clone().multiplyScalar(R(2, 8)).add(rv(1.2)), life: 0.06, size0: 0.35 * k, size1: 0.1, color0: 0xfff1b0, color1: 0xff7a1a, alpha0: 1 });
    for (let i = 0; i < 5; i++) ps.emit({ pos, vel: dir.clone().multiplyScalar(R(1, 3)).add(rv(0.4)), life: R(0.6, 1.2), size0: 0.15, size1: 0.6 * k, color0: 0x9a9a9a, alpha0: 0.35, alpha1: 0, drag: 2, gravity: -0.4 });
  },
  sparks(ps, pos, normal, k = 1) {
    for (let i = 0; i < 24 * k; i++) ps.emit({ blend: 'add', pos, vel: normal.clone().multiplyScalar(R(2, 6)).add(rv(3)), life: R(0.25, 0.7), size0: 0.06, size1: 0.02, color0: 0xffe28a, color1: 0xff5a00, gravity: 9.8, drag: 0.5 });
  },
  dust(ps, pos, normal, k = 1, color = 0xb8b0a0) {
    for (let i = 0; i < 12 * k; i++) ps.emit({ pos, vel: normal.clone().multiplyScalar(R(0.5, 2.5)).add(rv(0.8)), life: R(0.6, 1.6), size0: 0.08, size1: R(0.4, 0.9), color0: color, alpha0: 0.6, drag: 2.5, gravity: 0.3 });
    for (let i = 0; i < 8 * k; i++) ps.emit({ pos, vel: normal.clone().multiplyScalar(R(2, 5)).add(rv(2)), life: R(0.4, 0.9), size0: 0.04, color0: 0x6b665c, alpha0: 1, alpha1: 1, gravity: 9.8 });
  },
  smoke(ps, pos, k = 1) {
    for (let i = 0; i < 20 * k; i++) ps.emit({ pos: pos.clone().add(rv(0.3)), vel: new THREE.Vector3(R(-0.3, 0.3), R(0.6, 1.6), R(-0.3, 0.3)), life: R(2.5, 5), size0: 0.4, size1: R(2, 3.5), color0: 0x6a6a6a, color1: 0x9a9a9a, alpha0: 0.45, alpha1: 0, drag: 0.4, fadeIn: 0.3 });
  },
  explosion(ps, pos, k = 1) {
    for (let i = 0; i < 40 * k; i++) ps.emit({ blend: 'add', pos, vel: rv(1).normalize().multiplyScalar(R(2, 9)), life: R(0.25, 0.6), size0: R(0.8, 1.6), size1: 0.2, color0: 0xfff1b0, color1: 0xff3a00, drag: 3 });
    for (let i = 0; i < 30 * k; i++) ps.emit({ blend: 'add', pos, vel: rv(1).normalize().multiplyScalar(R(6, 16)).add(new THREE.Vector3(0, 4, 0)), life: R(0.5, 1.4), size0: 0.08, size1: 0.03, color0: 0xffd37a, color1: 0xff4400, gravity: 9.8, drag: 0.4 });
    for (let i = 0; i < 45 * k; i++) ps.emit({ pos: pos.clone().add(rv(0.8)), vel: rv(1).normalize().multiplyScalar(R(0.5, 3)).add(new THREE.Vector3(0, R(1, 3), 0)), life: R(3, 7), size0: 1, size1: R(3, 6), color0: 0x2e2a28, color1: 0x6e6a66, alpha0: 0.7, alpha1: 0, drag: 0.8, fadeIn: 0.25 });
  },
  fireTick(ps, pos, k = 1) {
    for (let i = 0; i < 3 * k; i++) ps.emit({ blend: 'add', pos: pos.clone().add(new THREE.Vector3(R(-0.6, 0.6), 0, R(-0.4, 0.4))), vel: new THREE.Vector3(R(-0.2, 0.2), R(1.2, 2.4), R(-0.2, 0.2)), life: R(0.5, 1), size0: R(0.5, 0.9), size1: 0.1, color0: 0xffc060, color1: 0xff2a00, drag: 0.5 });
    if (Math.random() < 0.5 * k) ps.emit({ pos: pos.clone().add(new THREE.Vector3(R(-0.4, 0.4), 1.2, R(-0.4, 0.4))), vel: new THREE.Vector3(R(-0.2, 0.2), R(1, 2), R(-0.2, 0.2)), life: R(3, 6), size0: 0.6, size1: 3, color0: 0x222222, color1: 0x555555, alpha0: 0.5, alpha1: 0, drag: 0.3, fadeIn: 0.4 });
  },
  steamTick(ps, pos, k = 1) {
    for (let i = 0; i < 2 * k; i++) ps.emit({ pos: pos.clone().add(rv(0.15)), vel: new THREE.Vector3(R(-0.2, 0.2), R(1.5, 2.5), R(-0.2, 0.2)), life: R(1.5, 3), size0: 0.3, size1: 2, color0: 0xe8eef2, alpha0: 0.35, alpha1: 0, drag: 0.6, fadeIn: 0.2 });
  },
  rainTick(ps, center, k = 1) {
    for (let i = 0; i < 40 * k; i++) ps.emit({ blend: 'alpha', pos: center.clone().add(new THREE.Vector3(R(-25, 25), R(10, 16), R(-25, 25))), vel: new THREE.Vector3(0.6, -14, 0), life: 1.2, size0: 0.05, color0: 0xb8c6d0, alpha0: 0.55, alpha1: 0.55 });
  },
};
