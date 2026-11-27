# 5 人目（ワンピース 2）の手の大きさを合わせる（Blender の中で exec する）。シェイプキー custom-hand を作り直し、手と指の骨も縮める。
#   手首から中指の先までを、あご先から眉までの長さにする（手が大きすぎた）。手首（Hand の骨の根元）を中心に一様に縮める。
#   肌は、手と指の骨の重みの割合で動かす（手首のまわりは前腕となじむ）。
#   骨は縮めた量を Girl_Rig["hand_scale"] に覚え、2 回目以降は差だけ縮める（何度流してもよい）
import bpy
import numpy as np
from mathutils import Vector
ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks; rig = bpy.data.objects["Girl_Rig"]
was = rig.data.pose_position; rig.data.pose_position = 'REST'
k0 = kb.get("custom-hand")
if k0: k0.value = 0.0
mods = [m_ for m_ in ob.modifiers if m_.type in ('MASK', 'SUBSURF')]; st = [m_.show_viewport for m_ in mods]
for m_ in mods: m_.show_viewport = False
bpy.context.view_layer.update()
ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
n = len(m.vertices); co = np.zeros(n*3); m.vertices.foreach_get("co", co); co = co.reshape(n, 3); ev.to_mesh_clear()
for m_, s_ in zip(mods, st): m_.show_viewport = s_
names = {g.index: g.name for g in ob.vertex_groups}
HK = ("Hand", "Thumb", "Index", "Middle", "Ring", "Little")
bodyg = {ob.vertex_groups["body"].index, ob.vertex_groups["hidden_by_clothes"].index}
real = np.array([any(g.group in bodyg and g.weight > 0.5 for g in v.groups) for v in me.vertices])
# 目標：あご先〜眉
cl = real & (np.abs(co[:, 0]) < 0.006); top = co[real][:, 2].max()
nz = cl & (co[:, 2] > top-0.17) & (co[:, 2] < top-0.08); ym0 = co[nz][:, 1].min(); zn = co[nz][np.argmin(co[nz][:, 1]), 2]
zz = zn-0.005
while zz > top-0.32:
    s = cl & (np.abs(co[:, 2]-zz) < 0.002)
    if s.any() and co[s][:, 1].min() > ym0+0.045: break
    zz -= 0.002
chin = zz+0.002
br = bpy.data.objects["Girl_Brows"]; e = br.evaluated_get(bpy.context.evaluated_depsgraph_get()); bm_ = e.to_mesh()
brow = float(np.mean([(br.matrix_world @ v.co).z for v in bm_.vertices])); e.to_mesh_clear()
TARGET = globals().get("TARGET", brow-chin)
D = np.zeros((n, 3)); info = {}
for side in ("left", "right"):
    W = np.array(rig.data.bones[side+"Hand"].head_local)
    hw = np.zeros(n)
    for v in me.vertices:
        tot = sum(g.weight for g in v.groups if names[g.group] in rig.data.bones)
        if tot > 1e-6: hw[v.index] = sum(g.weight for g in v.groups if names[g.group].startswith(side) and any(k in names[g.group] for k in HK))/tot
    hand = hw > 0.5
    L = np.linalg.norm(co[hand]-W, axis=1).max(); k = TARGET/L; info[side] = (L, k)
    D += (co-W)*(k-1)*hw[:, None]
B0 = np.zeros(n*3); kb["Basis"].data.foreach_get("co", B0)
kh = k0 or ob.shape_key_add(name="custom-hand", from_mix=False)
kh.data.foreach_set("co", (B0.reshape(n, 3)+D).ravel()); kh.value = 1.0; me.update()
# 骨：今までに縮めた量との差だけ
prev = float(rig.get("hand_scale", 1.0)); kk = info["left"][1]; rel = kk/prev
vl = bpy.context.view_layer; _hid = (rig.hide_viewport, rig.hide_get()); rig.hide_viewport = False; rig.hide_set(False)
for o in vl.objects: o.select_set(False)
rig.select_set(True); vl.objects.active = rig; bpy.ops.object.mode_set(mode='EDIT')
eb = rig.data.edit_bones
for side in ("left", "right"):
    W = eb[side+"Hand"].head.copy()
    for b in eb:
        if b.name.startswith(side) and any(k in b.name for k in HK):
            b.head = W+(b.head-W)*rel; b.tail = W+(b.tail-W)*rel
bpy.ops.object.mode_set(mode='OBJECT'); rig.hide_viewport = _hid[0]; rig.hide_set(_hid[1])
rig["hand_scale"] = kk; rig.data.pose_position = was
print("hand: chin->brow", round(brow-chin, 4), {s: (round(L, 4), round(k, 3)) for s, (L, k) in info.items()})
