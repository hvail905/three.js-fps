// Gunplay rules: plain data, fixed tick, no rendering.
// stepGun() consumes an input command and returns shots as { dirYaw, dirPitch } offsets (radians)
// relative to where the player is aiming, plus recoil to apply to the view.

export const STAT_SPEC = [
  ['Firing', [['mode', ['semi', 'auto', 'burst']], ['rpm', 40, 1200, 5], ['burstCount', 2, 5, 1], ['pellets', 1, 16, 1]]],
  ['Ammo', [['magSize', 1, 100, 1], ['reloadTime', 0.5, 5, 0.05, 's'], ['reloadEmptyTime', 0.5, 6, 0.05, 's']]],
  ['Damage', [['damage', 1, 200, 1], ['headMult', 1, 4, 0.05, '×'], ['limbMult', 0.3, 1, 0.05, '×'], ['rangeStart', 1, 150, 1, 'm'], ['rangeEnd', 2, 300, 1, 'm'], ['minDamage', 0.1, 1, 0.05, '× at range end']]],
  ['Spread', [['spreadHip', 0, 10, 0.05, '°'], ['spreadAds', 0, 5, 0.01, '°'], ['movePenalty', 0, 2, 0.01, '° per m/s'], ['airPenalty', 0, 10, 0.1, '°'], ['bloomPerShot', 0, 2, 0.01, '°'], ['bloomMax', 0, 10, 0.1, '°'], ['bloomRecovery', 0.5, 30, 0.5, '°/s']]],
  ['Recoil', [['recoilUp', 0, 5, 0.05, '° per shot'], ['recoilSide', 0, 3, 0.05, '° random'], ['recoilDrift', -2, 2, 0.05, '° bias'], ['recoilRecovery', 0, 20, 0.25, 'per s'], ['adsRecoil', 0.2, 1.2, 0.05, '×']]],
  ['Handling', [['adsTime', 0.05, 0.8, 0.01, 's'], ['adsMoveMult', 0.3, 1, 0.05, '× speed']]],
  ['Ballistics', [['projectile', 'bool'], ['muzzleVelocity', 80, 1200, 10, 'm/s'], ['gravityMult', 0, 3, 0.05, '×']]],
];

const base = {
  mode: 'auto', rpm: 600, burstCount: 3, pellets: 1, magSize: 30, reloadTime: 2.2, reloadEmptyTime: 2.8,
  damage: 25, headMult: 2, limbMult: 0.8, rangeStart: 25, rangeEnd: 60, minDamage: 0.6,
  spreadHip: 3, spreadAds: 0.15, movePenalty: 0.4, airPenalty: 4, bloomPerShot: 0.25, bloomMax: 3, bloomRecovery: 8,
  recoilUp: 0.7, recoilSide: 0.35, recoilDrift: 0.1, recoilRecovery: 6, adsRecoil: 0.7,
  adsTime: 0.25, adsMoveMult: 0.6, projectile: false, muzzleVelocity: 800, gravityMult: 1,
};
export const PRESETS = {
  pistol: { ...base, mode: 'semi', rpm: 400, magSize: 12, reloadTime: 1.4, reloadEmptyTime: 1.7, damage: 30, rangeStart: 12, rangeEnd: 35, minDamage: 0.55, spreadHip: 2, spreadAds: 0.3, bloomPerShot: 0.5, recoilUp: 1.6, recoilSide: 0.4, recoilDrift: 0, adsTime: 0.15, adsMoveMult: 0.85, muzzleVelocity: 360 },
  revolver: { ...base, mode: 'semi', rpm: 150, magSize: 6, reloadTime: 2.8, reloadEmptyTime: 2.8, damage: 60, headMult: 2.2, rangeStart: 20, rangeEnd: 50, spreadHip: 2.2, spreadAds: 0.2, bloomPerShot: 1, recoilUp: 4, recoilSide: 0.8, recoilRecovery: 5, adsTime: 0.18, adsMoveMult: 0.8, muzzleVelocity: 450 },
  smg: { ...base, rpm: 850, magSize: 32, reloadTime: 1.9, reloadEmptyTime: 2.3, damage: 18, rangeStart: 12, rangeEnd: 35, minDamage: 0.55, spreadHip: 2.2, spreadAds: 0.35, bloomPerShot: 0.18, recoilUp: 0.45, recoilSide: 0.4, adsTime: 0.18, adsMoveMult: 0.75, muzzleVelocity: 400 },
  rifle: { ...base },
  shotgun: { ...base, mode: 'semi', rpm: 75, pellets: 9, magSize: 6, reloadTime: 3.2, reloadEmptyTime: 3.6, damage: 14, headMult: 1.5, rangeStart: 6, rangeEnd: 20, minDamage: 0.25, spreadHip: 5, spreadAds: 3.5, bloomPerShot: 0.5, recoilUp: 5, recoilSide: 1, recoilRecovery: 4, adsTime: 0.28, muzzleVelocity: 400 },
  sniper: { ...base, mode: 'semi', rpm: 45, magSize: 5, reloadTime: 3.0, reloadEmptyTime: 3.6, damage: 95, headMult: 2.5, limbMult: 0.85, rangeStart: 80, rangeEnd: 200, minDamage: 0.85, spreadHip: 6, spreadAds: 0, movePenalty: 1, bloomPerShot: 0, recoilUp: 6, recoilSide: 0.6, recoilRecovery: 3, adsTime: 0.4, adsMoveMult: 0.45, projectile: true, muzzleVelocity: 850 },
};

export function makeGunState(stats) {
  return { ammo: stats.magSize, reloadT: 0, cooldown: 0, burstLeft: 0, bloom: 0, ads: 0, prevTrigger: false, shotsFired: 0, rand: seeded(12345) };
}
function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const D2R = Math.PI / 180;

// Current cone half-angle (degrees) given movement state.
export function currentSpread(g, S, ctx) {
  const baseS = S.spreadHip + (S.spreadAds - S.spreadHip) * g.ads;
  return Math.max(0, baseS + ctx.speed * S.movePenalty * (1 - 0.6 * g.ads) + (ctx.onGround ? 0 : S.airPenalty) + g.bloom);
}

// cmd: { trigger, ads, reload }   ctx: { speed, onGround }
// returns { shots: [{ yaw, pitch }], recoil: { up, side } | null, event: 'reloadStart'|'reloadDone'|'dry'|null }
export function stepGun(g, S, cmd, ctx, dt) {
  const out = { shots: [], recoil: null, event: null };
  g.ads += ((cmd.ads ? 1 : 0) - g.ads) * Math.min(1, dt / Math.max(0.01, S.adsTime) * 3);
  if (Math.abs(g.ads - (cmd.ads ? 1 : 0)) < 0.01) g.ads = cmd.ads ? 1 : 0;
  g.cooldown -= dt;
  g.bloom = Math.max(0, g.bloom - S.bloomRecovery * dt);

  if (g.reloadT > 0) {
    g.reloadT -= dt;
    if (g.reloadT <= 0) { g.ammo = S.magSize; g.reloadT = 0; out.event = 'reloadDone'; }
    g.prevTrigger = cmd.trigger; return out;
  }
  if ((cmd.reload && g.ammo < S.magSize) || (g.ammo === 0 && cmd.trigger && !g.prevTrigger)) {
    g.reloadT = g.ammo === 0 ? S.reloadEmptyTime : S.reloadTime; g.burstLeft = 0; out.event = 'reloadStart';
    g.prevTrigger = cmd.trigger; return out;
  }
  const pressed = cmd.trigger && !g.prevTrigger;
  if (S.mode === 'burst' && pressed && g.burstLeft === 0) g.burstLeft = S.burstCount;
  const wantShot = S.mode === 'auto' ? cmd.trigger : S.mode === 'semi' ? pressed : g.burstLeft > 0;
  if (wantShot && g.cooldown <= 0 && g.ammo > 0) {
    const spreadDeg = currentSpread(g, S, ctx), spread = spreadDeg * D2R;
    out.spread = spreadDeg;
    for (let i = 0; i < S.pellets; i++) {
      // uniform over the cone's disc
      const r = Math.sqrt(g.rand()) * spread, a = g.rand() * Math.PI * 2;
      out.shots.push({ yaw: Math.cos(a) * r, pitch: Math.sin(a) * r });
    }
    g.ammo--; g.shotsFired++; g.cooldown += 60 / S.rpm; if (g.cooldown < 0) g.cooldown = 60 / S.rpm * 0.5;
    if (S.mode === 'burst') g.burstLeft--;
    g.bloom = Math.min(S.bloomMax, g.bloom + S.bloomPerShot);
    const m = 1 + (S.adsRecoil - 1) * g.ads;
    out.recoil = { up: S.recoilUp * m * D2R, side: ((g.rand() * 2 - 1) * S.recoilSide + S.recoilDrift) * m * D2R };
  } else if (wantShot && g.ammo === 0 && pressed) out.event = 'dry';
  if (g.cooldown < 0) g.cooldown = 0;
  g.prevTrigger = cmd.trigger;
  return out;
}

export function damageAt(S, dist, zone) {
  const t = Math.min(1, Math.max(0, (dist - S.rangeStart) / Math.max(1e-3, S.rangeEnd - S.rangeStart)));
  const mult = zone === 'head' ? S.headMult : zone === 'limb' ? S.limbMult : 1;
  return S.damage * (1 + (S.minDamage - 1) * t) * mult;
}
