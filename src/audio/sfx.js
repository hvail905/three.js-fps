// Procedural sound effects for Web Audio, v2.
// Every sound is built from layers: a transient, a resonant body, a saturated low end, a tail, and detail
// (mechanics, debris, casings). Each play is varied so repeated sounds do not machine-gun.
// Optional sample layer: blend a recorded clip (e.g. CC0 from Freesound) under or over the synthesis.
// play(ctx, out, t0, params, R) schedules nodes into `out`. Works with AudioContext and OfflineAudioContext.

// ---------------------------------------------------------------- building blocks
const noiseCache = new WeakMap();
function noiseBuffer(ctx, kind = 'white') {
  let m = noiseCache.get(ctx); if (!m) { m = {}; noiseCache.set(ctx, m); }
  if (m[kind]) return m[kind];
  const len = ctx.sampleRate * 2, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
  let last = 0, b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    else if (kind === 'pink') { // Paul Kellet's filter
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    } else d[i] = w;
  }
  return (m[kind] = b);
}
// N-wave: the pressure shape of a supersonic crack / muzzle blast front. Short, dense, punchy.
function nwaveBuffer(ctx, ms) {
  const n = Math.max(8, Math.round(ctx.sampleRate * ms / 1000)), b = ctx.createBuffer(1, n * 4, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = 1 - 2 * i / n;
  for (let i = n; i < n * 4; i++) d[i] = -Math.exp(-(i - n) / (n * 0.6)) * 0.35 * Math.sin((i - n) / n * Math.PI * 1.5);
  return b;
}
function noise(ctx, t0, dur, kind = 'white') { const s = ctx.createBufferSource(); s.buffer = noiseBuffer(ctx, kind); s.loop = true; s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + 0.05); return s; }
function env(ctx, t0, attack, peak, decay, curve = 'exp', hold = 0) {
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
  if (hold) g.gain.setValueAtTime(Math.max(0.0002, peak), t0 + attack + hold);
  if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + decay); else g.gain.linearRampToValueAtTime(0, t0 + attack + hold + decay);
  return g;
}
function filter(ctx, type, freq, q = 0.7) { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = Math.min(ctx.sampleRate / 2 - 100, Math.max(10, freq)); f.Q.value = q; return f; }
function sweep(ctx, type, f0, f1, t0, dur, q = 0.7) { const f = filter(ctx, type, f0, q); f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur); return f; }
function chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }
function tone(ctx, t0, type, f0, f1, dur) { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(15, f1), t0 + dur); o.start(t0); o.stop(t0 + dur + 0.05); return o; }
function gain(ctx, v) { const g = ctx.createGain(); g.gain.value = v; return g; }
const shaperCache = new WeakMap();
// tanh saturation: adds harmonics so low end is heard on small speakers, and glues layers together
function drive(ctx, amount) {
  let m = shaperCache.get(ctx); if (!m) { m = {}; shaperCache.set(ctx, m); }
  const k = Math.round(amount * 20) / 20;
  if (!m[k]) {
    const n = 2048, c = new Float32Array(n), a = 1 + k * 9;
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(a * x) / Math.tanh(a); }
    m[k] = c;
  }
  const s = ctx.createWaveShaper(); s.curve = m[k]; s.oversample = '2x'; return s;
}
function nwave(ctx, t0, ms, a, out) { const s = ctx.createBufferSource(); s.buffer = nwaveBuffer(ctx, ms); s.start(t0); chain(s, gain(ctx, a), out); }
// parallel resonances: the "body" of an object or a muzzle blast
function resonate(ctx, src, freqs, q, gains, out) { freqs.forEach((f, i) => chain(src, filter(ctx, 'bandpass', f, q), gain(ctx, gains[i] ?? 1), out)); }
// damped inharmonic partials: metal, glass
function ring(ctx, t0, partials, a, out) { for (const [f, g, d] of partials) chain(tone(ctx, t0, 'sine', f, f * 0.995, d + 0.05), env(ctx, t0, 0.0008, a * g, d), out); }

// Per-play randomness. variation 0..1 scales every jitter.
export function makeVary(v = 0.5) { return (spread = 0.1) => 1 + (Math.random() * 2 - 1) * spread * v; }

// ---------------------------------------------------------------- sounds
export const SOUNDS = {
  gunshot: {
    label: 'Gunshot', group: 'Weapons', gain: 0.62,
    presets: {
      pistol: { crack: 0.7, crackTone: 2800, blast: 0.8, blastTone: 520, sub: 0.55, subPitch: 95, drive: 0.45, tail: 0.45, tailLength: 0.45, slap: 0.35, mech: 0.45, brass: 0.5, variation: 0.6 },
      smg: { crack: 0.65, crackTone: 3200, blast: 0.7, blastTone: 600, sub: 0.45, subPitch: 105, drive: 0.4, tail: 0.4, tailLength: 0.35, slap: 0.3, mech: 0.55, brass: 0.4, variation: 0.7 },
      rifle: { crack: 1.0, crackTone: 3600, blast: 0.95, blastTone: 430, sub: 0.75, subPitch: 80, drive: 0.55, tail: 0.65, tailLength: 0.8, slap: 0.5, mech: 0.4, brass: 0.45, variation: 0.6 },
      shotgun: { crack: 0.7, crackTone: 2000, blast: 1.1, blastTone: 300, sub: 1.0, subPitch: 65, drive: 0.6, tail: 0.8, tailLength: 1.0, slap: 0.55, mech: 0.2, brass: 0.2, variation: 0.5 },
      sniper: { crack: 1.15, crackTone: 4200, blast: 1.05, blastTone: 340, sub: 1.0, subPitch: 58, drive: 0.65, tail: 1.0, tailLength: 1.8, slap: 0.7, mech: 0.2, brass: 0.35, variation: 0.4 },
      suppressed: { crack: 0.12, crackTone: 1500, blast: 0.45, blastTone: 950, sub: 0.25, subPitch: 120, drive: 0.2, tail: 0.1, tailLength: 0.15, slap: 0.05, mech: 0.9, brass: 0.5, variation: 0.6 },
    },
    params: {
      crack: [0, 1.4, 0.01, 'supersonic crack and muzzle front'], crackTone: [800, 8000, 50, 'Hz'],
      blast: [0, 1.4, 0.01, 'mid-range blast body: what makes it sound solid'], blastTone: [150, 1500, 5, 'Hz, body center'],
      sub: [0, 1.4, 0.01, 'chest thump'], subPitch: [40, 160, 1, 'Hz'], drive: [0, 1, 0.01, 'saturation'],
      tail: [0, 1.4, 0.01], tailLength: [0.05, 3, 0.01, 's'], slap: [0, 1, 0.01, 'echo off nearby surfaces'],
      mech: [0, 1, 0.01, 'action cycling'], brass: [0, 1, 0.01, 'casing hitting the ground'], variation: [0, 1, 0.01, 'shot-to-shot change'],
    },
    play(ctx, out, t, p, R) {
      const bus = ctx.createGain(); const sat = drive(ctx, p.drive);
      chain(bus, sat, gain(ctx, 0.9), out);
      // 1. transient: N-wave front + bright noise snap
      nwave(ctx, t, 0.35 * R(0.2), p.crack * 0.9, bus);
      chain(noise(ctx, t, 0.03), filter(ctx, 'highpass', p.crackTone * R(0.15)), env(ctx, t, 0.0004, p.crack * 0.7, 0.012 * R(0.3)), bus);
      // 2. blast: pink noise through three resonances, low-passed downward so it blooms then darkens
      const bt = p.blastTone * R(0.12), bd = 0.05 + p.tailLength * 0.05;
      const bsrc = chain(noise(ctx, t, bd + 0.2, 'pink'), sweep(ctx, 'lowpass', 7000, bt * 1.3, t, bd * 1.4));
      const benv = env(ctx, t, 0.0012, p.blast * 6.5, bd * R(0.2));
      resonate(ctx, bsrc, [bt * 0.55, bt, bt * 2.3, bt * 4.8], 0.8 * R(0.2), [0.9, 1, 0.55 * R(0.3), 0.25 * R(0.3)], benv);
      chain(benv, bus);
      // 3. sub thump, saturated so it carries on small speakers
      chain(tone(ctx, t, 'sine', p.subPitch * 2.2 * R(0.08), p.subPitch * 0.45, 0.16), env(ctx, t, 0.001, p.sub * 0.8, 0.14 * R(0.15)), bus);
      chain(tone(ctx, t, 'triangle', p.subPitch * 1.1 * R(0.08), p.subPitch * 0.5, 0.1), env(ctx, t, 0.001, p.sub * 0.35, 0.08), bus);
      // 4. tail: rumble that darkens as it decays
      const tl = p.tailLength * R(0.15);
      chain(noise(ctx, t, tl + 0.2, 'brown'), sweep(ctx, 'lowpass', 2600, 260, t, tl), env(ctx, t + 0.008, 0.02, p.tail * 0.4, tl), out);
      chain(noise(ctx, t, tl * 0.6 + 0.1, 'pink'), sweep(ctx, 'bandpass', 1400, 400, t, tl * 0.6, 0.8), env(ctx, t + 0.01, 0.015, p.tail * 1.1, tl * 0.5), out);
      // 5. slap: discrete reflections off nearby surfaces (outdoor "pop-pop")
      const taps = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < taps && p.slap > 0; i++) {
        const dt = 0.06 + Math.random() * 0.3, a = p.slap * 1.2 / (1 + i * 0.7);
        chain(noise(ctx, t + dt, 0.12, 'pink'), filter(ctx, 'bandpass', bt * 1.4 * R(0.3), 0.9), env(ctx, t + dt, 0.003, a, 0.08 + dt * 0.25), out);
        chain(tone(ctx, t + dt, 'sine', p.subPitch * 1.4, p.subPitch * 0.6, 0.1), env(ctx, t + dt, 0.002, a * 0.4 * p.sub, 0.08), out);
      }
      // 6. mechanics: bolt carrier cycling
      if (p.mech > 0) {
        const tm = t + 0.03 + Math.random() * 0.025;
        chain(noise(ctx, tm, 0.03), filter(ctx, 'bandpass', 3200 * R(0.15), 3), env(ctx, tm, 0.0008, p.mech * 0.45, 0.02), out);
        chain(noise(ctx, tm, 0.05), filter(ctx, 'bandpass', 700 * R(0.15), 2), env(ctx, tm, 0.001, p.mech * 0.35, 0.04), out);
        ring(ctx, tm + 0.012, [[1840 * R(0.05), 0.4, 0.05], [2960 * R(0.05), 0.3, 0.04], [4380 * R(0.05), 0.2, 0.03]], p.mech * 0.25, out);
      }
      // 7. brass: casing bounces, intervals shrink like a real bounce
      let end = tl + 0.3;
      if (p.brass > 0) {
        let tb = t + 0.38 + Math.random() * 0.25, gap = 0.09 + Math.random() * 0.05, a = p.brass * 0.12;
        const f = 4800 * R(0.15);
        for (let i = 0; i < 4; i++) {
          ring(ctx, tb, [[f, 1, 0.07], [f * 1.53, 0.6, 0.05], [f * 2.31, 0.35, 0.04]], a, out);
          chain(noise(ctx, tb, 0.01), filter(ctx, 'highpass', 5000), env(ctx, tb, 0.0005, a * 0.8, 0.006), out);
          tb += gap; gap *= 0.62; a *= 0.55;
        }
        end = Math.max(end, tb - t + 0.1);
      }
      return end;
    },
  },
  explosion: {
    label: 'Explosion', group: 'Weapons', gain: 0.55,
    presets: {
      grenade: { size: 0.8, crack: 0.8, roar: 0.8, debris: 0.5, length: 2.4, drive: 0.6, variation: 0.6 },
      car: { size: 1.0, crack: 0.5, roar: 1.0, debris: 0.9, length: 3.8, drive: 0.55, variation: 0.6 },
      small: { size: 0.4, crack: 0.9, roar: 0.5, debris: 0.25, length: 1.1, drive: 0.5, variation: 0.6 },
    },
    params: { size: [0.1, 1.2, 0.01], crack: [0, 1.2, 0.01], roar: [0, 1.2, 0.01, 'mid-range fireball'], debris: [0, 1, 0.01], length: [0.5, 6, 0.05, 's'], drive: [0, 1, 0.01], variation: [0, 1, 0.01] },
    play(ctx, out, t, p, R) {
      const bus = ctx.createGain(); chain(bus, drive(ctx, p.drive), gain(ctx, 0.85), out);
      const L = p.length * R(0.15);
      nwave(ctx, t, 1.2 + p.size * 1.5, p.crack * 1.1, bus);
      chain(noise(ctx, t, 0.08), filter(ctx, 'highpass', 1800), env(ctx, t, 0.0005, p.crack * 0.8, 0.05), bus);
      // sub: long pitch drop
      chain(tone(ctx, t, 'sine', (70 + 30 * (1 - p.size)) * R(0.1), 22, 0.9 + p.size * 0.6), env(ctx, t, 0.004, p.size * 0.9, 0.8 + p.size * 0.7), bus);
      // punch in the mids
      const ps = noise(ctx, t, 0.6, 'pink'), penv = env(ctx, t, 0.002, p.size * 5, 0.35 * R(0.2));
      resonate(ctx, ps, [180 * R(0.1), 420 * R(0.1), 900 * R(0.1)], 0.9, [1, 0.8, 0.45], penv); chain(penv, bus);
      // roar: fireball, sweeping down
      chain(noise(ctx, t, L * 0.7, 'pink'), sweep(ctx, 'lowpass', 4500, 280, t, L * 0.6), env(ctx, t, 0.03, p.roar * 2.4, L * 0.55), bus);
      chain(noise(ctx, t, L + 0.2, 'brown'), sweep(ctx, 'lowpass', 900, 120, t, L), env(ctx, t, 0.05, p.size * 0.55, L), out);
      // rolling echoes off terrain and buildings
      for (let i = 0; i < 3; i++) {
        const dt = 0.25 + i * (0.35 + Math.random() * 0.4);
        chain(noise(ctx, t + dt, L * 0.5, 'brown'), filter(ctx, 'lowpass', 500 - i * 100), env(ctx, t + dt, 0.12, p.size * 0.3 / (i + 1), L * 0.45), out);
      }
      // debris: thuds and tinkles
      for (let i = 0; i < 22 * p.debris; i++) {
        const tt = t + 0.3 + Math.random() * L * 0.6, big = Math.random() < 0.35;
        if (big) chain(noise(ctx, tt, 0.08, 'pink'), filter(ctx, 'bandpass', 250 + Math.random() * 400, 1.5), env(ctx, tt, 0.002, 0.35 * p.debris, 0.06), out);
        else ring(ctx, tt, [[2000 + Math.random() * 3500, 1, 0.04 + Math.random() * 0.05], [5200 + Math.random() * 2000, 0.4, 0.03]], 0.1 * p.debris, out);
      }
      return L + 0.4;
    },
  },
  reload: {
    label: 'Reload', group: 'Weapons', gain: 2.2,
    presets: { magazine: { kind: 0, weight: 0.7, speed: 1, variation: 0.6 }, bolt: { kind: 1, weight: 0.7, speed: 1, variation: 0.6 }, shell: { kind: 2, weight: 0.6, speed: 1, variation: 0.6 } },
    params: { kind: [0, 2, 1, '0 mag · 1 bolt · 2 shell'], weight: [0.1, 1, 0.01, 'more weight = more low body'], speed: [0.5, 2, 0.01, '×'], variation: [0, 1, 0.01] },
    play(ctx, out, t, p, R) {
      const w = p.weight;
      // a hard contact: transient + low body + small metal ring
      const clack = (tt, bright, body, ringF = 0) => {
        chain(noise(ctx, tt, 0.02), filter(ctx, 'bandpass', bright * R(0.1), 2.5), env(ctx, tt, 0.0006, 0.5, 0.012), out);
        chain(noise(ctx, tt, 0.06, 'pink'), filter(ctx, 'bandpass', body * R(0.1), 1.6), env(ctx, tt, 0.001, 0.75 * w, 0.035), out);
        chain(tone(ctx, tt, 'sine', body * 0.45 * R(0.08), body * 0.3, 0.05), env(ctx, tt, 0.001, 0.35 * w, 0.04), out);
        if (ringF) ring(ctx, tt, [[ringF * R(0.05), 0.5, 0.06], [ringF * 1.58, 0.3, 0.05], [ringF * 2.4, 0.15, 0.04]], 0.18, out);
      };
      // a scrape: friction noise with uneven grip
      const scrape = (tt, len, f) => {
        const g = env(ctx, tt, 0.015, 0.25 * (0.5 + w * 0.5), len, 'lin');
        const am = ctx.createGain(); am.gain.value = 0.6;
        const lfo = tone(ctx, tt, 'square', 35 * R(0.3), 22, len); chain(lfo, gain(ctx, 0.4), am.gain);
        chain(noise(ctx, tt, len + 0.05, 'pink'), filter(ctx, 'bandpass', f * R(0.1), 1.4), am, g, out);
      };
      const s = 1 / p.speed;
      if (p.kind === 0) { clack(t, 2600, 900, 2400); scrape(t + 0.04 * s, 0.16 * s, 1500); scrape(t + 0.55 * s, 0.12 * s, 1300); clack(t + 0.69 * s, 2000, 520, 1900); clack(t + 0.73 * s, 3400, 1100); return 1.0 * s; }
      if (p.kind === 1) { clack(t, 3000, 1000, 2600); scrape(t + 0.03 * s, 0.13 * s, 2200); clack(t + 0.2 * s, 2400, 700); scrape(t + 0.27 * s, 0.09 * s, 2000); clack(t + 0.38 * s, 3600, 800, 2200); return 0.6 * s; }
      for (let i = 0; i < 3; i++) { const tt = t + i * 0.36 * s * R(0.08); scrape(tt, 0.07 * s, 1300); clack(tt + 0.09 * s, 1500, 420); }
      clack(t + 1.15 * s, 2500, 600, 1700); scrape(t + 1.17 * s, 0.1 * s, 1600); clack(t + 1.32 * s, 2800, 750);
      return 1.5 * s;
    },
  },
  footstep: {
    label: 'Footstep', group: 'Movement', gain: 2.6,
    presets: {
      concrete: { surface: 0, weight: 0.6, pace: 1, gear: 0.2, variation: 0.6 }, metal: { surface: 1, weight: 0.6, pace: 1, gear: 0.2, variation: 0.6 },
      wood: { surface: 2, weight: 0.6, pace: 1, gear: 0.2, variation: 0.6 }, gravel: { surface: 3, weight: 0.6, pace: 1, gear: 0.2, variation: 0.6 },
      grass: { surface: 4, weight: 0.6, pace: 1, gear: 0.2, variation: 0.6 }, water: { surface: 5, weight: 0.6, pace: 1, gear: 0.2, variation: 0.6 },
      dirt: { surface: 6, weight: 0.6, pace: 1, gear: 0.2, variation: 0.6 }, snow: { surface: 7, weight: 0.6, pace: 1, gear: 0.2, variation: 0.6 },
    },
    params: { surface: [0, 7, 1, '0 concrete · 1 metal · 2 wood · 3 gravel · 4 grass · 5 water · 6 dirt · 7 snow'], weight: [0.1, 1, 0.01], pace: [0.5, 2, 0.01, 'steps ×'], gear: [0, 1, 0.01, 'kit rattle'], variation: [0, 1, 0.01] },
    play(ctx, out, t, p, R) {
      const step = (tt, left) => {
        const w = p.weight * R(0.15), j = R(0.12), toe = tt + 0.03 + Math.random() * 0.025;
        // shared: boot body thud (heel), then toe roll
        const thud = (a, f = 90) => { chain(tone(ctx, tt, 'sine', f * 1.2 * j, f * 0.8, 0.05), env(ctx, tt, 0.002, a * 0.35 * w, 0.04), out); chain(noise(ctx, tt, 0.07, 'pink'), filter(ctx, 'bandpass', 260 * j, 0.8), env(ctx, tt, 0.002, a * 1.2 * w, 0.05), out); };
        switch (p.surface) {
          case 0: thud(0.55); chain(noise(ctx, tt, 0.04), filter(ctx, 'bandpass', 2100 * j, 1.4), env(ctx, tt, 0.001, 0.5 * w, 0.025), out); chain(noise(ctx, toe, 0.05, 'pink'), filter(ctx, 'bandpass', 1100 * j, 1.0), env(ctx, toe, 0.002, 0.9 * w, 0.035), out); chain(noise(ctx, tt, 0.06, 'pink'), filter(ctx, 'bandpass', 650 * j, 1.0), env(ctx, tt, 0.002, 0.9 * w, 0.04), out); break;
          case 1: thud(0.45, 110); chain(noise(ctx, tt, 0.04), filter(ctx, 'bandpass', 2600 * j, 2), env(ctx, tt, 0.001, 0.3 * w, 0.03), out); ring(ctx, tt, [[310 * j, 0.6, 0.35], [742 * j, 0.45, 0.28], [1290 * j, 0.3, 0.22], [2150 * j, 0.15, 0.15]], 0.22 * w, out); break;
          case 2: thud(0.6, 120); resonate(ctx, chain(noise(ctx, tt, 0.12, 'pink'), env(ctx, tt, 0.002, 0.9 * w, 0.07)), [190 * j, 430 * j, 980 * j], 4, [1.8, 1.2, 0.6], out); if (Math.random() < 0.3) chain(tone(ctx, toe + 0.05, 'triangle', 420 * j, 380, 0.12), env(ctx, toe + 0.05, 0.03, 0.05, 0.08), out); break;
          case 3: thud(0.4); for (let i = 0; i < 14; i++) { const g = tt + Math.random() * 0.12; chain(noise(ctx, g, 0.015), filter(ctx, 'bandpass', 1500 + Math.random() * 3500, 2.5), env(ctx, g, 0.0008, (0.25 + Math.random() * 0.3) * w, 0.014), out); } chain(noise(ctx, tt, 0.15, 'pink'), filter(ctx, 'bandpass', 1100, 0.8), env(ctx, tt, 0.004, 0.8 * w, 0.1), out); break;
          case 4: thud(0.35, 75); chain(noise(ctx, tt, 0.22, 'pink'), filter(ctx, 'bandpass', 2000 * j, 0.7), env(ctx, tt, 0.015, 0.7 * w, 0.17), out); for (let i = 0; i < 8; i++) { const g = tt + Math.random() * 0.15; chain(noise(ctx, g, 0.02), filter(ctx, 'highpass', 3500), env(ctx, g, 0.001, 0.12 * w, 0.015), out); } break;
          case 5: thud(0.3, 70); chain(noise(ctx, tt, 0.3, 'pink'), sweep(ctx, 'bandpass', 500, 1400, tt, 0.2, 1.1), env(ctx, tt, 0.006, 1.2 * w, 0.22), out); for (let i = 0; i < 5; i++) { const g = tt + 0.04 + Math.random() * 0.2, f = 500 + Math.random() * 1000; chain(tone(ctx, g, 'sine', f, f * 2.2, 0.05), env(ctx, g, 0.002, 0.07 * w, 0.04), out); } break;
          case 6: thud(0.6, 80); chain(noise(ctx, tt, 0.12, 'pink'), filter(ctx, 'bandpass', 650 * j, 1), env(ctx, tt, 0.003, 1.1 * w, 0.08), out); for (let i = 0; i < 8; i++) { const g = tt + Math.random() * 0.08; chain(noise(ctx, g, 0.015), filter(ctx, 'bandpass', 1500 + Math.random() * 1500, 2), env(ctx, g, 0.001, 0.2 * w, 0.012), out); } break;
          case 7: thud(0.3, 70); { const a = ctx.createGain(); a.gain.value = 1; for (let i = 0; i < 18; i++) { const g = tt + i * 0.008 + Math.random() * 0.006; chain(noise(ctx, g, 0.012), filter(ctx, 'bandpass', 1200 + Math.random() * 2500, 1.8), env(ctx, g, 0.001, (0.3 + Math.random() * 0.25) * w, 0.012), out); } } break;
        }
        if (p.gear > 0) { const g = tt + 0.02 + Math.random() * 0.04; ring(ctx, g, [[2700 * R(0.2), 0.5, 0.04], [4100 * R(0.2), 0.3, 0.03]], 0.06 * p.gear, out); chain(noise(ctx, g, 0.06, 'pink'), filter(ctx, 'bandpass', 1800, 1.2), env(ctx, g, 0.004, 0.08 * p.gear, 0.05), out); }
      };
      const gap = 0.45 / p.pace;
      for (let i = 0; i < 4; i++) step(t + i * gap * R(0.06), i % 2 === 0);
      return gap * 4 + 0.5;
    },
  },
  impact: {
    label: 'Bullet impact', group: 'Impacts', gain: 1.0,
    presets: { concrete: { material: 0, power: 0.8, variation: 0.6 }, metal: { material: 1, power: 0.8, variation: 0.6 }, wood: { material: 2, power: 0.8, variation: 0.6 }, glass: { material: 3, power: 0.8, variation: 0.6 }, body: { material: 4, power: 0.8, variation: 0.6 }, dirt: { material: 5, power: 0.8, variation: 0.6 } },
    params: { material: [0, 5, 1, '0 concrete · 1 metal · 2 wood · 3 glass · 4 body · 5 dirt'], power: [0.1, 1.2, 0.01], variation: [0, 1, 0.01] },
    play(ctx, out, t, p, R) {
      const w = p.power;
      const snap = (f, a, d = 0.01) => chain(noise(ctx, t, 0.03), filter(ctx, 'highpass', f * R(0.15)), env(ctx, t, 0.0005, a * w, d), out);
      const thump = (f, a, d = 0.06) => { chain(tone(ctx, t, 'sine', f * R(0.1), f * 0.5, d + 0.02), env(ctx, t, 0.001, a * w, d), out); chain(noise(ctx, t, d + 0.05, 'pink'), filter(ctx, 'lowpass', f * 3), env(ctx, t, 0.001, a * 0.8 * w, d), out); };
      switch (p.material) {
        case 0: { // concrete: crack, thud, chips, dust
          snap(2500, 0.5); thump(150, 0.6, 0.05);
          resonate(ctx, chain(noise(ctx, t, 0.1, 'pink'), env(ctx, t, 0.001, 3 * w, 0.06)), [700 * R(0.15), 1600 * R(0.15)], 1.2, [0.8, 0.6], out);
          for (let i = 0; i < 9; i++) { const g = t + 0.03 + Math.random() * 0.3; chain(noise(ctx, g, 0.02), filter(ctx, 'bandpass', 1800 + Math.random() * 3500, 3), env(ctx, g, 0.0008, (0.05 + Math.random() * 0.1) * w, 0.015), out); }
          chain(noise(ctx, t, 0.5, 'pink'), filter(ctx, 'bandpass', 2500, 0.7), env(ctx, t + 0.01, 0.03, 0.06 * w, 0.4), out);
          return 0.6;
        }
        case 1: { // metal: plate modes, each with its own decay
          const b = 620 * R(0.2);
          snap(3500, 0.45, 0.006); thump(200, 0.35, 0.04);
          ring(ctx, t, [[b, 0.5, 0.7], [b * 2.32, 0.4, 0.55], [b * 4.25, 0.3, 0.4], [b * 6.63, 0.18, 0.3], [b * 9.4, 0.1, 0.2]], 0.35 * w, out);
          if (Math.random() < 0.5) { const tr = t + 0.02; chain(tone(ctx, tr, 'sine', 3800 * R(0.2), 1400, 0.25), env(ctx, tr, 0.003, 0.05 * w, 0.22), out); } // ricochet whine
          return 1.0;
        }
        case 2: { // wood: hollow knock + splinters
          snap(2000, 0.35, 0.008);
          resonate(ctx, chain(noise(ctx, t, 0.15, 'pink'), env(ctx, t, 0.001, 1.3 * w, 0.06)), [210 * R(0.12), 540 * R(0.12), 1150 * R(0.12)], 4, [1.5, 1.6, 1.0], out);
          thump(130, 0.4, 0.05);
          for (let i = 0; i < 5; i++) { const g = t + 0.01 + Math.random() * 0.12; chain(noise(ctx, g, 0.015), filter(ctx, 'bandpass', 2500 + Math.random() * 2500, 3), env(ctx, g, 0.0008, 0.07 * w, 0.01), out); }
          return 0.4;
        }
        case 3: { // glass: tink, crash, falling shards
          snap(4500, 0.5, 0.012); thump(300, 0.15, 0.03);
          chain(noise(ctx, t, 0.3, 'pink'), filter(ctx, 'highpass', 2500), env(ctx, t + 0.005, 0.005, 0.25 * w, 0.2), out);
          for (let i = 0; i < 20; i++) { const g = t + 0.02 + Math.pow(Math.random(), 0.7) * 0.7, f = 2500 + Math.random() * 6000; ring(ctx, g, [[f, 1, 0.03 + Math.random() * 0.08], [f * 1.7, 0.4, 0.03]], 0.07 * w, out); }
          return 0.9;
        }
        case 4: { // body: wet low thud + cloth
          thump(95, 0.5, 0.08);
          chain(noise(ctx, t, 0.15, 'pink'), sweep(ctx, 'bandpass', 900, 300, t, 0.1, 1.4), env(ctx, t, 0.002, 2.2 * w, 0.09), out);
          chain(noise(ctx, t, 0.04), filter(ctx, 'bandpass', 3000, 1), env(ctx, t, 0.001, 0.12 * w, 0.025), out);
          return 0.35;
        }
        default: { // dirt: thud and a spray of grit
          thump(110, 0.7, 0.07);
          chain(noise(ctx, t, 0.2, 'pink'), filter(ctx, 'bandpass', 800 * R(0.2), 0.9), env(ctx, t, 0.002, 1.3 * w, 0.08), out);
          for (let i = 0; i < 16; i++) { const g = t + 0.02 + Math.random() * 0.35; chain(noise(ctx, g, 0.015), filter(ctx, 'bandpass', 1500 + Math.random() * 3000, 2), env(ctx, g, 0.0008, (0.06 + Math.random() * 0.1) * w, 0.012), out); }
          return 0.5;
        }
      }
    },
  },
  ui: {
    label: 'UI & feedback', group: 'Interface', gain: 1.6,
    presets: { click: { kind: 0, pitch: 1, volume: 0.6 }, hover: { kind: 1, pitch: 1, volume: 0.4 }, confirm: { kind: 2, pitch: 1, volume: 0.6 }, error: { kind: 3, pitch: 1, volume: 0.6 }, hitmarker: { kind: 4, pitch: 1, volume: 0.7 }, kill: { kind: 5, pitch: 1, volume: 0.7 } },
    params: { kind: [0, 5, 1, '0 click · 1 hover · 2 confirm · 3 error · 4 hit · 5 kill'], pitch: [0.5, 2, 0.01, '×'], volume: [0, 1, 0.01] },
    play(ctx, out, t, p) {
      const v = p.volume;
      // soft synth voice: two detuned oscillators, gentle low-pass, with a felt "tick" under it
      const b = (f, d, type = 'triangle', at = t, a = v * 0.22) => {
        const g = env(ctx, at, 0.003, a, d); const lp = filter(ctx, 'lowpass', 4000);
        chain(tone(ctx, at, type, f * p.pitch, f * p.pitch, d), lp); chain(tone(ctx, at, 'sine', f * p.pitch * 1.004, f * p.pitch * 1.004, d), lp); chain(lp, g, out);
      };
      const tick = (at, a, f = 2400) => chain(noise(ctx, at, 0.02), filter(ctx, 'bandpass', f * p.pitch, 3), env(ctx, at, 0.0006, a, 0.012), out);
      switch (p.kind) {
        case 0: tick(t, v * 0.6); b(900, 0.04, 'sine', t, v * 0.12); break;
        case 1: b(1100, 0.03, 'sine', t, v * 0.1); break;
        case 2: b(523, 0.1); b(784, 0.16, 'triangle', t + 0.07); tick(t, v * 0.25); break;
        case 3: b(196, 0.14, 'square', t, v * 0.12); b(165, 0.18, 'square', t + 0.1, v * 0.12); break;
        case 4: tick(t, v * 0.9, 4800); chain(tone(ctx, t, 'sine', 180, 90, 0.05), env(ctx, t, 0.001, v * 0.35, 0.04), out); b(2600, 0.035, 'sine', t, v * 0.12); break;
        case 5: tick(t, v * 0.9, 4200); chain(tone(ctx, t, 'sine', 160, 70, 0.08), env(ctx, t, 0.001, v * 0.45, 0.07), out); b(1320, 0.07, 'sine', t + 0.02, v * 0.16); b(1980, 0.12, 'sine', t + 0.08, v * 0.16); break;
      }
      return 0.35;
    },
  },
};

// Play a sound with level balance, per-play variation and an optional sample layer.
// layer: { buffer: AudioBuffer, gain, synth (0..1 synth level), pitch, pitchVar, offset }
export function playSound(ctx, out, t0, id, params, layer = null) {
  const s = SOUNDS[id], g = ctx.createGain(); g.gain.value = s.gain ?? 1; g.connect(out);
  const R = makeVary(params.variation ?? 0.5);
  let dur = 0;
  const synthLevel = layer && layer.buffer ? (layer.synth ?? 1) : 1;
  if (synthLevel > 0.001) { const sg = ctx.createGain(); sg.gain.value = synthLevel; sg.connect(g); dur = s.play(ctx, sg, t0, params, R); }
  if (layer && layer.buffer) {
    const src = ctx.createBufferSource(); src.buffer = layer.buffer;
    const rate = (layer.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * (layer.pitchVar ?? 0.05));
    src.playbackRate.value = rate;
    const lg = ctx.createGain(); lg.gain.value = (layer.gain ?? 1) / (s.gain ?? 1);
    chain(src, lg, g); src.start(t0 + (layer.offset ?? 0));
    dur = Math.max(dur, (layer.offset ?? 0) + layer.buffer.duration / rate);
  }
  return dur;
}

// Render offline and report where the energy sits. Used by the lab's balance readout and self-test.
export async function analyzeSound(id, params, layer = null) {
  const sr = 44100, n = 65536, oc = new OfflineAudioContext(1, n, sr);
  const dur = playSound(oc, oc.destination, 0, id, params, layer);
  const d = (await oc.startRendering()).getChannelData(0);
  const re = Float32Array.from(d), im = new Float32Array(n);
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { const tmp = re[i]; re[i] = re[j]; re[j] = tmp; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, h = len / 2;
    for (let i = 0; i < n; i += len) for (let k = 0; k < h; k++) {
      const wr = Math.cos(a * k), wi = Math.sin(a * k), xr = re[i + k + h], xi = im[i + k + h], tr = xr * wr - xi * wi, ti = xr * wi + xi * wr;
      re[i + k + h] = re[i + k] - tr; im[i + k + h] = im[i + k] - ti; re[i + k] += tr; im[i + k] += ti;
    }
  }
  const B = [[20, 100], [100, 400], [400, 2000], [2000, 8000], [8000, 20000]], e = [0, 0, 0, 0, 0]; let tot = 0;
  for (let i = 1; i < n / 2; i++) { const f = i * sr / n, m = re[i] * re[i] + im[i] * im[i]; tot += m; for (let k = 0; k < 5; k++) if (f >= B[k][0] && f < B[k][1]) e[k] += m; }
  let pk = 0, sum = 0; for (const v of d) { pk = Math.max(pk, Math.abs(v)); sum += v * v; }
  const pct = e.map(x => tot ? x / tot * 100 : 0);
  return { peak: pk, rms: Math.sqrt(sum / n), dur, bands: { sub: pct[0], low: pct[1], mid: pct[2], high: pct[3], air: pct[4] } };
}

// ---------------------------------------------------------------- ambience (continuous)
export function startAmbience(ctx, out, p) {
  const nodes = [], master = ctx.createGain(); master.gain.value = 1; master.connect(out);
  const lfo = (rate, depth, target, base) => { const o = ctx.createOscillator(); o.frequency.value = rate; const g = ctx.createGain(); g.gain.value = depth; o.connect(g); g.connect(target); target.value = base; o.start(); nodes.push(o); };
  const rumble = noise(ctx, ctx.currentTime, 3600, 'brown'); const rg = ctx.createGain(); rg.gain.value = p.rumble * 0.5;
  chain(rumble, filter(ctx, 'lowpass', 180), rg, master); nodes.push(rumble);
  const traffic = noise(ctx, ctx.currentTime, 3600, 'pink'); const tf = filter(ctx, 'bandpass', 450, 0.6); const tg = ctx.createGain();
  chain(traffic, tf, tg, master); lfo(0.07, p.traffic * 0.18, tg.gain, p.traffic * 0.25); nodes.push(traffic);
  const wind = noise(ctx, ctx.currentTime, 3600, 'pink'); const wf = filter(ctx, 'bandpass', 600, 1.2); const wg = ctx.createGain(); wg.gain.value = p.wind * 0.25;
  chain(wind, wf, wg, master); lfo(0.11, 350, wf.frequency, 600); nodes.push(wind);
  return { master, stop() { for (const n of nodes) { try { n.stop(); } catch (e) {} } master.disconnect(); }, set(np) { rg.gain.value = np.rumble * 0.5; wg.gain.value = np.wind * 0.25; } };
}

// ---------------------------------------------------------------- spaces: generated impulse responses
// Early reflections (discrete, per-ear timing) + a diffuse tail that loses highs as it decays.
export const SPACES = {
  'open street': { decay: 0.9, wet: 0.2, slap: 0.11, slapGain: 0.22, tone: 6500, er: 4, erSpread: 0.09, predelay: 0.012 },
  alley: { decay: 1.4, wet: 0.32, slap: 0.05, slapGain: 0.3, tone: 5000, er: 8, erSpread: 0.04, predelay: 0.006 },
  room: { decay: 0.55, wet: 0.35, slap: 0, slapGain: 0, tone: 4500, er: 10, erSpread: 0.025, predelay: 0.003 },
  warehouse: { decay: 2.2, wet: 0.4, slap: 0.07, slapGain: 0.18, tone: 3800, er: 8, erSpread: 0.07, predelay: 0.015 },
  garage: { decay: 2.6, wet: 0.48, slap: 0.03, slapGain: 0.2, tone: 3200, er: 12, erSpread: 0.03, predelay: 0.004 },
  forest: { decay: 1.1, wet: 0.16, slap: 0, slapGain: 0, tone: 3000, er: 3, erSpread: 0.12, predelay: 0.02 },
  dry: { decay: 0.1, wet: 0, slap: 0, slapGain: 0, tone: 20000, er: 0, erSpread: 0.01, predelay: 0 },
};
export function impulse(ctx, decay, space = {}) {
  const sr = ctx.sampleRate, len = Math.max(1, Math.floor(sr * decay)), b = ctx.createBuffer(2, len, sr);
  const tone = space.tone ?? 5000, pre = Math.floor((space.predelay ?? 0.008) * sr), er = space.er ?? 6, spread = space.erSpread ?? 0.05;
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let y = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / (len - pre);
      const fc = tone * (1 - 0.85 * t) + 200; // damping: highs die first
      const a = 1 - Math.exp(-2 * Math.PI * fc / sr);
      y += a * ((Math.random() * 2 - 1) - y);
      d[i] = y * Math.exp(-6.9 * t) * (1 - Math.exp(-(i - pre) / (sr * 0.004)));
    }
    for (let k = 0; k < er; k++) {
      const at = pre + Math.floor((0.004 + Math.random() * spread) * sr);
      if (at < len) d[at] += (k % 2 ? -1 : 1) * (0.9 - k * 0.6 / Math.max(1, er)) * 2.2;
    }
  }
  return b;
}
