# 5 人目（ワンピース 2）のパンプスを、既製のモデル（Sketchfab「Classic high heel pumps」作者 Earl_1、CC-BY 4.0）から作る（Blender の中で exec する）。
#   取り込んだ左の靴（PumpL。つま先 -Y、かかとの後ろ y=0、床 z=0 に置き直したもの）を、今の足に合わせて変形して OP_PumpL / OP_PumpR にする：
#   1) ミドルヒールに：指の付け根（中敷きのいちばん低い所 PIV）を軸に、靴の後ろ半分を回して下げ、中敷きの傾きを足の裏の傾きにそろえる。
#      ヒールの柱は、上の付け根が下がったぶん、床の先を残して縮める
#   2) 足に合わせて縮め、指の付け根を足の指の付け根の下に置く。浮いたぶんは、靴底の下 6mm を床までのばす
#   3) 右足の靴は左を鏡写しにする。骨組みに付け（足の骨）、靴の中に入る足の肌を隠す（肌の外側に靴があれば隠す）
#   クレジット（CC-BY）："Classic high heel pumps" by Earl_1 (Sketchfab) — CC BY 4.0
import bpy, math
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
src = bpy.data.objects["PumpL"]
ob = bpy.data.objects["Girl_Body"]; rig = bpy.data.objects["Girl_Rig"]
was = rig.data.pose_position; rig.data.pose_position = 'REST'
def ss(x): return np.clip(x, 0, 1)**2*(3-2*np.clip(x, 0, 1))
# ── 足の裏の点（左足）──
mods = [m for m in ob.modifiers if m.type in ('MASK', 'SUBSURF')]; st = [m.show_viewport for m in mods]
for m in mods: m.show_viewport = False
bpy.context.view_layer.update(); e = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); me_ = e.to_mesh()
co = np.array([tuple(v.co) for v in me_.vertices]); vn = np.array([tuple(v.normal) for v in me_.vertices]); e.to_mesh_clear()
for m, s in zip(mods, st): m.show_viewport = s
gi = {g.name: g.index for g in ob.vertex_groups}; bi = {gi["body"], gi["hidden_by_clothes"]}
def foot_idx(side):
    return [v.index for v in ob.data.vertices if any(g.group in (gi[side+"Foot"], gi[side+"Toes"]) and g.weight > 0.3 for g in v.groups)
            and any(g.group in bi and g.weight > 0.5 for g in v.groups)]
FI = foot_idx("left"); F = co[FI]
hy = F[:, 1].max(); hb = F[F[:, 1] > hy-0.015]; HEEL = hb[np.argmin(hb[:, 2])]
by = rig.data.bones["leftToes"].head_local.y; bb = F[np.abs(F[:, 1]-by) < 0.006]; BALL = bb[np.argmin(bb[:, 2])]
CX = (F[:, 0].min()+F[:, 0].max())/2; FW = F[:, 0].max()-F[:, 0].min()
foot_slope = math.atan2(HEEL[2]-BALL[2], HEEL[1]-BALL[1]); foot_len = math.hypot(HEEL[2]-BALL[2], HEEL[1]-BALL[1])
# ── 靴の中敷き（取り込んだときの寸法）──
PIV = np.array([0.0, -0.155, 0.0045]); HIN = np.array([0.0, -0.020, 0.120])        # 中敷きの指の付け根・かかと
shoe_slope = math.atan2(HIN[2]-PIV[2], HIN[1]-PIV[1]); shoe_len = math.hypot(HIN[2]-PIV[2], HIN[1]-PIV[1])
MIDDLE = globals().get("MIDDLE", True)          # True：後ろ半分を回してミドルヒールに。False：元の形のまま（足を靴の角度に合わせて傾けておく）
A = (shoe_slope-foot_slope) if MIDDLE else 0.0
ZBB = [(-0.075, 0.064), (-0.065, 0.0775), (-0.055, 0.0883), (-0.045, 0.0963), (-0.035, 0.1019), (-0.025, 0.1044), (-0.005, 0.1053), (0.002, 0.106)]   # 靴の本体の底の高さ（後ろ。測った値）
def zbb(y): return float(np.interp(y, [q[0] for q in ZBB], [q[1] for q in ZBB]))
P = np.array([tuple(v.co) for v in src.data.vertices])
def rot(p, a):
    d = p-PIV; c, s = math.cos(a), math.sin(a)
    return PIV+np.array([d[0], d[1]*c+d[2]*s, -d[1]*s+d[2]*c])
Q = P.copy()
post = (P[:, 1] > -0.07) & (np.abs(P[:, 0]) < 0.03) & (P[:, 2] < np.array([zbb(y) for y in P[:, 1]])-0.002)   # ヒールの柱（付け根の広がりまで）
for i in range(len(P)):
    p = P[i]
    if post[i]:
        T = np.array([p[0], p[1], zbb(p[1])]); T2 = rot(T, A); k = p[2]/T[2]
        Q[i] = np.array([p[0], p[1]+(T2[1]-T[1]), T2[2]*k])     # 柱は付け根が動いたぶん平行に動かし、床までまっすぐ（斜めに倒すと不自然だった）
    else:
        w = float(ss((p[1]-PIV[1])/0.05)) if p[1] > PIV[1] else 0.0
        Q[i] = rot(p, A*w)
# つま先の長さ：指の付け根より前を TOE_K 倍に縮める（足の指は付け根から 3cm しか前にないのに、靴は 9.7cm あり、長く大きく見えた）
UNIFORM = globals().get("UNIFORM", 0.82)      # 元の形のまま全体をこの倍率に（None なら下の合わせ方）
TOE_K = 1.0 if UNIFORM else globals().get("TOE_K", 0.55)
fr = Q[:, 1] < PIV[1]
Q[fr, 1] = PIV[1]+(Q[fr, 1]-PIV[1])*TOE_K
# 縮めて足に合わせる
TOE_EXT = globals().get("TOE_EXT", 0.028)        # 足の先からとがったつま先の先まで
HB_GAP = 0.004                                       # かかとの後ろと靴の内側のすき間
S = (F[:, 1].max()+HB_GAP-BALL[1])/(0.0-PIV[1])     # 靴のかかとの後ろ（y=0）〜中敷きの指の付け根（PIV）を、足のかかとの後ろ〜指の付け根に合わせる   # 靴の全長を足の前後の長さ＋つま先に（かかとと指の付け根の長さで決めると、足を傾けたとき 26.9cm と大きすぎた）
SX = (FW+0.002)/(P[:, 0].max()-P[:, 0].min())   # 幅は足ぎりぎりに
if UNIFORM: S = UNIFORM; SX = max(UNIFORM, (FW+0.014)/(P[:, 0].max()-P[:, 0].min()))   # 長さと高さは UNIFORM。幅は足が収まるように（細いと肌が履き口からはみ出した）
Q[:, 0] *= SX; Q[:, 1:] *= S
piv_s = np.array([0, PIV[1]*S, PIV[2]*S])
Q += np.array([CX, F[:, 1].max()+HB_GAP-float(Q[:, 1].max()), BALL[2]-0.002-piv_s[2]])   # 回したあとの実際の靴のかかとの後ろを、足のかかとの後ろへ   # 靴のかかとの後ろを足のかかとの後ろへ（指の付け根で合わせると、かかとがはみ出した）   # 全体縮小のときは指の付け根で合わせる。それ以外は靴のかかとの後ろを足のかかとの後ろへ
zf = float(Q[:, 2].min())                                       # 浮いた高さ
band = 0.006
low = Q[:, 2] < zf+band
Q[low, 2] = (Q[low, 2]-zf)*((zf+band)/band)                      # 底の下 6mm を床までのばす
print("foot slope", round(math.degrees(foot_slope), 1), "shoe slope", round(math.degrees(shoe_slope), 1), "rot", round(math.degrees(A), 1), "scale", round(S, 3), round(SX, 3), "lift was", round(zf, 4))
def make(name, mirror):
    old = bpy.data.objects.get(name)
    if old: m_ = old.data; bpy.data.objects.remove(old); bpy.data.meshes.remove(m_)
    me = src.data.copy(); me.name = name
    R = Q.copy()
    if mirror: R[:, 0] *= -1
    me.vertices.foreach_set("co", R.ravel())
    if mirror: me.flip_normals()
    me.update()
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
    for p in me.polygons: p.use_smooth = True
    return o
L = make("OP_PumpL", False); Rr = make("OP_PumpR", True)
# 靴を足に沿わせる：足の肌の内側に入っている（または 2.5mm より近い）靴の頂点を、肌の 2.5mm 外へ押し出す。
#   まわりの頂点も、なだらかに一緒に動かす（押した量を 3 回となりへ広げる）。足が靴より太い所で、肌が靴を突きぬけたり、
#   肌を隠すと穴になったりしたため
import bmesh as _bm
for side, o in (("left", L), ("right", Rr)):
    fi = foot_idx(side)+[v.index for v in ob.data.vertices if co[v.index][2] < 0.16 and (co[v.index][0] > 0) == (side == "left") and abs(co[v.index][0]) > 0.04]
    fset = set(fi)
    fpol = [tuple(p_.vertices) for p_ in ob.data.polygons if all(v_ in fset for v_ in p_.vertices)]
    fb = BVHTree.FromPolygons([Vector(c_) for c_ in co], fpol)
    bm_ = _bm.new(); bm_.from_mesh(o.data); bm_.verts.ensure_lookup_table()
    disp = {}
    for v in bm_.verts:
        if v.co.z < 0.004: continue                                   # 床に着く所（ヒールの先・底）は動かさない
        loc, nor, _, d = fb.find_nearest(v.co)
        if loc is None or d > 0.02: continue
        s_ = (v.co-loc).dot(nor)
        if s_ < 0.0025: disp[v] = nor*(0.0025-s_)
    for _ in range(3):                                                # となりへ半分ずつ広げて、なだらかに
        add = {}
        for v, dv in disp.items():
            for e_ in v.link_edges:
                w_ = e_.other_vert(v)
                if w_ not in disp: add[w_] = add.get(w_, Vector())+dv*0.25
        for w_, dv in add.items(): disp[w_] = dv
    for v, dv in disp.items(): v.co += dv
    bm_.to_mesh(o.data); bm_.free(); o.data.update()
    print("fit to foot:", side, len(disp), "verts moved")
# 材質：白いエナメル（取り込んだ材質を置きかえる）
mt = bpy.data.materials.get("OP_PumpEnamel") or bpy.data.materials.new("OP_PumpEnamel"); mt.use_nodes = True
b = next(n for n in mt.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
b.inputs["Base Color"].default_value = (0.95, 0.94, 0.93, 1); b.inputs["Roughness"].default_value = 0.3
b.inputs["Coat Weight"].default_value = 1.0; b.inputs["Coat Roughness"].default_value = 0.03
mt.diffuse_color = (0.95, 0.94, 0.93, 1)
for o in (L, Rr):
    o.data.materials.clear(); o.data.materials.append(mt)
    o.parent = rig
# 隠す肌：肌の外側（法線の向き）6mm 以内に靴がある肌だけを隠す（靴を足に沿わせたので、包まれている肌はかならず当たる）
hide = []
for side, o in (("left", L), ("right", Rr)):
    bvh = BVHTree.FromPolygons([Vector(v.co) for v in o.data.vertices], [tuple(p_.vertices) for p_ in o.data.polygons])
    for i in foot_idx(side):
        p = Vector(co[i]); n = Vector(vn[i])
        if n.length < 1e-6: continue
        n.normalize()
        if bvh.ray_cast(p+n*0.0002, n, 0.006)[0] is not None: hide.append(i)
# 指の付け根より前（指）は、つま先の中に入るので全部隠す（足を強く傾けると、指が靴の外へ平らに出た）
for side in ("left", "right"):
    by_ = rig.data.bones[side+"Toes"].head_local.y
    pass   # （指の付け根より前を全部隠すと、靴の切れ込みから見える甲の肌まで消えて穴になったので、ふちの高さで決める上のやり方だけにする）
# 隠す肌をならす：まわりの点の多数決で、ふちに残ったぎざぎざの肌のかけらと、小さな穴を消す
_adj = [[] for _ in range(len(ob.data.vertices))]
for e_ in ob.data.edges: a_, b_ = e_.vertices; _adj[a_].append(b_); _adj[b_].append(a_)
_hs = set(hide); _zone = set(foot_idx("left")+foot_idx("right"))
for _ in range(3):
    _n = set(_hs)
    for i in _zone:
        nb = _adj[i]
        if not nb: continue
        f_ = sum(1 for j in nb if j in _hs)/len(nb)
        if i in _hs and f_ < 0.4: _n.discard(i)
        elif i not in _hs and f_ > 0.6: _n.add(i)
    _hs = _n
hide = sorted(_hs)
body = ob.vertex_groups["body"]; hid = ob.vertex_groups["hidden_by_clothes"]
# いったん足の肌を全部見せてから隠す
allfoot = foot_idx("left")+foot_idx("right")
body.add(allfoot, 1.0, 'REPLACE'); hid.remove(allfoot)
body.remove(hide); hid.add(hide, 1.0, 'REPLACE')
old = bpy.data.objects.get("OP_Shoes")
if old: old.hide_viewport = True; old.hide_render = True
for n in ("OP_ShoeBows",):
    o = bpy.data.objects.get(n)
    if o: o.hide_viewport = True; o.hide_render = True
src.hide_viewport = True; src.hide_render = True
rig.data.pose_position = was
exec(compile(open("C:\\Users\\shuji\\Documents\\girl-blender\\scripts\\bind_rig.py", encoding="utf-8").read(), "bind_rig.py", "exec"), {"__name__": "__main__"})
print("pumps:", len(L.data.vertices), "verts each, hidden skin", len(hide))
