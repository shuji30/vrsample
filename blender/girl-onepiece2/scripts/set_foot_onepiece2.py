# 5 人目（ワンピース 2）の足の長さを FOOT にする（Blender の中で exec する。何度流してもよい）。シェイプキー custom-foot を作り直し、足先の骨も伸ばす。
#   頭身を合わせた（set_head_onepiece2.py）とき首から下を縮めたので、23cm にしてあった足が 22.4cm に縮んでいた。
#   かかと（いちばん後ろ）を支点に、足の骨（Foot・Toes）の重みの割合で前後（y）に伸ばす。ヒールで傾いているので、かかと〜つま先の実際の長さ（3D）で合わせる。
#   骨は伸ばした量を Girl_Rig["foot_scale"] に覚え、2 回目以降は差だけ伸ばす。流したあとは服（靴）を流し直す
import bpy, math
import numpy as np
FOOT = globals().get("FOOT", 0.220)      # 23cm では足が大きく見えたので 22cm に
ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks; rig = bpy.data.objects["Girl_Rig"]
was = rig.data.pose_position; rig.data.pose_position = 'REST'
k0 = kb.get("custom-foot")
if k0: k0.value = 0.0
mods = [m_ for m_ in ob.modifiers if m_.type in ('MASK', 'SUBSURF')]; st = [m_.show_viewport for m_ in mods]
for m_ in mods: m_.show_viewport = False
bpy.context.view_layer.update()
ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
n = len(m.vertices); co = np.zeros(n*3); m.vertices.foreach_get("co", co); co = co.reshape(n, 3); ev.to_mesh_clear()
for m_, s_ in zip(mods, st): m_.show_viewport = s_
names = {g.index: g.name for g in ob.vertex_groups}
bodyg = {ob.vertex_groups["body"].index, ob.vertex_groups["hidden_by_clothes"].index}
real = np.array([any(g.group in bodyg and g.weight > 0.5 for g in v.groups) for v in me.vertices])
footw = np.zeros(n)
for v in me.vertices:
    tot = sum(g.weight for g in v.groups if names[g.group] in rig.data.bones)
    if tot > 1e-6: footw[v.index] = sum(g.weight for g in v.groups if names[g.group] in ("leftFoot", "rightFoot", "leftToes", "rightToes"))/tot
D = np.zeros((n, 3)); ks = {}
for sg, side in ((1, "left"), (-1, "right")):
    sel = (sg*co[:, 0] > 0.03) & (co[:, 2] < 0.13) & real
    F = co[sel]; hp = F[np.argmax(F[:, 1])]; tp = F[np.argmin(F[:, 1])]; heel = hp[1]
    L = float(np.linalg.norm(hp-tp)); dy = hp[1]-tp[1]; rest = L*L-dy*dy
    kf = math.sqrt(max(FOOT*FOOT-rest, 1e-6))/dy; ks[side] = (L, kf, heel)
    sd = sg*co[:, 0] > 0
    D[:, 1] += np.where(sd, (co[:, 1]-heel)*(kf-1)*footw, 0.0)
B0 = np.zeros(n*3); kb["Basis"].data.foreach_get("co", B0)
kk = k0 or ob.shape_key_add(name="custom-foot", from_mix=False)
kk.data.foreach_set("co", (B0.reshape(n, 3)+D).ravel()); kk.value = 1.0; me.update()
# 骨
prev = float(rig.get("foot_scale", 1.0)); kf = ks["left"][1]; rel = kf/prev
vl = bpy.context.view_layer; _hid = (rig.hide_viewport, rig.hide_get()); rig.hide_viewport = False; rig.hide_set(False)
for o in vl.objects: o.select_set(False)
rig.select_set(True); vl.objects.active = rig; bpy.ops.object.mode_set(mode='EDIT')
eb = rig.data.edit_bones
for side in ("left", "right"):
    heel = ks[side][2]
    for nm, wh in ((side+"Foot", 0.0), (side+"Toes", 1.0)):
        b = eb.get(nm)
        if not b: continue
        h = b.head.copy(); t = b.tail.copy()
        if wh: h.y = heel+(h.y-heel)*rel
        t.y = heel+(t.y-heel)*rel; b.head = h; b.tail = t
bpy.ops.object.mode_set(mode='OBJECT'); rig.hide_viewport = _hid[0]; rig.hide_set(_hid[1])
rig["foot_scale"] = kf; rig.data.pose_position = was
print("foot:", {s: (round(L, 4), round(k, 3)) for s, (L, k, _) in ks.items()}, "->", FOOT)
