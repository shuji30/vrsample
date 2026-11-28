# カート（"Modular Go-kart" by Jungle Jim、CC BY 4.0
#   https://sketchfab.com/3d-models/modular-go-kart-35ed6acb8016410d9b2a32d41ef2ca54）を、src/kart.js が読む形に組み直す。
#   blender -b --factory-startup --python blender/cars/build_kart.py -- models/modular_go-kart.glb models/kart.glb 0.25
#
# - 部品を Body・Wheel_LF/RF/LR/RR（原点が車輪の中心）・Steer（原点がハンドルの輪の中心。extras の axis が回る軸＝運転席のほう）にまとめる
# - 原点を後輪の車軸の真ん中の地面に（src/kart.js のカートのローカル座標と同じ。前が +Z、左が +X）
# - 赤い塗装の材質は KartPaint_* という名前にし、テクスチャの赤い所を明るい灰色に抜く（ゲームで材質の色を掛けて青・ピンクに塗る）
# - ポリゴンを減らし（3 つ目の数字の割合。大きな部品だけ）、テクスチャを縮めて書き出す（4 つ目で画像の形式。既定は AUTO）
import bpy, sys
import numpy as np
from mathutils import Vector, Matrix
argv = sys.argv[sys.argv.index('--')+1:]
src, out = argv[0], argv[1]
RATIO = float(argv[2]) if len(argv) > 2 else 0.25
FMT = argv[3] if len(argv) > 3 else 'AUTO'   # 画像の形式。WEBP では一色の画像の写し（書き出しが作る .001）が保存できずに落ちた
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
O = bpy.data.objects
def obj(prefix):
    return next(o for o in O if o.type == 'MESH' and o.name.startswith(prefix + '_gameasset'))

# 元のモデルは Blender の -Y が前、+X が左、Z が上。車輪：root.4/5 が前（+X/-X）、root.2/3 が後ろ（+X/-X）
groups = {'Wheel_LF': [obj('root.4')], 'Wheel_RF': [obj('root.5')], 'Wheel_LR': [obj('root.2')], 'Wheel_RR': [obj('root.3')],
          'Steer': [obj('Steering_Wheel_Sport_Car_blinn1_0')]}
used = {o.name for v in groups.values() for o in v}
groups['Body'] = [o for o in O if o.type == 'MESH' and o.name not in used]
# 塗装（赤い材質）。テクスチャの平均が赤いもの
PAINT = ('root.0.0', 'root.0.1', 'root.0.2', 'root.0.3', 'root.6', 'root.7', 'Steering_Wheel_Sport_Car_blinn1_0')

# 実体化：親を外してワールドの形を焼き込む
allm = [o for v in groups.values() for o in v]
for o in allm:
    o.data = o.data.copy()
    mw = o.matrix_world.copy()
    o.parent = None
    o.data.transform(mw)
    o.matrix_world = Matrix.Identity(4)
for o in [o for o in O if o.type != 'MESH']:
    bpy.data.objects.remove(o, do_unlink=True)

def bbox(objs):
    ws = [v.co for o in objs for v in o.data.vertices]
    return Vector((min(v.x for v in ws), min(v.y for v in ws), min(v.z for v in ws))), Vector((max(v.x for v in ws), max(v.y for v in ws), max(v.z for v in ws)))
centers = {}
for k in ('Wheel_LF', 'Wheel_RF', 'Wheel_LR', 'Wheel_RR'):
    mn, mx = bbox(groups[k]); centers[k] = (mn+mx)/2
    print('WHEEL', k, 'center', tuple(round(v, 4) for v in centers[k]), 'radius', round((mx.z-mn.z)/2, 4), 'width', round(mx.x-mn.x, 4))
# 原点：後輪の車軸の真ん中の地面
rear_y = (centers['Wheel_LR'].y+centers['Wheel_RR'].y)/2
ground = min(bbox(groups['Wheel_LR'] + groups['Wheel_RR'] + groups['Wheel_LF'] + groups['Wheel_RF'])[0].z, 0.0)
shift = Matrix.Translation((0, -rear_y, -ground))
for o in allm: o.data.transform(shift)
for k in centers: centers[k] = shift @ centers[k]

before = sum(len(o.data.polygons) for o in allm)
for o in allm:
    n = len(o.data.polygons)
    if n > 2000:
        m = o.modifiers.new('dec', 'DECIMATE'); m.ratio = max(RATIO, 2000/n)
        bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier='dec')
print('POLYS', before, '->', sum(len(o.data.polygons) for o in allm))

# ハンドル：輪の面の向き（頂点の主成分でばらつきの一番小さい向き）と中心。中心は輪の頂点（中心から遠い 6 割）の平均
steer = groups['Steer'][0]
P = np.array([v.co[:] for v in steer.data.vertices])
c = P.mean(0); A = P-c
w_, V = np.linalg.eigh(A.T@A); nrm = V[:, 0]
if nrm[1] < 0: nrm = -nrm   # 運転席のほう（Blender の +Y が後ろ）
d = np.linalg.norm(A-np.outer(A@nrm, nrm), axis=1)
rim = P[d > np.quantile(d, 0.4)]
c = rim.mean(0)
print('STEER center', np.round(c, 4).tolist(), 'normal', np.round(nrm, 4).tolist(), 'radius', round(float(np.quantile(d, 0.95)), 3))
centers['Steer'] = Vector(c.tolist())

# 塗装のテクスチャ：赤い所（r が g・b より十分大きい）を、明るさを保った灰色に。ゲームで色を掛ける
done = set()
for o in allm:
    for s in o.material_slots:
        m = s.material
        if not m or not any(m.name.startswith(p + '_gameasset') for p in PAINT): continue
        m.name = 'KartPaint_' + m.name.split('_gameasset')[0]
        b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        lk = b.inputs['Base Color'].links
        if not lk: continue
        im = lk[0].from_node.image
        if im.name in done: continue
        done.add(im.name)
        a = np.array(im.pixels[:], np.float32).reshape(-1, 4)
        r, g, bl = a[:, 0], a[:, 1], a[:, 2]
        red = np.clip((r-np.maximum(g, bl)*1.6)/0.15, 0, 1)        # 赤らしさ 0〜1
        lum = np.clip(r/0.75, 0, 1)*0.92+0.04                        # 赤の明るさ → 灰色（いちばん明るい赤がほぼ白）
        for ch in range(3): a[:, ch] = a[:, ch]*(1-red)+lum*red
        im.pixels = a.ravel()
        print('PAINT', m.name, 'red share', round(float((red > 0.5).mean()), 3))

def join(name, objs, origin):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name; o.data.name = name
    if origin is not None:
        o.data.transform(Matrix.Translation(-origin)); o.location = origin
    return o
res = {k: join(k, objs, None if k == 'Body' else centers[k]) for k, objs in groups.items()}
res['Steer']['axis'] = [float(nrm[0]), float(nrm[2]), float(-nrm[1])]   # glTF の向き（Y が上、+Z が前）
for o in res.values():
    bpy.context.view_layer.objects.active = o; bpy.ops.object.material_slot_remove_unused()

# テクスチャを縮める（色は 1024、凹凸などは 512）
for im in bpy.data.images:
    if im.size[0] == 0: continue
    lim = 1024 if any(im.name == n.image.name for m in bpy.data.materials if m.node_tree for n in m.node_tree.nodes
                      if n.type == 'TEX_IMAGE' and n.image and any(l.to_socket.name == 'Base Color' for l in n.outputs[0].links)) else 512
    mm = max(im.size[:])
    if mm > lim: f = lim/mm; im.scale(max(1, int(im.size[0]*f)), max(1, int(im.size[1]*f)))
for o in res.values():
    print('OBJ', o.name, len(o.data.polygons), [s.material.name for s in o.material_slots][:6], tuple(round(v, 3) for v in o.location))
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_image_format=FMT, export_extras=True, export_yup=True,
                          export_apply=True, export_animations=False, export_draco_mesh_compression_enable=False)
