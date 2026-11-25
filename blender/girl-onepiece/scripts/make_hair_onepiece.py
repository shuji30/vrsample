# 4 人目（ワンピース）の髪：前髪を作らず後ろへなでつけた黒髪のまとめ髪。まん中で分け、えりあしの低い位置で一つに結び、黒いリボンを付ける。
#   make_face_onepiece.py の最後で実行する（hair_params の C・RX・RY・RZ を使う）。Girl_Hair のメッシュを作り直す（厚み・めり込み防止・材質はそのまま）。
#   共通の make_hair_pony.py（高い位置のロングポニーテール）を元にしている。ちがい：
#     ・前髪の板を作らない。頭を包む髪（CAP）は、額の生えぎわ・耳の上・えりあしで終わる（耳は出す）
#     ・結び目はえりあしの少し上。毛束は短め（肩甲骨の上まで）で、ゆるく内へ入る
#     ・髪の流れの毛束（FLOW）は、まん中の分け目と生えぎわから、結び目へ向かって引きつめる
#     ・結び目に黒いリボン（輪 2 つ・結び目・垂れ 2 本）。書き出しで髪と同じ 1 枚の画像に焼くので、材質は髪と同じ（黒）にし、
#       UV は髪の画像の毛先でない所（不透明）に置く
# 前のボブ（make_hair_onepiece_bob.py）は使っていない。
import bpy, bmesh, math, random
from mathutils import Vector
from mathutils.bvhtree import BVHTree
_rig = bpy.data.objects.get("Girl_Rig"); _pose = _rig.data.pose_position if _rig else None    # 骨組みがあれば、作る間は基本の姿勢に戻す
if _rig: _rig.data.pose_position = 'REST'; bpy.context.view_layer.update()

body = bpy.data.objects["Girl_Body"]
HP = body["hair_params"].to_dict()
dg = bpy.context.evaluated_depsgraph_get()
def make_bvh(names):
    vs = []; ps = []
    for name in names:
        o = bpy.data.objects.get(name)
        if not o: continue
        e = o.evaluated_get(dg); m = e.to_mesh(); b = len(vs)
        vs += [o.matrix_world @ v.co for v in m.vertices]
        ps += [tuple(b+i for i in p.vertices) for p in m.polygons]
        e.to_mesh_clear()
    return BVHTree.FromPolygons(vs, ps)
bvh = make_bvh(("Girl_Body",))
bvh2 = make_bvh(("Girl_Body", "OP_Dress"))               # 結んだ毛束は、服の えり・背中もよける

_sh = Vector(body.get("heel_shift", (0, 0, 0)))
C = Vector(HP.get("C", (0, -0.050, 1.520)))+_sh
RX = HP.get("RX", 0.101); RY = HP.get("RY", 0.113); RZ = HP.get("RZ", 0.108)
NP = 16                                                   # 頭を包む毛の、上から生えぎわまでの点の数
def sstep(t): t = max(0, min(1, t)); return t*t*(3-2*t)
def lerp(a, b, t): return a+(b-a)*t
def ell(th, ph): return C+Vector((RX*math.sin(ph)*math.sin(th), -RY*math.sin(ph)*math.cos(th), RZ*math.cos(ph)))

# 耳の上のふち：頭を包む髪は、耳の上を通って後ろへ回る（耳は出す）
_mkb = next(md for md in body.modifiers if md.type == 'MASK'); _mkb.show_viewport = False; bpy.context.view_layer.update()
_eb = body.evaluated_get(bpy.context.evaluated_depsgraph_get()); _em = _eb.to_mesh()
_eco = [body.matrix_world @ v.co for v in _em.vertices]; _eb.to_mesh_clear(); _mkb.show_viewport = True
_ei = body.vertex_groups["ears"].index
_ep = [_eco[v.index] for v in body.data.vertices if _eco[v.index].x > 0 and any(g.group == _ei and g.weight > 0.5 for g in v.groups)]
EAR_TOP = max(p.z for p in _ep); EAR_BACK = max(p.y for p in _ep)
PH_EAR = math.degrees(math.acos(max(-0.99, min(0.99, (EAR_TOP+0.006-C.z)/RZ))))     # 耳の上 6mm を通る角度

def pe_of(a):
    """頭を包む髪の終わり（上からの角度。度）。a は前からの角度（0 が額のまん中、180 が後ろ）"""
    front = 69.5                                          # 額の生えぎわ（57・66 では、おでこが広すぎた。72 では毛束が目の上に垂れた）
    temple = lerp(front, 92.0, sstep((a-20)/38))         # こめかみで下がる（こめかみまで髪で覆う）
    ear = PH_EAR
    back = 126.0                                          # えりあし
    if a < 70: return temple
    if a < 100: return lerp(90.0 if a >= 62 else temple, ear, sstep((a-70)/12))
    return lerp(ear, back, sstep((a-100)/30))

# ── 頭を包む髪（CAP）──
_rnd = random.Random(7)
bm = bmesh.new(); uv = bm.loops.layers.uv.new("UVMap"); uvt = bm.loops.layers.uv.new("Tip")
L_t = bm.verts.layers.float.new("t"); L_c = bm.verts.layers.float.new("clump")
ths = [-180+360*i/96 for i in range(97)]
grid = []; tips = []
for th in ths:
    a = abs(th); pe = pe_of(a); col = []; tv = []
    for j in range(NP+1):
        ph = pe*j/NP; p = ell(math.radians(th), math.radians(ph))
        v = bm.verts.new(p); v[L_t] = 0.0; v[L_c] = 0.0; col.append(v); tv.append(4.0)     # 生えぎわは毛先として透かさない（透かすと、ふちがギザギザに欠けた）
    grid.append(col); tips.append(tv)
for i in range(len(grid)-1):
    a_, b_ = grid[i], grid[i+1]
    for j in range(NP):
        try: f = bm.faces.new((a_[j], a_[j+1], b_[j+1], b_[j]))
        except ValueError: continue
        for l, (ii, jj) in zip(f.loops, ((i, j), (i, j+1), (i+1, j+1), (i+1, j))):
            l[uv].uv = (ii/96, 1-jj/(NP+10)); l[uvt].uv = (ii/96, tips[ii][jj])
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0004)
def push(gap=0.006):
    for v in bm.verts:
        loc, nor, idx, dist = bvh.find_nearest(v.co)
        if loc is None: continue
        if (v.co-loc).dot(nor) < 0 or dist < gap: v.co = loc+nor*gap
# なでつけた髪：頭の形の楕円体のままだと、頭の横で頭から離れてふくらむ。頭の表面から CAP_GAP の所へ吸いつけてから、ならす
CAP_GAP = 0.007
for v in bm.verts:
    loc, nor, idx, dist = bvh.find_nearest(v.co)
    if loc is not None: v.co = loc+nor*CAP_GAP
for it in range(4):
    bmesh.ops.smooth_vert(bm, verts=[v for v in bm.verts if not v.is_boundary], factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    push(CAP_GAP)
# 生えぎわのふち：ふちに沿ってならし（ギザギザを消す）、頭の表面に戻す
_rim = [v for v in bm.verts if v.is_boundary]
for it in range(12):
    nw = {}
    for v in _rim:
        nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
        if len(nb) == 2: nw[v] = v.co*0.5+(nb[0].co+nb[1].co)*0.25
    for v, c_ in nw.items(): v.co = c_
    for v in _rim:
        loc, nor, idx, dist = bvh.find_nearest(v.co)
        if loc is not None: v.co = loc+nor*CAP_GAP
n_cap = len(bm.faces)

# ── 結び目と、結んだ毛束（えりあしの少し上。短め）──
YB = C.y+RY                                              # 後頭部のいちばん後ろ
TIE = Vector((0.0, C.y+RY*0.86, C.z-RZ*0.42))            # 結び目は頭の表面（えりあしの少し上）
_hit = bvh.find_nearest(TIE)
if _hit[0] is not None: TIE = _hit[0]+_hit[1]*0.012       # 頭の表面から 1.2cm 外
_tie_d = Vector(((TIE.x-C.x)/RX, (TIE.y-C.y)/RY, (TIE.z-C.z)/RZ)).normalized()

def catmull(P, n):
    Q = [P[0]]+list(P)+[P[-1]]; out = []
    for i in range(1, len(Q)-2):
        for k in range(n):
            t = k/n; a, b, c, e = Q[i-1], Q[i], Q[i+1], Q[i+2]
            out.append(0.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-e)*t*t+(-a+3*b-3*c+e)*t**3))
    out.append(P[-1]); return out
def resample(pts, n):
    d = [0.0]
    for a, b in zip(pts, pts[1:]): d.append(d[-1]+(b-a).length)
    out = []; j = 0
    for i in range(n+1):
        s = d[-1]*i/n
        while j < len(d)-2 and d[j+1] < s: j += 1
        t = (s-d[j])/max(1e-9, d[j+1]-d[j]); out.append(pts[j].lerp(pts[j+1], min(1, max(0, t))))
    return out
def tail(ctrl, seed, R0=0.010, R1=0.020, NST=12, TURNS=(0.2, 0.5)):
    """結んだ毛束：軸のまわりを、何本もの毛束がゆるく回りながら下りる。太さは根元 R0 → 中ほど R1 → 毛先へ細く"""
    NA = 120; rnd = random.Random(seed)
    ax = resample(catmull([Vector(p) for p in ctrl], 24), NA)
    def RB(s): return (R0+(R1-R0)*sstep(s/0.35))*(1-0.6*sstep((s-0.70)/0.30))
    for it in range(6):                                  # 首・えり・背中をよける
        for i in range(int(NA*0.08), NA+1):
            loc, nor, idx, dist = bvh2.find_nearest(ax[i]); need = RB(i/NA)+0.006
            if loc is not None:
                sd = (ax[i]-loc).dot(nor)
                if sd < need: ax[i] = ax[i]+nor*(need-sd)
        for _ in range(3): ax = [ax[0]]+[(ax[i-1]+ax[i]*2+ax[i+1])/4 for i in range(1, NA)]+[ax[-1]]
    ax = resample(ax, NA)
    T = [(ax[min(NA, i+1)]-ax[max(0, i-1)]).normalized() for i in range(NA+1)]
    U = [T[0].cross(Vector((0, 1, 0))).normalized()]
    for i in range(1, NA+1):
        u = U[-1]-T[i]*U[-1].dot(T[i]); U.append(u.normalized())
    W = [T[i].cross(U[i]) for i in range(NA+1)]
    def at(s):
        f = max(0.0, min(1.0, s))*NA; i = min(NA-1, int(f)); t = f-i
        return ax[i].lerp(ax[i+1], t), U[i].lerp(U[i+1], t).normalized(), W[i].lerp(W[i+1], t).normalized()
    NR = 60; NK = 3
    for k in range(NST):
        ph = 2*math.pi*k/NST+rnd.uniform(-0.3, 0.3); turns = rnd.uniform(*TURNS); hand = 1 if k % 3 else -1
        send = rnd.uniform(0.82, 1.0); rr = rnd.uniform(0.75, 1.1); wid = rnd.uniform(0.012, 0.018)
        def center(s):
            p, u, w = at(s*send)
            th = ph+hand*2*math.pi*turns*s**1.5
            rad = u*math.cos(th)+w*math.sin(th)
            return p+rad*RB(s*send)*rr, rad
        rows = []
        for i in range(NR+1):
            s = i/NR; c, rad = center(s); c2, _ = center(min(1, s+0.004)); c1, _ = center(max(0, s-0.004))
            tg = (c2-c1).normalized(); side = tg.cross(rad)
            if side.length < 1e-6: side = Vector((1, 0, 0))
            side.normalize(); nrm = side.cross(tg).normalized()
            w = wid*(0.6+0.4*sstep(s/0.15))*(1-0.75*sstep((s-0.70)/0.30))
            row = []
            for q in range(NK+1):
                kk = -1+2*q/NK; pt = c+side*(kk*w/2)+nrm*(0.003*(1-kk*kk))
                v = bm.verts.new(pt); v[L_t] = 0.45+0.45*s; v[L_c] = 0.0; row.append(v)
            rows.append(row)
        uc = 0.07+k*0.06
        for i in range(NR):
            for q in range(NK):
                f = bm.faces.new((rows[i][q], rows[i+1][q], rows[i+1][q+1], rows[i][q+1]))
                for l, (ii, qq) in zip(f.loops, ((i, q), (i+1, q), (i+1, q+1), (i, q+1))):
                    l[uv].uv = (uc+qq/NK*0.04, 1-ii/NR); l[uvt].uv = (uc+qq/NK*0.04, (NR-ii)/NR/0.12)
tz = TIE.z
PONY = (TIE, (0.0, TIE.y+0.022, tz-0.035), (0.0, TIE.y+0.030, tz-0.090), (0.0, TIE.y+0.024, tz-0.150), (0.0, TIE.y+0.010, tz-0.195))
tail(PONY, 11)

# ── 髪の流れ（FLOW）：分け目と生えぎわから、結び目へ引きつめる細い毛束 ──
def _dir_of(thd, phd):
    th = math.radians(thd); ph = math.radians(phd); return Vector((math.sin(ph)*math.sin(th), -math.sin(ph)*math.cos(th), math.cos(ph)))
_fr = random.Random(23); _nlock = [0]
def lock(dirs, wid, lift):
    NS = 28; NKL = 3
    ds = resample(catmull(dirs, 10), NS); g = []; uc = 0.02+0.031*(_nlock[0] % 30); _nlock[0] += 1
    cs = []
    for i, d in enumerate(ds):
        d = d.normalized(); s = i/NS
        c = C+Vector((d.x*RX, d.y*RY, d.z*RZ))
        loc, nor, idx, dist = bvh.find_nearest(c)                 # 頭を包む髪と同じく、頭の表面から測った高さに置く
        if loc is not None: c = loc+nor*(CAP_GAP+0.0008+lift*math.sin(math.pi*min(1, s*1.1))**0.6)
        cs.append((c, d))
    for i, (c, d) in enumerate(cs):
        s = i/NS; tg = (cs[min(NS, i+1)][0]-cs[max(0, i-1)][0]).normalized(); side = tg.cross(d).normalized()
        w = wid*(0.35+0.65*sstep(s/0.15))*(1-0.6*sstep((s-0.80)/0.20)); row = []
        for q in range(NKL+1):
            kk = -1+2*q/NKL; pt = c+side*(kk*w/2)+d*(0.0015*(1-kk*kk))
            loc, nor, idx, dist = bvh.find_nearest(pt)
            if loc is not None and ((pt-loc).dot(nor) < 0 or dist < CAP_GAP+0.0006): pt = loc+nor*(CAP_GAP+0.0006)
            v = bm.verts.new(pt); v[L_t] = 0.80+0.18*s; v[L_c] = 0.0; row.append(v)
        g.append(row)
    for i in range(NS):
        for q in range(NKL):
            f = bm.faces.new((g[i][q], g[i+1][q], g[i+1][q+1], g[i][q+1]))
            for l, (ii, qq) in zip(f.loops, ((i, q), (i+1, q), (i+1, q+1), (i, q+1))):
                l[uv].uv = (uc+qq/NKL*0.03, 1-ii/NS); l[uvt].uv = (uc+qq/NKL*0.03, 3.0)    # 生えぎわ側の根元も薄くしない
def _arc(d0, n=4, wob=0.0):
    out = [d0]
    for i in range(1, n+1):
        t = i/(n+1); m_ = (d0*(1-t)+_tie_d*t).normalized()
        sd_ = m_.cross(Vector((0, 0, 1)))
        if sd_.length > 1e-6: m_ = (m_+sd_.normalized()*wob*math.sin(math.pi*t)).normalized()
        out.append(m_)
    return out+[_tie_d]
for sg in (1, -1):
    for k in range(8):                                  # 分け目から：額の上を通り、てっぺんをこえて結び目へ（多く・高くすると、頭の上がごつごつ盛り上がった）
        t0 = sg*lerp(4, 26, k/7)+_fr.uniform(-1.5, 1.5)
        lock(_arc(_dir_of(t0, pe_of(abs(t0))-5.0), 4, _fr.uniform(-0.03, 0.03)), _fr.uniform(0.012, 0.016), _fr.uniform(0.0002, 0.0006))
    for k in range(6):                                  # 生えぎわ（こめかみ）から、横を通って結び目へ（耳の上まで出すと、耳の上でギザギザに重なった）
        a0 = lerp(30, 70, k/5)+_fr.uniform(-2, 2)
        lock(_arc(_dir_of(sg*a0, pe_of(a0)-5.0), 4, _fr.uniform(-0.03, 0.03)), _fr.uniform(0.012, 0.016), _fr.uniform(0.0002, 0.0006))
n_hair = len(bm.faces)

# ── 結び目のゴムと、黒いリボン（材質は髪と同じ。UV は不透明な所）──
RIB_UV = (0.5, 0.5); RIB_TIP = 10.0
def _rib_face(vs):
    f = bm.faces.new(vs)
    for l in f.loops: l[uv].uv = RIB_UV; l[uvt].uv = (RIB_UV[0], RIB_TIP)
    for v in vs: v[L_t] = 0.95
    return f
_dir = (Vector(PONY[1])-Vector(PONY[0])).normalized()
_u = Vector((1, 0, 0)); _w = _dir.cross(_u).normalized(); _u = _w.cross(_dir).normalized()
KR = 0.013; Kr = 0.004; ring = []                       # ゴム：毛束の根元を巻く輪
for i in range(20):
    a = 2*math.pi*i/20; rad = _u*math.cos(a)+_w*math.sin(a)
    ring.append([bm.verts.new(TIE+_dir*0.004+rad*(KR+Kr*math.cos(2*math.pi*k/8))+_dir*(Kr*math.sin(2*math.pi*k/8))) for k in range(8)])
for i in range(20):
    for k in range(8): _rib_face((ring[i][k], ring[(i+1) % 20][k], ring[(i+1) % 20][(k+1) % 8], ring[i][(k+1) % 8]))
BACK = Vector((0, 1, 0)); UPV = Vector((0, 0, 1)); RIGHT = Vector((1, 0, 0))
_bc = TIE+BACK*0.012                                     # リボンの結び目（ゴムの後ろ）
def blob(c, rx, ry, rz):
    """楕円体（x・y・z の半径）"""
    nu = 12; nv = 6; rings = []
    for i in range(1, nv):
        a = math.pi*i/nv
        rings.append([bm.verts.new(c+Vector((rx*math.sin(a)*math.cos(k*2*math.pi/nu), ry*math.sin(a)*math.sin(k*2*math.pi/nu), rz*math.cos(a)))) for k in range(nu)])
    for i in range(len(rings)-1):
        for k in range(nu): _rib_face((rings[i][k], rings[i][(k+1) % nu], rings[i+1][(k+1) % nu], rings[i+1][k]))
    for rg, z in ((rings[0], rz), (rings[-1], -rz)):
        cv = bm.verts.new(c+Vector((0, 0, z)))
        for k in range(nu): _rib_face((rg[k], rg[(k+1) % nu], cv) if z > 0 else (rg[(k+1) % nu], rg[k], cv))
def bow_loop(sgn):
    """結び目から横へ出て戻る輪（幅 1.4cm の帯）。sgn = 1 で本人の左へ。輪の先は少し下がる"""
    NS = 18; A = []; B = []; RW = 0.014; L = 0.036
    for s in range(NS+1):
        a = 2*math.pi*s/NS
        c = _bc+RIGHT*(sgn*L*(0.5-0.5*math.cos(a)))-UPV*(0.006*(0.5-0.5*math.cos(a)))+BACK*(0.004+0.005*math.sin(a))
        w = RW*0.5*(0.45+0.75*math.sin(a/2))
        A.append(bm.verts.new(c-UPV*w)); B.append(bm.verts.new(c+UPV*w))
    for s in range(NS): _rib_face((A[s], A[s+1], B[s+1], B[s]) if sgn > 0 else (B[s], B[s+1], A[s+1], A[s]))
bow_loop(1); bow_loop(-1)
blob(_bc+BACK*0.005, 0.006, 0.005, 0.008)               # 結び目
for sgn, ln in ((1, 0.070), (-1, 0.060)):               # 垂れ：毛束の上を、少し外へ開いて下りる
    NS = 10; A = []; B = []
    for s in range(NS+1):
        q = s/NS; c = _bc+BACK*(0.010+0.008*q)+RIGHT*(sgn*(0.004+0.012*q))-UPV*(ln*q)
        hw = 0.006
        A.append(bm.verts.new(c-RIGHT*hw)); B.append(bm.verts.new(c+RIGHT*hw-UPV*(0.006 if s == NS else 0.0)))   # 先はななめに切る
    for s in range(NS): _rib_face((A[s], A[s+1], B[s+1], B[s]))
bmesh.ops.recalc_face_normals(bm, faces=[f for i, f in enumerate(bm.faces) if i >= n_hair])

# ── Girl_Hair に入れる ──
bm.verts.ensure_lookup_table(); _tw = [v[L_t] for v in bm.verts]
h = bpy.data.objects["Girl_Hair"]; bm.to_mesh(h.data); bm.free()
g = h.vertex_groups.get("thick") or h.vertex_groups.new(name="thick")
for i, t in enumerate(_tw): g.add([i], max(0.05, 1-0.95*t), 'REPLACE')
for md in h.modifiers:
    if md.type == 'SOLIDIFY': md.vertex_group = "thick"; md.thickness_vertex_group = 0.05; md.thickness = 0.006
for p in h.data.polygons: p.use_smooth = True
h.data.update()
print("hair rebuilt (low ponytail)", len(h.data.vertices), len(h.data.polygons), "ear top", round(EAR_TOP, 3), "ph ear", round(PH_EAR, 1))
if _rig:                                                 # 作り直した物を骨組みに付け直し、姿勢を元に戻す
    exec(compile(open("C:\\Users\\shuji\\Documents\\girl-blender\\scripts\\bind_rig.py", encoding="utf-8").read(), "bind_rig.py", "exec"), {"__name__": "__main__"})
    _rig.data.pose_position = _pose
    _po = next((x for x in h.modifiers if x.name == "PushOut"), None); _dr = bpy.data.objects.get("OP_Dress")
    if _po and _dr:                                      # めり込み防止の相手に、上身ごろ（えり）を入れる（bind_rig.py はワンピースを知らないので）
        _ids = {it.name: it.identifier for it in _po.node_group.interface.items_tree if it.item_type == 'SOCKET' and it.in_out == 'INPUT'}
        getattr(_po.properties.inputs, _ids["Target B"]).value = _dr
