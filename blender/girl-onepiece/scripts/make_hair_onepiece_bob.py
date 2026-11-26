# 4 人目（ワンピース）のゆるふわセミロングボブの髪。値は Girl_Body の hair_params（前のまとめ髪 make_hair_onepiece.py は使っていない）。
#   3 人目の make_hair_knit.py（元は Documents/girl-blender/scripts/make_hair.py）の写しに、make_hair_bob.py の形を入れたもの。
#   ちがい：毛先はあごの下（hair_params の ZB）でほぼまっすぐ切りそろえ、内へ巻く。横の毛はほおの外側を通る。
#   前髪は眉にかかる長さで、毛先を少しばらつかせて軽く見せる。
# 髪のメッシュを作り直す（Blender の中で exec する）。頭の形を変えたあとに実行する。
# 使い方: exec(open(path, encoding="utf-8").read(), {"RX": 0.108})   RX/RY/RZ/C は省略可
import bpy, bmesh, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree
_rig = bpy.data.objects.get("Girl_Rig"); _pose = _rig.data.pose_position if _rig else None    # 骨組みがあれば、作る間は基本の姿勢に戻す
if _rig: _rig.data.pose_position = 'REST'; bpy.context.view_layer.update()

# 当たり判定：体（見えている肌）と、その上の服。服の下の肌は隠してあるので、服も入れないと髪がもぐる
dg = bpy.context.evaluated_depsgraph_get()
_vs = []; _ps = []
for _name in ("Girl_Body", "OP_Dress"):
    _o = bpy.data.objects.get(_name)
    if not _o: continue
    e = _o.evaluated_get(dg); m = e.to_mesh(); _b = len(_vs)
    _vs += [_o.matrix_world @ v.co for v in m.vertices]
    _ps += [tuple(_b+i for i in p.vertices) for p in m.polygons]
    e.to_mesh_clear()
bvh = BVHTree.FromPolygons(_vs, _ps)

C = Vector(globals().get("C", (0, -0.050, 1.520)))          # 頭の中心
RX = globals().get("RX", 0.101); RY = globals().get("RY", 0.113); RZ = globals().get("RZ", 0.108)
ZB = globals().get("ZB", 1.43) - 0.020   # 毛先の高さ（1.43 であごの下）
ZSH = 1.345      # 肩の高さ
ZBANG = globals().get("ZBANG", 1.5365)   # 前髪の切りそろえる高さ（眉のすぐ上）
OFF = 0.011; BL = 0.06
# ヒールで体全体が動いたぶん（Girl_Body の "heel_shift"）を、上の数値に足す
_sh = Vector(bpy.data.objects["Girl_Body"].get("heel_shift", (0, 0, 0)))
C = C + _sh; ZB += _sh.z; ZSH += _sh.z; ZBANG += _sh.z
YBACK = 0.045 + _sh.y; ZSM = 1.50 + _sh.z
NH = 9; ND = 18
SPLIT = 100; SPLITW = 22    # 横髪と後ろ髪の境目の角度と、なじませる幅（度）
BANG = globals().get("BANG", 50)    # 前髪の端の角度（度）。小さくすると、横髪がより手前（顔の前寄り）から垂れる

def ell(th, ph): return C + Vector((RX*math.sin(ph)*math.sin(th), -RY*math.sin(ph)*math.cos(th), RZ*math.cos(ph)))
def sstep(t): t = max(0, min(1, t)); return t*t*(3-2*t)
def front_y(x, z):
    h = bvh.ray_cast(Vector((x, -1, z)), Vector((0, 1, 0))); return h[0].y-OFF if h[0] else None
def back_y(x, z):
    h = bvh.ray_cast(Vector((x, 1, z)), Vector((0, -1, 0))); return h[0].y+OFF if h[0] else None

def strand(thd, kind):
    th = math.radians(thd)
    pts = [ell(th, math.radians(10*i)) for i in range(NH)]
    if kind == "bang":
        ph = math.acos((ZBANG-C.z)/RZ); p = ell(th, ph); pts.append(p); pts.append(p+Vector((0, 0.004, -0.005))); return pts
    E = ell(th, math.radians(90)); pts.append(E)
    if kind == "long":
        # 横髪（肩の前へ）と後ろ髪（背中へ）を、耳のあたりでなだらかにつなぐ。割れ目を作らない
        a = thd if thd < 180 else 360-thd
        wf = 1-sstep((a-SPLIT+SPLITW)/(2*SPLITW))
        fo = drop(thd, E, "front") if wf > 0 else None
        bo = drop(thd, E, "back") if wf < 1 else None
        if fo is None: return pts+bo
        if bo is None: return pts+fo
        return pts+[b.lerp(f, wf) for f, b in zip(fo, bo)]
    return pts+drop(thd, E, kind)

def drop(thd, E, kind):
    zs = [E.z+(ZB-E.z)*((j+1)/ND) for j in range(ND)]
    if kind == "front":
        s = 1 if E.x > 0 else -1; a = thd if thd < 180 else 360-thd
        xb = s*(0.078+min(1, (a-BANG)/(100-BANG))*0.016)          # ボブ：横の毛は、ほおの外側をまっすぐ下りる
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
NBANG = globals().get("NBANG", 16)      # 前髪の列の数（うすめの前髪は細い毛束にするため多くする）
BANG_OV = globals().get("BANG_OV", 0)   # 前髪を横の髪の上へ重ねる幅（度）。重ねないと、前髪の端と横の髪のあいだに切れ込みができる
panels = [("bang", rng(-BANG-BANG_OV, BANG+BANG_OV, NBANG)), ("long", rng(BANG, 360-BANG, 56))]
TIP_LONG = 0.010; TIP_BANG = globals().get("TIP_BANG", 0.007)     # 毛先がばらける幅（長い髪／前髪）。この幅の中で、毛束ごとに長さが変わる
SEE_J = globals().get("SEE_J", 8); SEE_PULL = globals().get("SEE_PULL", 0.45); SEE_MOD = globals().get("SEE_MOD", 3); SEE_RAND = globals().get("SEE_RAND", 0.0)
CURL = globals().get("CURL", 0.009)   # 毛先を内へ巻く量（強いと、肩や服に当たって毛先が折れる）
SEE = globals().get("SEE_THROUGH", False)  # うすめの前髪：下のほうに すき間を作って額を少し見せ、厚みも薄くする
import random
_rnd = random.Random(7)
bm = bmesh.new(); uv = bm.loops.layers.uv.new("UVMap"); uvt = bm.loops.layers.uv.new("Tip")
L_t = bm.verts.layers.float.new("t"); L_c = bm.verts.layers.float.new("clump"); L_b = bm.verts.layers.float.new("bang")
for kind, ths in panels:
    grid = []; tips = []
    for ci, th in enumerate(ths):
        P = strand(th, kind); col = []
        if SEE and kind == "bang" and SEE_RAND > 0:      # 毛束ごとに長さを変える（毛先がそろわず、軽く見える）
            dz = SEE_RAND*random.Random(ci//SEE_MOD+11).random()**1.5   # 同じ毛束（SEE_MOD 列）は同じ長さ
            for q in P[-2:]: q.z += dz
        cl = 0.6*math.sin(th*0.31+1.3)+0.4*_rnd.uniform(-1, 1)        # 毛束ごとの出っぱり
        zend = P[-1].z; span = TIP_BANG if kind == "bang" else TIP_LONG
        tv = []
        for j, pt in enumerate(P):
            v = bm.verts.new(pt); t = max(0.0, (j-(NH-1))/(len(P)-NH)) if kind != "bang" else j/(len(P)-1)*0.5
            v[L_t] = t; v[L_c] = cl if kind != "bang" else cl*0.35; v[L_b] = 1.0 if kind == "bang" else 0.0
            col.append(v); tv.append((pt.z-zend)/span)
        grid.append(col); tips.append(tv)
    if SEE and kind == "bang":                           # 3 列ずつ毛先へ向かって寄せて、とがった毛束にする（毛束のあいだから額が少し見える）
        for j in range(SEE_J, len(grid[0])):
            k = SEE_PULL*(j-SEE_J+1)/(len(grid[0])-SEE_J)
            xs = [col[j].co.x for col in grid]
            for i, col in enumerate(grid):
                c = min(SEE_MOD*(i//SEE_MOD)+SEE_MOD//2, len(grid)-1)
                if 0 < i < len(grid)-1: col[j].co.x += (xs[c]-xs[i])*k
    for i in range(len(grid)-1):
        a, b = grid[i], grid[i+1]
        for j in range(len(a)-1):
            if SEE and kind == "bang" and i % SEE_MOD == SEE_MOD-1 and j >= SEE_J and 0 < i < len(grid)-2: continue   # 毛束のあいだの すき間（毛先の近くだけ）
            f = bm.faces.new((a[j], a[j+1], b[j+1], b[j]))
            for l, (ii, jj) in zip(f.loops, ((i, j), (i, j+1), (i+1, j+1), (i+1, j))):
                if kind == "bang":                       # 前髪は、横・後ろの髪（u が 2*BANG/360 から先）と重ならない所へ詰める。重なると、書き出しで画像に焼くときに前髪の透けが混ざる
                    _u = (ths[ii]+BANG+BANG_OV)/(2*(BANG+BANG_OV))*(2*BANG/360-0.01)
                else: _u = (ths[ii]+BANG)/360
                l[uv].uv = (_u, 1-jj/(NH+ND))
                l[uvt].uv = ((ths[ii]+BANG)/360, tips[ii][jj])
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0004)

def push():
    n = 0
    for v in bm.verts:
        loc, nor, idx, dist = bvh.find_nearest(v.co)
        if loc is None: continue
        if (v.co-loc).dot(nor) < 0 or dist < 0.008:
            if v[L_t] > 0.2 and v.co.z >= ZSM and v.co.y < C.y:
                # 前髪の下のほう：いちばん近い面へ寄せると、鼻筋の付け根へ引き下ろされて中央が V 字に欠ける。
                # 高さと横位置は変えず、前へだけ逃がす
                fy = front_y(v.co.x, v.co.z)
                if fy is not None: v.co.y = min(v.co.y, fy)
            else:
                v.co = loc+nor*0.008
            n += 1
    return n
push()
for it in range(3):
    bmesh.ops.smooth_vert(bm, verts=[v for v in bm.verts if ZB+0.01 < v.co.z < ZSM], factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=False)
    push()

# 前髪の下のほう：眉間や眉の出っぱりに押されて一部だけ飛び出すので、横にならす
_bang = [v for v in bm.verts if v.co.z >= ZSM and v[L_t] > 0.28 and v.co.y < C.y]
for it in range(4):
    bmesh.ops.smooth_vert(bm, verts=_bang, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=False)
    for v in _bang:
        loc, nor, idx, dist = bvh.find_nearest(v.co)
        if loc is not None and ((v.co-loc).dot(nor) < 0 or dist < 0.006): v.co.y = min(v.co.y, (loc+nor*0.006).y)
# 毛束の凹凸：束ごとに、下へ行くほど少し出入りさせる（布の一枚板に見えないように）
for v in bm.verts:
    d = Vector((v.co.x-C.x, v.co.y-C.y, 0))
    if d.length > 1e-5: v.co += d.normalized()*v[L_c]*0.0055*sstep(v[L_t]*1.4)
    if v.co.z < ZSM-0.03 and d.length > 1e-5:           # ボブ：途中は少しふくらませ、毛先は内へ巻く（make_hair_bob.py と同じ形。巻きは少し弱く）
        t = (ZSM-0.03-v.co.z)/(ZSM-0.03-ZB)
        v.co += d.normalized()*(0.006*math.sin(math.pi*min(1, t*1.1))-CURL*sstep((t-0.65)/0.35))
# ゆるふわ：垂れた髪に、ゆるい波（外へ・横へ S 字にうねる）と、下へ行くほどのふくらみを付ける。前髪は入れない。
#   WAVE … 波の大きさ（m）、WAVE_LEN … 波 1 つ分の長さ（m）、FLUFF … 毛先のふくらみ（m）
WAVE = globals().get("WAVE", 0.0); WAVE_LEN = globals().get("WAVE_LEN", 0.07); FLUFF = globals().get("FLUFF", 0.0); WAVE_PH = globals().get("WAVE_PH", 1.0)
if WAVE > 0 or FLUFF > 0:
    for v in bm.verts:
        if v[L_b] > 0.5 or v.co.z >= ZSM-0.01: continue
        d = Vector((v.co.x-C.x, v.co.y-C.y, 0))
        if d.length < 1e-5: continue
        d.normalize(); tg = Vector((-d.y, d.x, 0))
        t = min(1.0, (ZSM-0.01-v.co.z)/max(1e-4, ZSM-0.01-ZB))
        a = math.atan2(d.x, -d.y); ph = WAVE_PH*a+0.25*math.sin(7.0*a)      # 毛束ごとに波の位置を少しずらす（ずらしすぎると、となりの束と逆にうねって布がしわになったように見えた）
        s = 2*math.pi*(ZSM-v.co.z)/WAVE_LEN+ph; k = sstep(t*2.5)
        v.co += d*(WAVE*k*math.sin(s)+FLUFF*sstep(t*1.4))+tg*(0.6*WAVE*k*math.cos(s))
# ゆるふわの前髪：頭の丸みにぴったり沿った一枚の面だと、ヘルメットをかぶったように見えた。
#   BANG_FLUFF … 前髪を額から浮かせる量（m）。中ほどでふくらみ、毛先は内へ巻いて額に戻る
#   BANG_SWEEP … 毛先を横へ流す量（m。+ で体の左へ）
#   TOP_LUMP … 頭頂の毛束の凹凸（m）。つるんとした殻に見えないように
BANG_FLUFF = globals().get("BANG_FLUFF", 0.0); BANG_SWEEP = globals().get("BANG_SWEEP", 0.0); TOP_LUMP = globals().get("TOP_LUMP", 0.0)
_ztop = C.z+RZ
for v in bm.verts:
    d = Vector((v.co.x-C.x, v.co.y-C.y, 0))
    if d.length < 1e-5: continue
    d.normalize()
    if v[L_b] > 0.5 and (BANG_FLUFF > 0 or BANG_SWEEP != 0):
        f = max(0.0, min(1.0, (_ztop-v.co.z)/max(1e-4, _ztop-ZBANG)))      # 0：頭頂、1：前髪の毛先
        v.co += d*(BANG_FLUFF*math.sin(math.pi*min(1.0, f*0.8))-0.6*BANG_FLUFF*sstep((f-0.75)/0.25))
        v.co.x += BANG_SWEEP*sstep((f-0.35)/0.65)
    if TOP_LUMP > 0 and v.co.z > ZSM:
        a = math.atan2(d.x, -d.y)
        v.co += d*TOP_LUMP*(0.5+0.5*math.sin(9*a+1.7*math.sin(3*a)))*sstep((v.co.z-ZSM)/0.04)
# 後ろ髪を首・背中に沿わせる（BACK_HUG）：頭のいちばん後ろから真下へ垂らすだけだと、細い首とのあいだにすき間ができ、
# 横から見ると毛先が宙に浮いて、重力に逆らって後ろへ張り出したように見えた。下へ行くほど、後ろの表面の少し外へ寄せる
BACK_HUG = globals().get("BACK_HUG", 0.0)
if BACK_HUG > 0:
    for v in bm.verts:
        if v[L_b] > 0.5 or v.co.y <= C.y or v.co.z >= ZSM-0.02: continue
        h = bvh.ray_cast(Vector((v.co.x, 1.0, v.co.z)), Vector((0, -1, 0)))
        if h[0] is None: continue
        tgt = h[0].y+0.012
        if tgt >= v.co.y: continue
        t = min(1.0, (ZSM-0.02-v.co.z)/max(1e-4, ZSM-0.02-ZB))
        v.co.y += (tgt-v.co.y)*BACK_HUG*sstep(t*1.6)
    for it in range(2):
        bmesh.ops.smooth_vert(bm, verts=[v for v in bm.verts if v[L_b] < 0.5 and v.co.y > C.y and v.co.z < ZSM-0.02], factor=0.5, use_axis_x=False, use_axis_y=True, use_axis_z=False)
push()                                                 # 内へ巻いた毛先が、首やあごにもぐらないように
# 耳：髪の厚み（Solidify で内側へ 1cm）が耳に刺さって、横から見ると耳が髪を突きぬけていた。
# 耳のまわりの髪だけを、耳の外側のふちより EAR_GAP 外へ、なだらかにふくらませる
EAR_GAP = 0.024
_bo = bpy.data.objects["Girl_Body"]; _mkb = next(md for md in _bo.modifiers if md.type == 'MASK'); _mkb.show_viewport = False; bpy.context.view_layer.update()
_eb = _bo.evaluated_get(bpy.context.evaluated_depsgraph_get()); _em = _eb.to_mesh()
_eco = [_bo.matrix_world @ v.co for v in _em.vertices]; _eb.to_mesh_clear(); _mkb.show_viewport = True
_ei = _bo.vertex_groups["ears"].index
for _s in (1, -1):
    _ep = [_eco[v.index] for v in _bo.data.vertices if _s*_eco[v.index].x > 0 and any(g.group == _ei and g.weight > 0.5 for g in v.groups)]
    if not _ep: continue
    _ec = sum(_ep, Vector())/len(_ep); _ex = max(_s*p.x for p in _ep)
    _ry = (max(p.y for p in _ep)-min(p.y for p in _ep))/2+0.030; _rz = (max(p.z for p in _ep)-min(p.z for p in _ep))/2+0.032
    for v in bm.verts:
        if _s*v.co.x <= 0: continue
        dd = math.hypot((v.co.y-_ec.y)/_ry, (v.co.z-_ec.z)/_rz); w = sstep((1.25-dd)/0.6)
        tx = _ex+EAR_GAP
        if w > 0 and _s*v.co.x < tx: v.co.x += _s*(tx-_s*v.co.x)*w
# 前髪を切りそろえる高さ（BANG_CUT。ZBANG と同じく、ヒールで動く前の高さ）：毛先の透かしの基準を、毛先からの距離ではなく
# この高さからの距離にする。形は横で下がっていても、見える毛先は同じ高さにそろう
if globals().get("BANG_CUT") is not None:
    _bc = globals()["BANG_CUT"]+_sh.z
    for f in bm.faces:
        for l in f.loops:
            if l.vert[L_b] > 0.5: l[uvt].uv.y = (l.vert.co.z-_bc)/TIP_BANG
bm.verts.ensure_lookup_table()
_tw = [v[L_t] for v in bm.verts]; _bw = [v[L_b] for v in bm.verts]
h = bpy.data.objects["Girl_Hair"]; bm.to_mesh(h.data); bm.free()
# 厚み：毛先へ向かって薄くする
g = h.vertex_groups.get("thick") or h.vertex_groups.new(name="thick")
for i, t in enumerate(_tw): g.add([i], max(0.05, (1-0.95*t)*(0.4 if SEE and _bw[i] > 0.5 and t > 0.25 else 1.0)), 'REPLACE')
for md in h.modifiers:
    if md.type == 'SOLIDIFY': md.vertex_group = "thick"; md.thickness_vertex_group = 0.05
for p in h.data.polygons: p.use_smooth = True
h.data.update()
print("hair rebuilt", len(h.data.vertices), len(h.data.polygons))
if _rig: _rig.data.pose_position = _pose                 # 姿勢を元に戻す
