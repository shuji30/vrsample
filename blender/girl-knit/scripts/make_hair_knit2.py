# 3 人目（ニットコーデ）の髪：こげ茶の胸の上までの長さ、前髪なしの横分け、あごから下に大きめのゆるいウェーブ（Blender の中で exec する）。
#   分け目は本人の左寄り（PART_TH 度）。多い側（本人の右）へ流して肩の前へ、少ない側（本人の左）は肩の後ろへ。
#   make_face_knit.py の最後で実行する。make_hair_knit.py（ぱっつんのストレート）の作り方をもとにしている。
#   ・前髪の帯はなく、真ん中のわずかなすき間（PART 度）で左右に分ける
#   ・顔の前の毛（分け目から FRONT 度まで）は、額の生えぎわまで来たら横へ流れ、頬の外側を通って胸の前へ下りる
#   ・毛先のほう（下 5 割）に、ゆるいウェーブを付ける
# 使い方: exec(..., {"C": ..., "RX": ..., "RY": ..., "RZ": ..., "ZB": ..., "ZBANG": ...})   ZBANG は眉のすぐ上の高さ（生えぎわの目安）
import bpy, bmesh, math, random
from mathutils import Vector
from mathutils.bvhtree import BVHTree
_rig = bpy.data.objects.get("Girl_Rig"); _pose = _rig.data.pose_position if _rig else None
if _rig: _rig.data.pose_position = 'REST'; bpy.context.view_layer.update()

dg = bpy.context.evaluated_depsgraph_get()
_vs = []; _ps = []
for _name in ("Girl_Body", "Girl_Knit"):
    _o = bpy.data.objects.get(_name)
    if not _o: continue
    e = _o.evaluated_get(dg); m = e.to_mesh(); _b = len(_vs)
    _vs += [_o.matrix_world @ v.co for v in m.vertices]
    _ps += [tuple(_b+i for i in p.vertices) for p in m.polygons]
    e.to_mesh_clear()
bvh = BVHTree.FromPolygons(_vs, _ps)

C = Vector(globals().get("C", (0, -0.050, 1.520)))
RX = globals().get("RX", 0.101); RY = globals().get("RY", 0.113); RZ = globals().get("RZ", 0.108)
ZB = globals().get("ZB", 1.26) - 0.020        # 毛先の高さ（1.26 で胸の上）
ZSH = 1.345
ZH = globals().get("ZBANG", 1.5365)+0.030     # 額の生えぎわの高さ（眉の 3cm ほど上）
OFF = 0.011; BL = 0.06
_sh = Vector(bpy.data.objects["Girl_Body"].get("heel_shift", (0, 0, 0)))
C = C + _sh; ZB += _sh.z; ZSH += _sh.z; ZH += _sh.z
YBACK = 0.045 + _sh.y; ZSM = 1.50 + _sh.z
NH = 9; ND = 30
SPLIT = 100; SPLITW = 22
PART = 0.8; FRONT = 72.0                       # 分け目のすき間（度）、顔の前を横へ流す毛の範囲（度）
PART_TH = 24.0                                 # 分け目の位置（前から本人の左へ、度）

def ell(th, ph): return C + Vector((RX*math.sin(ph)*math.sin(th), -RY*math.sin(ph)*math.cos(th), RZ*math.cos(ph)))
def sstep(t): t = max(0, min(1, t)); return t*t*(3-2*t)
def front_y(x, z):
    h = bvh.ray_cast(Vector((x, -1, z)), Vector((0, 1, 0))); return h[0].y-OFF if h[0] else None
def back_y(x, z):
    h = bvh.ray_cast(Vector((x, 1, z)), Vector((0, -1, 0))); return h[0].y+OFF if h[0] else None
PH_H = math.acos(max(-1, min(1, (ZH-C.z)/RZ)))  # 生えぎわの高さに当たる、頭頂からの角度

def strand(thd):
    # 分け目から見て、本人の左（+X）へ流れる側か、右（-X）へ流れる側か。a は、流れる側から見た前からの角度
    #（分け目と前のあいだの毛は、額を横切って右へ流れるので a がマイナスになる）
    thm = thd % 360; rel = (thd-PART_TH) % 360
    sg = 1 if rel < 180 else -1
    a = thm if sg > 0 else (360-thm if thm > 180 else -thm)
    # 顔の前の毛：生えぎわより下では、横（耳の前）へ向きを変えながら下りる。毛束が 1 点に集まらないよう、行き先の角度を散らす
    # 耳の高さでの角度：前（0 度）から横（100 度）までを 60〜100 度へ順にずらす（並びが入れ替わらないので、毛の層の重なりの筋が出ない）
    tgt = 60+0.4*a if a < 100 else a
    # 生えぎわは、まん中（分け目）が高く、こめかみへ下がる曲線にする（水平な一直線だと帽子のふちに見える）
    zh = ZH+0.020*(1-sstep(abs(a)/FRONT))
    ph_h = math.acos(max(-1, min(1, (zh-C.z)/RZ)))
    def th_at(ph):
        if a >= 100 or ph <= ph_h: return math.radians(sg*a)
        if a < 0: k = sstep((ph-ph_h*0.55)/(math.radians(90)-ph_h*0.55)*1.05)      # 額を横切る毛は、生えぎわよりずっと上から横へ流す（持ち上げてから垂らす）
        else: k = sstep((ph-ph_h)/(math.radians(90)-ph_h)*1.15)
        return math.radians(sg*(a+(tgt-a)*k))
        k = sstep((ph-ph_h)/(math.radians(90)-ph_h)*1.15)
        return math.radians(sg*(a+(tgt-a)*k))
    pts = [ell(th_at(math.radians(10*i)), math.radians(10*i)) for i in range(NH)]
    E = ell(th_at(math.radians(90)), math.radians(90)); pts.append(E)
    ae = tgt                                      # 耳の高さでの角度
    wf = 1-sstep((ae-SPLIT+SPLITW)/(2*SPLITW))
    if sg > 0: wf = 0.0                           # 少ない側（本人の左）は、肩の後ろへ
    fo = drop(ae, E, "front") if wf > 0 else None
    bo = drop(ae, E, "back") if wf < 1 else None
    if fo is None: return pts+bo
    if bo is None: return pts+fo
    return pts+[b.lerp(f, wf) for f, b in zip(fo, bo)]

def drop(a, E, kind):
    zs = [E.z+(ZB-E.z)*((j+1)/ND) for j in range(ND)]
    if kind == "front":
        s = 1 if E.x > 0 else -1
        xb = s*(0.084+min(1, max(0, (a-60)/40))*0.030)        # 横の毛は頬の外側を下り、肩の前へ
    else:
        xb = E.x*1.08
    run = None; out = []
    for z in zs:
        t = sstep((E.z-z)/(E.z-ZB)*1.5)
        x = E.x+(xb-E.x)*t; y = E.y
        if z < ZSH+BL:
            w = sstep((ZSH+BL-z)/BL); zq = min(z, ZSH-0.01)
            if kind == "front":
                fy = front_y(x, zq)
                if fy is not None:
                    run = fy if run is None else (fy if fy < run else run+(fy-run)*0.25)
                    if run < E.y: y = E.y+(run-E.y)*w
            else:
                by = back_y(x, zq)
                if by is not None: run = by if run is None else (by if by > run else run+(by-run)*0.15)
                tgt = max(E.y, run if run is not None else E.y, YBACK if abs(x) > 0.02 else E.y)
                y = E.y+(tgt-E.y)*w
        out.append(Vector((x, y, z)))
    return out

def rng(a, b, n): return [a+(b-a)*i/n for i in range(n+1)]
ths = rng(PART_TH+PART, PART_TH+360-PART, 72)
TIP = 0.070
_rnd = random.Random(11)
bm = bmesh.new(); uv = bm.loops.layers.uv.new("UVMap"); uvt = bm.loops.layers.uv.new("Tip")
L_t = bm.verts.layers.float.new("t"); L_c = bm.verts.layers.float.new("clump")
grid = []; tips = []
for th in ths:
    P = strand(th); col = []; tv = []
    cl = 0.6*math.sin(th*0.31+1.3)+0.4*_rnd.uniform(-1, 1)
    zend = P[-1].z
    for j, pt in enumerate(P):
        v = bm.verts.new(pt); v[L_t] = max(0.0, (j-(NH-1))/(len(P)-NH)); v[L_c] = cl
        col.append(v); tv.append((pt.z-zend)/TIP)
    grid.append(col); tips.append(tv)
for i in range(len(grid)-1):
    a, b = grid[i], grid[i+1]
    for j in range(len(a)-1):
        f = bm.faces.new((a[j], a[j+1], b[j+1], b[j]))
        for l, (ii, jj) in zip(f.loops, ((i, j), (i, j+1), (i+1, j+1), (i+1, j))):
            l[uv].uv = (ths[ii]/360, 1-jj/(NH+ND)); l[uvt].uv = (ths[ii]/360, tips[ii][jj])
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0004)      # 頭頂で重なる頂点をまとめる（とがりの元）

def push(m=0.008):
    for v in bm.verts:
        loc, nor, idx, dist = bvh.find_nearest(v.co)
        if loc is None: continue
        if (v.co-loc).dot(nor) < 0 or dist < m: v.co = loc+nor*m
push()
for it in range(3):
    bmesh.ops.smooth_vert(bm, verts=[v for v in bm.verts if ZB+0.01 < v.co.z < ZSM], factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=False)
    push()
# 分け目のボリューム：分け目のまわりの根元を外へ立ち上げ、頭の上全体にも少しふくらみを足す（ぺたんとした頭に見えないように）
VOL_PART = 0.016; VOL_TOP = 0.006
for v in bm.verts:
    dx, dy, dz = v.co.x-C.x, v.co.y-C.y, v.co.z-C.z
    if dz < -0.02: continue
    az = math.degrees(math.atan2(dx, -dy)); dang = (az-PART_TH+180) % 360-180
    ph = math.degrees(math.acos(max(-1, min(1, dz/RZ))))
    lift = VOL_PART*math.exp(-(dang/30.0)**2)*sstep((ph-4)/14)*(1-sstep((ph-55)/30)) + VOL_TOP*(1-sstep((ph-60)/30))
    d = Vector((dx, dy, dz*0.6))
    if d.length > 1e-5: v.co += d.normalized()*lift
# 毛束の凹凸と、毛先のゆるいウェーブ（下 5 割）
for v in bm.verts:
    d = Vector((v.co.x-C.x, v.co.y-C.y, 0))
    if d.length < 1e-5: continue
    dn = d.normalized(); tg = Vector((-dn.y, dn.x, 0))
    v.co += dn*v[L_c]*0.0055*sstep(v[L_t]*1.4)
    w = sstep((ZSM+0.01-v.co.z)/0.06); ph = v[L_c]*2.4          # あごの高さから下
    v.co += dn*(0.010*w*math.sin(2*math.pi*(ZSM-v.co.z)/0.17+ph)+0.014*w)         # 大きくゆるい波（間隔 17cm）とふくらみ
    v.co += tg*0.004*w*math.sin(2*math.pi*(ZSM-v.co.z)/0.15+ph*1.6)
push(0.006)
bm.verts.ensure_lookup_table()
_tw = [v[L_t] for v in bm.verts]
h = bpy.data.objects["Girl_Hair"]; bm.to_mesh(h.data); bm.free()
g = h.vertex_groups.get("thick") or h.vertex_groups.new(name="thick")
for i, t in enumerate(_tw): g.add([i], max(0.05, 1-0.95*t), 'REPLACE')
for md in h.modifiers:
    if md.type == 'SOLIDIFY': md.vertex_group = "thick"; md.thickness_vertex_group = 0.05
for p in h.data.polygons: p.use_smooth = True
h.data.update()
print("hair (side part, waves) rebuilt", len(h.data.vertices), len(h.data.polygons))
if _rig: _rig.data.pose_position = _pose
