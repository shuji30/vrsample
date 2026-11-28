import bpy, sys, bmesh
from mathutils import Vector, Matrix
argv = sys.argv[sys.argv.index('--')+1:]
src, out = argv[0], argv[1]
RATIO = float(argv[2]) if len(argv) > 2 else 0.35
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene
O = bpy.data.objects
def meshes_under(name):
    o = O.get(name)
    return [x for x in [o] + list(o.children_recursive) if x.type == 'MESH'] if o else []
groups = {}
for w in ['LF', 'RF', 'LR', 'RR']:
    groups['Wheel_' + w] = meshes_under('WHEEL_' + w)
    groups['Caliper_' + w] = meshes_under('SUSP_' + w)
groups['Steer'] = meshes_under('STEER_HR')
used = set(m.name for v in groups.values() for m in v)
groups['Body'] = [o for o in O if o.type == 'MESH' and o.name not in used]
centers = {}
for w in ['LF', 'RF', 'LR', 'RR']:
    centers[w] = O['WHEEL_' + w].matrix_world.translation.copy()
centers['Steer'] = O['STEER_HR'].matrix_world.translation.copy()
# 光り物の場所（確認用）
for o in groups['Body']:
    for s in o.material_slots:
        if s.material and any(k in s.material.name.lower() for k in ['light', 'red', 'amber']):
            ws = [o.matrix_world @ Vector(c) for c in o.bound_box]
            print('LIGHT', o.name, s.material.name, 'y', round(min(v.y for v in ws), 2), round(max(v.y for v in ws), 2), 'z', round(min(v.z for v in ws), 2), round(max(v.z for v in ws), 2))
# 実体化：親を外してワールドの形を焼き込み
bpy.ops.object.select_all(action='DESELECT')
allm = [o for v in groups.values() for o in v]
for o in allm:
    o.data = o.data.copy()
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
    o.data.transform(mw)
    o.matrix_world = Matrix.Identity(4)
# 空の物は消す
for o in [o for o in O if o.type != 'MESH']:
    bpy.data.objects.remove(o, do_unlink=True)
before = sum(len(o.data.polygons) for o in allm)
# ポリゴンを減らす（大きいものだけ）
for o in allm:
    n = len(o.data.polygons)
    if n > 2500:
        m = o.modifiers.new('dec', 'DECIMATE')
        m.ratio = max(RATIO, 2500 / n) if n < 7000 else RATIO
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier='dec')
after = sum(len(o.data.polygons) for o in allm)
print('POLYS', before, '->', after)
# ハンドルの回る軸：輪（Steer.001 = CSR2_Interior の輪）の頂点の主成分で一番ばらつきの小さい向き
rim = next(o for o in groups['Steer'] if o.name.startswith('Steer.'))
pts = [v.co.copy() for v in rim.data.vertices]
c = sum(pts, Vector()) / len(pts)
import numpy as np
A = np.array([[*(p - c)] for p in pts])
w_, V = np.linalg.eigh(A.T @ A)
nrm = Vector(V[:, 0])
if nrm.y < 0: nrm = -nrm   # 運転席のほう（Blender の +Y が後ろ）
print('STEER center', tuple(round(v, 4) for v in c), 'normal', tuple(round(v, 4) for v in nrm), 'radius', round(max((p - c).length for p in pts), 3))
centers['Steer'] = c
# 前のライトと後ろのライト（CSR2_Light は前後でひとつのメッシュ）を分ける
def split_light(o):
    for i, s in enumerate(o.material_slots):
        if s.material and s.material.name == 'CSR2_Light':
            head = s.material.copy(); head.name = 'LexusHead'
            tail = s.material.copy(); tail.name = 'LexusTail'
            o.data.materials.append(head); hi = len(o.data.materials) - 1
            o.data.materials.append(tail); ti = len(o.data.materials) - 1
            for p in o.data.polygons:
                if p.material_index == i and abs(p.center.y) > 1.5:
                    p.material_index = hi if p.center.y < 0 else ti
for o in groups['Body']:
    split_light(o)
# まとめる（グループごとに 1 つ）と、原点をそのグループの中心に
def join(name, objs, origin):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name; o.data.name = name
    if origin is not None:
        o.data.transform(Matrix.Translation(-origin))
        o.location = origin
    return o
res = {}
for k, objs in groups.items():
    if not objs: continue
    if k == 'Body': org = None
    elif k == 'Steer': org = centers['Steer']
    else: org = centers[k.split('_')[1]]
    res[k] = join(k, objs, org)
res['Steer']['axis'] = [nrm.x, nrm.z, -nrm.y]   # glTF の向き（Y が上、+Z が前）
# 使わない材質を外す
for o in res.values():
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.material_slot_remove_unused()
# テクスチャを縮める
for im in bpy.data.images:
    if im.size[0] == 0: continue
    m = max(im.size[:])
    lim = 1024 if any(k in im.name for k in ['baked_5', 'baked_6', 'baked_9', 'baked_7']) else 512
    if m > lim:
        f = lim / m
        im.scale(max(1, int(im.size[0] * f)), max(1, int(im.size[1] * f)))
for o in res.values():
    print('OBJ', o.name, len(o.data.polygons), [s.material.name for s in o.material_slots], tuple(round(v, 3) for v in o.location))
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_image_format='WEBP', export_extras=True, export_yup=True, export_apply=True, export_animations=False, export_draco_mesh_compression_enable=False)
