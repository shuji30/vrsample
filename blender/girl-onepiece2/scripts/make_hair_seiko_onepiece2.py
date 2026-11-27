# 5 人目（ワンピース 2）の聖子ちゃんカット風の髪の、上の層（毛束）を作る（Blender の中で exec する。何度流してもよい）。
#   特定の人に似せるのではなく、80 年代のアイドルの髪形の特徴だけを入れる：
#   ・前髪：眉にかかる長さで、額から浮かせてふんわり丸く、毛先は内へ巻く。両端ほど長く、横の段へつながる
#   ・横の段（フェザー）：こめかみから下りた毛束が、ほお（上の段）・あご（下の段）の高さで、後ろへ・外へくるりと巻く
#   ・後ろ：肩までの長さで、毛先は外へはねる
#   下の層（Girl_Hair。make_hair_onepiece2_bob.py）は地肌を隠す土台。ここで作るのは Girl_HairLayer（その上に重ねる毛束）。
#   毛束は 1 本ずつリボン状の面（幅方向に少し丸めた 5 列）で、材質 Hair の UV の使い方に合わせる：
#     UVMap … 毛束ごとに重ならないマス（u が幅、v が長さ。書き出しで画像に焼くため重ねない）
#     Tip   … x は毛束をまたいで続く位置（毛先のばらつきの模様）、y は毛先からの長さ / TIP_SPAN（1 より小さい所で毛先が透ける）
#   作ったら共通の bind_rig.py で骨の重みを付け直す（Girl_Hair で始まる名前なので、頭の骨と髪の揺れ骨に付く）
import bpy, bmesh, math, random
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

OBJ = globals().get("OBJ", "Girl_HairLayer")
OFF = globals().get("OFF", 0.008)            # 下の層（楕円体 C・RX・RY・RZ の上に作る）から浮かせる量。参考の写真（丸くふくらんだボブ）に合わせて大きめに
TOP_VOL = globals().get("TOP_VOL", 0.010)    # てっぺんのふくらみ（m）
# 高さは目の骨（leftEye の基本の位置。EZ）からの距離で決める（靴を替えると体ごと上下するので、ワールドの高さでは決めない）
BANG_DZ = globals().get("BANG_DZ", 0.014)        # 前髪のまん中の毛先（眉の下のふちくらい。0.007 では目にかかりすぎた。前髪を密にしたので眉は隠れる）
BANG_ROUND = globals().get("BANG_ROUND", 0.010)  # 前髪の端を、まん中より何 m 長くするか
BANG_FLUFF = globals().get("BANG_FLUFF", 0.014)  # 前髪を額から浮かせる量（m。丸く厚い前髪に）
BANG_CURL = globals().get("BANG_CURL", 0.010)    # 前髪の毛先を内へ巻く半径（m）
BANG_CURL_ANG = globals().get("BANG_CURL_ANG", 55.0)   # 前髪の毛先を内へ巻く角度（度。80 度では、すける毛先が裏に隠れて下の端が四角く見えた）
BANG_HALF = globals().get("BANG_HALF", 60.0)     # 前髪の幅（顔の正面から左右に何度まで）
N_BANG = globals().get("N_BANG", 45)      # 21 本では幅 1.5cm の平たい板が並んで見えた。細い毛束にする
BANG_W = globals().get("BANG_W", 4.4)     # 根元側は重ねて額をすかさず、毛先の 4 割だけ細くとがらせる（2.7 で全長を細らせたら、箸を並べたように見えた）
# 横の段：(根元の角度の範囲（度）, 毛束の数, 浮かせる量（上の段ほど外へ重ねる）, 毛先の高さ（EZ から）, 巻きの半径, 巻く角度（度）, 後ろへ流す角度（度）, 外へのふくらみ, 巻く向き)
#   巻く向き：under＝内へ巻き込む（参考の写真のベル形のボブ）、back＝後ろへ流す（フェザー）、out＝外へはねる
#   横の段は正面から 60 度より後ろから下ろす（45 度からでは、横から見て顔の手前に髪がかかり鼻まで隠れた）
#   2026-11-28 の 3 枚目の参考の写真：丸くふくらんだボブで、横と後ろはあごの下〜首の高さで内へ巻き込む。耳と眉は隠れる
TIERS = globals().get("TIERS", [
    ((60, 105), 9, 0.006, -0.032, 0.020, 115.0, 6.0, 0.030, "under"),     # 上の段：ほおの高さで内へ巻く
    ((68, 122), 10, 0.003, -0.088, 0.024, 135.0, 8.0, 0.042, "under"),     # 下の段：あごの下で内へ巻く
])
BACK = globals().get("BACK", ((100, 180), 11, 0.0, -0.118, 0.024, 135.0, 0.0, 0.036, "under"))   # 後ろ：首の高さで内へ巻く
TIP_SPAN = globals().get("TIP_SPAN", 0.025)   # 毛先の透けの長さ（0.014 では毛先が四角く切れて見えた）
SEED = globals().get("SEED", 5)
NS = 20                                      # 毛束 1 本の長さ方向の点の数（34 と幅 5 列では 7 万 6 千三角形で、VR には重かった）
ROOT_PH = 1.5                               # 毛束の根元（てっぺんからの角度）。てっぺんはつむじの面（CAP）でふさぐ。てっぺんから出すと、つむじがすぼまってくぼんだ

rnd = random.Random(SEED)
ob = bpy.data.objects["Girl_Body"]; hp = ob["hair_params"]; sh = Vector(ob.get("heel_shift", (0, 0, 0)))
EZ = bpy.data.objects["Girl_Rig"].data.bones["leftEye"].head_local.z
Z_BROW = EZ+BANG_DZ
TIERS = [(a, n, lay, EZ+dz, rc, ang, sw, fl, md) for a, n, lay, dz, rc, ang, sw, fl, md in TIERS]
BACK = BACK[:3]+(EZ+BACK[3],)+BACK[4:]
C = Vector(hp["C"])+sh; RX, RY, RZ = hp["RX"], hp["RY"], hp["RZ"]
rig = bpy.data.objects.get("Girl_Rig"); _pose = rig.data.pose_position if rig else None
if rig: rig.data.pose_position = 'REST'; bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get(); _vs = []; _ps = []
for _name in ("Girl_Body", "OP_Dress"):
    _o = bpy.data.objects.get(_name)
    if not _o: continue
    e = _o.evaluated_get(dg); m = e.to_mesh(); _b = len(_vs)
    _vs += [_o.matrix_world @ v.co for v in m.vertices]; _ps += [tuple(_b+i for i in p.vertices) for p in m.polygons]
    e.to_mesh_clear()
bvh = BVHTree.FromPolygons(_vs, _ps)

def sstep(t): t = max(0.0, min(1.0, t)); return t*t*(3-2*t)
def dirv(th, ph):
    th = math.radians(th); ph = math.radians(ph)
    return Vector((math.sin(ph)*math.sin(th), -math.sin(ph)*math.cos(th), math.cos(ph)))
def scalp(th, ph, extra=0.0):
    """下の層の楕円体から OFF+extra 浮かせた点（頭の表面より 1.4cm は外）。th：正面から本人の左へ（度）、ph：てっぺんから（度）"""
    d = dirv(th, ph)
    vol = TOP_VOL*sstep((70-ph)/50)
    e = d/math.sqrt((d.x/RX)**2+(d.y/RY)**2+(d.z/RZ)**2)
    p = C+e+d*(OFF+vol)
    h = bvh.ray_cast(C+d*0.4, -d, 0.4)
    if h[0] is not None and (h[0]-C).length+0.014 > (p-C).length: p = h[0]+d*0.014
    return p+d*extra                                      # 重ねる量はいつも足す（頭の表面に切りかわる所で足さずにいたら、つむじの面だけが 1cm 浮いた）
def radial(p):
    r = Vector((p.x-C.x, p.y-C.y, 0)); return r.normalized() if r.length > 1e-6 else Vector((0, -1, 0))
def resample(pts, n):
    L = [0.0]
    for a, b in zip(pts, pts[1:]): L.append(L[-1]+(b-a).length)
    out = []; j = 0
    for i in range(n):
        s = L[-1]*i/(n-1)
        while j < len(L)-2 and L[j+1] < s: j += 1
        t = (s-L[j])/max(1e-9, L[j+1]-L[j]); out.append(pts[j].lerp(pts[j+1], t))
    return out
def smooth(pts, it=3, k=0.5):
    for _ in range(it):
        pts = [pts[0]]+[pts[i].lerp((pts[i-1]+pts[i+1])/2, k) for i in range(1, len(pts)-1)]+[pts[-1]]
    return pts
def curl(p, down, back, rc, ang, n=10):
    """p から、下向き down で入って、back の向きへくるりと巻く弧（半径 rc、ang 度）"""
    c = p+back*rc; out = []
    for i in range(1, n+1):
        a = math.radians(ang)*i/n
        out.append(c+(-back*math.cos(a)+down*math.sin(a))*rc)
    return out
def push(pts, gap=0.006):
    out = []
    for p in pts:
        loc, nor, idx, dist = bvh.find_nearest(p)
        if loc is not None and ((p-loc).dot(nor) < 0 or dist < gap): p = loc+nor*gap
        out.append(p)
    return out

locks = []      # (点の列, 幅, 外向きの基準の向きを返す関数)
# 前髪
for i in range(N_BANG):
    a = -1+2*i/(N_BANG-1); th = a*BANG_HALF+rnd.uniform(-2, 2)
    pts = [scalp(th*0.45, ROOT_PH)]
    for k in range(1, 8): pts.append(scalp(th*(0.45+0.55*k/7), ROOT_PH+(48-ROOT_PH)*k/7))
    H = pts[-1]
    cl = i//3; ca = -1+2*min(N_BANG-1, 3*cl+1)/(N_BANG-1)          # 3 本ずつの毛束（毛先を束の中心へ寄せ、束ごとに長さを変える。そろうとぱっつんのヘルメットに見えた）
    zt = Z_BROW-BANG_ROUND*a*a+random.Random(cl*7+3).uniform(-0.004, 0.004)+rnd.uniform(-0.003, 0.003)     # 1 本ずつも長さを変える
    fy = bvh.ray_cast(Vector((H.x*1.05, -1, zt)), Vector((0, 1, 0)))
    E = Vector((H.x*1.06, (fy[0].y if fy[0] else H.y)-0.006, zt))
    if abs(a) > 1e-3: E.x += (E.x*ca/a-E.x)*0.35          # 束の中心の毛束の毛先の横位置へ寄せる
    fwd = radial(H)
    for k in range(1, 9):
        t = k/8
        q = H.lerp(E, t)+fwd*BANG_FLUFF*math.sin(math.pi*min(1.0, t*0.9))
        pts.append(q)
    pts += curl(pts[-1], Vector((0, 0, -1)), -fwd, BANG_CURL*(0.7+0.3*rnd.random()), BANG_CURL_ANG, 4)     # 80 度巻くと、すける毛先が裏に隠れて、下の端が四角く切れて見えた
    w = 2*math.pi*0.11*(2*BANG_HALF/360)/N_BANG*BANG_W
    locks.append((pts, w, "bang"))
# 横の段と後ろ
def side_lock(th, extra, zend, rc, ang, sweep, flare, w, mode="back"):
    s = 1 if th >= 0 else -1
    rf = 0.6+0.4*sstep((abs(th)-90)/40)          # 根元を正面寄りにずらす割合（横は前から流す。後ろはまっすぐ下ろす。後ろもずらすと、つむじで毛束が交差して V 字のすき間ができた）
    pts = [scalp(th*rf, ROOT_PH, extra)]+[scalp(th*(rf+(1-rf)*k/8), ROOT_PH+(84-ROOT_PH)*k/8, extra) for k in range(1, 9)]     # 根元はてっぺんから（ph0 からにしたら、てっぺんに穴が開いた）
    S0 = pts[-1]; r0 = Vector((S0.x-C.x, S0.y-C.y)).length; z0 = S0.z
    hang = []
    for k in range(1, 11):
        t = k/10; z = z0+(zend-z0)*t
        thk = math.radians(th+s*sweep*sstep(t))
        r = r0+flare*math.sin(math.pi*min(1.0, t*0.85))+0.4*flare*t
        hang.append(Vector((C.x+r*math.sin(thk), C.y-r*math.cos(thk), z)))
    pts += hang
    P = pts[-1]; thk = math.radians(th+s*sweep)
    rad = Vector((math.sin(thk), -math.cos(thk), 0)); tb = Vector((math.cos(thk), math.sin(thk), 0))*s
    back = {"out": rad, "back": tb*0.75+rad*0.65, "under": -rad*0.9+tb*0.2}[mode].normalized()     # under：首・ほおの方へ内へ巻き込む
    pts += curl(P, Vector((0, 0, -1)), back, rc, ang, 6)
    locks.append((pts, w, "side"))
for ti, ((a0, a1), n, lay, zend, rc, ang, sweep, flare, md) in enumerate(TIERS):
    for s in (1, -1):
        for i in range(n):
            th = a0+(a1-a0)*i/max(1, n-1)+rnd.uniform(-3, 3)
            w = 2*math.pi*0.12*((a1-a0)/360)/max(1, n-1)*3.2     # 幅広く重ねる（2.4 では毛先が筒のように並んだ）
            side_lock(s*th, lay, zend+rnd.uniform(-0.010, 0.010), rc*(0.8+0.4*rnd.random()), ang*(0.85+0.3*rnd.random()), sweep+rnd.uniform(-4, 4), flare*(0.85+0.3*rnd.random()), w, md)     # 1 本ずつ流し方を変える（そろうと屋根瓦に見えた）
(a0, a1), n, lay, zend, rc, ang, sweep, flare, md = BACK
for i in range(2*n-1):
    th = a0+(360-2*a0)*i/(2*n-2) if True else 0
    th = th if th <= 180 else th-360
    w = 2*math.pi*0.12*((360-2*a0)/360)/(2*n-2)*2.8
    side_lock(th+rnd.uniform(-2, 2) if abs(th) < 178 else th, lay, zend+rnd.uniform(-0.008, 0.008), rc, ang, sweep, flare, w, md)

# 面を作る
bm = bmesh.new(); uv = bm.loops.layers.uv.new("UVMap"); uvt = bm.loops.layers.uv.new("Tip")
L_t = bm.verts.layers.float.new("t"); L_c = bm.verts.layers.float.new("clump"); L_b = bm.verts.layers.float.new("bang")
NL = len(locks); cols = math.ceil(math.sqrt((NL+2)*2)); rows = math.ceil((NL+2)/cols)     # 最後の 2 マスはつむじの面と地肌の面
ACROSS = (-1.0, 0.0, 1.0)
for li, (pts, w, kind) in enumerate(locks):
    pts = resample(smooth(push(resample(pts, NS)), 2, 0.4), NS); pts = push(pts, 0.005)
    seg = [(b-a).length for a, b in zip(pts, pts[1:])]; tot = sum(seg); acc = [0.0]
    for sg in seg: acc.append(acc[-1]+sg)
    cu = li % cols; cv = li//cols; u0 = cu/cols; v0 = cv/rows; du = 0.9/cols; dv = 0.92/rows
    grid = []
    for j, p in enumerate(pts):
        T = (pts[min(j+1, NS-1)]-pts[max(j-1, 0)]).normalized()
        Nr = (p-C); Nr.z *= 0.3; Nr = Nr.normalized()
        S = T.cross(Nr)
        if S.length < 1e-6: S = Vector((1, 0, 0))
        S.normalize(); N = S.cross(T).normalized()
        t = acc[j]/tot
        ww = w*(1.0-0.9*sstep((t-0.80)/0.20) if kind == "bang" else 1.0-0.65*t*t)*(0.6+0.4*sstep(t*6))     # 毛先へ細く（前髪は毛先の 4 割だけ）
        row = []
        for a in ACROSS:
            v = bm.verts.new(p+S*a*ww/2+N*(1-a*a)*ww*(0.08 if kind == "bang" else 0.10))     # 毛束を丸く
            v[L_t] = t; v[L_c] = 0.0; v[L_b] = 0.0; row.append(v)
        grid.append(row)
    for j in range(NS-1):
        for k in range(len(ACROSS)-1):
            f = bm.faces.new((grid[j][k], grid[j+1][k], grid[j+1][k+1], grid[j][k+1]))
            for l, (jj, kk) in zip(f.loops, ((j, k), (j+1, k), (j+1, k+1), (j, k+1))):
                uu = u0+du*kk/(len(ACROSS)-1); l[uv].uv = (uu, v0+dv*(1-jj/(NS-1)))
                l[uvt].uv = (uu, (tot-acc[jj])/TIP_SPAN)
# つむじの面（CAP）：てっぺんから 16 度までを、毛束の下でふさぐ（毛束がてっぺんに集まる所のすき間から地肌が見えないように）
#   毛束の根元はてっぺん（ROOT_PH）から出す（10 度からそろえて出したら、根元の切り口が輪に見えた）
_NA, _NR = 32, 5; _cu = NL % cols; _cv = NL//cols; _u0 = _cu/cols; _v0 = _cv/rows; _du = 0.9/cols; _dv = 0.92/rows
_top = bm.verts.new(scalp(0, 0.0, -0.002)); _top[L_t] = 0.0; _top[L_c] = 1.0; _top[L_b] = 0.0
_ring = []
for _r in range(1, _NR+1):
    _row = []
    for _a in range(_NA):
        # 毛束の下に全部しずめて、てっぺんのすき間だけをふさぐ（毛束の上に出すと、てっぺんに玉がのったように見えた）
        v = bm.verts.new(scalp(360*_a/_NA, 16.0*_r/_NR, -0.002-0.002*(_r/_NR))); v[L_t] = 0.0; v[L_c] = 1.0; v[L_b] = 0.0; _row.append(v)
    _ring.append(_row)
def _cuv(r, a): return (_u0+_du*a/_NA, _v0+_dv*(1-r/_NR))
for _a in range(_NA):
    f = bm.faces.new((_top, _ring[0][_a], _ring[0][(_a+1) % _NA]))
    for l, (r, a) in zip(f.loops, ((0, _a+0.5), (1, _a), (1, _a+1))): l[uv].uv = _cuv(r, a); l[uvt].uv = (l[uv].uv[0], 99.0)
    for _r in range(_NR-1):
        f = bm.faces.new((_ring[_r][_a], _ring[_r+1][_a], _ring[_r+1][(_a+1) % _NA], _ring[_r][(_a+1) % _NA]))
        for l, (r, a) in zip(f.loops, ((_r+1, _a), (_r+2, _a), (_r+2, _a+1), (_r+1, _a+1))): l[uv].uv = _cuv(r, a); l[uvt].uv = (l[uv].uv[0], 99.0)
# 地肌の面（SCALP）：頭の地肌にぴったり沿う髪色の薄い面。生え際から上、横は耳の下まで、後ろはえりあしまで。
#   前と横は下の層（Girl_Hair）が作らないので、下から見上げると前髪のすき間や耳のまわりから地肌が見えて、はげ頭のように見えた。
#   外から頭へ光線を当てて、いちばん外の面（耳も含む）から 2mm 浮かせるので、耳は外からくるまれる
_ZL_TH = [0, 35, 70, 95, 140, 180]; _ZL_DZ = [0.040, 0.040, 0.005, -0.045, -0.060, -0.070]
def _zlim(th): return EZ+float(np.interp(abs(th), _ZL_TH, _ZL_DZ))
def _shell(th, ph):
    d = dirv(th, ph); h = bvh.ray_cast(C+d*0.4, -d, 0.4)
    return (h[0]+d*0.002) if h[0] is not None else None
_SA, _SR = 64, 16; _cu = (NL+1) % cols; _cv = (NL+1)//cols; _su0 = _cu/cols; _sv0 = _cv/rows
_cols = []
for _a in range(_SA):
    th = 360*_a/_SA; th = th if th <= 180 else th-360
    phm = 20.0
    while phm < 160:
        q = _shell(th, phm+1)
        if q is None or q.z < _zlim(th): break
        phm += 1
    col = []
    for _r in range(_SR+1):
        q = _shell(th, 2+(phm-2)*_r/_SR) or scalp(th, 2+(phm-2)*_r/_SR, -0.01)
        v = bm.verts.new(q); v[L_t] = 0.0; v[L_c] = 1.0; v[L_b] = 0.0; col.append(v)
    _cols.append(col)
for _a in range(_SA):
    A = _cols[_a]; B = _cols[(_a+1) % _SA]
    for _r in range(_SR):
        f = bm.faces.new((A[_r], A[_r+1], B[_r+1], B[_r]))
        for l, (aa, rr) in zip(f.loops, ((_a, _r), (_a, _r+1), (_a+1, _r+1), (_a+1, _r))):
            l[uv].uv = (_su0+du*aa/_SA, _sv0+dv*(1-rr/_SR)); l[uvt].uv = (l[uv].uv[0], 99.0)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    if (f.calc_center_median()-C).dot(f.normal) < 0: f.normal_flip()
_tw = [v[L_t] for v in bm.verts]; _cap = [v[L_c] > 0.5 for v in bm.verts]
h = bpy.data.objects.get(OBJ)
if h is None:
    _src = bpy.data.objects["Girl_Hair"]; h = _src.copy(); h.data = _src.data.copy(); h.name = OBJ; h.data.name = OBJ
    for _c in _src.users_collection: _c.objects.link(h)
bm.to_mesh(h.data); bm.free()
g = h.vertex_groups.get("thick") or h.vertex_groups.new(name="thick")
for i, t in enumerate(_tw): g.add([i], 0.05 if _cap[i] else max(0.05, 0.25*(1-0.8*t)), 'REPLACE')     # つむじの面は薄く（厚いとふちが見えた）     # 0.45 では毛束のふちが厚く硬く見え、裏のふちが白く光った
for md in h.modifiers:
    if md.type == 'SOLIDIFY': md.vertex_group = "thick"; md.thickness_vertex_group = 0.05
for p in h.data.polygons: p.use_smooth = True
h.data.update()
if rig: rig.data.pose_position = _pose
print("seiko hair locks", NL, "verts", len(h.data.vertices))
