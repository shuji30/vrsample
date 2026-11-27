# 5 人目（ワンピース 2）の胴回りを、スリーサイズ（BUST・WAIST・HIP）に合わせ直す（Blender の中で exec する）。シェイプキー custom-girth を作り直す。
#   腕・脚の長さを変えた（set_limbs_onepiece2.py）あとに、胴回りが 1cm ほどずれたのを直すため。
#   高さ z の平面で肌（腕と補助の形を除く）を切った断面の、凸包の周（巻き尺で測るのと同じ）を測り、
#   バスト・ウエスト・ヒップの高さで目標との比を出して、高さごとに胴の中心から横・前後へ広げる（あいだはなめらかにつなぐ。わきの下より上は動かさない）
#   何度流してもよい（custom-girth を 0 にしてから測り直す）。流したあとは服を流し直す
import bpy, math
import numpy as np
BUST = globals().get("BUST", 86.0); WAIST = globals().get("WAIST", 58.0); HIP = globals().get("HIP", 84.0)
ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks; rig = bpy.data.objects["Girl_Rig"]
was = rig.data.pose_position; rig.data.pose_position = 'REST'
kg = kb.get("custom-girth")
if kg: kg.value = 0.0
mods = [m_ for m_ in ob.modifiers if m_.type in ('MASK', 'SUBSURF')]; st = [m_.show_viewport for m_ in mods]
for m_ in mods: m_.show_viewport = False
bpy.context.view_layer.update()
ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
n = len(m.vertices); co = np.zeros(n*3); m.vertices.foreach_get("co", co); co = co.reshape(n, 3); ev.to_mesh_clear()
for m_, s_ in zip(mods, st): m_.show_viewport = s_
names = {g.index: g.name for g in ob.vertex_groups}
bodyg = {ob.vertex_groups["body"].index, ob.vertex_groups["hidden_by_clothes"].index}
ARMK = ("UpperArm", "LowerArm", "Hand", "Thumb", "Index", "Middle", "Ring", "Little")
real = np.zeros(n, bool); armw = np.zeros(n)
for v in me.vertices:
    real[v.index] = any(g.group in bodyg and g.weight > 0.5 for g in v.groups)
    tot = sum(g.weight for g in v.groups if names[g.group] in rig.data.bones)
    if tot > 1e-6: armw[v.index] = sum(g.weight for g in v.groups if any(k in names[g.group] for k in ARMK))/tot
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
_E = np.array(sorted({tuple(sorted(e)) for p_ in me.polygons if not armish[list(p_.vertices)].any() for e in p_.edge_keys}))
def cut(P, z):
    a = P[_E[:, 0]]; b = P[_E[:, 1]]; c = (a[:, 2]-z)*(b[:, 2]-z) < 0
    a = a[c]; b = b[c]; w = ((z-a[:, 2])/(b[:, 2]-a[:, 2]))[:, None]; X = a+(b-a)*w
    return X[np.abs(X[:, 0]) < 0.25]
def girth(P, z): return hull_per(cut(P, z)[:, :2])*100
sh_z = float(rig.data.bones["leftUpperArm"].head_local.z)
zs = np.arange(0.62, sh_z, 0.005); gs = np.array([girth(co, z) for z in zs])
def pick(a, b, f): return f([(g, z) for z, g in zip(zs, gs) if a <= z <= b and g > 0])
gB, zB = pick(sh_z-0.16, sh_z-0.04, max); gW, zW = pick(zB-0.25, zB-0.06, min); gH, zH = pick(zW-0.35, zW-0.12, max)
print("before: B", round(gB, 1), "@", round(zB, 3), "W", round(gW, 1), "@", round(zW, 3), "H", round(gH, 1), "@", round(zH, 3))
CPZ = [zH-0.12, zH, zW, zB, sh_z-0.03]; CPK = [1.0, HIP/gH, WAIST/gW, BUST/gB, 1.0]
def kz(z): return np.interp(z, CPZ, CPK)
yc_z = np.array([(lambda q: (q[:, 1].min()+q[:, 1].max())/2 if len(q) else -0.04)(cut(co, z)) for z in zs])
yc_z = np.convolve(np.pad(yc_z, 4, mode='edge'), np.ones(9)/9, mode='valid')
k = kz(co[:, 2]); yc = np.interp(co[:, 2], zs, yc_z)
D = np.zeros_like(co); D[:, 0] = co[:, 0]*(k-1); D[:, 1] = (co[:, 1]-yc)*(k-1)
D *= (1-armw)[:, None]
B0 = np.zeros(n*3); kb["Basis"].data.foreach_get("co", B0)
kg = kg or ob.shape_key_add(name="custom-girth", from_mix=False)
kg.data.foreach_set("co", (B0.reshape(n, 3)+D).ravel()); kg.value = 1.0; me.update()
Q = co+D
print("after: B", round(max(girth(Q, z) for z in np.arange(zB-0.03, zB+0.03, 0.005)), 1), "W", round(min(girth(Q, z) for z in np.arange(zW-0.03, zW+0.03, 0.005)), 1),
      "H", round(max(girth(Q, z) for z in np.arange(zH-0.03, zH+0.03, 0.005)), 1))
rig.data.pose_position = was
