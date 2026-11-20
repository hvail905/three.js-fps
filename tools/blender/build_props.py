"""The Gallery's props, fixtures and pickups, built in Blender.

    python tools/blender/build_props.py OUT_DIR [--only crate,drum]      (pip install bpy)
    blender -b --python tools/blender/build_props.py -- OUT_DIR

One GLB per asset in OUT_DIR, sized and oriented to match the procedural builders in src/world/sewer-props.js:
free-standing props stand on the origin and face -Y (the game's +Z); wall-mounted ones have the wall at y = 0 and
stick out toward -Y. Named child nodes the game drives: 'head' and 'led' (camera), 'glow' (lamps).
"""
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
import numpy as np
from mathutils import Vector, Euler
import gallery_lib as G

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else (sys.argv[1] if len(sys.argv) > 1 else 'out_props')
ONLY = sys.argv[sys.argv.index('--only') + 1].split(',') if '--only' in sys.argv else None
P_ = G.prim
PI = math.pi

# ---------------------------------------------------------------- paint
BASE = {
    'pine': (.62, .48, .32), 'pine_dk': (.42, .31, .19), 'wood_dk': (.3, .22, .14), 'steel': (.42, .43, .42), 'steel_dk': (.2, .21, .21),
    'paint_green': (.24, .3, .25), 'paint_grey': (.36, .38, .36), 'drum_blue': (.16, .27, .4), 'drum_band': (.62, .48, .14), 'rust': (.24, .13, .07),
    'leather': (.2, .13, .08), 'cloth': (.5, .5, .44), 'sheet': (.66, .66, .6), 'rubber': (.07, .07, .07), 'black': (.04, .04, .04),
    'glass': (.3, .38, .34), 'jar': (.3, .36, .22), 'tin': (.5, .46, .36), 'paper': (.66, .63, .54), 'card': (.46, .36, .22),
    'label': (.72, .66, .46), 'brick': (.5, .24, .16), 'mortar': (.5, .47, .42), 'bottle': (.16, .36, .16), 'tape': (.16, .26, .5),
    'bandage': (.82, .8, .72), 'red': (.55, .08, .06), 'yellow': (.7, .55, .14), 'bag': (.6, .64, .5), 'grille': (.12, .12, .11),
    'bulb': (.9, .85, .7), 'cable': (.05, .05, .05), 'brass': (.55, .42, .2),
}
WOODS = ('pine', 'pine_dk', 'wood_dk', 'card'); PAINTS = ('paint_green', 'paint_grey', 'drum_blue', 'drum_band', 'yellow', 'red')
METALS = ('steel', 'steel_dk', 'tin', 'brass'); CLOTHS = ('cloth', 'sheet', 'bandage', 'paper', 'bag', 'label')


def painter(seed=1, extra=None):
    def paint(P, N, K, keys, edges=None):
        x, y, z = P[..., 0], P[..., 1], P[..., 2]
        lo = G.fbm(P, 3, seed, 3); mid = G.fbm(P, 12, seed + 3, 2); hi = G.vnoise(P, 50, seed + 9)
        col = np.zeros(P.shape, np.float32)
        E = edges() if edges is not None else np.full(z.shape, 9, np.float32)
        edge = np.clip(1 - E / .012, 0, 1) * (G.vnoise(P, 40, seed + 5) > .35)   # within ~1 cm of a sharp edge, broken up
        for i, k in enumerate(keys):
            mk = K == i
            if not mk.any(): continue
            b = np.array(BASE.get(k, (.5, .5, .5)), np.float32)
            c = b * (0.8 + 0.35 * lo[..., None]) * (0.92 + 0.14 * hi[..., None])
            if k in WOODS:
                grain = np.sin((x + z * .2) * 90 + G.vnoise(P, 6, seed) * 8)[..., None]
                c = c * (0.9 + 0.08 * grain) * (1 + .25 * edge[..., None])
            elif k in PAINTS:
                chip = (edge > .5) | (G.fbm(P, 18, seed + 7, 2) > .78)
                bare = np.array(BASE['rust'], np.float32) * (0.8 + .4 * mid[..., None])
                c = np.where(chip[..., None], bare, c)
            elif k in METALS:
                c = c * (1 + .45 * edge[..., None])
                rust = (G.fbm(P, 9, seed + 13, 2) > .66)[..., None]
                c = np.where(rust, c * .5 + np.array(BASE['rust']) * .5, c)
            elif k in CLOTHS:
                stain = (G.fbm(P, 7, seed + 21, 2) > .6)[..., None]
                c = np.where(stain, c * .7 + np.array([.35, .26, .12]) * .3, c)
            col[mk] = c[mk]
        if extra: col = extra(P, N, K, keys, col, dict(x=x, y=y, z=z, lo=lo, mid=mid, hi=hi, edge=edge))
        col = col * (0.82 + 0.1 * lo[..., None])                                               # everything down here is a little dirty
        grime = np.clip((.25 - z) * 2.5, 0, 1)[..., None] * (0.5 + .5 * lo[..., None])   # filth rising from the floor
        col = col * (1 - grime * .45) + np.array([.1, .08, .05]) * grime * .45
        top_dust = np.clip(N[..., 2] - .7, 0, 1)[..., None] * .25                          # dust settles on top faces
        col = col * (1 - top_dust) + np.array([.42, .4, .36]) * top_dust
        return col
    return paint


def km(name):
    return lambda P, N, K, keys: G.mask_key(K, keys, name)


def finish(name, parts, size=256, seed=1, extra=None, ao=.75, aod=.15, keep=()):
    """Join the parts (except those named in keep), paint, bake AO, return the main object."""
    main = [p for p in parts if p.name not in keep]
    o = G.join(main, name) if len(main) > 1 else main[0]
    if o.name != name: o.name = name
    info = G.paint_and_bake(o, size, painter(seed, extra), OUT, ao_strength=ao, ao_samples=32, ao_distance=aod)
    return o, info


def glow_mat(name, rgb, strength=4.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; bs = nt.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*rgb, 1); bs.inputs['Emission Color'].default_value = (*rgb, 1); bs.inputs['Emission Strength'].default_value = strength
    return m


def glow(name, kind, size, loc, rgb, rot=(0, 0, 0), segs=10):
    o = P_(name, kind, 'bulb', size=size, loc=loc, rot=rot, segs=segs)
    o.data.materials.clear(); o.data.materials.append(glow_mat('M_' + name, rgb)); o.name = 'glow'
    return o


# ---------------------------------------------------------------- props
ASSETS = {}
def asset(fn): ASSETS[fn.__name__] = fn; return fn


@asset
def crate():
    p = [P_('c_core', 'box', 'pine', size=(.86, .86, .86), loc=(0, 0, .45), bevel=.01)]
    for sy in (-1, 1):   # frame boards on front and back
        for zz in (.06, .84): p.append(P_('c_h', 'box', 'pine_dk', size=(.9, .04, .1), loc=(0, sy * .44, zz), bevel=.008))
        for xx in (-.4, .4): p.append(P_('c_v', 'box', 'pine_dk', size=(.1, .04, .9), loc=(xx, sy * .44, .45), bevel=.008))
        p.append(P_('c_d', 'box', 'pine_dk', size=(1.02, .035, .09), loc=(0, sy * .445, .45), rot=(0, -.82, 0), bevel=.006))
    for sx in (-1, 1):
        for sy in (-1, 1): p.append(P_('c_post', 'box', 'pine_dk', size=(.07, .07, .9), loc=(sx * .43, sy * .43, .45), bevel=.008))   # corner posts close the gaps
        for zz in (.06, .84): p.append(P_('c_hs', 'box', 'pine_dk', size=(.04, .9, .1), loc=(sx * .44, 0, zz), bevel=.008))
        p.append(P_('rope', 'torus', 'leather', size=(.22, .22, .04), loc=(sx * .455, 0, .66), rot=(0, PI / 2, 0), segs=12))
    def stencil(P, N, K, keys, col, d):
        x, y, z = d['x'], d['y'], d['z']
        front = (N[..., 1] < -.8) & G.mask_key(K, keys, 'pine')
        arrow = front & (((np.abs(x) < .05) & (z > .3) & (z < .52)) | ((z >= .52) & (z < .64) & (np.abs(x) < (.64 - z) * 1.1)))
        col[arrow] = col[arrow] * .25 + np.array([.08, .06, .04]) * .75
        return col
    return finish('crate', p, 256, 3, stencil)


@asset
def drum():
    p = [P_('d_body', 'cyl', 'drum_blue', size=(.6, .6, .88), loc=(0, 0, .45), segs=20)]
    for zz in (.02, .3, .6, .88): p.append(P_('d_rib', 'torus', 'drum_blue', size=(.61, .61, .025), loc=(0, 0, zz), segs=20))
    p.append(P_('d_band', 'cyl', 'drum_band', size=(.606, .606, .12), loc=(0, 0, .45), segs=20))
    p.append(P_('d_lid', 'cyl', 'steel_dk', size=(.56, .56, .015), loc=(0, 0, .895), segs=20))
    p.append(P_('d_bung', 'cyl', 'steel', size=(.06, .06, .02), loc=(.17, .05, .905), segs=8))
    p.append(P_('d_bung2', 'cyl', 'steel', size=(.035, .035, .02), loc=(-.18, -.02, .905), segs=8))
    p.append(P_('d_dent', 'sphere', 'drum_blue', size=(.12, .05, .1), loc=(.12, -.285, .7), segs=8))
    return finish('drum', p, 256, 5)


@asset
def gurney():
    p = []
    for x in (-.9, .9):
        for y in (-.3, .3):
            p.append(P_('g_leg', 'cyl', 'steel', size=(.035, .035, .66), loc=(x, y, .42), segs=8))
            p.append(P_('g_wheel', 'cyl', 'rubber', size=(.09, .09, .03), loc=(x, y, .05), rot=(0, PI / 2, 0), segs=10))
            p.append(P_('g_fork', 'box', 'steel_dk', size=(.04, .05, .08), loc=(x, y, .1)))
    for y in (-.33, .33): p.append(P_('g_rail', 'cyl', 'steel', size=(.03, .03, 1.95), loc=(0, y, .76), rot=(0, PI / 2, 0), segs=8))
    p.append(P_('g_frame', 'box', 'steel_dk', size=(1.95, .68, .04), loc=(0, 0, .75), bevel=.01))
    p.append(P_('g_mat', 'box', 'cloth', size=(1.86, .62, .1), loc=(0, 0, .82), bevel=.035, bevel_segs=3))
    p.append(P_('g_pillow', 'box', 'sheet', size=(.36, .5, .08), loc=(-.72, 0, .9), bevel=.03, bevel_segs=3))
    for x in (-.35, .2, .65):
        p.append(P_('g_strap', 'box', 'leather', size=(.08, .66, .12), loc=(x, 0, .83), bevel=.01))
        p.append(P_('g_buckle', 'box', 'steel', size=(.06, .015, .05), loc=(x, -.335, .85)))
    def stains(P, N, K, keys, col, d):
        mk = G.mask_key(K, keys, 'cloth') & (G.fbm(P, 5, 9, 2) > .55)
        col[mk] = col[mk] * .45 + np.array([.32, .05, .03]) * .55
        return col
    return finish('gurney', p, 512, 7, stains)


@asset
def chair():
    p = []
    for x in (-.22, .22):
        for y in (-.22, .22): p.append(P_('ch_leg', 'box', 'steel', size=(.045, .045, .45), loc=(x, y, .225), bevel=.006))
    p.append(P_('ch_seat', 'box', 'leather', size=(.52, .52, .07), loc=(0, 0, .48), bevel=.02))
    p.append(P_('ch_back', 'box', 'leather', size=(.52, .07, .7), loc=(0, .25, .88), rot=(-.08, 0, 0), bevel=.02))
    p.append(P_('ch_head', 'box', 'leather', size=(.24, .08, .18), loc=(0, .27, 1.33), bevel=.02))
    for x in (-.27, .27):
        p.append(P_('ch_arm', 'box', 'steel_dk', size=(.06, .46, .05), loc=(x, 0, .69), bevel=.006))
        p.append(P_('ch_post', 'box', 'steel_dk', size=(.04, .04, .22), loc=(x, -.2, .58)))
        p.append(P_('ch_cuff', 'box', 'leather', size=(.1, .08, .07), loc=(x, .02, .73), bevel=.01))
        p.append(P_('ch_ankle', 'box', 'leather', size=(.08, .08, .06), loc=(x * .8, -.22, .12), bevel=.01))
    p.append(P_('ch_bolt', 'box', 'steel_dk', size=(.6, .6, .02), loc=(0, 0, .01)))
    return finish('chair', p, 256, 11)


def table_(name, sheet):
    p = []
    for x in (-.7, .7):
        for y in (-.35, .35): p.append(P_('t_leg', 'box', 'steel', size=(.05, .05, .85), loc=(x, y, .425), bevel=.006))
    for y in (-.35, .35): p.append(P_('t_bar', 'box', 'steel_dk', size=(1.4, .03, .03), loc=(0, y, .2)))
    p.append(P_('t_top', 'box', 'paint_grey', size=(1.6, .85, .05), loc=(0, 0, .87), bevel=.01))
    if sheet: p.append(P_('t_sheet', 'box', 'sheet', size=(1.12, .64, .01), loc=(.05, 0, .9), bevel=.003))
    else:
        p.append(P_('t_box', 'box', 'card', size=(.4, .3, .3), loc=(-.4, 0, 1.045), bevel=.01))
        p.append(P_('t_tray', 'box', 'steel', size=(.3, .22, .03), loc=(.3, -.1, .91), bevel=.004))
        p.append(P_('t_jar', 'cyl', 'jar', size=(.12, .12, .2), loc=(.55, .2, .995), segs=10))
    return finish(name, p, 256, 13)


@asset
def table(): return table_('table', False)


@asset
def table_sheet(): return table_('table_sheet', True)


@asset
def shelf():
    p = []
    for x in (-.7, .7):
        for y in (-.05, -.45): p.append(P_('s_post', 'box', 'steel', size=(.04, .04, 1.9), loc=(x, y, .95)))
    rr = np.random.default_rng(3)
    for i in range(4):
        z = .2 + i * .5
        p.append(P_('s_board', 'box', 'paint_grey', size=(1.45, .45, .03), loc=(0, -.25, z), bevel=.004))
        for k in range(5):
            if rr.random() < .25: continue
            xx = -.55 + k * .27 + rr.uniform(-.04, .04); t = rr.integers(0, 3)
            if t == 0: p.append(P_('s_jar', 'cyl', 'jar', size=(.1, .1, .17), loc=(xx, -.25, z + .1), segs=10))
            elif t == 1: s = rr.uniform(.12, .2); p.append(P_('s_box', 'box', 'card', size=(s * 1.3, s, s), loc=(xx, -.25, z + s / 2 + .015), rot=(0, 0, rr.uniform(-.2, .2)), bevel=.006))
            else: p.append(P_('s_tin', 'cyl', 'tin', size=(.09, .09, .12), loc=(xx, -.22, z + .075), segs=10))
    return finish('shelf', p, 512, 17)


@asset
def locker():
    p = []
    for x in (-.3, .3):
        p.append(P_('l_box', 'box', 'paint_green', size=(.58, .5, 1.9), loc=(x, -.25, .95), bevel=.008))
        for i in range(5): p.append(P_('l_vent', 'box', 'black', size=(.3, .01, .015), loc=(x, -.502, 1.6 + i * .04)))
        p.append(P_('l_handle', 'box', 'steel', size=(.03, .03, .12), loc=(x + .2, -.515, 1.0), bevel=.004))
        p.append(P_('l_tag', 'box', 'label', size=(.12, .006, .05), loc=(x, -.503, 1.4)))
    p.append(P_('l_dent', 'sphere', 'paint_green', size=(.2, .04, .25), loc=(-.25, -.49, .7), segs=10))
    return finish('locker', p, 256, 19)


@asset
def cabinet():
    p = [P_('cb_box', 'box', 'paint_grey', size=(.8, .45, 1.8), loc=(0, -.225, .9), bevel=.008)]
    for i in range(4):
        z = .25 + i * .42
        p.append(P_('cb_drawer', 'box', 'paint_grey', size=(.72, .02, .38), loc=(0, -.455, z), bevel=.006))
        p.append(P_('cb_pull', 'box', 'steel', size=(.14, .03, .02), loc=(0, -.47, z + .1), bevel=.004))
        p.append(P_('cb_card', 'box', 'label', size=(.08, .005, .04), loc=(0, -.466, z + .14)))
    return finish('cabinet', p, 256, 23)


@asset
def iv():
    p = [P_('iv_pole', 'cyl', 'steel', size=(.025, .025, 1.85), loc=(0, 0, .95), segs=8)]
    for a in range(5):
        r = a * 2 * PI / 5
        p.append(P_('iv_foot', 'box', 'steel_dk', size=(.26, .03, .025), loc=(math.cos(r) * .12, math.sin(r) * .12, .06), rot=(0, 0, r)))
        p.append(P_('iv_caster', 'sphere', 'rubber', size=(.04, .04, .04), loc=(math.cos(r) * .24, math.sin(r) * .24, .02), segs=6))
    p.append(P_('iv_hook', 'box', 'steel', size=(.32, .015, .015), loc=(0, 0, 1.85)))
    p.append(P_('iv_bag', 'box', 'bag', size=(.11, .04, .18), loc=(.12, 0, 1.68), bevel=.015, bevel_segs=3))
    p.append(P_('iv_tube', 'cyl', 'bag', size=(.008, .008, .9), loc=(.12, 0, 1.15), segs=5))
    return finish('iv', p, 128, 29)


@asset
def camera():
    base = [P_('cm_plate', 'box', 'steel_dk', size=(.12, .02, .16), loc=(0, -.01, 0), bevel=.004),
            P_('cm_arm', 'box', 'steel_dk', size=(.05, .25, .05), loc=(0, -.13, 0), bevel=.004)]
    b, _ = finish('camera', base, 128, 31)
    hp = [P_('cm_body', 'box', 'paint_grey', size=(.14, .3, .12), loc=(0, -.1, 0), bevel=.012),
          P_('cm_hood', 'box', 'paint_grey', size=(.17, .34, .02), loc=(0, -.12, .07), bevel=.004),
          P_('cm_lens', 'cyl', 'black', size=(.08, .08, .04), loc=(0, -.265, 0), rot=(PI / 2, 0, 0), segs=12),
          P_('cm_glass', 'cyl', 'glass', size=(.06, .06, .01), loc=(0, -.287, 0), rot=(PI / 2, 0, 0), segs=12)]
    h, _ = finish('head', hp, 128, 37)
    led = P_('led', 'sphere', 'bulb', size=(.024, .024, .024), loc=(.05, -.255, .045), segs=6)
    led.data.materials.clear(); led.data.materials.append(glow_mat('M_led', (1, .08, .03), 6))
    led.parent = h          # head is still at the origin, so the LED's position is already head-local
    # head pivots where it meets the arm, tipped down; the game turns it
    h.parent = b; h.location = (0, -.25, -.06); h.rotation_euler = (-.35, 0, 0)
    return b, {}


@asset
def speaker():
    p = [P_('sp_box', 'box', 'paint_grey', size=(.34, .08, .34), loc=(0, -.04, 0), bevel=.01),
         P_('sp_grille', 'box', 'grille', size=(.26, .01, .26), loc=(0, -.082, 0))]
    for i in range(-3, 4): p.append(P_('sp_slat', 'box', 'paint_grey', size=(.26, .012, .012), loc=(0, -.088, i * .035)))
    p.append(P_('sp_conduit', 'cyl', 'steel_dk', size=(.03, .03, .6), loc=(.12, -.02, .45), segs=6))
    p.append(P_('sp_box2', 'box', 'steel_dk', size=(.08, .05, .06), loc=(.12, -.03, .17), bevel=.005))
    return finish('speaker', p, 128, 41)


@asset
def lamp_cage():
    p = [P_('lc_bracket', 'box', 'steel_dk', size=(.06, .3, .06), loc=(0, -.15, .1), bevel=.005),
         P_('lc_socket', 'cyl', 'steel_dk', size=(.12, .12, .05), loc=(0, -.3, .06), segs=10)]
    for i in range(6):
        a = i / 6 * 2 * PI
        p.append(P_('lc_wire', 'box', 'steel', size=(.008, .008, .17), loc=(math.cos(a) * .075, -.3 + math.sin(a) * .075, -.03)))
    p.append(P_('lc_ring', 'torus', 'steel', size=(.15, .15, .01), loc=(0, -.3, -.11), segs=12))
    o, _ = finish('lamp_cage', p, 128, 43)
    g = glow('glow', 'sphere', (.1, .1, .12), (0, -.3, -.02), (1, .85, .6)); g.parent = o
    return o, {}


@asset
def lamp_tube():
    p = [P_('lt_housing', 'box', 'paint_grey', size=(1.3, .18, .06), loc=(0, 0, -.03), bevel=.008)]
    for x in (-.62, .62): p.append(P_('lt_cap', 'box', 'steel_dk', size=(.04, .1, .05), loc=(x, 0, -.07)))
    o, _ = finish('lamp_tube', p, 128, 47)
    g = glow('glow', 'cyl', (.05, .05, 1.2), (0, 0, -.085), (.85, .92, 1.0), rot=(0, PI / 2, 0)); g.parent = o
    return o, {}


@asset
def lamp_red():
    p = [P_('lr_base', 'box', 'steel_dk', size=(.18, .04, .18), loc=(0, -.02, 0), bevel=.006),
         P_('lr_cage', 'torus', 'steel', size=(.17, .17, .012), loc=(0, -.06, 0), rot=(PI / 2, 0, 0), segs=12)]
    o, _ = finish('lamp_red', p, 128, 53)
    g = glow('glow', 'sphere', (.15, .1, .15), (0, -.05, 0), (1, .1, .05)); g.parent = o
    return o, {}


@asset
def lamp_bulb():
    p = [P_('lb_socket', 'cyl', 'black', size=(.06, .06, .07), loc=(0, 0, .04), segs=8), P_('lb_shade', 'cyl', 'steel_dk', size=(.2, .2, .04), loc=(0, 0, .08), segs=12)]
    o, _ = finish('lamp_bulb', p, 64, 59)
    g = glow('glow', 'sphere', (.11, .11, .13), (0, 0, -.04), (1, .82, .55)); g.parent = o
    return o, {}


# ---------------------------------------------------------------- pickups (centred; the game turns them with their physics bodies)
@asset
def pick_brick():
    p = [P_('pb', 'box', 'brick', size=(.2, .1, .065), loc=(0, 0, 0), bevel=.008, bevel_segs=2)]
    def mortar(P, N, K, keys, col, d):
        mk = (d['edge'] > .3) | (G.fbm(P, 30, 3, 2) > .7); col[mk] = col[mk] * .4 + np.array(BASE['mortar']) * .6; return col
    return finish('pick_brick', p, 64, 61, mortar)


@asset
def pick_bottle():
    p = [P_('pbo', 'cyl', 'bottle', size=(.07, .07, .16), loc=(0, 0, -.03), segs=12), P_('pbo_sh', 'cyl', 'bottle', size=(.07, .07, .03), loc=(0, 0, .065), segs=12)]
    neck = P_('pbo_n', 'cyl', 'bottle', size=(.026, .026, .07), loc=(0, 0, .11), segs=10); p.append(neck)
    p.append(P_('pbo_lab', 'cyl', 'label', size=(.072, .072, .07), loc=(0, 0, -.03), segs=12))
    p.append(P_('pbo_cap', 'cyl', 'brass', size=(.03, .03, .015), loc=(0, 0, .15), segs=8))
    return finish('pick_bottle', p, 64, 67)


@asset
def pick_pipe():
    p = [P_('pp', 'cyl', 'steel', size=(.045, .045, .6), loc=(0, 0, 0), rot=(PI / 2, 0, 0), segs=10)]
    p.append(P_('pp_tape', 'cyl', 'tape', size=(.05, .05, .16), loc=(0, .2, 0), rot=(PI / 2, 0, 0), segs=10))
    p.append(P_('pp_elbow', 'cyl', 'steel_dk', size=(.06, .06, .05), loc=(0, -.29, 0), rot=(PI / 2, 0, 0), segs=10))
    return finish('pick_pipe', p, 64, 71)


@asset
def pick_bandage():
    p = [P_('pbd', 'cyl', 'bandage', size=(.08, .08, .09), loc=(0, 0, 0), segs=14), P_('pbd_x', 'box', 'red', size=(.03, .082, .092), loc=(0, 0, 0))]
    return finish('pick_bandage', p, 64, 73)


@asset
def pick_ammo():
    p = [P_('pa', 'box', 'card', size=(.12, .08, .06), loc=(0, 0, 0), bevel=.004), P_('pa_lab', 'box', 'yellow', size=(.122, .082, .022), loc=(0, 0, .006))]
    return finish('pick_ammo', p, 64, 79)


# ---------------------------------------------------------------- build
os.makedirs(OUT, exist_ok=True)
G.clean()
report = {}; objs = []
for name, fn in ASSETS.items():
    if ONLY and name not in ONLY: continue
    o, info = fn()
    kids = [c for c in o.children_recursive]
    G.export_glb([o] + kids, os.path.join(OUT, o.name + '.glb'))
    report[o.name] = {'tris': G.tris(o) + sum(G.tris(k) for k in kids if k.type == 'MESH'), **info}
    objs.append(o)
for i, o in enumerate(objs): o.location.x = (i % 6) * 2.2; o.location.y = (i // 6) * 2.4
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'props.blend'))
for o in objs:
    G.preview([o] + [c for c in o.children_recursive if c.type == 'MESH'], os.path.join(OUT, 'previews', o.name + '.png'), yaw=30, pitch=20, res=(320, 320))
print('REPORT', report)
