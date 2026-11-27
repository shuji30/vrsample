# 5 人目（ワンピース 2）のバストを BUST cm に保つ（Blender の中で exec する。何度流してもよい）。シェイプキー custom-bust-keep を作り直す。
#   脇を寄せた（set_side_slim_onepiece2.py）ぶんバストの周りが減るので、胸のふくらみだけを、ふくらみの奥の点を中心に大きくして戻す
#   （胴全体を広げると脇がまたふくらむ）。周りは、高さ z の平面で肌を切った断面の凸包の周（巻き尺と同じ）。流したあとは服を流し直す
import bpy, math
import numpy as np
BUST = globals().get("BUST", 86.0)
ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks; rig = bpy.data.objects["Girl_Rig"]
k0 = kb.get("custom-bust-keep")
if k0: k0.value = 0.0
n = len(me.vertices)
def co_of(k): a = np.zeros(n*3); k.data.foreach_get("co", a); return a.reshape(n, 3)
B = co_of(kb["Basis"]); mix = B.copy()
for k in kb:
    if k.name in ("Basis", "custom-bust-keep") or k.name.startswith("exp-") or k.mute or k.value == 0: continue
    mix += (co_of(k)-B)*k.value
names = {g.index: g.name for g in ob.vertex_groups}
bodyg = {ob.vertex_groups["body"].index, ob.vertex_groups["hidden_by_clothes"].index}
real = np.zeros(n, bool); armw = np.zeros(n)
for v in me.vertices:
    real[v.index] = any(g.group in bodyg and g.weight > 0.5 for g in v.groups)
    tot = sum(g.weight for g in v.groups if names[g.group] in rig.data.bones)
    if tot > 1e-6: armw[v.index] = sum(g.weight for g in v.groups if any(s in names[g.group] for s in ("UpperArm", "LowerArm", "Hand", "Thumb", "Index", "Middle", "Ring", "Little")))/tot
armish = (armw > 0.2) | ~real
E = np.array(sorted({tuple(sorted(e)) for p in me.polygons if not armish[list(p.vertices)].any() for e in p.edge_keys}))
def hull_per(P):
    P = sorted(set(map(tuple, np.round(P, 6))))
    def cr(o, a, b): return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
    lo = []; up = []
    for q in P:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], q) <= 0: lo.pop()
        lo.append(q)
    for q in reversed(P):
        while len(up) >= 2 and cr(up[-2], up[-1], q) <= 0: up.pop()
        up.append(q)
    H = lo[:-1]+up[:-1]; return sum(math.dist(H[i], H[(i+1) % len(H)]) for i in range(len(H)))
def girth(P, z):
    a = P[E[:, 0]]; b = P[E[:, 1]]; c = (a[:, 2]-z)*(b[:, 2]-z) < 0
    a = a[c]; b = b[c]; w = ((z-a[:, 2])/(b[:, 2]-a[:, 2]))[:, None]; X = a+(b-a)*w
    return hull_per(X[np.abs(X[:, 0]) < 0.25][:, :2])*100
def ss(x): x = np.clip(x, 0, 1); return x*x*(3-2*x)
def bust_g(P): return max(girth(P, z) for z in np.arange(1.12, 1.26, 0.005))
FLAT = globals().get("FLAT", 0.72)      # 前への突き出しを何倍にするか（0.85 でも真横から見て張り出していた）（ふくらみの奥の点＝胸の壁からの前後の長さ）
# 胸の頂点が左右 11.4cm と中央に寄って前へとがり、張り出して見えた。ふくらみを左右へ離し（SPREAD を探す）、前への突き出しを FLAT 倍に抑えて、
# 横へ丸く広がる形にする。周りが BUST になる SPREAD を二分探索で決める
def disp(spread):
    D = np.zeros((n, 3))
    for sg in (1, -1):
        sel = (sg*mix[:, 0] > 0.03) & (sg*mix[:, 0] < 0.15) & (mix[:, 2] > 1.10) & (mix[:, 2] < 1.28) & (mix[:, 1] < -0.04) & real & (armw < 0.2)
        ap = mix[sel][np.argmin(mix[sel][:, 1])]; cen = ap+np.array([0.0, 0.050, 0.004])
        d = np.linalg.norm((mix-cen)*np.array([1.0, 0.8, 1.0]), axis=1)
        w = ss(1-d/0.10)*(mix[:, 1] < cen[1]+0.010)*(sg*mix[:, 0] > 0.005)*(armw < 0.5)
        D[:, 0] += sg*spread*w
        D[:, 1] += np.minimum(mix[:, 1]-cen[1], 0)*(FLAT-1)*w        # 奥の点より前だけ、前後を縮める
    return D
g0 = bust_g(mix); lo, hi = 0.0, 0.04
for _ in range(16):
    m_ = (lo+hi)/2
    if bust_g(mix+disp(m_)) < BUST: lo = m_
    else: hi = m_
kB = (lo+hi)/2; D = disp(kB)
print("bust keep:", round(g0, 1), "->", round(bust_g(mix+D), 1), "spread mm", round(kB*1000, 1))
k = k0 or ob.shape_key_add(name="custom-bust-keep", from_mix=False)
k.data.foreach_set("co", (B+D).ravel()); k.value = 1.0; me.update()
