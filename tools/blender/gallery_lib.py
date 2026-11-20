"""Shared helpers for the Gallery asset builds (Blender 5.x, runs headless with `pip install bpy` or inside Blender).

Approach (after Gloomwood and Pigface): smooth-shaded low-poly shapes, one painted atlas per asset, detail painted by
3D position (so remodelling never reshuffles the paint), ambient occlusion baked with Cycles and multiplied in so
layers (clothing over skin, a lid over a box) read as layers. Textures are sampled with nearest filtering in the game.

Conventions: metres, Z up, the asset faces -Y (the glTF exporter turns that into +Z, the game's forward),
origin at the base centre on the ground.
"""
import math
import os
import bpy
import bmesh
import numpy as np
from mathutils import Vector, Matrix


# ---------------------------------------------------------------- scene
def clean():
    if bpy.context.object is not None and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.images, bpy.data.actions,
                 bpy.data.cameras, bpy.data.lights, bpy.data.curves):
        for b in list(coll): coll.remove(b)


def link(obj, coll=None):
    (coll or bpy.context.scene.collection).objects.link(obj); return obj


def select_only(*objs):
    for o in bpy.context.scene.objects:
        if o is not None: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def apply_modifiers(obj):
    select_only(obj)
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def mesh_obj(name, verts, faces, key=None):
    me = bpy.data.meshes.new(name); me.from_pydata([tuple(v) for v in verts], [], faces); me.update()
    o = link(bpy.data.objects.new(name, me))
    if key: set_key(o, key)
    return o


def set_key(obj, key):
    """A 'key' names the paint used for the faces; stored as a material slot so it survives joins."""
    m = bpy.data.materials.get('K_' + key) or bpy.data.materials.new('K_' + key)
    obj.data.materials.clear(); obj.data.materials.append(m)
    for p in obj.data.polygons: p.material_index = 0
    return obj


def smooth(obj, on=True):
    for p in obj.data.polygons: p.use_smooth = on


def join(objs, name):
    select_only(*objs); bpy.ops.object.join(); o = bpy.context.view_layer.objects.active; o.name = name; o.data.name = name
    return o


# ---------------------------------------------------------------- primitives (bmesh based, keyed)
def prim(name, kind, key, size=(1, 1, 1), loc=(0, 0, 0), rot=(0, 0, 0), segs=12, bevel=0.0, bevel_segs=2, smooth_angle=None):
    bm = bmesh.new()
    if kind == 'box':
        bmesh.ops.create_cube(bm, size=1.0)
    elif kind == 'cyl':
        bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=0.5, radius2=0.5, depth=1.0)
    elif kind == 'sphere':
        bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=max(4, segs // 2), radius=0.5)
    elif kind == 'torus':
        # major radius 0.5, minor radius from size[2] relative
        r1, r2 = 0.5, size[2] / max(size[0], 1e-6) * 0.5
        size = (size[0], size[1], size[0])
        vs = []
        n1, n2 = segs, 6
        for i in range(n1):
            a = 2 * math.pi * i / n1
            for j in range(n2):
                b = 2 * math.pi * j / n2
                vs.append(bm.verts.new(((r1 + r2 * math.cos(b)) * math.cos(a), (r1 + r2 * math.cos(b)) * math.sin(a), r2 * math.sin(b))))
        for i in range(n1):
            for j in range(n2):
                a, b, c, d = vs[i * n2 + j], vs[((i + 1) % n1) * n2 + j], vs[((i + 1) % n1) * n2 + (j + 1) % n2], vs[i * n2 + (j + 1) % n2]
                bm.faces.new((a, b, c, d))
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = link(bpy.data.objects.new(name, me)); o.location = loc; o.rotation_euler = rot
    set_key(o, key)
    if bevel > 0:
        b = o.modifiers.new('bev', 'BEVEL'); b.width = bevel; b.segments = bevel_segs; b.limit_method = 'ANGLE'
    apply_modifiers(o)
    select_only(o); bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    smooth(o, kind in ('cyl', 'sphere', 'torus') or bevel > 0)
    return o


def loft(name, rings, key, cap0=True, cap1=True):
    """rings: list of lists of 3D points (equal length). Smooth quads, capped."""
    n = len(rings[0]); verts = [p for r in rings for p in r]; faces = []
    for i in range(len(rings) - 1):
        for j in range(n):
            a, b = i * n + j, i * n + (j + 1) % n
            faces.append((a, b, b + n, a + n))
    if cap0: faces.append(tuple(range(n - 1, -1, -1)))
    if cap1: faces.append(tuple(range((len(rings) - 1) * n, len(rings) * n)))
    o = mesh_obj(name, verts, faces, key)
    select_only(o); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
    smooth(o); return o


def ring(c, rx, ry, n=12, z=None, rot=0.0):
    cx, cy, cz = c
    return [Vector((cx + rx * math.cos(rot + 2 * math.pi * i / n), cy + ry * math.sin(rot + 2 * math.pi * i / n), cz)) for i in range(n)]


# ---------------------------------------------------------------- noise (deterministic, by position)
def _hash(ix, iy, iz, seed):
    h = np.sin(ix * 12.9898 + iy * 78.233 + iz * 37.719 + seed * 4.123) * 43758.5453
    return h - np.floor(h)


def vnoise(P, scale, seed=0.0):
    """Smooth value noise, trilinear. P (..., 3) in metres."""
    p = P * scale; i = np.floor(p); f = p - i; f = f * f * (3 - 2 * f)
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (f[..., 0] if dx else 1 - f[..., 0]) * (f[..., 1] if dy else 1 - f[..., 1]) * (f[..., 2] if dz else 1 - f[..., 2])
                out = out + w * _hash(i[..., 0] + dx, i[..., 1] + dy, i[..., 2] + dz, seed)
    return out


def fbm(P, scale, seed=0.0, oct=3):
    s, a, t, n = scale, 1.0, 0.0, 0.0
    for k in range(oct):
        t += a * vnoise(P, s, seed + k * 7.1); n += a; s *= 2.1; a *= 0.5
    return t / n


def displace(obj, fn):
    """Move every vertex: fn(co: Vector) -> Vector offset."""
    for v in obj.data.vertices: v.co += fn(v.co.copy())
    obj.data.update()


# ---------------------------------------------------------------- paint pipeline
def unwrap(obj, margin=0.006, angle=60, emphasis=None):
    """Smart project. emphasis(face_centre) -> scale lets important areas (a face) take more texels; islands are repacked."""
    select_only(obj)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    if emphasis:
        me = obj.data; uv = me.uv_layers.active.data
        bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
        lay = bm.loops.layers.uv.active
        # scale each island about its own centre (islands = connected UV regions; approximate per face group by key on centre)
        from collections import defaultdict
        isl = bmesh_islands(bm, lay)
        for faces in isl:
            c = sum((f.calc_center_median() for f in faces), Vector()) / len(faces); k = emphasis(c)
            if abs(k - 1) < 1e-3: continue
            uvs = [l[lay].uv for f in faces for l in f.loops]; cu = sum((u for u in uvs), Vector((0, 0))) / len(uvs)
            for f in faces:
                for l in f.loops: l[lay].uv = cu + (l[lay].uv - cu) * k
        bm.to_mesh(me); bm.free()
        select_only(obj); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.select_all(action='SELECT'); bpy.ops.uv.pack_islands(margin=margin, rotate=True)
        bpy.ops.object.mode_set(mode='OBJECT')


def bmesh_islands(bm, lay):
    """Faces grouped into UV islands (faces sharing a UV-coincident edge)."""
    seen = set(); out = []
    for f0 in bm.faces:
        if f0.index in seen: continue
        stack = [f0]; grp = []; seen.add(f0.index)
        while stack:
            f = stack.pop(); grp.append(f)
            for l in f.loops:
                for lo in l.edge.link_loops:
                    g = lo.face
                    if g.index in seen: continue
                    # same island if the shared edge has the same UVs on both sides
                    a1, a2 = l[lay].uv, l.link_loop_next[lay].uv
                    b1, b2 = lo[lay].uv, lo.link_loop_next[lay].uv
                    if ((a1 - b2).length < 1e-5 and (a2 - b1).length < 1e-5) or ((a1 - b1).length < 1e-5 and (a2 - b2).length < 1e-5):
                        seen.add(g.index); stack.append(g)
        out.append(grp)
    return out


def sharp_edges(obj, angle_deg=25):
    """Set of edge keys whose two faces meet at more than angle_deg (or open edges)."""
    me = obj.data; lim = math.cos(math.radians(angle_deg)); faces_of = {}
    for p in me.polygons:
        for k in p.edge_keys: faces_of.setdefault(k, []).append(p.index)
    out = set()
    for k, fs in faces_of.items():
        if len(fs) != 2 or me.polygons[fs[0]].normal.dot(me.polygons[fs[1]].normal) < lim: out.add(k)
    return out


def raster(obj, size, edges=True):
    """Per texel: world position P, smooth normal N, key index K (-1 = empty) and ED, the distance in metres to the
    nearest sharp edge of the polygon (drives worn edges)."""
    me = obj.data
    uvd = me.uv_layers.active.data
    co = np.array([v.co[:] for v in me.vertices], np.float32)
    lno = np.array([l.normal[:] for l in me.loops], np.float32)
    sharp = sharp_edges(obj) if edges else set()
    P = np.zeros((size, size, 3), np.float32); N = np.zeros((size, size, 3), np.float32); K = -np.ones((size, size), np.int32)
    ED = np.full((size, size), 9.0, np.float32)
    for poly in me.polygons:
        L = list(poly.loop_indices); vi = [me.loops[l].vertex_index for l in L]
        uv = np.array([[uvd[l].uv.x * size, (1 - uvd[l].uv.y) * size] for l in L]); pos = co[vi]; nrm = lno[L]
        x0 = int(max(0, math.floor(uv[:, 0].min() - 1))); x1 = int(min(size, math.ceil(uv[:, 0].max() + 1)))
        y0 = int(max(0, math.floor(uv[:, 1].min() - 1))); y1 = int(min(size, math.ceil(uv[:, 1].max() + 1)))
        if x1 <= x0 or y1 <= y0: continue
        xs, ys = np.meshgrid(np.arange(x0, x1) + .5, np.arange(y0, y1) + .5); pts = np.stack([xs, ys], -1)
        filled = np.zeros(xs.shape, bool); pp = np.zeros(xs.shape + (3,), np.float32); nn = np.zeros(xs.shape + (3,), np.float32)
        for k in range(1, len(L) - 1):
            a, b, c = uv[0], uv[k], uv[k + 1]; v0 = b - a; v1 = c - a; v2 = pts - a
            d00 = v0 @ v0; d01 = v0 @ v1; d11 = v1 @ v1; den = d00 * d11 - d01 * d01
            if abs(den) < 1e-9: continue
            d20 = v2 @ v0; d21 = v2 @ v1
            bv = (d11 * d20 - d01 * d21) / den; bw = (d00 * d21 - d01 * d20) / den; bu = 1 - bv - bw
            mk = (bu >= -.03) & (bv >= -.03) & (bw >= -.03) & ~filled
            if mk.any():
                pp[mk] = bu[mk, None] * pos[0] + bv[mk, None] * pos[k] + bw[mk, None] * pos[k + 1]
                nn[mk] = bu[mk, None] * nrm[0] + bv[mk, None] * nrm[k] + bw[mk, None] * nrm[k + 1]
                filled |= mk
        if not filled.any(): continue
        ed = np.full(xs.shape, 9.0, np.float32)
        for i in range(len(L)):
            j = (i + 1) % len(L); key = tuple(sorted((vi[i], vi[j])))
            if key not in sharp: continue
            p0, q0 = uv[i], uv[j]; e = q0 - p0; ll = e @ e
            if ll < 1e-9: continue
            t = np.clip(((pts - p0) @ e) / ll, 0, 1); dpx = np.linalg.norm(pts - (p0 + t[..., None] * e), axis=-1)
            m_per_px = np.linalg.norm(pos[j] - pos[i]) / math.sqrt(ll)
            ed = np.minimum(ed, dpx * m_per_px)
        sl = (slice(y0, y1), slice(x0, x1))
        P[sl][filled] = pp[filled]; N[sl][filled] = nn[filled]; K[sl][filled] = poly.material_index; ED[sl][filled] = ed[filled]
    n = np.linalg.norm(N, axis=-1, keepdims=True); N = N / np.maximum(n, 1e-6)
    return P, N, K, ED


def dilate(arr, valid, iters=8):
    arr = arr.copy(); valid = valid.copy()
    for _ in range(iters):
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sh = np.roll(arr, (dy, dx), (0, 1)); sv = np.roll(valid, (dy, dx), (0, 1))
            m = (~valid) & sv; arr[m] = sh[m]; valid = valid | m
    return arr


def bake_ao(obj, size, samples=48, distance=0.25):
    """Cycles ambient occlusion into a (size, size) float array (1 = open, 0 = occluded). Needs UVs."""
    sc = bpy.context.scene; prev = sc.render.engine
    sc.render.engine = 'CYCLES'; sc.cycles.samples = samples; sc.cycles.device = 'CPU'
    try: sc.world.light_settings.distance = distance
    except Exception: pass
    img = bpy.data.images.new(obj.name + '_ao_tmp', size, size, alpha=False, float_buffer=True)
    mats = [s.material for s in obj.material_slots]
    nodes_added = []
    for m in mats:
        if m is None: continue
        m.use_nodes = True
        n = m.node_tree.nodes.new('ShaderNodeTexImage'); n.image = img; m.node_tree.nodes.active = n; nodes_added.append((m, n))
    select_only(obj)
    sc.render.bake.margin = 4
    others = [o for o in sc.objects if o.type == 'MESH' and o is not obj and not o.hide_render]
    for o in others: o.hide_render = True          # other assets sharing the origin must not occlude this one
    bpy.ops.object.bake(type='AO', use_clear=True)
    for o in others: o.hide_render = False
    a = np.array(img.pixels[:], np.float32).reshape(size, size, 4)[..., 0]
    for m, n in nodes_added: m.node_tree.nodes.remove(n)
    bpy.data.images.remove(img); sc.render.engine = prev
    return np.flipud(a)


def write_png(arr, path, name):
    h, w, _ = arr.shape
    rgba = np.concatenate([np.flipud(np.clip(arr, 0, 1)), np.ones((h, w, 1), np.float32)], 2).astype(np.float32)
    img = bpy.data.images.new(name, w, h, alpha=False); img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = path; img.file_format = 'PNG'; img.save()
    return img


def final_material(name, img, roughness=0.85):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); bs = nt.nodes.new('ShaderNodeBsdfPrincipled'); t = nt.nodes.new('ShaderNodeTexImage')
    t.image = img; t.interpolation = 'Closest'; nt.links.new(t.outputs['Color'], bs.inputs['Base Color'])
    bs.inputs['Roughness'].default_value = roughness; bs.inputs['Metallic'].default_value = 0.0
    nt.links.new(bs.outputs['BSDF'], out.inputs['Surface'])
    return m


def paint_and_bake(obj, size, painter, out_dir, ao_strength=0.85, ao_samples=48, ao_distance=0.25, emphasis=None):
    """Unwrap, rasterize, call painter(P, N, K, keys) -> (size, size, 3) colour, multiply baked AO, save, assign."""
    unwrap(obj, emphasis=emphasis)
    keys = [s.material.name[2:] if s.material else '' for s in obj.material_slots]
    P, N, K, S = raster(obj, size)
    valid = K >= 0
    import inspect
    if 'edges' in inspect.signature(painter).parameters: col = painter(P, N, K, keys, edges=lambda: S)
    else: col = painter(P, N, K, keys)
    ao = bake_ao(obj, size, ao_samples, ao_distance)
    if os.environ.get('GALLERY_DEBUG'):
        for i, k in enumerate(keys):
            mk = K == i
            if mk.any(): print('KEY', obj.name, k, int(mk.sum()), np.round(col[mk].mean(0), 2), 'ao', round(float(ao[mk].mean()), 2))
        write_png(np.repeat(ao[..., None], 3, 2), os.path.join(out_dir, obj.name + '_ao.png'), obj.name + '_aodbg')
    ao = 1 - ao_strength * (1 - np.clip(ao, 0, 1))
    col = col * ao[..., None]
    col = dilate(col, valid)
    os.makedirs(os.path.join(out_dir, 'textures'), exist_ok=True)
    img = write_png(col, os.path.join(out_dir, 'textures', obj.name + '.png'), obj.name + '_tex')
    mat = final_material('M_' + obj.name, img)
    obj.data.materials.clear(); obj.data.materials.append(mat)
    return {'tex': size, 'cover': round(float(valid.mean()), 2)}


def mask_key(K, keys, *names):
    ids = [i for i, k in enumerate(keys) if k in names]
    return np.isin(K, ids)


def export_glb(objs, path, skins=False):
    select_only(*objs)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=False, export_yup=True,
                              export_animations=False, export_skins=skins, export_image_format='AUTO')
    return path


def tris(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


# ---------------------------------------------------------------- preview renders
def preview(objs, path, yaw=25, pitch=8, res=(512, 640), lens=60, target=None, dist=None, light=1.0):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.samples = 24; sc.cycles.device = 'CPU'
    sc.render.resolution_x, sc.render.resolution_y = res
    if sc.world is None: sc.world = bpy.data.worlds.new('W')
    sc.world.use_nodes = True; bg = sc.world.node_tree.nodes.get('Background')
    if bg: bg.inputs['Color'].default_value = (0.05, 0.06, 0.06, 1); bg.inputs['Strength'].default_value = 1.0
    for n in ('PvCam', 'PvKey', 'PvRim'):
        if n in bpy.data.objects: bpy.data.objects.remove(bpy.data.objects[n], do_unlink=True)
    cam = link(bpy.data.objects.new('PvCam', bpy.data.cameras.new('PvCam'))); cam.data.lens = lens; sc.camera = cam
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c); lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    ctr = target or (lo + hi) / 2; r = dist or (hi - lo).length * 1.25
    a, p = math.radians(yaw), math.radians(pitch)
    cam.location = ctr + Vector((math.sin(a) * math.cos(p), -math.cos(a) * math.cos(p), math.sin(p))) * r
    cam.rotation_euler = (ctr - cam.location).to_track_quat('-Z', 'Y').to_euler()
    key = link(bpy.data.objects.new('PvKey', bpy.data.lights.new('PvKey', 'AREA'))); key.data.energy = 300 * light; key.data.size = 1.5; key.data.color = (1, .85, .65)
    key.location = ctr + Vector((1.6, -2.2, 1.4)); key.rotation_euler = (ctr - key.location).to_track_quat('-Z', 'Y').to_euler()
    rim = link(bpy.data.objects.new('PvRim', bpy.data.lights.new('PvRim', 'AREA'))); rim.data.energy = 180 * light; rim.data.size = 1.0; rim.data.color = (.6, .8, .85)
    rim.location = ctr + Vector((-1.8, 2.0, 1.2)); rim.rotation_euler = (ctr - rim.location).to_track_quat('-Z', 'Y').to_euler()
    hidden = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o not in objs]
    for o in hidden: o.hide_render = True
    sc.render.filepath = path; os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.render.render(write_still=True)
    for o in hidden: o.hide_render = False
    for n in ('PvCam', 'PvKey', 'PvRim'): bpy.data.objects.remove(bpy.data.objects[n], do_unlink=True)
    return path
