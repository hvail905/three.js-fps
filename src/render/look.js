// look.js : the post-processing and atmosphere pipeline tuned in the Effects lab.
// createLook(renderer, scene, camera) adds sky, sun and hemisphere lights to the scene and builds the
// composer: render -> depth of field -> bloom -> grade -> output -> lens. apply(settings) sets it
// from a lookSettings object (data/looks/*.json). Used by the Effects lab and the game.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
export { RenderPass };
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';

const D2R = THREE.MathUtils.degToRad;
export const BLOOM_TRIM_MAX = 0.6; // locked: auto bloom never exceeds 0.6x its curve
export const LOOK_DEFAULT = { autoAtmosphere: true, exposureTrim: 0, bloomTrim: 0.55, fogTrim: 1, sunElevation: 35, sunAzimuth: 200, exposure: 1.0, fogDensity: 0.003, bloomStrength: 0.35, bloomRadius: 0.4, bloomThreshold: 0.85, contrast: 1.05, saturation: 1.0, temperature: 0, tint: 0, vignette: 0.25, grain: 0.03, chromatic: 0.0, particleScale: 1, lens: 'none', lensAmount: 0.6, dof: false, focus: 14, aperture: 0.6 };
export const LENS_MODES = ['none', 'bodycam', 'crt', 'vhs', 'nightvision', 'thermal', 'pixel', 'cinematic'];

// ---------- auto atmosphere: values keyed by sun elevation, anchored on the golden-hour look ----------
export const ATMO_KEYS = [ // elevation, exposure, bloomStrength, bloomThreshold, fogDensity
  [-15, 1.3, 0.7, 0.62, 0.012], [-4, 1.1, 0.4, 0.72, 0.011], [3, 0.85, 0.12, 0.84, 0.009], [9, 0.82, 0.11, 0.83, 0.008],
  [20, 0.92, 0.16, 0.86, 0.005], [45, 1.0, 0.2, 0.88, 0.0035], [80, 1.0, 0.22, 0.9, 0.003],
];
export function atmo(el) {
  const K = ATMO_KEYS; if (el <= K[0][0]) return K[0].slice(1); if (el >= K[K.length - 1][0]) return K[K.length - 1].slice(1);
  for (let i = 0; i < K.length - 1; i++) if (el <= K[i + 1][0]) { const t = (el - K[i][0]) / (K[i + 1][0] - K[i][0]), sm = t * t * (3 - 2 * t); return K[i].slice(1).map((v, j) => v + (K[i + 1][j + 1] - v) * sm); }
}

export function createLook(renderer, scene, camera, { shadowExtent = 30, overlayParent = null } = {}) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const sky = new Sky(); sky.scale.setScalar(1500); scene.add(sky);
  const su = sky.material.uniforms; su.turbidity.value = 6; su.rayleigh.value = 1.5; su.mieCoefficient.value = 0.005; su.mieDirectionalG.value = 0.8;
  const hemi = new THREE.HemisphereLight(0xdfe8f0, 0x50483e, 1.0); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.5); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -shadowExtent, right: shadowExtent, top: shadowExtent, bottom: -shadowExtent, near: 1, far: 150 }); sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  scene.fog = new THREE.FogExp2(0xbfc9d1, 0.003);
  scene.background = new THREE.Color().setRGB(0.02, 0.025, 0.04);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bokeh = new BokehPass(scene, camera, { focus: 14, aperture: 0.0006, maxblur: 0.012 }); bokeh.enabled = false;
  composer.addPass(bokeh);
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.35, 0.4, 0.85);
  composer.addPass(bloom);
  const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uContrast: { value: 1 }, uSat: { value: 1 }, uTemp: { value: 0 }, uTint: { value: 0 }, uVig: { value: 0 }, uGrain: { value: 0 }, uChroma: { value: 0 }, uTime: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uContrast, uSat, uTemp, uTint, uVig, uGrain, uChroma, uTime; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
    void main(){
      vec2 dir = vUv - 0.5;
      vec3 col = vec3(texture2D(tDiffuse, vUv + dir * uChroma).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - dir * uChroma).b);
      col *= vec3(1.0 + uTemp * 0.18, 1.0 + uTint * 0.12, 1.0 - uTemp * 0.18);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col = (col - 0.18) * uContrast + 0.18;
      col *= 1.0 - uVig * smoothstep(0.3, 0.85, length(dir) * 1.3);
      col += (hash(vUv * 731.0) - 0.5) * uGrain;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
});
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  // display-space lens / camera emulation
  const lens = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uMode: { value: 0 }, uAmt: { value: 0.6 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform int uMode; uniform float uAmt, uTime; uniform vec2 uRes; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    float lum(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }
    vec2 barrel(vec2 uv, float k){ vec2 c = uv * 2.0 - 1.0; float r2 = dot(c, c); c *= (1.0 + k * r2) / (1.0 + k * 1.2); return c * 0.5 + 0.5; }
    bool outside(vec2 uv){ return uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0; }
    void main(){
      vec2 uv = vUv; vec3 col; float a = uAmt;
      if (uMode == 1) { // body cam: strong barrel distortion, edge chroma, crushed corners, sensor noise
        float k = 0.55 * a;
        vec2 ur = barrel(uv, k * 1.04), ug = barrel(uv, k), ub = barrel(uv, k * 0.96);
        col = vec3(texture2D(tDiffuse, ur).r, texture2D(tDiffuse, ug).g, texture2D(tDiffuse, ub).b);
        vec2 c = uv - 0.5; col *= 1.0 - smoothstep(0.35, 0.78, length(c * vec2(1.0, 0.85))) * 0.85 * a;
        col = mix(col, vec3(lum(col)), 0.2 * a) + (h(uv * uRes + uTime) - 0.5) * 0.06 * a;
        col = (col - 0.5) * (1.0 + 0.15 * a) + 0.5;
      } else if (uMode == 2) { // CRT: curvature, scanlines, aperture grille, flicker
        vec2 u2 = barrel(uv, 0.18 * a);
        if (outside(u2)) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        col = texture2D(tDiffuse, u2).rgb;
        col *= 0.78 + 0.22 * sin(u2.y * uRes.y * 1.5708) * a + (1.0 - a) * 0.22;
        float m = mod(gl_FragCoord.x, 3.0);
        vec3 mask = m < 1.0 ? vec3(1.0, 0.7, 0.7) : m < 2.0 ? vec3(0.7, 1.0, 0.7) : vec3(0.7, 0.7, 1.0);
        col *= mix(vec3(1.0), mask, 0.6 * a) * (1.0 + 0.25 * a);
        col *= 0.97 + 0.03 * sin(uTime * 60.0);
        vec2 c = u2 - 0.5; col *= 1.0 - smoothstep(0.42, 0.72, length(c)) * a;
      } else if (uMode == 3) { // VHS: line wobble, chroma bleed, tracking band, washed color
        float wob = sin(uv.y * 40.0 + uTime * 3.0) * 0.0015 * a + (h(vec2(floor(uv.y * 240.0), floor(uTime * 20.0))) - 0.5) * 0.004 * a;
        float band = smoothstep(0.0, 0.02, abs(fract(uv.y + uTime * 0.08) - 0.9)); wob += (1.0 - band) * 0.02 * a;
        vec2 u2 = vec2(uv.x + wob, uv.y);
        col = vec3(texture2D(tDiffuse, u2 + vec2(0.006 * a, 0.0)).r, texture2D(tDiffuse, u2).g, texture2D(tDiffuse, u2 - vec2(0.006 * a, 0.0)).b);
        col = mix(col, vec3(lum(col)), 0.35 * a) * vec3(1.05, 1.0, 0.92);
        col += (h(uv * uRes + uTime) - 0.5) * 0.12 * a + (1.0 - band) * 0.25 * a;
      } else if (uMode == 4) { // night vision: amplified luminance, green phosphor, noise, tube vignette
        float l = lum(texture2D(tDiffuse, uv).rgb);
        l = pow(l * (2.5 + 3.0 * a), 0.8) + (h(uv * uRes + uTime) - 0.5) * 0.18 * a;
        col = vec3(0.12, 1.0, 0.25) * l;
        vec2 c = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0); col *= 1.0 - smoothstep(0.38, 0.5, length(c));
      } else if (uMode == 5) { // thermal-style false color (luminance, not real heat)
        float l = clamp(lum(texture2D(tDiffuse, uv).rgb) * 1.6, 0.0, 1.0);
        vec3 c1 = mix(vec3(0.0, 0.0, 0.15), vec3(0.45, 0.0, 0.6), smoothstep(0.0, 0.3, l));
        c1 = mix(c1, vec3(0.95, 0.2, 0.1), smoothstep(0.3, 0.6, l)); c1 = mix(c1, vec3(1.0, 0.9, 0.2), smoothstep(0.6, 0.85, l)); c1 = mix(c1, vec3(1.0), smoothstep(0.85, 1.0, l));
        col = mix(texture2D(tDiffuse, uv).rgb, c1, a);
      } else if (uMode == 6) { // pixelated
        float px = 1.0 + floor(10.0 * a); vec2 cell = px / uRes;
        col = texture2D(tDiffuse, (floor(uv / cell) + 0.5) * cell).rgb;
        col = floor(col * (6.0 + (1.0 - a) * 26.0)) / (6.0 + (1.0 - a) * 26.0);
      } else if (uMode == 7) { // cinematic: 2.39:1 letterbox, slight halation
        float target = uRes.x / 2.39 / uRes.y, bar = (1.0 - target) * 0.5 * a;
        if (uv.y < bar || uv.y > 1.0 - bar) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        col = texture2D(tDiffuse, uv).rgb;
        vec3 glow = texture2D(tDiffuse, uv + vec2(0.002, 0.0)).rgb + texture2D(tDiffuse, uv - vec2(0.002, 0.0)).rgb;
        col += max(glow * 0.5 - 0.7, 0.0) * vec3(1.0, 0.35, 0.2) * a;
      } else col = texture2D(tDiffuse, uv).rgb;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
  composer.addPass(lens);

  let overlay = null;
  if (overlayParent) {
    overlay = document.createElement('div');
    Object.assign(overlay.style, { position: 'absolute', right: '14px', top: '12px', font: '600 14px ui-monospace, Menlo, monospace', color: '#fff', textShadow: '0 0 3px #000', pointerEvents: 'none', display: 'none', textAlign: 'right', zIndex: 5 });
    overlayParent.appendChild(overlay);
  }

  const sunDir = new THREE.Vector3(), focus = new THREE.Vector3();
  let current = { ...LOOK_DEFAULT }, state = {};
  // Returns derived values: { exposure, bloomStrength, bloomThreshold, fogDensity, night, warm }.
  function apply(input) {
    const L = current = { ...LOOK_DEFAULT, ...input };
    L.bloomTrim = Math.min(BLOOM_TRIM_MAX, Math.max(0, L.bloomTrim));
    const el = L.sunElevation, night = THREE.MathUtils.clamp((-el + 2) / 10, 0, 1);
    sunDir.setFromSphericalCoords(1, D2R(90 - el), D2R(L.sunAzimuth));
    su.sunPosition.value.copy(sunDir);
    placeSun();
    sun.intensity = 2.6 * THREE.MathUtils.clamp(el / 15, 0, 1) + 0.05;
    const warm = THREE.MathUtils.clamp(1 - el / 25, 0, 1);
    sun.color.setRGB(1, 1 - warm * 0.25, 1 - warm * 0.5);
    hemi.intensity = THREE.MathUtils.lerp(1.0, 0.08, night);
    sky.visible = el > -8;
    const fogCol = new THREE.Color(0xbfc9d1).lerp(new THREE.Color(0xd9a77a), warm * 0.4 * (1 - night)).lerp(new THREE.Color(0x0a0d14), night);
    let ex = L.exposure, bs = L.bloomStrength, bt = L.bloomThreshold, fd = L.fogDensity;
    if (L.autoAtmosphere) { const [e2, b2, t2, f2] = atmo(el); ex = e2 + L.exposureTrim; bs = b2 * L.bloomTrim; bt = t2; fd = f2 * L.fogTrim; }
    // tame the sun disc near the horizon (main source of flare)
    su.mieCoefficient.value = THREE.MathUtils.lerp(0.002, 0.005, THREE.MathUtils.clamp(el / 30, 0, 1)); su.turbidity.value = THREE.MathUtils.lerp(8, 5, THREE.MathUtils.clamp(el / 30, 0, 1));
    scene.fog.color.copy(fogCol); scene.fog.density = fd;
    renderer.toneMappingExposure = ex;
    bloom.strength = bs; bloom.radius = L.bloomRadius; bloom.threshold = bt;
    lens.uniforms.uMode.value = Math.max(0, LENS_MODES.indexOf(L.lens)); lens.uniforms.uAmt.value = L.lensAmount;
    bokeh.enabled = !!L.dof; bokeh.uniforms.focus.value = L.focus; bokeh.uniforms.aperture.value = L.aperture * 0.001;
    const u = grade.uniforms; u.uContrast.value = L.contrast; u.uSat.value = L.saturation; u.uTemp.value = L.temperature; u.uTint.value = L.tint; u.uVig.value = L.vignette; u.uGrain.value = L.grain; u.uChroma.value = L.chromatic;
    if (overlay) overlay.style.display = L.lens === 'bodycam' || L.lens === 'vhs' ? 'block' : 'none';
    state = { exposure: ex, bloomStrength: bs, bloomThreshold: bt, fogDensity: fd, night, warm };
    return state;
  }
  function placeSun() { sun.target.position.copy(focus); sun.position.copy(focus).addScaledVector(sunDir, 60); sun.target.updateMatrixWorld(); }
  // Keep the shadow map centered on the action (player position in the game).
  function follow(p) { focus.set(p.x, 0, p.z); placeSun(); }
  function setSize(w, h) { composer.setSize(w, h); const pr = renderer.getPixelRatio(); lens.uniforms.uRes.value.set(w * pr, h * pr); }
  function tick(dt) {
    grade.uniforms.uTime.value = (grade.uniforms.uTime.value + dt) % 100; lens.uniforms.uTime.value = grade.uniforms.uTime.value;
    if (overlay && overlay.style.display === 'block') { const d = new Date(); overlay.textContent = current.lens === 'vhs' ? `PLAY \u25B6  ${d.toLocaleTimeString()}` : `CAM 04 \u00B7 ${d.toISOString().slice(0, 10)} ${d.toTimeString().slice(0, 8)} \u00B7 \u25CF REC`; }
  }
  // Draw a second scene (the first-person weapon) over the world: after depth of field so it stays
  // sharp, before bloom, grade and lens so it gets the same look.
  function addOverlay(oScene, oCamera) {
    const p = new RenderPass(oScene, oCamera); p.clear = false; p.clearDepth = true;
    composer.insertPass(p, composer.passes.indexOf(bokeh) + 1);
    return p;
  }
  return { composer, sky, sun, hemi, bloom, grade, bokeh, lens, sunDir, apply, follow, addOverlay, setSize, tick, render: () => composer.render(), get settings() { return current; }, get state() { return state; } };
}
