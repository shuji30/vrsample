# 5 人目（ワンピース 2）の腕と脚の長さを直す（Blender の中で exec する）。シェイプキー custom-limbs を作り、骨組みの骨も同じだけ動かす。
#   腕：上腕 UPPER・前腕 FORE・手（手首〜中指の先）HAND の長さにする（骨の向きは変えず、骨に沿って伸ばす）
#   脚：股下（はだし）を CROTCH にする。太もも・すねを同じ割合で縮め、縮めたぶん（DZ）だけ胴（腰〜胸の下）を伸ばして、身長は変えない
#   肌は、骨の重み（ウェイト）の割合で、それぞれの骨の動きを混ぜる。補助の頂点は、いちばん近い肌の頂点と同じだけ動かす
# 実行したあとは、服（make_outfit_onepiece2.py）を流し直す。1 回だけ流す（2 回流すと 2 回かかる）
import bpy
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree

UPPER = globals().get("UPPER", 0.280); FORE = globals().get("FORE", 0.225); HAND = globals().get("HAND", 0.165)
CROTCH = globals().get("CROTCH", 0.710)
ZR0, ZR1 = 0.92, 1.10                                    # 胴を伸ばす所（この高さのあいだを、なだらかに）

ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks; rig = bpy.data.objects["Girl_Rig"]
if "custom-limbs" in kb: raise RuntimeError("custom-limbs はもう作ってある（元の .blend を開き直してから流す）")
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
hs = np.array(ob["heel_shift"])
BN = rig.data.bones
def J(nm, t="head"): return np.array(getattr(BN[nm], t+"_local"))
bodyg = {ob.vertex_groups["body"].index, ob.vertex_groups["hidden_by_clothes"].index}
real = np.array([any(g.group in bodyg and g.weight > 0.5 for g in v.groups) for v in me.vertices])
# 今の股下
cl = real & (np.abs(co[:, 0]) < 0.008) & (co[:, 2] > 0.5) & (co[:, 2] < 0.95)
crotch = co[cl][:, 2].min()-hs[2]; DZ = crotch-CROTCH
print("crotch", round(crotch, 4), "->", CROTCH, "DZ", round(DZ, 4))

# ── それぞれの骨の動き（点 p → 動く量）──
FING = ("Thumb", "Index", "Middle", "Ring", "Little")
chain = {}
for side in ("left", "right"):
    S = J(side+"UpperArm"); E = J(side+"LowerArm"); W = J(side+"Hand")
    tip = J(side+"MiddleDistal", "tail") if side+"MiddleDistal" in BN else J(side+"Hand", "tail")
    Lu = np.linalg.norm(E-S); Lf = np.linalg.norm(W-E); Lh = np.linalg.norm(tip-W)
    dU = (E-S)/Lu; dF = (W-E)/Lf
    kU, kF, kH = UPPER/Lu, FORE/Lf, HAND/Lh
    H_ = J(side+"UpperLeg"); K = J(side+"LowerLeg"); A = J(side+"Foot")
    Lt = np.linalg.norm(H_-K); Ls = np.linalg.norm(K-A); uS = (K-A)/Ls; uT = (H_-K)/Lt
    kL = 1-DZ/(H_[2]-A[2])
    chain[side] = dict(S=S, E=E, W=W, Lu=Lu, Lf=Lf, dU=dU, dF=dF, kU=kU, kF=kF, kH=kH, A=A, K=K, Ls=Ls, Lt=Lt, uS=uS, uT=uT, kL=kL)
    print(side, "arm", round(Lu, 3), round(Lf, 3), round(Lh, 3), "->", UPPER, FORE, HAND, " leg k", round(kL, 4))
def torso(p): return np.array([0, 0, -DZ+DZ*float(ss((p[2]-ZR0)/(ZR1-ZR0)))])
def disp_bone(b, p):
    side = "left" if b.startswith("left") else "right" if b.startswith("right") else None
    if side is None or b.endswith(("Eye",)): return torso(p)
    c = chain[side]; part = b[len(side):]
    if part == "Shoulder": return np.zeros(3)                            # 肩（鎖骨）は胴の上のほう：動かない
    if part == "UpperArm":
        t = np.clip((p-c["S"]) @ c["dU"], 0, c["Lu"]); return c["dU"]*t*(c["kU"]-1)
    eU = c["dU"]*c["Lu"]*(c["kU"]-1)
    if part == "LowerArm":
        t = np.clip((p-c["E"]) @ c["dF"], 0, c["Lf"]); return eU+c["dF"]*t*(c["kF"]-1)
    eF = eU+c["dF"]*c["Lf"]*(c["kF"]-1)
    if part == "Hand" or part.startswith(FING): return eF+(p-c["W"])*(c["kH"]-1)
    if part == "LowerLeg":
        t = np.clip((p-c["A"]) @ c["uS"], 0, c["Ls"]); return c["uS"]*t*(c["kL"]-1)
    if part == "UpperLeg":
        t = np.clip((p-c["K"]) @ c["uT"], 0, c["Lt"]); return c["uS"]*c["Ls"]*(c["kL"]-1)+c["uT"]*t*(c["kL"]-1)
    if part in ("Foot", "Toes"): return np.zeros(3)
    return torso(p)

names = {g.index: g.name for g in ob.vertex_groups}
D = np.zeros((n, 3))
for v in me.vertices:
    p = co[v.index]; acc = np.zeros(3); tot = 0.0
    for g in v.groups:
        nm = names[g.group]
        if nm not in BN or g.weight <= 0: continue
        acc += g.weight*disp_bone(nm, p); tot += g.weight
    D[v.index] = acc/tot if tot > 1e-6 else torso(p)
kd = KDTree(int(real.sum())); ridx = np.where(real)[0]
for j, i in enumerate(ridx): kd.insert(co[i], j)
kd.balance()
for i in np.where(~real)[0]:
    _, j, _ = kd.find(co[i]); D[i] = D[ridx[j]]
# 関節の目印（補助の頂点）は、その関節の骨の動きにそろえる（いちばん近い肌が別の部位のことがある）
JM = {"joint-l-shoulder": ("leftUpperArm", "head"), "joint-r-shoulder": ("rightUpperArm", "head"), "joint-l-elbow": ("leftLowerArm", "head"), "joint-r-elbow": ("rightLowerArm", "head"),
      "joint-l-wrist": ("leftHand", "head"), "joint-r-wrist": ("rightHand", "head"), "joint-l-knee": ("leftLowerLeg", "head"), "joint-r-knee": ("rightLowerLeg", "head"),
      "joint-l-ankle": ("leftFoot", "head"), "joint-r-ankle": ("rightFoot", "head"), "joint-l-upper-leg": ("leftUpperLeg", "head"), "joint-r-upper-leg": ("rightUpperLeg", "head")}
for gname, (bn, _) in JM.items():
    g = ob.vertex_groups.get(gname)
    if not g: continue
    for v in me.vertices:
        if any(x.group == g.index and x.weight > 0.5 for x in v.groups): D[v.index] = disp_bone(bn, co[v.index])
B0 = np.zeros(n*3); kb["Basis"].data.foreach_get("co", B0)
kl = ob.shape_key_add(name="custom-limbs", from_mix=False)
kl.data.foreach_set("co", (B0.reshape(n, 3)+D).ravel()); kl.value = 1.0; me.update()

# ── 骨 ──
vl = bpy.context.view_layer
_hid = (rig.hide_viewport, rig.hide_get()); rig.hide_viewport = False; rig.hide_set(False)
for o in vl.objects: o.select_set(False)
rig.select_set(True); vl.objects.active = rig; bpy.ops.object.mode_set(mode='EDIT')
newpos = {}
for b in rig.data.edit_bones:
    hd, tl = np.array(b.head), np.array(b.tail)
    newpos[b.name] = (hd+disp_bone(b.name, hd), tl+disp_bone(b.name, tl))
for b in rig.data.edit_bones:
    h_, t_ = newpos[b.name]
    if b.parent and b.use_connect: h_ = newpos[b.parent.name][1]
    b.head = Vector(h_); b.tail = Vector(t_)
bpy.ops.object.mode_set(mode='OBJECT'); rig.hide_viewport = _hid[0]; rig.hide_set(_hid[1])
ob["limbs"] = [UPPER, FORE, HAND, CROTCH]
Q = eval_co(); rig.data.pose_position = was
print("after: crotch", round(Q[cl][:, 2].min()-hs[2], 4), "top", round(Q[real][:, 2].max()-hs[2], 4))
