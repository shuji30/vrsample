# 5 人目（ワンピース 2）の頭身を合わせる（Blender の中で exec する）。シェイプキー custom-headsize を作り、骨組みの骨も同じだけ動かす。
#   頭身 HEADS ＝ はだしの身長 ÷ 頭の高さ（あご先〜頭のてっぺん。髪は入れない）。はだしの身長は今のまま（TARGET_H）
#   1) 体全体を、服を作る座標の原点（T0 = heel_shift－靴底 2.2cm）を支点に s1 倍する（Girl_Body["height_s"] にも掛ける）
#   2) 頭（頭・目・髪の揺れの骨に付いた所。肌の重みの割合で）を、あご先の少し上（PIV）を支点に k2 倍する。顔の形は変えない
#   2 つ合わせて、頭の高さが TARGET_H / HEADS、てっぺんが TARGET_H になるように s1・k2 を決める
#   眉・まつ毛・歯・口の中は頭といっしょに動かす。髪の値（hair_params）と head_small も直す。
# 実行したあとは、髪（make_hair_onepiece2_bob.py）と服（make_outfit_onepiece2.py）を流し直す。1 回だけ流す（2 回流すと 2 回かかる）
import bpy, math
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree

HEADS = globals().get("HEADS", 7.5)
KEY = globals().get("KEY", "custom-headsize")          # 2 回目に合わせ直すときは、別の名前（custom-headsize2 など）で流す
ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks; rig = bpy.data.objects["Girl_Rig"]
if KEY in kb: raise RuntimeError(KEY+" はもう作ってある（元の .blend を開き直すか、別の KEY で流す）")
was = rig.data.pose_position; rig.data.pose_position = 'REST'
def eval_co():
    mods = [m_ for m_ in ob.modifiers if m_.type in ('MASK', 'SUBSURF')]; st = [m_.show_viewport for m_ in mods]
    for m_ in mods: m_.show_viewport = False
    bpy.context.view_layer.update()
    ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
    c = np.zeros(len(m.vertices)*3); m.vertices.foreach_get("co", c); ev.to_mesh_clear()
    for m_, s_ in zip(mods, st): m_.show_viewport = s_
    return c.reshape(-1, 3)
co = eval_co(); n = len(co); assert n == len(me.vertices)
def ss(x): x = np.clip(x, 0, 1); return x*x*(3-2*x)
names = {g.index: g.name for g in ob.vertex_groups}
bodyg = {ob.vertex_groups["body"].index, ob.vertex_groups["hidden_by_clothes"].index}
HEADB = ("head", "leftEye", "rightEye", "hairSwing", "hairSwingEnd")
real = np.zeros(n, bool); hw = np.zeros(n)
for v in me.vertices:
    real[v.index] = any(g.group in bodyg and g.weight > 0.5 for g in v.groups)
    tot = sum(g.weight for g in v.groups if names[g.group] in rig.data.bones)
    if tot > 1e-6: hw[v.index] = sum(g.weight for g in v.groups if names[g.group] in HEADB)/tot

def measure(c):
    top = c[real][:, 2].max()
    cl = real & (np.abs(c[:, 0]) < 0.006)
    _nz = cl & (c[:, 2] > top-0.17) & (c[:, 2] < top-0.08)
    ym0 = c[_nz][:, 1].min(); zn = c[_nz][np.argmin(c[_nz][:, 1]), 2]                       # 鼻先
    # あご先：鼻先より下で、顔のまん中の線が前（-y）から首（後ろ）へ大きく引っこむ所。鼻先の高さから 2mm ごとに下へ見て、
    # 鼻先から 4.5cm より奥へ入った最初の高さ（鼻より上から見ると、頭が大きいときに鼻の付け根で止まった）
    zz = zn-0.005
    while zz > top-0.30:
        s = cl & (np.abs(c[:, 2]-zz) < 0.002)
        if s.any() and c[s][:, 1].min() > ym0+0.045: break
        zz -= 0.002
    return top, zz+0.002
hs = np.array(ob["heel_shift"]); T0 = hs-np.array([0, 0, 0.022])
top, chin = measure(co); H = top-hs[2]; h = top-chin
TARGET_H = globals().get("TARGET_H", round(float(H), 4))
hn = TARGET_H/HEADS
piv = np.array([0.0, float(rig.data.bones["head"].head_local.y), chin+0.020])         # 頭を大きくする支点：あご先の少し上（首の後ろが伸びすぎない）
tgt = TARGET_H+hs[2]
s1 = (tgt-T0[2]-(top-piv[2])*hn/h)/(piv[2]-T0[2])
k2 = hn/(h*s1)
piv1 = T0+(piv-T0)*s1
def f1(p): return T0+(p-T0)*s1
def f12(p): return piv1+(f1(p)-piv1)*k2
print("before: barefoot", round(H, 4), "head", round(h, 4), "heads", round(H/h, 3), "-> s1", round(s1, 4), "k2", round(k2, 4))

P1 = f1(co); P2 = f12(co)
D = P1+(P2-P1)*hw[:, None]-co
# 補助の頂点（骨の重みが無い・肌でない）は、いちばん近い肌の頂点と同じだけ動かす
kd = KDTree(int(real.sum())); ridx = np.where(real)[0]
for j, i in enumerate(ridx): kd.insert(co[i], j)
kd.balance()
for i in np.where(~real)[0]:
    _, j, _ = kd.find(co[i]); D[i] = D[ridx[j]]
B0 = np.zeros(n*3); kb["Basis"].data.foreach_get("co", B0)
kh = ob.shape_key_add(name=KEY, from_mix=False)
kh.data.foreach_set("co", (B0.reshape(n, 3)+D).ravel()); kh.value = 1.0; ob[KEY.replace("custom-", "")] = [float(s1), float(k2)]; me.update()

# ── 骨 ──
vl = bpy.context.view_layer
_hid = (rig.hide_viewport, rig.hide_get()); rig.hide_viewport = False; rig.hide_set(False)
for o in vl.objects: o.select_set(False)
rig.select_set(True); vl.objects.active = rig; bpy.ops.object.mode_set(mode='EDIT')
for b in rig.data.edit_bones:
    hd, tl = np.array(b.head), np.array(b.tail)
    if b.name in HEADB: b.head = Vector(f12(hd)); b.tail = Vector(f12(tl))
    elif b.name == "neck": b.head = Vector(f1(hd)); b.tail = Vector(f12(tl))     # 首の先は頭の根元につながっている
    else: b.head = Vector(f1(hd)); b.tail = Vector(f1(tl))
bpy.ops.object.mode_set(mode='OBJECT'); rig.hide_viewport = _hid[0]; rig.hide_set(_hid[1])

# ── 頭に付く物 ──
def move_obj(o, fn):
    blocks = o.data.shape_keys.key_blocks if o.data.shape_keys else None
    for src in (blocks if blocks else [o.data.vertices]):
        data = src.data if blocks else src
        a = np.zeros(len(data)*3); data.foreach_get("co", a); a = fn(a.reshape(-1, 3)); data.foreach_set("co", a.ravel())
    o.data.update()
for nm in ("Girl_Brows", "Girl_LashStrands", "Girl_LashLowerStrands", "Girl_Teeth", "Girl_MouthBag", "Girl_Hair"):
    o = bpy.data.objects.get(nm)
    if o: move_obj(o, f12)

# ── 値 ──
ob["height_s"] = float(ob["height_s"])*s1
br = bpy.data.objects.get("Girl_Brows")
if br and "height_s" in br: br["height_s"] = float(br["height_s"])*s1
hsm = list(ob["head_small"]); pv = f12(np.array(hsm[:3])); ob["head_small"] = [float(pv[0]), float(pv[1]), float(pv[2]), hsm[3]]
hp = ob["hair_params"].to_dict(); sh = hs
def w2p(p): return p-sh                                   # 実際の位置 → 髪の値（ヒールで動く前）
C = np.array(hp["C"])+sh; hp["C"] = [float(x) for x in w2p(f12(C))]
for k_ in ("RX", "RY", "RZ"): hp[k_] = float(hp[k_])*s1*k2
def zz12(z): return float(f12(np.array([0, piv[1], z+sh[2]]))[2]-sh[2])
def zz1(z): return float(f1(np.array([0, 0, z+sh[2]]))[2]-sh[2])
for k_ in ("ZBANG", "BANG_CUT", "ZSM"):
    if k_ in hp: hp[k_] = zz12(float(hp[k_]))
for k_ in ("ZB", "ZSH"):
    if k_ in hp: hp[k_] = zz1(float(hp[k_]))
if "YBACK0" in hp: hp["YBACK0"] = float(f1(np.array([0, hp["YBACK0"]+sh[1], 1.0]))[1]-sh[1])
for k_ in ("SIDE_X",):
    if k_ in hp: hp[k_] = float(hp[k_])*s1*k2
ob["hair_params"] = hp
rig.data.pose_position = 'REST'
Q = eval_co(); t2, c2 = measure(Q)
rig.data.pose_position = was
print("after: barefoot", round(t2-hs[2], 4), "head", round(t2-c2, 4), "heads", round((t2-hs[2])/(t2-c2), 3))
