# 5 人目（ワンピース 2）の膝の高さを下げる（Blender の中で exec する）。シェイプキー custom-knee を作り、骨組みの膝の骨も動かす。
#   膝を脚に沿って DK 下げる：すねは足首を支点に縮め、太ももは股関節を支点に伸ばす（股下・身長・足は変えない）
#   ヒールで足が持ち上がるので、太ももとすねが同じ長さだと、膝から下が長く見えた
#   肌は、骨の重みの割合で、太もも・すねの動きを混ぜる。補助の頂点は、いちばん近い肌の頂点と同じだけ動かす
# 実行したあとは、服（make_outfit_onepiece2.py）を流し直す。1 回だけ流す
import bpy
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree

DK = globals().get("DK", 0.020)
ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks; rig = bpy.data.objects["Girl_Rig"]
if "custom-knee" in kb: raise RuntimeError("custom-knee はもう作ってある（元の .blend を開き直してから流す）")
was = rig.data.pose_position; rig.data.pose_position = 'REST'
mods = [m_ for m_ in ob.modifiers if m_.type in ('MASK', 'SUBSURF')]; st = [m_.show_viewport for m_ in mods]
for m_ in mods: m_.show_viewport = False
bpy.context.view_layer.update()
ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
n = len(m.vertices); co = np.zeros(n*3); m.vertices.foreach_get("co", co); co = co.reshape(n, 3); ev.to_mesh_clear()
for m_, s_ in zip(mods, st): m_.show_viewport = s_
BN = rig.data.bones
def J(nm, t="head"): return np.array(getattr(BN[nm], t+"_local"))
leg = {}
for side in ("left", "right"):
    H = J(side+"UpperLeg"); K = J(side+"LowerLeg"); A = J(side+"Foot")
    Lt = np.linalg.norm(K-H); Ls = np.linalg.norm(K-A); uS = (K-A)/Ls; uT = (K-H)/Lt
    leg[side] = (H, K, A, Lt, Ls, uS, uT)
    print(side, "thigh", round(Lt, 4), "shin", round(Ls, 4), "->", round(Lt+DK, 4), round(Ls-DK, 4))
def disp_bone(b, p):
    side = "left" if b.startswith("left") else "right" if b.startswith("right") else None
    if side is None: return np.zeros(3)
    H, K, A, Lt, Ls, uS, uT = leg[side]; part = b[len(side):]; dk = -uS*DK      # 膝の動き（すねに沿って下へ）
    if part == "LowerLeg":
        t = np.clip((p-A) @ uS, 0, Ls); return dk*(t/Ls)
    if part == "UpperLeg":
        t = np.clip((p-H) @ uT, 0, Lt); return dk*(t/Lt)
    return np.zeros(3)
names = {g.index: g.name for g in ob.vertex_groups}
bodyg = {ob.vertex_groups["body"].index, ob.vertex_groups["hidden_by_clothes"].index}
real = np.array([any(g.group in bodyg and g.weight > 0.5 for g in v.groups) for v in me.vertices])
D = np.zeros((n, 3))
for v in me.vertices:
    p = co[v.index]; acc = np.zeros(3); tot = 0.0
    for g in v.groups:
        nm = names[g.group]
        if nm not in BN or g.weight <= 0: continue
        acc += g.weight*disp_bone(nm, p); tot += g.weight
    if tot > 1e-6: D[v.index] = acc/tot
kd = KDTree(int(real.sum())); ridx = np.where(real)[0]
for j, i in enumerate(ridx): kd.insert(co[i], j)
kd.balance()
for i in np.where(~real)[0]:
    _, j, _ = kd.find(co[i]); D[i] = D[ridx[j]]
for gname, bn in (("joint-l-knee", "leftLowerLeg"), ("joint-r-knee", "rightLowerLeg")):
    g = ob.vertex_groups.get(gname)
    if not g: continue
    for v in me.vertices:
        if any(x.group == g.index and x.weight > 0.5 for x in v.groups): D[v.index] = -leg[bn[:-8]][5]*DK
B0 = np.zeros(n*3); kb["Basis"].data.foreach_get("co", B0)
kk = ob.shape_key_add(name="custom-knee", from_mix=False)
kk.data.foreach_set("co", (B0.reshape(n, 3)+D).ravel()); kk.value = 1.0; me.update()
vl = bpy.context.view_layer
_hid = (rig.hide_viewport, rig.hide_get()); rig.hide_viewport = False; rig.hide_set(False)
for o in vl.objects: o.select_set(False)
rig.select_set(True); vl.objects.active = rig; bpy.ops.object.mode_set(mode='EDIT')
for side in ("left", "right"):
    dk = Vector(-leg[side][5]*DK)
    eb = rig.data.edit_bones
    eb[side+"UpperLeg"].tail = eb[side+"UpperLeg"].tail+dk
    eb[side+"LowerLeg"].head = eb[side+"UpperLeg"].tail
bpy.ops.object.mode_set(mode='OBJECT'); rig.hide_viewport = _hid[0]; rig.hide_set(_hid[1])
ob["knee_drop"] = DK
rig.data.pose_position = was
print("knee lowered", DK)
