# 5 人目（ワンピース 2）の体のサイズを合わせる（Blender の中で exec する）。シェイプキー custom-size を作り直し、骨組みの骨も同じだけ動かす。
#   身長（はだし）TARGET_H、スリーサイズ BUST・WAIST・HIP、アンダーバスト UNDER（E カップは B－アンダー ≒ 21〜22cm）、足の長さ FOOT
#   顔は make_face_onepiece2.py で作ったあと Blender の中で手で直してあり、流し直すと消えるので、今の形にこのキーを 1 つ足して合わせる。
#   1) 全体：服を作る座標の原点（T0 = heel_shift－靴底 2.2cm）を支点に一様に縮める（Girl_Body["height_s"] にも掛ける。服のスクリプトはこれで割って作る）
#   2) 胴：高さごとに、胴のまわり（巻き尺で測るのと同じ、断面の凸包の周）が目標になるように、胴の中心から横・前後へ広げる。
#      腕・手は、わきの下で胴が広がったぶんだけ横へずらす（腕の太さは変えない）
#   3) 胸：左右のふくらみを、頂点の奥の点を中心に大きくする（バストが BUST になるまで）
#   4) 足：かかとを支点に、前後（y）に伸ばして FOOT にする
#   眉・まつ毛・歯・口の中・髪は 1) だけ掛ける。髪の値（hair_params）と head_small も直す。
# 実行したあとは、髪（make_hair_onepiece2_bob.py）と服（make_outfit_onepiece2.py）を流し直す。
import bpy, math
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree

TARGET_H = globals().get("TARGET_H", 1.55)
BUST = globals().get("BUST", 86.0); WAIST = globals().get("WAIST", 58.0); HIP = globals().get("HIP", 84.0); UNDER = globals().get("UNDER", 65.0)
FOOT = globals().get("FOOT", 0.230)

ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks; rig = bpy.data.objects["Girl_Rig"]
was = rig.data.pose_position; rig.data.pose_position = 'REST'
# 1 回だけ流す（骨・眉・髪の値などは今の値に掛けるので、2 回流すと 2 回縮む）。やり直すときは、元の .blend を開き直してから流す
if "custom-size" in kb or "size_scale" in ob: raise RuntimeError("custom-size はもう作ってある（元の .blend を開き直してから流す）")
mods = [m for m in ob.modifiers if m.type in ('MASK', 'SUBSURF')]; st = [m.show_viewport for m in mods]
for m_ in mods: m_.show_viewport = False
bpy.context.view_layer.update()
ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
n = len(m.vertices); co = np.zeros(n*3); m.vertices.foreach_get("co", co); co = co.reshape(n, 3); ev.to_mesh_clear()
for m_, s_ in zip(mods, st): m_.show_viewport = s_
assert n == len(me.vertices)

def ss(x): x = np.clip(x, 0, 1); return x*x*(3-2*x)
names = {g.index: g.name for g in ob.vertex_groups}
bodyg = {ob.vertex_groups["body"].index, ob.vertex_groups["hidden_by_clothes"].index}
ARMK = ("UpperArm", "LowerArm", "Hand", "Thumb", "Index", "Middle", "Ring", "Little")
real = np.zeros(n, bool); armw = np.zeros(n); footw = np.zeros(n)
for v in me.vertices:
    real[v.index] = any(g.group in bodyg and g.weight > 0.5 for g in v.groups)
    tot = sum(g.weight for g in v.groups if names[g.group] in rig.data.bones)
    if tot > 1e-6:
        armw[v.index] = sum(g.weight for g in v.groups if any(k in names[g.group] for k in ARMK))/tot
        footw[v.index] = sum(g.weight for g in v.groups if names[g.group] in ("leftFoot", "rightFoot", "leftToes", "rightToes"))/tot
armish = (armw > 0.2) | ~real

def hull_per(P):
    P = sorted(set(map(tuple, np.round(P, 6))))
    if len(P) < 3: return 0.0
    def cr(o, a, b): return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
    lo = []; up = []
    for q in P:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], q) <= 0: lo.pop()
        lo.append(q)
    for q in reversed(P):
        while len(up) >= 2 and cr(up[-2], up[-1], q) <= 0: up.pop()
        up.append(q)
    H = lo[:-1]+up[:-1]; return sum(math.dist(H[i], H[(i+1) % len(H)]) for i in range(len(H)))
def slice_(P, z, band=0.006): return (np.abs(P[:, 2]-z) < band) & ~armish & (np.abs(P[:, 0]) < 0.25)
# 胴回り：高さ z の平面で肌（腕と補助の形を除く）を切った断面の、凸包の周（巻き尺で測るのと同じ。cm）
_E = np.array(sorted({tuple(sorted(e)) for p_ in me.polygons if not armish[list(p_.vertices)].any() for e in p_.edge_keys}))
def girth(P, z):
    a = P[_E[:, 0]]; b = P[_E[:, 1]]; c = (a[:, 2]-z)*(b[:, 2]-z) < 0
    a = a[c]; b = b[c]; w = ((z-a[:, 2])/(b[:, 2]-a[:, 2]))[:, None]; X = a+(b-a)*w
    X = X[np.abs(X[:, 0]) < 0.25]
    return hull_per(X[:, :2])*100

# ── 1) 全体を縮める ──
hs = np.array(ob["heel_shift"]); T0 = hs-np.array([0, 0, 0.022])
top = co[real][:, 2].max()
s = (TARGET_H+hs[2]-T0[2])/(top-T0[2])
P = T0+(co-T0)*s
print("scale", round(s, 5), "barefoot", round(top-hs[2], 4), "->", round(P[real][:, 2].max()-hs[2], 4))

# ── 2) 胴を広げる ──
sh_z = float(np.mean([P[i, 2] for i in range(n) if any(names[g.group] == "joint-l-shoulder" and g.weight > 0.5 for g in me.vertices[i].groups)]))
zs = np.arange(0.62, sh_z+0.08, 0.01)
gs = np.array([girth(P, z) for z in zs])
def pick(a, b, f):
    sel = [(g, z) for z, g in zip(zs, gs) if a <= z <= b and g > 0]; return f(sel)
gB, zB = pick(sh_z-0.20, sh_z-0.06, max)
gW, zW = pick(zB-0.30, zB-0.10, min)
gH, zH = pick(zW-0.35, zW-0.12, max)
zU = zB-0.085; gU = girth(P, zU)
kW = WAIST/gW; kH = HIP/gH; kU = UNDER/gU
print("before: B", round(gB, 1), "@", round(zB, 3), "U", round(gU, 1), "@", round(zU, 3), "W", round(gW, 1), "@", round(zW, 3), "H", round(gH, 1), "@", round(zH, 3))
zArm = sh_z-0.075
CPZ = [zH-0.13, zH, zW, zU, zB, zArm, sh_z, sh_z+0.05]
CPK = [1.0, kH, kW, kU, kU, 1+(kU-1)*0.6, 1+(kU-1)*0.25, 1.0]
def kz(z): return np.interp(z, CPZ, CPK)
# 胴の中心（前後）：高さごとの断面の前後のまん中
yc_z = np.array([(lambda q: (q[:, 1].min()+q[:, 1].max())/2 if len(q) else -0.04)(P[slice_(P, z, 0.008)]) for z in zs])
yc_z = np.convolve(np.pad(yc_z, 3, mode='edge'), np.ones(7)/7, mode='valid')
def ycz(z): return np.interp(z, zs, yc_z)
k = kz(P[:, 2]); yc = ycz(P[:, 2])
Drad = np.zeros_like(P); Drad[:, 0] = P[:, 0]*(k-1); Drad[:, 1] = (P[:, 1]-yc)*(k-1)
qa = P[slice_(P, zArm, 0.01)]; hw_arm = np.abs(qa[:, 0]).max() if len(qa) else 0.12
dxA = hw_arm*(kz(zArm)-1)
Darm = np.zeros_like(P); Darm[:, 0] = np.sign(P[:, 0])*dxA
P2 = P+Drad*(1-armw)[:, None]+Darm*armw[:, None]
print("arm shift mm", round(dxA*1000, 1))

# ── 3) 胸を大きくする ──
def bust_disp(Q, kb_):
    D = np.zeros_like(Q)
    for sg in (1, -1):
        sel = (sg*Q[:, 0] > 0.03) & (sg*Q[:, 0] < 0.16) & (np.abs(Q[:, 2]-zB) < 0.07) & (Q[:, 1] < -0.02) & real & (armw < 0.2)
        ap = Q[sel][np.argmin(Q[sel][:, 1])]
        cen = ap+np.array([0.0, 0.055, 0.004])
        d = np.linalg.norm((Q-cen)*np.array([1.0, 0.8, 1.0]), axis=1)
        w = ss(1-d/0.105)*(Q[:, 1] < cen[1]+0.015)*(sg*Q[:, 0] > 0.005)*(armw < 0.5)
        D += (Q-cen)*(kb_-1)*w[:, None]
    return D
def bust_g(Q): return max(girth(Q, z) for z in np.arange(zB-0.05, zB+0.05, 0.005))
lo_, hi_ = 0.8, 2.0                                    # 胴を広げただけで大きすぎたら、少し小さくもする
for _ in range(18):
    mid = (lo_+hi_)/2
    if bust_g(P2+bust_disp(P2, mid)) < BUST: lo_ = mid
    else: hi_ = mid
kB = (lo_+hi_)/2; P3 = P2+bust_disp(P2, kB)
print("bust scale", round(kB, 3))

# ── 4) 足を伸ばす（かかとを支点に前後へ）──
for sg in (1, -1):
    sel = (sg*P3[:, 0] > 0.03) & (P3[:, 2] < 0.13) & real
    Pf = P3[sel]; hp_ = Pf[np.argmax(Pf[:, 1])]; tp_ = Pf[np.argmin(Pf[:, 1])]; heel = hp_[1]
    L = float(np.linalg.norm(hp_-tp_)); dy = hp_[1]-tp_[1]; rest = L*L-dy*dy      # ヒールで傾いているので、かかと〜つま先の実際の長さ（3D）で合わせる
    kf = math.sqrt(max(FOOT*FOOT-rest, 1e-6))/dy; side = sg*P3[:, 0] > 0
    P3[:, 1] = np.where(side, P3[:, 1]+(P3[:, 1]-heel)*(kf-1)*footw, P3[:, 1])
    print("foot", sg, round(L, 4), "->", FOOT)

# 補助の頂点（関節の目印・目の玉の位置など）は、いちばん近い肌の頂点と同じだけ動かす
D = P3-co
kd = KDTree(int(real.sum())); ridx = np.where(real)[0]
for j, i in enumerate(ridx): kd.insert(co[i], j)
kd.balance()
for i in np.where(~real)[0]:
    _, j, _ = kd.find(co[i]); D[i] = D[ridx[j]]
# 補助の頂点のうち、関節の目印は、腕なら腕のずらし、それ以外は胴の広げ方で（いちばん近い肌が別の部位のことがある）
for g in ob.vertex_groups:
    if not g.name.startswith("joint-"): continue
    idx = [v.index for v in me.vertices if any(x.group == g.index and x.weight > 0.5 for x in v.groups)]
    if not idx: continue
    isarm = any(t in g.name for t in ("shoulder", "elbow", "wrist", "hand", "finger"))
    for i in idx:
        p = P[i]
        if isarm: D[i] = (p-co[i])+np.array([np.sign(p[0])*dxA, 0, 0])
        else: D[i] = (p-co[i])+Drad[i]

B0 = np.zeros(n*3); kb["Basis"].data.foreach_get("co", B0)
ks = kb.get("custom-size") or ob.shape_key_add(name="custom-size", from_mix=False)
ks.data.foreach_set("co", (B0.reshape(n, 3)+D).ravel()); ks.value = 1.0; ob["size_scale"] = s; me.update()

# ── 骨組みの骨を同じだけ動かす ──
def bone_disp(p, kind):
    p = np.array(p); q = T0+(p-T0)*s
    if kind == "arm": return q+np.array([np.sign(q[0])*dxA, 0, 0])
    if kind == "foot": return q                                     # 足先の骨は下で伸ばす
    kk = kz(q[2]); return np.array([q[0]*kk, ycz(q[2])+(q[1]-ycz(q[2]))*kk, q[2]])
def kind_of(nm):
    if any(t in nm for t in ARMK): return "arm"
    if nm in ("leftFoot", "rightFoot", "leftToes", "rightToes"): return "foot"
    return "body"
ctx = bpy.context; vl = ctx.view_layer
_hid = (rig.hide_viewport, rig.hide_get()); rig.hide_viewport = False; rig.hide_set(False)
for o in vl.objects: o.select_set(False)
rig.select_set(True); vl.objects.active = rig; bpy.ops.object.mode_set(mode='EDIT')
eb = rig.data.edit_bones
old = {b.name: (np.array(b.head), np.array(b.tail)) for b in eb}
heel_y = {1: None, -1: None}
for b in eb:
    kd_ = kind_of(b.name); h, t = old[b.name]
    if b.name.endswith("Shoulder"):
        b.head = Vector(bone_disp(h, "body")); b.tail = Vector(bone_disp(t, "arm"))
    else:
        b.head = Vector(bone_disp(h, kd_)); b.tail = Vector(bone_disp(t, kd_))
# 足先：かかと（足の骨の根元のうしろ）を支点に前後へ。肌と同じ倍率
for sg, side in ((1, "left"), (-1, "right")):
    sel = (sg*co[:, 0] > 0.03) & (co[:, 2] < 0.13) & real
    Pc = T0+(co[sel]-T0)*s; hp_ = Pc[np.argmax(Pc[:, 1])]; tp_ = Pc[np.argmin(Pc[:, 1])]; heel = hp_[1]
    L = float(np.linalg.norm(hp_-tp_)); dy = hp_[1]-tp_[1]; kf = math.sqrt(max(FOOT*FOOT-(L*L-dy*dy), 1e-6))/dy
    for nm in (side+"Foot", side+"Toes"):
        b = eb.get(nm)
        if not b: continue
        for attr, ws in (("head", 0.0 if nm.endswith("Foot") else 1.0), ("tail", 1.0)):
            v = getattr(b, attr); v.y = v.y+(v.y-heel)*(kf-1)*ws; setattr(b, attr, v)
bpy.ops.object.mode_set(mode='OBJECT'); rig.hide_viewport = _hid[0]; rig.hide_set(_hid[1])

# ── 頭に付く物：一様に縮めるだけ ──
def scale_obj(o):
    if o.data.shape_keys:
        for kbk in o.data.shape_keys.key_blocks:
            a = np.zeros(len(kbk.data)*3); kbk.data.foreach_get("co", a); a = T0+(a.reshape(-1, 3)-T0)*s; kbk.data.foreach_set("co", a.ravel())
    else:
        a = np.zeros(len(o.data.vertices)*3); o.data.vertices.foreach_get("co", a); a = T0+(a.reshape(-1, 3)-T0)*s; o.data.vertices.foreach_set("co", a.ravel())
    o.data.update()
for nm in ("Girl_Brows", "Girl_LashStrands", "Girl_LashLowerStrands", "Girl_Teeth", "Girl_MouthBag", "Girl_Hair"):
    o = bpy.data.objects.get(nm)
    if o: scale_obj(o)
br = bpy.data.objects.get("Girl_Brows")
if br and "height_s" in br: br["height_s"] = float(br["height_s"])*s

# ── 値を直す ──
ob["height_s"] = float(ob["height_s"])*s
hsm = list(ob["head_small"]); pv = T0+(np.array(hsm[:3])-T0)*s; ob["head_small"] = [float(pv[0]), float(pv[1]), float(pv[2]), hsm[3]]
hp = ob["hair_params"].to_dict(); sh = hs
def wz(z): return float(T0[2]+(z+sh[2]-T0[2])*s-sh[2])
def wy(y): return float(T0[1]+(y+sh[1]-T0[1])*s-sh[1])
C = np.array(hp["C"]); hp["C"] = [float(C[0]*s), wy(C[1]), wz(C[2])]
for kk_ in ("RX", "RY", "RZ"): hp[kk_] = float(hp[kk_])*s
for kk_ in ("ZB", "ZBANG", "BANG_CUT"):
    if kk_ in hp: hp[kk_] = wz(float(hp[kk_]))
hp["ZSH"] = wz(float(hp.get("ZSH", 1.345))); hp["ZSM"] = wz(float(hp.get("ZSM", 1.50))); hp["YBACK0"] = wy(float(hp.get("YBACK0", 0.045)))
for kk_ in ("SIDE_X",):
    if kk_ in hp: hp[kk_] = float(hp[kk_])*s
ob["hair_params"] = hp
rig.data.pose_position = was
bpy.context.view_layer.update()
# 確かめ
mods = [m_ for m_ in ob.modifiers if m_.type in ('MASK', 'SUBSURF')]; st = [m_.show_viewport for m_ in mods]
for m_ in mods: m_.show_viewport = False
rig.data.pose_position = 'REST'; bpy.context.view_layer.update()
ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
Q = np.zeros(n*3); m.vertices.foreach_get("co", Q); Q = Q.reshape(n, 3); ev.to_mesh_clear()
for m_, s_ in zip(mods, st): m_.show_viewport = s_
rig.data.pose_position = was
fl = [(lambda F: float(np.linalg.norm(F[np.argmax(F[:, 1])]-F[np.argmin(F[:, 1])])))(Q[(sg*Q[:, 0] > 0.03) & (Q[:, 2] < 0.13) & real]) for sg in (1, -1)]
print("after: height", round(Q[real][:, 2].max()-hs[2], 4), "B", round(bust_g(Q), 1), "U", round(girth(Q, zU), 1), "W", round(min(girth(Q, z) for z in np.arange(zW-0.05, zW+0.05, 0.005)), 1),
      "H", round(max(girth(Q, z) for z in np.arange(zH-0.05, zH+0.05, 0.005)), 1), "foot", [round(f, 4) for f in fl])
