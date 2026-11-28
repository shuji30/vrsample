import bpy, sys
from mathutils import Vector, Matrix
import numpy as np
argv = sys.argv[sys.argv.index('--')+1:]
src, out = argv[0], argv[1]
RATIO = float(argv[2]) if len(argv) > 2 else 0.35
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
O = bpy.data.objects
P = 'TwiXeR_992_'
def top(name): return O.get(P + name)
def meshes_under(o): return [x for x in [o] + list(o.children_recursive) if x.type == 'MESH']
# 重なっている別バージョン・見えない下回りを捨てる
DROP = ['chrome_dash_accessories', 'door_L_chrome_end', 'door_R_chrome_end', 'exhausttip_3_chrome', 'dash_noclock', 'needle_tacho',
        'muffler_custom', 'shifter_base_M', 'shifter_boot_M', 'shifter_knob_M', 'clutchpedal', 'halfshaft_e_F', 'halfshaft_e_R',
        'brakelines', 'coolantlines', 'fuellines', 'fueltank', 'driveshaft', 'diff_F', 'steeringbox', 'heatshield', 'intake_TT']
for n in DROP:
    o = top(n)
    if o is None: print('MISSING', n); continue
    for x in [o] + list(o.children_recursive): bpy.data.objects.remove(x, do_unlink=True)
roots = [o for o in O if o.parent and o.parent.name == 'RootNode']
def center(objs):
    mn = Vector((1e9,)*3); mx = Vector((-1e9,)*3)
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c); mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
    return (mn + mx) / 2, mn, mx
# 車輪：タイヤ（Object_4.*）の中心を四隅の中心にして、ホイール・ディスクをいちばん近い隅へ
tires = [o for o in roots if o.name.startswith('Object_4')]
corners = {}
for t in tires:
    c, mn, mx = center(meshes_under(t))
    k = ('L' if c.x > 0 else 'R') + ('F' if c.y < 0 else 'R')
    corners[k] = c
    print('TIRE', k, tuple(round(v, 3) for v in c), 'radius', round((mx.z - mn.z) / 2, 3))
groups = {'Wheel_' + k: [] for k in corners}
for o in roots:
    if o.name.startswith('Object_4') or 'chrome_wheels' in o.name or 'brakedisc' in o.name:
        c, _, _ = center(meshes_under(o))
        k = min(corners, key=lambda kk: (corners[kk] - c).length)
        groups['Wheel_' + k] += meshes_under(o)
steer_root = top('steer_3')
groups['Steer'] = meshes_under(steer_root)
used = set(m.name for v in groups.values() for m in v)
groups['Body'] = [o for o in O if o.type == 'MESH' and o.name not in used]
head_objs = set(m.name for n in ['headlight_L_led', 'headlight_R_led'] for m in meshes_under(top(n)))
tail_objs = set(m.name for n in ['fascia_glass', 'fascia_mid'] for m in meshes_under(top(n)))
mir = [o for o in groups['Body'] if 'mirror.001' in o.name]
for o in mir:
    c, mn, mx = center([o]); print('ROOMMIRROR', o.name, tuple(round(v, 3) for v in mn), tuple(round(v, 3) for v in mx))
for k in ['seat_FL', 'windshield', 'gt3rs_carbon_roof', 'dash_9000', 'gauges_screen', 'needle_tacho_9000']:
    c, mn, mx = center(meshes_under(top(k))); print('PART', k, tuple(round(v, 3) for v in mn), tuple(round(v, 3) for v in mx))
allm = [o for v in groups.values() for o in v]
# ライトの材質を、車ごとの名前の写しに
for o in allm:
    pre = 'CarHead_' if o.name in head_objs else 'CarTail_' if o.name in tail_objs else None
    if not pre: continue
    for s in o.material_slots:
        if s.material and not s.material.name.startswith(pre):
            m = s.material.copy(); m.name = pre + s.material.name; s.material = m
# 親を外してワールドの形を焼き込む
mws = {o.name: o.matrix_world.copy() for o in allm}
for o in allm:
    o.data = o.data.copy()
    o.parent = None
    o.data.transform(mws[o.name]); o.matrix_world = Matrix.Identity(4)
for o in [o for o in O if o.type != 'MESH']: bpy.data.objects.remove(o, do_unlink=True)
# 地面（タイヤの下）を 0 に
low = min(v.co.z for o in allm for v in o.data.vertices)
for o in allm: o.data.transform(Matrix.Translation((0, 0, -low)))
for k in corners: corners[k].z -= low
print('LIFT', round(-low, 3))
before = sum(len(o.data.polygons) for o in allm)
for o in allm:
    n = len(o.data.polygons)
    if n > 600:
        m = o.modifiers.new('dec', 'DECIMATE'); m.ratio = max(RATIO, 600 / n)
        bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier='dec')
print('POLYS', before, '->', sum(len(o.data.polygons) for o in allm))
# ハンドル：輪の面の向き（主成分で一番ばらつきの小さい向き）と、中心（形の箱の真ん中）
pts = [v.co.copy() for o in groups['Steer'] for v in o.data.vertices]
vs = [v.co for o in groups['Steer'] for v in o.data.vertices]
mn = Vector([min(v[i] for v in vs) for i in range(3)]); mx = Vector([max(v[i] for v in vs) for i in range(3)]); c = (mn + mx) / 2
A = np.array([[*(p - c)] for p in pts]); _, V = np.linalg.eigh(A.T @ A)
nrm = Vector(V[:, 0])
if nrm.y < 0: nrm = -nrm
print('STEER center', tuple(round(v, 4) for v in c), 'normal', tuple(round(v, 4) for v in nrm), 'size', tuple(round(v, 3) for v in (mx - mn)))
def join(name, objs, origin):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active; o.name = name; o.data.name = name
    if origin is not None:
        o.data.transform(Matrix.Translation(-origin)); o.location = origin
    return o
res = {}
for k, objs in groups.items():
    org = None if k == 'Body' else c if k == 'Steer' else corners[k.split('_')[1]]
    res[k] = join(k, objs, org)
res['Steer']['axis'] = [nrm.x, nrm.z, -nrm.y]
for o in res.values():
    bpy.context.view_layer.objects.active = o; bpy.ops.object.material_slot_remove_unused()
for im in list(bpy.data.images):
    if im.size[0] == 0: continue
    if im.depth < 24:
        # 8 ビットの画像は WebP に書けないので、普通の RGBA に写す
        new = bpy.data.images.new(im.name + '_rgba', im.size[0], im.size[1], alpha=True)
        new.pixels = im.pixels[:]
        new.colorspace_settings.name = im.colorspace_settings.name
        im.user_remap(new)
        im = new
    m = max(im.size[:])
    if m > 1024:
        f = 1024 / m; im.scale(max(1, int(im.size[0] * f)), max(1, int(im.size[1] * f)))
for o in res.values():
    print('OBJ', o.name, len(o.data.polygons), len(o.material_slots), tuple(round(v, 3) for v in o.location))
print('MATS', sorted(set(s.material.name for o in res.values() for s in o.material_slots if s.material)))
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_image_format='WEBP', export_extras=True, export_yup=True, export_apply=True, export_animations=False)
