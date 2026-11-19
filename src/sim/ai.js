// Enemy AI simulation: plain data, fixed tick, no rendering or DOM.
// The world is 2.5D: obstacles are axis-aligned boxes with heights; agents move on a nav grid.
// For co-op later: the host runs stepWorld(); clients only draw the state it sends.

export const AI_TICK = 1 / 30;

export const DEFAULT_AI = {
  viewDist: 26, fov: 110, reaction: 1.0, hearing: 1.0, walkSpeed: 1.8, runSpeed: 4.2,
  accuracy: 0.45, damage: 9, fireInterval: 0.18, burst: 4, preferredRange: 12, coverSearch: 14,
  callout: 20, searchTime: 10, aggression: 0.5,
};

// ---------- seeded RNG (deterministic for replays/networking) ----------
export function rng(seed) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------- world ----------
// obstacles: { x, z, w, d, h }  (center x/z, size w (x) d (z), height h)
export function makeWorld({ width = 60, depth = 40, cell = 0.5, obstacles = [], spawns = [], patrol = [], playerSpawn = [0, 0], seed = 1 } = {}) {
  const W = { width, depth, cell, obstacles, cols: Math.ceil(width / cell), rows: Math.ceil(depth / cell), x0: -width / 2, z0: -depth / 2, rand: rng(seed), t: 0, noises: [], shots: [], events: [] };
  W.blocked = new Uint8Array(W.cols * W.rows);
  const R = 0.4;
  for (let r = 0; r < W.rows; r++) for (let c = 0; c < W.cols; c++) {
    const x = W.x0 + (c + 0.5) * cell, z = W.z0 + (r + 0.5) * cell;
    for (const o of obstacles) if (Math.abs(x - o.x) < o.w / 2 + R && Math.abs(z - o.z) < o.d / 2 + R) { W.blocked[r * W.cols + c] = 1; break; }
  }
  // cover candidates: free cells next to an obstacle tall enough to hide a crouching body
  W.coverCells = [];
  for (let r = 1; r < W.rows - 1; r++) for (let c = 1; c < W.cols - 1; c++) {
    if (W.blocked[r * W.cols + c]) continue;
    let near = false;
    for (let dr = -2; dr <= 2 && !near; dr++) for (let dc = -2; dc <= 2; dc++) if (W.blocked[(r + dr) * W.cols + (c + dc)]) { near = true; break; }
    if (near && (r + c) % 2 === 0) W.coverCells.push([c, r]);
  }
  W.player = { x: playerSpawn[0], z: playerSpawn[1], vx: 0, vz: 0, crouch: false, hp: 100, alive: true, moving: false, running: false };
  W.agents = spawns.map((s, i) => makeAgent(i, s, patrol, W));
  return W;
}
function makeAgent(id, [x, z], patrol, W) {
  // each agent patrols the 3 patrol points nearest its spawn (or a box around it)
  let route = patrol.slice().sort((a, b) => Math.hypot(a[0] - x, a[1] - z) - Math.hypot(b[0] - x, b[1] - z)).slice(0, 3);
  if (route.length < 2) route = [[x, z], [x + 6, z], [x + 6, z + 6], [x, z + 6]].map(p => clampToWorld(W, p));
  return {
    id, x, z, yaw: W.rand() * Math.PI * 2, hp: 100, alive: true, state: 'patrol', stateT: 0,
    awareness: 0, lastKnown: null, lastSeenT: -99, seeing: false, crouch: false,
    path: [], pathGoal: null, route, routeIdx: 0, cover: null, peek: false, peekT: 0,
    fireT: 0, burstLeft: 0, searchPts: [], thinkT: 0, label: '',
  };
}
const clampToWorld = (W, [x, z]) => [Math.max(W.x0 + 1, Math.min(-W.x0 - 1, x)), Math.max(W.z0 + 1, Math.min(-W.z0 - 1, z))];

// ---------- grid helpers ----------
const cellOf = (W, x, z) => [Math.floor((x - W.x0) / W.cell), Math.floor((z - W.z0) / W.cell)];
const centerOf = (W, c, r) => [W.x0 + (c + 0.5) * W.cell, W.z0 + (r + 0.5) * W.cell];
const free = (W, c, r) => c >= 0 && r >= 0 && c < W.cols && r < W.rows && !W.blocked[r * W.cols + c];
function nearestFree(W, c, r) {
  if (free(W, c, r)) return [c, r];
  for (let rad = 1; rad < 12; rad++) for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) if (free(W, c + dc, r + dr)) return [c + dc, r + dr];
  return null;
}
// walkable straight line on the grid (for path smoothing)
function walkLine(W, ax, az, bx, bz) {
  const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / (W.cell * 0.5));
  for (let i = 1; i < n; i++) { const t = i / n; const [c, r] = cellOf(W, ax + (bx - ax) * t, az + (bz - az) * t); if (!free(W, c, r)) return false; }
  return true;
}
// A* with 8 neighbours, no corner cutting; returns smoothed world-space waypoints
export function findPath(W, ax, az, bx, bz) {
  const s = nearestFree(W, ...cellOf(W, ax, az)), g = nearestFree(W, ...cellOf(W, bx, bz));
  if (!s || !g) return [];
  const N = W.cols * W.rows, sI = s[1] * W.cols + s[0], gI = g[1] * W.cols + g[0];
  const gScore = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const open = [[0, sI]]; gScore[sI] = 0;
  const h = i => { const c = i % W.cols, r = (i / W.cols) | 0, dx = Math.abs(c - g[0]), dz = Math.abs(r - g[1]); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
  let iter = 0;
  while (open.length && iter++ < 20000) {
    // binary-heap-lite: pop min
    let mi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[mi][0]) mi = i;
    const [, cur] = open[mi]; open[mi] = open[open.length - 1]; open.pop();
    if (cur === gI) break;
    if (closed[cur]) continue; closed[cur] = 1;
    const c = cur % W.cols, r = (cur / W.cols) | 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nc = c + dc, nr = r + dr;
      if (!free(W, nc, nr)) continue;
      if (dc && dr && (!free(W, c + dc, r) || !free(W, c, r + dr))) continue;
      const ni = nr * W.cols + nc, ng = gScore[cur] + (dc && dr ? 1.414 : 1);
      if (ng < gScore[ni]) { gScore[ni] = ng; came[ni] = cur; open.push([ng + h(ni), ni]); }
    }
  }
  if (came[gI] === -1 && gI !== sI) return [];
  const cells = []; for (let i = gI; i !== -1; i = came[i]) cells.push(centerOf(W, i % W.cols, (i / W.cols) | 0));
  cells.reverse();
  // string-pull smoothing
  const out = []; let anchor = [ax, az], k = 0;
  while (k < cells.length) {
    let far = k;
    for (let j = cells.length - 1; j > k; j--) if (walkLine(W, anchor[0], anchor[1], cells[j][0], cells[j][1])) { far = j; break; }
    out.push(cells[far]); anchor = cells[far]; k = far + 1;
  }
  return out;
}

// ---------- line of sight with heights ----------
// eye heights: standing 1.6, crouched 1.0. Low obstacles only block lines that pass below their top.
export function lineOfSight(W, ax, az, ah, bx, bz, bh) {
  const dx = bx - ax, dz = bz - az;
  for (const o of W.obstacles) {
    let t0 = 0, t1 = 1;
    for (const [p, d, lo, hi] of [[ax, dx, o.x - o.w / 2, o.x + o.w / 2], [az, dz, o.z - o.d / 2, o.z + o.d / 2]]) {
      if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) { t0 = 2; break; } continue; }
      let ta = (lo - p) / d, tb = (hi - p) / d; if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) break;
    }
    if (t0 <= t1 && t0 <= 1) {
      const y0 = ah + (bh - ah) * t0, y1 = ah + (bh - ah) * t1;
      if (Math.min(y0, y1) < o.h) return false;
    }
  }
  return true;
}
const eyeH = crouch => (crouch ? 1.0 : 1.6);
const bodyH = crouch => (crouch ? 0.8 : 1.2);

// ---------- player input (data) ----------
// cmd: { moveX, moveZ, run, crouch, fire: { x, z } | null }
export function stepPlayer(W, cmd, dt) {
  const p = W.player; if (!p.alive) return;
  p.crouch = !!cmd.crouch;
  const sp = p.crouch ? 1.8 : cmd.run ? 6 : 3.5;
  let mx = cmd.moveX, mz = cmd.moveZ; const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
  const nx = p.x + mx * sp * dt, nz = p.z + mz * sp * dt;
  const [c1] = cellOf(W, nx, p.z), [, r1] = cellOf(W, p.x, nz);
  const [c0, r0] = cellOf(W, p.x, p.z);
  if (free(W, c1, r0)) p.x = nx;
  if (free(W, c0, r1)) p.z = nz;
  p.moving = l > 0.1; p.running = p.moving && cmd.run && !p.crouch;
  if (p.running && W.rand() < dt * 3) W.noises.push({ x: p.x, z: p.z, r: 9, t: W.t, kind: 'footsteps' });
  if (cmd.fire) {
    W.noises.push({ x: p.x, z: p.z, r: 35, t: W.t, kind: 'gunshot' });
    W.shots.push({ from: [p.x, p.z], to: [cmd.fire.x, cmd.fire.z], t: W.t, by: 'player' });
    // hit the first agent near the aim point with line of sight
    let best = null, bd = 1.2;
    for (const a of W.agents) if (a.alive) { const d = Math.hypot(a.x - cmd.fire.x, a.z - cmd.fire.z); if (d < bd && lineOfSight(W, p.x, p.z, eyeH(p.crouch), a.x, a.z, bodyH(a.crouch))) { bd = d; best = a; } }
    if (best) {
      best.hp -= 34; W.events.push({ type: 'hit', id: best.id, t: W.t });
      best.awareness = 1; best.lastKnown = [p.x, p.z]; best.lastSeenT = W.t;
      if (best.hp <= 0) { best.alive = false; best.state = 'dead'; W.events.push({ type: 'kill', id: best.id, t: W.t }); }
      else if (best.state !== 'cover') setState(best, 'cover');
    }
  }
}

// ---------- agents ----------
function setState(a, s) { if (a.state !== s) { a.state = s; a.stateT = 0; a.path = []; a.pathGoal = null; a.cover = s === 'cover' ? a.cover : null; } }
function goTo(W, a, x, z) {
  if (a.pathGoal && Math.hypot(a.pathGoal[0] - x, a.pathGoal[1] - z) < 0.6 && a.path.length) return;
  a.path = findPath(W, a.x, a.z, x, z); a.pathGoal = [x, z];
}
function moveAlong(W, a, speed, dt) {
  if (!a.path.length) return true;
  const [tx, tz] = a.path[0], dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz);
  const step = speed * dt;
  if (d <= step) { a.x = tx; a.z = tz; a.path.shift(); }
  else { a.x += (dx / d) * step; a.z += (dz / d) * step; turnTo(a, Math.atan2(dx, dz), dt * 6); }
  // separation from other agents
  for (const b of W.agents) if (b !== a && b.alive) { const ex = a.x - b.x, ez = a.z - b.z, e = Math.hypot(ex, ez); if (e > 0 && e < 0.8) { a.x += (ex / e) * (0.8 - e) * 0.5; a.z += (ez / e) * (0.8 - e) * 0.5; } }
  return !a.path.length;
}
function turnTo(a, target, rate) {
  let d = target - a.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  a.yaw += Math.max(-rate, Math.min(rate, d));
}
function perceive(W, a, P, dt) {
  const p = W.player;
  a.seeing = false;
  if (!p.alive) { a.awareness = Math.max(0, a.awareness - dt * 0.3); return; }
  const dx = p.x - a.x, dz = p.z - a.z, d = Math.hypot(dx, dz);
  let ang = Math.atan2(dx, dz) - a.yaw; while (ang > Math.PI) ang -= 2 * Math.PI; while (ang < -Math.PI) ang += 2 * Math.PI;
  const inCone = Math.abs(ang) < (P.fov * Math.PI / 360), close = d < 3.5;
  if (d < P.viewDist && (inCone || close) && lineOfSight(W, a.x, a.z, eyeH(a.crouch && !a.peek), p.x, p.z, bodyH(p.crouch))) {
    a.seeing = true;
    let rate = P.reaction * (1.6 - d / P.viewDist) * (inCone ? 1 : 0.35) * (p.crouch ? 0.55 : 1) * (p.moving ? 1.3 : 0.8);
    a.awareness = Math.min(1, a.awareness + rate * dt * 1.5);
    if (a.awareness >= 1 || a.state === 'attack' || a.state === 'cover' || a.state === 'chase') { a.lastKnown = [p.x, p.z]; a.lastSeenT = W.t; }
  } else {
    const inCombat = a.state === 'attack' || a.state === 'cover' || a.state === 'chase';
    a.awareness = Math.max(inCombat ? 0.6 : 0, a.awareness - dt * (inCombat ? 0.05 : 0.15));
  }
  // hearing
  for (const n of W.noises) {
    if (W.t - n.t > AI_TICK * 1.5) continue;
    const hd = Math.hypot(n.x - a.x, n.z - a.z);
    if (hd < n.r * P.hearing) {
      a.awareness = Math.max(a.awareness, n.kind === 'gunshot' ? 0.75 : 0.45);
      if (a.state === 'patrol' || a.state === 'investigate' || a.state === 'search') { a.lastKnown = [n.x, n.z]; setState(a, 'investigate'); }
    }
  }
}
function chooseCover(W, a, P) {
  const p = W.player, tgt = a.lastKnown || [p.x, p.z];
  let best = null, bestScore = Infinity;
  for (const [c, r] of W.coverCells) {
    const [x, z] = centerOf(W, c, r), dA = Math.hypot(x - a.x, z - a.z);
    if (dA > P.coverSearch) continue;
    const dT = Math.hypot(x - tgt[0], z - tgt[1]);
    if (dT < 4) continue;
    if (W.agents.some(o => o !== a && o.alive && o.cover && Math.hypot(o.cover[0] - x, o.cover[1] - z) < 1.5)) continue;
    const hidden = !lineOfSight(W, tgt[0], tgt[1], 1.6, x, z, 1.0);
    if (!hidden) continue;
    const canPeek = lineOfSight(W, x, z, 1.6, tgt[0], tgt[1], 1.2);
    const score = dA * 1.0 + Math.abs(dT - P.preferredRange) * 0.6 + (canPeek ? 0 : 6);
    if (score < bestScore) { bestScore = score; best = [x, z]; }
  }
  return best;
}
function tryShoot(W, a, P, dt) {
  const p = W.player; if (!p.alive) return;
  a.fireT -= dt;
  if (!a.seeing || a.fireT > 0) return;
  const d = Math.hypot(p.x - a.x, p.z - a.z);
  if (d > P.viewDist) return;
  turnTo(a, Math.atan2(p.x - a.x, p.z - a.z), 1);
  if (a.burstLeft <= 0) { a.burstLeft = P.burst; a.fireT = 0.6 + W.rand() * 0.6; return; }
  a.burstLeft--; a.fireT = P.fireInterval;
  const chance = P.accuracy * (1 - (d / P.viewDist) * 0.6) * (p.moving ? 0.7 : 1) * (p.crouch ? 0.75 : 1);
  const hit = W.rand() < chance;
  const miss = hit ? 0 : 0.6 + W.rand() * 1.4;
  W.shots.push({ from: [a.x, a.z], to: [p.x + (W.rand() - 0.5) * miss, p.z + (W.rand() - 0.5) * miss], t: W.t, by: a.id, hit });
  W.noises.push({ x: a.x, z: a.z, r: 30, t: W.t, kind: 'gunshot' });
  if (hit) { p.hp -= P.damage; if (p.hp <= 0) { p.hp = 0; p.alive = false; W.events.push({ type: 'playerDown', t: W.t }); } }
}
function callout(W, a, P) {
  for (const b of W.agents) if (b !== a && b.alive && Math.hypot(b.x - a.x, b.z - a.z) < P.callout && (b.state === 'patrol' || b.state === 'investigate' || b.state === 'search')) {
    b.lastKnown = a.lastKnown.slice(); b.awareness = Math.max(b.awareness, 0.9); setState(b, 'chase');
  }
}

function think(W, a, P, dt) {
  a.stateT += dt;
  const p = W.player;
  const spotted = a.awareness >= 1 && a.seeing;
  if (spotted && (a.state === 'patrol' || a.state === 'investigate' || a.state === 'search')) {
    W.events.push({ type: 'spotted', id: a.id, t: W.t }); callout(W, a, P);
    setState(a, W.rand() < P.aggression ? 'chase' : 'cover');
  }
  switch (a.state) {
    case 'patrol': {
      a.crouch = false;
      const [tx, tz] = a.route[a.routeIdx % a.route.length];
      goTo(W, a, tx, tz);
      if (moveAlong(W, a, P.walkSpeed, dt)) { a.routeIdx++; a.path = []; a.pathGoal = null; }
      if (a.awareness > 0.35 && a.seeing) { turnTo(a, Math.atan2(p.x - a.x, p.z - a.z), dt * 3); a.path = []; }
      a.label = 'patrol';
      break;
    }
    case 'investigate': {
      a.crouch = false;
      if (a.lastKnown) { goTo(W, a, ...a.lastKnown); if (moveAlong(W, a, P.walkSpeed * 1.3, dt)) { a.lastKnown = null; a.stateT = 0; } }
      else { a.yaw += dt * 1.2; if (a.stateT > 4) setState(a, 'patrol'); }
      a.label = 'investigate';
      break;
    }
    case 'chase': {
      a.crouch = false;
      const tgt = a.lastKnown || [p.x, p.z], d = Math.hypot(tgt[0] - a.x, tgt[1] - a.z);
      if (a.seeing && d < P.preferredRange * 1.2) { setState(a, 'cover'); break; }
      goTo(W, a, ...tgt); moveAlong(W, a, P.runSpeed, dt);
      tryShoot(W, a, P, dt);
      if (!a.seeing && W.t - a.lastSeenT > 4 && Math.hypot(tgt[0] - a.x, tgt[1] - a.z) < 1.5) setState(a, 'search');
      a.label = 'chase';
      break;
    }
    case 'cover': {
      if (!a.cover || a.stateT > 9 || (a.seeing && !a.peek && a.stateT > 1)) {
        // pick (or re-pick) cover when flanked or after holding too long
        const c = chooseCover(W, a, P);
        if (c) { a.cover = c; a.stateT = 0; a.path = []; a.pathGoal = null; }
        else if (!a.cover) { setState(a, 'attack'); break; }
      }
      const arrived = Math.hypot(a.cover[0] - a.x, a.cover[1] - a.z) < 0.4 || (goTo(W, a, ...a.cover), moveAlong(W, a, P.runSpeed, dt));
      if (arrived) {
        a.peekT -= dt;
        if (a.peekT <= 0) { a.peek = !a.peek; a.peekT = a.peek ? 1.6 + W.rand() : 1 + W.rand() * 1.2; }
        a.crouch = !a.peek;
        if (a.peek) tryShoot(W, a, P, dt);
        if (a.lastKnown) turnTo(a, Math.atan2(a.lastKnown[0] - a.x, a.lastKnown[1] - a.z), dt * 4);
      } else { a.crouch = false; tryShoot(W, a, P, dt); }
      if (W.t - a.lastSeenT > 6) setState(a, 'search');
      a.label = arrived ? (a.peek ? 'cover: peek' : 'cover: hide') : 'to cover';
      break;
    }
    case 'attack': { // no cover available: stand and fight, strafe
      a.crouch = false; tryShoot(W, a, P, dt);
      if (!a.path.length) { const ang = W.rand() * Math.PI * 2; const [x, z] = clampToWorld(W, [a.x + Math.cos(ang) * 3, a.z + Math.sin(ang) * 3]); goTo(W, a, x, z); }
      moveAlong(W, a, P.walkSpeed, dt);
      if (a.stateT > 3) setState(a, 'cover');
      if (W.t - a.lastSeenT > 5) setState(a, 'search');
      a.label = 'attack';
      break;
    }
    case 'search': {
      a.crouch = false;
      if (!a.searchPts.length && a.stateT < 0.1) {
        const c = a.lastKnown || [a.x, a.z];
        a.searchPts = [c, ...[0, 1, 2].map(() => clampToWorld(W, [c[0] + (W.rand() - 0.5) * 12, c[1] + (W.rand() - 0.5) * 12]))];
      }
      if (a.searchPts.length) { goTo(W, a, ...a.searchPts[0]); if (moveAlong(W, a, P.walkSpeed * 1.4, dt)) { a.searchPts.shift(); a.path = []; a.pathGoal = null; } }
      else a.yaw += dt * 1.5;
      if (a.stateT > P.searchTime) { a.searchPts = []; a.awareness = 0; setState(a, 'patrol'); }
      a.label = 'search';
      break;
    }
  }
}

export function stepWorld(W, playerCmd, P, dt = AI_TICK) {
  W.t += dt;
  stepPlayer(W, playerCmd, dt);
  for (const a of W.agents) {
    if (!a.alive) continue;
    perceive(W, a, P, dt);
    think(W, a, P, dt);
  }
  W.noises = W.noises.filter(n => W.t - n.t < 1.0);
  W.shots = W.shots.filter(s => W.t - s.t < 0.15);
  if (W.events.length > 50) W.events.splice(0, W.events.length - 50);
}
