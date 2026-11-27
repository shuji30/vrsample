# 5 人目（ワンピース 2）のヒールの高さを変える（Blender の中で exec する。何度流してもよい）。
#   体のシェイプキー custom-heel（足をつま先立ちにして体を持ち上げる）を HEEL にし、変わったぶんだけ
#   骨組みの骨・頭に付く物（眉・まつ毛・歯・口の中・髪・カチューシャ）・値（heel_shift・head_small）を動かす。
#   骨は、まわりの肌の頂点が動いた量（近い 8 頂点の平均）で動かす（キーは肌しか動かさないので、骨がずれると脚がゆがむ）。
#   heel_shift（体が靴で持ち上がったぶん）も同じだけ動かすので、はだしの身長（てっぺん－heel_shift）は変わらない。
#   流したあとは、髪・服・飾り・カチューシャを流し直す
import bpy
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree
HEEL = globals().get("HEEL", 3.0)
ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks; rig = bpy.data.objects["Girl_Rig"]
KEY = globals().get("KEY", "custom-heel")                       # 動かすキー（custom-foot-tilt にも使う）
kh = kb[KEY]; v0 = kh.value
if abs(HEEL-v0) < 1e-6: print("heel: no change", v0)
n = len(me.vertices)
def co_of(k): a = np.zeros(n*3); k.data.foreach_get("co", a); return a.reshape(n, 3)
D = (co_of(kh)-co_of(kb["Basis"]))*(HEEL-v0)                      # 肌が動く量（基本の姿勢で）
was = rig.data.pose_position; rig.data.pose_position = 'REST'
mods = [m_ for m_ in ob.modifiers if m_.type in ('MASK', 'SUBSURF')]; st = [m_.show_viewport for m_ in mods]
for m_ in mods: m_.show_viewport = False
bpy.context.view_layer.update()
ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
co = np.zeros(n*3); m.vertices.foreach_get("co", co); co = co.reshape(n, 3); ev.to_mesh_clear()
for m_, s_ in zip(mods, st): m_.show_viewport = s_
bodyg = {ob.vertex_groups["body"].index, ob.vertex_groups["hidden_by_clothes"].index}
real = np.array([any(g.group in bodyg and g.weight > 0.5 for g in v.groups) for v in me.vertices])
ridx = np.where(real)[0]; kd = KDTree(len(ridx))
for j, i in enumerate(ridx): kd.insert(co[i], j)
kd.balance()
def disp_at(p):
    near = kd.find_n(Vector(p), 8); return np.mean([D[ridx[j]] for _, j, _ in near], axis=0)
# 骨
vl = bpy.context.view_layer; _hid = (rig.hide_viewport, rig.hide_get()); rig.hide_viewport = False; rig.hide_set(False)
for o in vl.objects: o.select_set(False)
rig.select_set(True); vl.objects.active = rig; bpy.ops.object.mode_set(mode='EDIT')
newp = {b.name: (np.array(b.head)+disp_at(b.head), np.array(b.tail)+disp_at(b.tail)) for b in rig.data.edit_bones}
dhead = disp_at(rig.data.edit_bones["head"].head)
for b in rig.data.edit_bones:
    h, t = newp[b.name]
    if b.parent and b.use_connect: h = newp[b.parent.name][1]
    b.head = Vector(h); b.tail = Vector(t)
bpy.ops.object.mode_set(mode='OBJECT'); rig.hide_viewport = _hid[0]; rig.hide_set(_hid[1])
kh.slider_max = max(kh.slider_max, HEEL); kh.value = HEEL; me.update()
# 頭に付く物：頭が動いた量だけ平行に動かす
def move(o, d):
    if o.data.shape_keys:
        for k in o.data.shape_keys.key_blocks:
            a = np.zeros(len(k.data)*3); k.data.foreach_get("co", a); k.data.foreach_set("co", (a.reshape(-1, 3)+d).ravel())
    else:
        a = np.zeros(len(o.data.vertices)*3); o.data.vertices.foreach_get("co", a); o.data.vertices.foreach_set("co", (a.reshape(-1, 3)+d).ravel())
    o.data.update()
for nm in ("Girl_Brows", "Girl_LashStrands", "Girl_LashLowerStrands", "Girl_Teeth", "Girl_MouthBag"):
    o = bpy.data.objects.get(nm)
    if o: move(o, dhead)
dpel = disp_at(rig.data.bones["hips"].head_local)
hs = np.array(ob["heel_shift"]); ob["heel_shift"] = [float(x) for x in hs+dpel]
hsm = list(ob["head_small"]); ob["head_small"] = [float(hsm[0]+dhead[0]), float(hsm[1]+dhead[1]), float(hsm[2]+dhead[2]), hsm[3]]
# 髪の値は heel_shift からの相対なので、頭と腰の動きの差だけ直す
for key in ("hair_params", "hair_layer_params"):
    if key in ob:
        p = ob[key].to_dict(); dd = dhead-dpel
        p["C"] = [float(p["C"][0]+dd[0]), float(p["C"][1]+dd[1]), float(p["C"][2]+dd[2])]
        for k in ("ZBANG", "BANG_CUT", "ZSM"):
            if k in p: p[k] = float(p[k]+dd[2])
        ob[key] = p
rig.data.pose_position = was
print("heel:", v0, "->", HEEL, "pelvis moved mm", np.round(dpel*1000, 1), "head moved mm", np.round(dhead*1000, 1), "heel_shift", np.round(ob["heel_shift"], 4))
