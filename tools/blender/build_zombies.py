"""The Gallery's experiment subjects: three skinned zombie variants with clothing layers, built in Blender.

    python tools/blender/build_zombies.py OUT_DIR             (pip install bpy)
    blender -b --python tools/blender/build_zombies.py -- OUT_DIR

Writes OUT_DIR/zombie_<variant>.glb (mesh + armature, no animation: the game animates the bones procedurally),
OUT_DIR/textures/*.png, OUT_DIR/previews/*.png and OUT_DIR/zombies.blend.

Body: a skin-modifier armature sketch, subdivided, then shaped by position (sunken eyes, nose, open jaw, ribs,
collarbones, spine). Clothes are separate shells grown from the body (inflated, folded, torn) plus lofted pieces
(skirt, collar, belt, rope, cuffs, boots). Weights: Blender's automatic (heat) weights on the body; every clothing
vertex copies the weights of the nearest body vertex. Bone names match src/assets/zombie.js.
"""
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
import numpy as np
from mathutils import Vector, kdtree
import gallery_lib as G

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else (sys.argv[1] if len(sys.argv) > 1 else 'out_zombies')
ONLY = sys.argv[sys.argv.index('--only') + 1].split(',') if '--only' in sys.argv else None

# ---------------------------------------------------------------- skeleton (Blender coords: x left, -y front, z up)
BONES = {
    'root': ((0, 0, 0), (0, 0, .1), None),
    'hips': ((0, 0, .955), (0, 0, 1.085), 'root'), 'spine': ((0, 0, 1.085), (0, 0, 1.285), 'hips'),
    'chest': ((0, 0, 1.285), (0, 0, 1.535), 'spine'), 'neck': ((0, 0, 1.535), (0, -.015, 1.615), 'chest'),
    'head': ((0, -.015, 1.615), (0, -.015, 1.84), 'neck'),
}
for s, S in ((1, 'L'), (-1, 'R')):
    BONES['shoulder' + S] = ((s * .19, 0, 1.485), (s * .275, 0, 1.19), 'chest')
    BONES['elbow' + S] = ((s * .275, 0, 1.19), (s * .345, -.01, .915), 'shoulder' + S)
    BONES['wrist' + S] = ((s * .345, -.01, .915), (s * .39, -.02, .73), 'elbow' + S)
    BONES['thigh' + S] = ((s * .095, 0, .955), (s * .095, -.01, .515), 'hips')
    BONES['knee' + S] = ((s * .095, -.01, .515), (s * .095, 0, .085), 'thigh' + S)
    BONES['ankle' + S] = ((s * .095, 0, .085), (s * .095, -.14, .02), 'knee' + S)


def armature(name):
    data = bpy.data.armatures.new(name + '_data'); arm = G.link(bpy.data.objects.new(name, data))
    G.select_only(arm); bpy.ops.object.mode_set(mode='EDIT')
    for n, (h, t, p) in BONES.items():
        b = data.edit_bones.new(n); b.head = h; b.tail = t
    for n, (h, t, p) in BONES.items():
        if p: data.edit_bones[n].parent = data.edit_bones[p]
    bpy.ops.object.mode_set(mode='OBJECT')
    data.bones['root'].use_deform = False
    return arm


# ---------------------------------------------------------------- body
def body(variant, gaunt):
    w = .96 if gaunt else 1.1
    V, E, R = [], [], []
    def v(p, r):
        V.append(p); R.append(r); return len(V) - 1
    def chain(pts, rs, start=None):
        prev = start; ids = []
        for p, r in zip(pts, rs):
            i = v(p, r)
            if prev is not None: E.append((prev, i))
            prev = i; ids.append(i)
        return ids
    pel = v((0, 0, .93), (.14 * w, .1))
    spine = chain([(0, .005, 1.06), (0, 0, 1.2), (0, 0, 1.33), (0, .005, 1.45), (0, .0, 1.54), (0, -.01, 1.62)],
                  [(.125 * w, .088 * w), (.14 * w, .095), (.16 * w, .105), (.17 * w, .1), (.056, .058), (.05, .05)], pel)
    upper = spine[3]
    for s in (1, -1):
        arm = chain([(s * .12, 0, 1.47), (s * .185, 0, 1.465), (s * .23, 0, 1.33), (s * .275, 0, 1.19), (s * .31, -.005, 1.05), (s * .345, -.01, .915), (s * .36, -.016, .86)],
                    [(.054, .054), (.058, .06), (.05 * w, .052 * w), (.04, .042), (.04 * w, .04 * w), (.029, .025), (.024, .04)], upper)
        hand = arm[-1]
        for f in range(4): chain([(s * (.372 + .002 * f), -.035 + .022 * f, .815), (s * (.385 + .002 * f), -.038 + .023 * f, .765), (s * (.396 + .002 * f), -.042 + .024 * f, .72 + (.01 if f in (0, 3) else 0))], [(.0095, .0095), (.008, .008), (.006, .006)], hand)
        chain([(s * .345, -.05, .87), (s * .35, -.07, .825)], [(.01, .01), (.008, .008)], arm[-2])     # thumb
        leg = chain([(s * .095, 0, .9), (s * .097, -.005, .72), (s * .096, -.012, .515), (s * .095, -.005, .32), (s * .095, 0, .09), (s * .095, -.06, .035), (s * .095, -.14, .03)],
                    [(.092 * w, .095 * w), (.08 * w, .083 * w), (.06, .064), (.06 * w, .068 * w), (.04, .044), (.048, .054), (.044, .032)], pel)
        heel = v((s * .095, .03, .03), (.035, .03)); E.append((leg[4], heel))
    o = G.mesh_obj('body_' + variant, V, [], 'skin')
    me = o.data
    me.clear_geometry(); me.from_pydata([tuple(p) for p in V], E, []); me.update()
    G.set_key(o, 'skin')
    sk = o.modifiers.new('skin', 'SKIN'); sk.branch_smoothing = 0.6; sk.use_smooth_shade = True
    for i, r in enumerate(R):
        d = me.skin_vertices[0].data[i]; d.radius = r
    me.skin_vertices[0].data[0].use_root = True
    sub = o.modifiers.new('sub', 'SUBSURF'); sub.levels = 2; sub.render_levels = 2
    G.apply_modifiers(o)
    G.smooth(o)
    sculpt(o, variant, gaunt)
    dec = o.modifiers.new('dec', 'DECIMATE'); dec.ratio = 0.3; G.apply_modifiers(o)
    h = head(variant)
    return G.join([o, h], 'body_' + variant)


HC = Vector((0, -.018, 1.70))   # head centre


def head(variant):
    """A dense sphere shaped into a skull and a face by (azimuth, height) around the head axis, front = -Y."""
    h = G.prim('head_' + variant, 'sphere', 'skin', size=(.168, .2, .245), loc=HC, segs=32)
    def f(c):
        rel = c - HC; az = math.atan2(rel.x, -rel.y); z = c.z; r = Vector((rel.x, rel.y, 0)); rl = r.length or 1e-6; out = r / rl
        def bump(a0, z0, sa, sz, amt):
            d = ((az - a0) / sa) ** 2 + ((z - z0) / sz) ** 2
            return amt * math.exp(-d * 2.2)
        k = 0.0
        if rel.z < -.055: k -= .25 * (-.055 - rel.z) * (1 - min(1, abs(az) / 2.2))      # narrower jaw
        for s in (1, -1):
            k -= bump(s * .36, 1.708, .22, .02, .03)      # deep eye sockets
            k += bump(s * .36, 1.734, .32, .011, .016)      # brow ridge
            k += bump(s * .62, 1.69, .2, .02, .006)       # cheekbones
            k -= bump(s * .6, 1.655, .25, .025, .018)     # hollow cheeks
            k += bump(s * 1.57, 1.70, .18, .03, .02)      # ears
            k -= bump(s * 1.2, 1.74, .3, .05, .006)       # temples
        k += bump(0, 1.684, .1, .024, .042)               # nose
        k += bump(0, 1.668, .16, .008, .006)              # nostril wings
        k -= bump(0, 1.642, .3, .012, .035)              # gaping mouth
        k += bump(0, 1.612, .25, .015, .012)              # chin
        off = out * k
        if rel.z < -.05 and abs(az) < 1.0: off.z -= .018 * min(1, (-.05 - rel.z) / .04)   # jaw hangs open
        return off
    G.displace(h, f)
    return h


def falloff(d, r): return max(0.0, 1 - d / r) ** 2


def sculpt(o, variant, gaunt):
    """Shape the face and torso by position."""
    def f(c):
        off = Vector((0, 0, 0)); x, y, z = c
        if z > 9:  # head is built separately
            for s in (1, -1):
                e = Vector((s * .033, -.085, 1.708)); d = (c - e).length
                off.y += .016 * falloff(d, .03)                                   # sunken eye sockets
                ch = Vector((s * .05, -.07, 1.655)); off.y += .012 * falloff((c - ch).length, .03)  # hollow cheeks
                ea = Vector((s * .088, -.005, 1.705)); off.x += s * .014 * falloff((c - ea).length, .025)  # ears
            off.y -= .011 * falloff((c - Vector((0, -.095, 1.735))).length, .045)  # brow ridge
            nd = (c - Vector((0, -.1, 1.68))).length; off.y -= .024 * falloff(nd, .022); off.z -= .006 * falloff(nd, .022)  # nose
            if z < 1.655 and y < -.02:  # jaw hangs open
                k = min(1, (1.655 - z) / .05); off.z -= .022 * k; off.y -= .006 * k
            mo = (c - Vector((0, -.095, 1.642))).length; off.y += .014 * falloff(mo, .028)   # mouth cavity
        elif z > 1.15:  # chest and back
            if y < 0 and abs(x) > .03 and z < 1.42 and gaunt:
                off.y -= .006 * max(0, math.sin((z - 1.15) * 95)) * min(1, abs(x) / .06)   # ribs
            if y < 0 and 1.42 < z < 1.48: off.y -= .008 * falloff(abs(z - 1.455), .02) * min(1, abs(x) / .04)  # collarbones
            if y > 0 and abs(x) < .025: off.y += .006 * max(0, math.sin(z * 120))       # spine knuckles
            if y > 0 and 1.3 < z < 1.45 and .04 < abs(x) < .12: off.y += .012 * falloff(abs(abs(x) - .08), .05)  # shoulder blades
        elif z > .98 and y < 0 and gaunt:
            off.y += .02 * falloff(abs(z - 1.1), .09) * falloff(abs(x), .12)   # sunken belly
        return off
    G.displace(o, f)


# ---------------------------------------------------------------- clothing helpers
COVERED = set()


def shell(src, name, key, keep, inflate=.016, folds=.006, seed=1, rips=0.0, ripscale=8):
    """Grow a garment from the body: keep(co) chooses the faces, they are pushed out along the normal."""
    o = src.copy(); o.data = src.data.copy(); o.name = name; o.data.name = name; G.link(o)
    o.vertex_groups.clear(); o.modifiers.clear()
    bm = bmesh.new(); bm.from_mesh(o.data); bm.faces.ensure_lookup_table()
    tag = bm.faces.layers.int.new('src')
    for f in bm.faces: f[tag] = f.index
    dead = [f for f in bm.faces if not all(keep(v.co) for v in f.verts)]
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    if rips > 0:
        P = np.array([f.calc_center_median()[:] for f in bm.faces], np.float32)
        n = G.fbm(P, ripscale, seed, 2) if len(P) else []
        bmesh.ops.delete(bm, geom=[f for f, v in zip(bm.faces, n) if v > 1 - rips], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    COVERED.update(f[tag] for f in bm.faces)   # the body under this garment is never seen: it gets removed
    bm.normal_update()
    for v in bm.verts:
        p = np.array(v.co[:], np.float32)[None]
        fold = (G.vnoise(p * np.array([[3, 3, .6]], np.float32), 8, seed)[0] - .5) * 2   # long vertical folds
        v.co += v.normal * (inflate + folds * fold)
    bm.to_mesh(o.data); bm.free(); G.set_key(o, key); G.smooth(o)
    sol = o.modifiers.new('sol', 'SOLIDIFY'); sol.thickness = .006; sol.offset = 1
    G.apply_modifiers(o)
    return o


def tube(name, key, centre, radii, z0, z1, n=14, rings=4, jag=0.0, seed=1, flare=1.0, cy=0.0, cap=False):
    rs = []
    for i in range(rings):
        t = i / (rings - 1); z = z1 + (z0 - z1) * t; f = 1 + (flare - 1) * t
        r = G.ring((centre[0], centre[1] + cy * t, z), radii[0] * f, radii[1] * f, n)
        if i == rings - 1 and jag:
            for k, p in enumerate(r): p.z += jag * (0.5 * math.sin(k * 2.3 + seed) + 0.5 * math.sin(k * 5.1 + seed * 3))
        rs.append(r)
    o = G.loft(name, rs, key, cap0=cap, cap1=cap)
    sol = o.modifiers.new('sol', 'SOLIDIFY'); sol.thickness = .006; G.apply_modifiers(o)
    return o


def cuff(name, key, centre, r, h=.03, n=12):
    return G.prim(name, 'cyl', key, size=(r * 2, r * 2, h), loc=centre, segs=n)


def strap(name, key, p0, p1, w=.03, t=.006):
    d = Vector(p1) - Vector(p0); L = d.length
    o = G.prim(name, 'box', key, size=(w, t, L), loc=(Vector(p0) + Vector(p1)) / 2)
    o.rotation_euler = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_euler(); G.select_only(o); bpy.ops.object.transform_apply(rotation=True)
    return o


# ---------------------------------------------------------------- variants
def build_variant(variant, seed):
    gaunt = variant in ('hood', 'gown')
    b = body(variant, gaunt)
    if os.environ.get('GALLERY_DEBUG'):
        inward = 0
        for poly in b.data.polygons:
            c = poly.center; axis = Vector((0, 0, c.z)) if abs(c.x) < .17 else Vector((math.copysign(.21 if c.z > .8 else .095, c.x), 0, c.z))
            if poly.normal.dot(c - axis) < 0: inward += 1
        print('NORMALS', variant, inward, len(b.data.polygons))
    COVERED.clear()
    parts = []
    head_top = lambda c: c.z > 1.53
    hand = lambda c: abs(c.x) > .3 and c.z < .93
    if variant == 'gown':
        parts.append(shell(b, 'gown_top', 'gown', lambda c: .86 < c.z < 1.49 and (abs(c.x) < .19 or (c.z > 1.3 and abs(c.x) < .26 and abs(c.x) < .19 + (c.z - 1.3) * 1.2)) and c.z < 1.6, inflate=.02, folds=.008, seed=seed))
        parts.append(tube('gown_skirt', 'gown', (0, .0), (.2, .14), .6, .93, n=18, rings=5, jag=.05, seed=seed, flare=1.18, cy=-.01))
        parts.append(cuff('wristband', 'band', (.35, -.01, .9), .03, .02))
        for s in (1, -1):
            parts.append(cuff('cuff' + str(s), 'leather', (s * .34, -.01, .93), .034, .05))
            parts.append(strap('strap' + str(s), 'leather', (s * .36, -.035, .925), (s * .375, -.06, .76), .028))
        parts.append(G.prim('tie', 'box', 'gown', size=(.04, .01, .1), loc=(0, .125, 1.2)))
        # head wrapped in old dressings, one eye and the mouth left open
        before = set(COVERED); wrap = shell(b, 'wrap', 'bandage', lambda c: c.z > 1.6, inflate=.008, folds=.004, seed=seed); COVERED.clear(); COVERED.update(before)
        bm = bmesh.new(); bm.from_mesh(wrap.data)
        cut = [f for f in bm.faces if (f.calc_center_median() - Vector((.034, -.112, 1.708))).length < .02 or (abs(f.calc_center_median().x) < .025 and abs(f.calc_center_median().z - 1.643) < .012 and f.calc_center_median().y < -.05)]
        bmesh.ops.delete(bm, geom=cut, context='FACES'); bm.to_mesh(wrap.data); bm.free(); parts.append(wrap)
    elif variant == 'coverall':
        parts.append(shell(b, 'coverall', 'coverall', lambda c: not head_top(c) and not hand(c) and c.z > .2, inflate=.022, folds=.009, seed=seed, rips=.13, ripscale=7))
        parts.append(tube('collar', 'coverall', (0, .002), (.075, .072), 1.47, 1.545, n=14, rings=3, flare=1.35))
        parts.append(tube('belt', 'leather', (0, .004), (.16, .118), .985, 1.02, n=18, rings=2, flare=1.0))
        parts.append(G.prim('buckle', 'box', 'metal', size=(.05, .012, .04), loc=(0, -.124, 1.0)))
        parts.append(G.prim('pocket', 'box', 'coverall', size=(.11, .02, .1), loc=(.08, -.125, 1.32), bevel=.005))
        # respirator and goggles strapped over the face
        before = set(COVERED); mask = shell(b, 'mask', 'rubber', lambda c: 1.6 < c.z < 1.69 and c.y < -.04, inflate=.018, folds=.0, seed=seed); COVERED.clear(); COVERED.update(before)
        parts.append(mask)
        parts.append(G.prim('snout', 'cyl', 'rubber', size=(.06, .06, .05), loc=(0, -.14, 1.645), rot=(math.pi / 2, 0, 0), segs=12, bevel=.004))
        for sx in (1, -1):
            parts.append(G.prim('filter' + str(sx), 'cyl', 'olive', size=(.055, .055, .05), loc=(sx * .07, -.13, 1.635), rot=(math.pi / 2, 0, sx * .7), segs=12, bevel=.004))
            parts.append(G.prim('goggle' + str(sx), 'cyl', 'glass', size=(.045, .045, .025), loc=(sx * .034, -.118, 1.71), rot=(math.pi / 2, 0, 0), segs=12))
            parts.append(G.prim('rim' + str(sx), 'torus', 'rubber', size=(.05, .05, .012), loc=(sx * .034, -.123, 1.71), rot=(math.pi / 2, 0, 0), segs=12))
        parts.append(G.prim('gstrap', 'torus', 'rubber', size=(.2, .2, .014), loc=(0, -.012, 1.71), segs=20))
        parts.append(G.prim('mstrap', 'torus', 'rubber', size=(.19, .19, .014), loc=(0, -.01, 1.64), rot=(-.25, 0, 0), segs=20))
        for s in (1, -1):
            parts.append(shell(b, 'boot' + str(s), 'boot', lambda c, s=s: c.z < .24 and c.x * s > 0, inflate=.02, folds=.002, seed=seed + s))
            parts.append(G.prim('sole' + str(s), 'box', 'sole', size=(.095, .25, .03), loc=(s * .095, -.045, .015), bevel=.008))
            parts.append(G.prim('kneepad' + str(s), 'box', 'leather', size=(.1, .03, .1), loc=(s * .096, -.075, .52), bevel=.01))
    else:  # hood
        before = set(COVERED); sack = shell(b, 'sack', 'burlap', lambda c: c.z > 1.585, inflate=.022, folds=.01, seed=seed); COVERED.clear(); COVERED.update(before)
        bm = bmesh.new(); bm.from_mesh(sack.data)
        for v in bm.verts:   # floppy point at the back of the crown
            if v.co.z > 1.76: v.co.z += (v.co.z - 1.76) * 1.4; v.co.y += (v.co.z - 1.76) * 1.2
        holes = [f for f in bm.faces if any((f.calc_center_median() - Vector((s * .034, -.115, 1.708))).length < .017 for s in (1, -1))]
        bmesh.ops.delete(bm, geom=holes, context='FACES'); bm.to_mesh(sack.data); bm.free()
        parts.append(sack)
        parts.append(G.prim('rope', 'torus', 'rope', size=(.13, .13, .028), loc=(0, -.005, 1.575), segs=16))
        parts.append(G.prim('knot', 'sphere', 'rope', size=(.04, .04, .04), loc=(0, .065, 1.57), segs=8))
        parts.append(shell(b, 'trousers', 'trousers', lambda c: .14 < c.z < 1.02 and not hand(c), inflate=.018, folds=.009, seed=seed, rips=.08, ripscale=9))
        parts.append(tube('waist', 'rope', (0, .004), (.15, .11), .99, 1.015, n=16, rings=2))
        for s in (1, -1):
            parts.append(cuff('cuff' + str(s), 'leather', (s * .34, -.01, .93), .034, .05))
            parts.append(G.prim('hem' + str(s), 'torus', 'trousers', size=(.12, .12, .035), loc=(s * .095, -.004, .15), segs=12))
    return b, parts


def drop_covered(b):
    """Remove body faces hidden under garments (only where every neighbour is covered, so no gap opens at the edges).
    Runs after the garments copied their weights from the full body."""
    bm = bmesh.new(); bm.from_mesh(b.data); bm.faces.ensure_lookup_table()
    hidden = [f for f in bm.faces if f.index in COVERED and all(sum(1 for g in v.link_faces if g.index in COVERED) == len(v.link_faces) for v in f.verts)]
    bmesh.ops.delete(bm, geom=hidden, context='FACES'); bm.to_mesh(b.data); bm.free()


# ---------------------------------------------------------------- weights
def copy_weights(body, garments):
    kd = kdtree.KDTree(len(body.data.vertices))
    for i, v in enumerate(body.data.vertices): kd.insert(v.co, i)
    kd.balance()
    names = [g.name for g in body.vertex_groups]
    bw = [[(body.vertex_groups[g.group].name, g.weight) for g in v.groups] for v in body.data.vertices]
    for o in garments:
        for n in names:
            if n not in o.vertex_groups: o.vertex_groups.new(name=n)
        for v in o.data.vertices:
            hits = kd.find_n(v.co, 1); tot = {}; wsum = 0   # shells were grown from these very vertices: take the source vertex's weights
            for co, idx, dist in hits:
                k = 1 / (dist + .005); wsum += k
                for n, w in bw[idx]: tot[n] = tot.get(n, 0) + w * k
            for n, w in tot.items():
                if w / wsum > .01: o.vertex_groups[n].add([v.index], w / wsum, 'REPLACE')


# ---------------------------------------------------------------- paint
def painter(variant, seed):
    rng = np.random.default_rng(seed)
    skin_tone = np.array([(94, 100, 86), (102, 94, 82), (86, 96, 79)][seed % 3], np.float32) / 255
    def paint(P, N, K, keys):
        x, y, z = P[..., 0], P[..., 1], P[..., 2]
        col = np.zeros(P.shape, np.float32)
        lo = G.fbm(P, 4, seed, 3); mid = G.fbm(P, 14, seed + 3, 2); hi = G.vnoise(P, 60, seed + 9)
        def m(*n): return G.mask_key(K, keys, *n)
        def put(mask, rgb): col[mask] = rgb[mask] if isinstance(rgb, np.ndarray) and rgb.shape == col.shape else rgb
        # skin: sickly grey-green, mottled bruising, veins, darker at extremities
        sk = skin_tone * (0.82 + 0.3 * lo[..., None]) * (0.92 + 0.12 * hi[..., None])
        bruise = np.clip((G.fbm(P, 9, seed + 21, 2) - .58) * 4, 0, 1)[..., None]
        sk = sk * (1 - bruise * .35) + np.array([.32, .18, .26]) * bruise * .35
        vein = (np.abs(np.sin(G.fbm(P, 22, seed + 5, 2) * 40)) < .08)[..., None] * .25
        sk = sk * (1 - vein) + np.array([.22, .26, .32]) * vein
        ext = np.clip((np.abs(x) - .32) * 6, 0, 1)[..., None] + np.clip((.25 - z) * 4, 0, 1)[..., None]
        sk = sk * (1 - .35 * np.clip(ext, 0, 1))
        put(m('skin'), sk)
        # face, by position on the head front: darken the sculpted sockets and mouth, dull wet eyes, teeth
        face = m('skin') & (z > 1.6) & (y < -.05)
        for sx in (1, -1):
            d = np.sqrt(((x - sx * .033) / 1.2) ** 2 + (z - 1.708) ** 2)
            dark = np.clip(1 - d / .024, 0, 1)[..., None]
            col[face] = (col * (1 - .8 * dark) + np.array([.1, .05, .05]) * .8 * dark)[face]
            eye = face & (np.sqrt((x - sx * .033) ** 2 + (z - 1.707) ** 2) < .0085)
            col[eye] = (.5, .5, .38)
            col[face & (np.sqrt((x - sx * .034) ** 2 + (z - 1.706) ** 2) < .0032)] = (.16, .05, .03)
        md = np.sqrt((x / 1.8) ** 2 + ((z - 1.642) / .8) ** 2)
        mdark = np.clip(1 - md / .016, 0, 1)[..., None]
        col[face] = (col * (1 - .9 * mdark) + np.array([.08, .02, .02]) * .9 * mdark)[face]
        teeth = face & (np.abs(x) < .022) & (np.abs(z - 1.653) < .0045) & (np.sin(x * 520) > -.4)
        col[teeth] = (.5, .46, .34)
        lips_blood = face & (np.abs(x) < .03) & (z < 1.638) & (z > 1.56) & (G.vnoise(P * np.array([1, 1, .15]), 80, seed) > .6)
        col[lips_blood] = col[lips_blood] * .3 + np.array([.3, .03, .02]) * .7
        # surgical stitches (hood: Y incision; others: a scar on the scalp)
        if variant == 'hood':
            yi = m('skin') & (y < 0) & (((np.abs(np.abs(x) - (1.44 - z) * .9) < .006) & (z > 1.32) & (z < 1.44)) | ((np.abs(x) < .006) & (z < 1.32) & (z > 1.0)))
            col[yi] = (.24, .08, .06)
            st = yi & (np.sin(z * 900) > .6); col[st] = (.06, .03, .02)
        # cloth families
        def cloth(mask, base, dark, fold_scale=6):
            f = (G.vnoise(P * np.array([2.5, 2.5, .5], np.float32), fold_scale, seed + 11) - .5)
            c = np.array(base, np.float32) * (0.78 + 0.35 * mid[..., None] + 0.4 * f[..., None])
            grime = np.clip((1.0 - z) * 1.2 + (lo - .5), 0, 1)[..., None] * .45
            c = c * (1 - grime) + np.array(dark, np.float32) * grime
            put(mask, c)
        cloth(m('gown'), (.4, .45, .4), (.2, .17, .1))
        stain = (G.fbm(P, 7, seed + 31, 2) > .6)[..., None] & m('gown')[..., None]
        col = np.where(stain, col * .75 + np.array([.3, .24, .1]) * .25, col)
        gp = m('gown') & (np.sin(x * 80) * np.sin(z * 80) > .85); col[gp] = col[gp] * .7 + np.array([.2, .27, .4]) * .3   # faded print
        cloth(m('coverall'), (.22, .26, .32), (.1, .09, .07))
        cloth(m('trousers'), (.2, .18, .15), (.08, .07, .05))
        burlap = (.42, .34, .2)
        weave = ((np.sin(x * 700) > 0) ^ (np.sin(z * 700) > 0))[..., None] * .12
        cloth(m('burlap'), burlap, (.14, .1, .05)); col[m('burlap')] = (col * (1 - weave))[m('burlap')]
        cloth(m('rope'), (.36, .3, .18), (.16, .12, .06), 14)
        lea = np.array([.2, .13, .08]) * (0.8 + 0.4 * mid[..., None]); put(m('leather'), lea)
        put(m('boot'), np.array([.09, .08, .07]) * (0.8 + 0.5 * lo[..., None])); put(m('sole'), np.array([.04, .04, .04]))
        put(m('metal'), np.array([.5, .48, .42]) * (0.7 + .4 * hi[..., None])); put(m('band'), np.array([.78, .78, .7]))
        stripe = (np.sin((z * 1.0 + x * .6) * 260) > .55)[..., None]
        bd = np.array([.62, .58, .48]) * (0.8 + .3 * mid[..., None]) * (1 - .25 * stripe)
        seep = (G.fbm(P, 16, seed + 41, 2) > .58)[..., None]
        bd = np.where(seep, bd * .55 + np.array([.36, .26, .1]) * .45, bd)
        put(m('bandage'), bd)
        put(m('rubber'), np.array([.07, .07, .065]) * (0.8 + .5 * lo[..., None]))
        put(m('glass'), np.array([.12, .16, .14])); put(m('olive'), np.array([.24, .25, .16]) * (0.8 + .4 * mid[..., None]))
        # blood: runs from wounds downward, collects on the front; stronger on some variants
        wounds = [(.06, -.12, 1.35), (-.08, -.1, 1.2), (.2, -.03, 1.1), (-.1, -.07, .7)]
        bl = np.zeros(z.shape, np.float32)
        for wx, wy, wz in wounds:
            dx = np.abs(x - wx); below = np.clip((wz - z) / .35, 0, 1)
            streak = (dx < .006 + .008 * G.vnoise(P * np.array([1, 1, .1]), 25, seed)) & (z < wz) & (z > wz - .35 * (0.4 + G.vnoise(P * np.array([1, 1, 0]), 30, seed + wx)))
            bl = np.maximum(bl, streak * (1 - below) * (y < .02))
            spot = np.sqrt((x - wx) ** 2 + (z - wz) ** 2 + (y - wy) ** 2 * .3) < .03 + .02 * G.vnoise(P, 25, seed + wz)
            bl = np.maximum(bl, spot * .95)
        drip = (G.vnoise(P * np.array([6, 6, .25], np.float32), 30, seed + 2) > .86) & (y < 0) & (z > .5) & (z < 1.5)
        bl = np.maximum(bl, drip * .45)
        blood = np.array([.26, .02, .015]) * (0.7 + .5 * mid[..., None])
        col = col * (1 - bl[..., None] * .9) + blood * bl[..., None] * .9
        # floor filth on everything low
        low = np.clip((.35 - z) * 3, 0, 1)[..., None] * (0.6 + .4 * lo[..., None])
        col = col * (1 - low * .5) + np.array([.12, .1, .06]) * low * .5
        return col
    return paint


# ---------------------------------------------------------------- build
os.makedirs(OUT, exist_ok=True)
G.clean()
VARIANTS = [('gown', 2), ('coverall', 3), ('hood', 5)]
built = []
report = {}
for variant, seed in VARIANTS:
    if ONLY and variant not in ONLY: continue
    b, parts = build_variant(variant, seed)
    # decimate the body to the budget before weighting
    arm = armature('rig_' + variant)
    G.select_only(b, arm); bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    copy_weights(b, parts)
    drop_covered(b)
    mesh = G.join([b] + parts, 'zombie_' + variant)
    for mo in list(mesh.modifiers): mesh.modifiers.remove(mo)
    # glTF carries four influences per vertex: keep the strongest four and make them sum to one
    G.select_only(mesh)
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
    mesh.parent = arm; am = mesh.modifiers.new('arm', 'ARMATURE'); am.object = arm
    info = G.paint_and_bake(mesh, 512, painter(variant, seed), OUT, ao_strength=.8, ao_samples=40, ao_distance=.12, emphasis=lambda c: 2.6 if c.z > 1.58 and c.y < .02 else 1.3 if c.z > 1.58 else 1.0)  # the face gets the texels
    info['tris'] = G.tris(mesh)
    unweighted = sum(1 for v in mesh.data.vertices if not any(g.weight > .001 for g in v.groups))
    info['unweighted'] = unweighted
    G.export_glb([mesh, arm], os.path.join(OUT, 'zombie_' + variant + '.glb'), skins=True)
    report[variant] = info
    built.append((mesh, arm))
# lay them out and save, then previews
for i, (mesh, arm) in enumerate(built): arm.location.x = (i - (len(built) - 1) / 2) * 1.0
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'zombies.blend'))
for mesh, arm in built:
    G.preview([mesh], os.path.join(OUT, 'previews', mesh.name + '.png'), yaw=20, pitch=6, target=arm.matrix_world @ Vector((0, 0, .9)), dist=3.2)
    G.preview([mesh], os.path.join(OUT, 'previews', mesh.name + '_face.png'), yaw=15, pitch=2, target=arm.matrix_world @ Vector((0, -.02, 1.68)), dist=.75, res=(480, 480))
print('REPORT', report)
