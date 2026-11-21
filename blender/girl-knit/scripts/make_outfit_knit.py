# 3 人目（ニットコーデ）の服を作る（Blender の中で exec する）。girl-knit.blend で、make_face_knit.py のあとに実行する。
#   Girl_Knit  … 黒の長そでニット。ハイネック（上を折り返す）。すそはスカートの中へ入れる
#   Knit_Skirt … 黒のひざ下丈のフレアスカート。黒地にグレーのリボン柄（ジャカード風）。リボンの垂れ 2 本も、この中に入れる
#                （スカートと同じ骨の付け方になり、座ったときにスカートと一緒に動く）
#   Knit_Sash  … ウエストのリボンベルトと、前の少し右寄りのちょう結び（布はスカートと同じ）
#   Knit_Inner … 白のショーツ（スカートの中。股から腰へ斜めのすそ・縁取り・前に小さなリボン）
#   Knit_Shoes … 黒のパンプス。底は薄く、かかとに太めのブロックヒール
# 服の寸法は、足が平らで靴底 2.2cm（heel_shift = (0, 0, 0.022)）のときの体の位置で書いてある。
# ヒールで体が動いたぶん（heel_shift との差 T0）は、作る間だけ体を戻して作り、できた服をそのぶん動かす。
# 靴だけは、実際の足の位置で作る。
import bpy, bmesh, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree

rig = bpy.data.objects["Girl_Rig"]; _pose = rig.data.pose_position; rig.data.pose_position = 'REST'
ob = bpy.data.objects["Girl_Body"]; me = ob.data
T0 = Vector(ob["heel_shift"])-Vector((0, 0, 0.022))
mk = next(m for m in ob.modifiers if m.type == 'MASK')
mk.show_viewport = False; bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get(); e = ob.evaluated_get(dg); m = e.to_mesh()
co_real = [v.co.copy() for v in m.vertices]; e.to_mesh_clear(); mk.show_viewport = True
co = [c-T0 for c in co_real]
body = ob.vertex_groups["body"]; hid = ob.vertex_groups["hidden_by_clothes"]
gi = {body.index, hid.index}
inb = [any(g.group in gi and g.weight > 0.5 for g in v.groups) for v in me.vertices]
# ほかのコーデで隠していた肌を、いったん全部見せる（このコーデで隠す所は、最後に決め直す）
allv = [i for i in range(len(co)) if inb[i]]
body.add(allv, 1.0, 'REPLACE'); hid.remove(allv)

def joint(n):
    j = ob.vertex_groups[n].index
    ps = [co[v.index] for v in me.vertices if any(g.group == j and g.weight > 0.5 for g in v.groups)]
    return sum(ps, Vector())/len(ps)
hand = joint("joint-l-hand"); elbow = joint("joint-l-elbow"); d = (hand-elbow).normalized()
def ss(t): t = max(0, min(1, t)); return t*t*(3-2*t)

def newobj(name, bm, mats, shift=True):
    old = bpy.data.objects.get(name)
    if old: bpy.data.objects.remove(old, do_unlink=True)
    if shift:
        for v in bm.verts: v.co += T0                    # ヒールで体が動いたぶん、服も動かす
    bm.normal_update(); mesh = bpy.data.meshes.new(name); bm.to_mesh(mesh); bm.free()
    for p in mesh.polygons: p.use_smooth = True
    o = bpy.data.objects.new(name, mesh); bpy.context.scene.collection.objects.link(o)
    for mt in (mats if isinstance(mats, (list, tuple)) else [mats]): mesh.materials.append(mt)
    return o
def from_body(sel):
    vs = [i for i in range(len(co)) if inb[i] and sel(co[i])]; s = set(vs)
    bm = bmesh.new(); mp = {i: bm.verts.new(co[i]) for i in vs}
    for p in me.polygons:
        if all(v in s for v in p.vertices):
            try: bm.faces.new([mp[v] for v in p.vertices])
            except ValueError: pass
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    return bm, s
def erode(sel_set, rings):
    inner = set(sel_set)
    for _ in range(rings):
        edge = set()
        for p in me.polygons:
            vs = p.vertices
            if any(v not in inner for v in vs): edge.update(v for v in vs if v in inner)
        inner -= edge
    return inner

# ── 材質 ──
def knit_mat():
    mt = bpy.data.materials.get("Knit") or bpy.data.materials.new("Knit"); mt.use_nodes = True
    b = next(n for n in mt.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    for l in list(b.inputs["Base Color"].links): mt.node_tree.links.remove(l)
    b.inputs["Base Color"].default_value = (0.022, 0.021, 0.024, 1); b.inputs["Roughness"].default_value = 0.92
    b.inputs["Sheen Weight"].default_value = 0.45; b.inputs["Sheen Tint"].default_value = (0.6, 0.6, 0.65, 1)
    mt.diffuse_color = (0.022, 0.021, 0.024, 1); mt.use_backface_culling = False
    return mt
def jacquard_mat():
    """黒地に、少し明るいグレーのリボン柄（4 枚の花びらが X 字に重なった形）。UV「Pattern」（単位は m）で描く"""
    mt = bpy.data.materials.get("Jacquard")
    if mt: bpy.data.materials.remove(mt)
    mt = bpy.data.materials.new("Jacquard"); mt.use_nodes = True; nt = mt.node_tree; Nn = nt.nodes; L = nt.links
    b = next(n for n in Nn if n.type == "BSDF_PRINCIPLED")
    b.inputs["Roughness"].default_value = 0.78; b.inputs["Sheen Weight"].default_value = 0.3
    uvn = Nn.new("ShaderNodeUVMap"); uvn.uv_map = "Pattern"
    P = 0.062                                            # 柄の間隔（m）
    sep = Nn.new("ShaderNodeSeparateXYZ"); L.new(uvn.outputs["UV"], sep.inputs[0])
    def math(op, a, b_=None, v=None):
        n = Nn.new("ShaderNodeMath"); n.operation = op
        for k, x in enumerate((a, b_)):
            if x is None: continue
            if isinstance(x, (int, float)): n.inputs[k].default_value = x
            else: L.new(x, n.inputs[k])
        return n.outputs[0]
    u = math('DIVIDE', sep.outputs["X"], P); v = math('DIVIDE', sep.outputs["Y"], P)
    # 1 段おきに半分ずらす（千鳥）
    row = math('FLOOR', v); half = math('MULTIPLY', math('FRACT', math('MULTIPLY', row, 0.5)), 1.0)
    u2 = math('ADD', u, half)
    px = math('SUBTRACT', math('FRACT', u2), 0.5); py = math('SUBTRACT', math('FRACT', v), 0.5)
    def ell(x, y, rx, ry):
        return math('ADD', math('POWER', math('DIVIDE', x, rx), 2.0), math('POWER', math('DIVIDE', y, ry), 2.0))
    def part(cx, cy, rx, ry, deg):
        """中心 (cx, cy)・半径 (rx, ry)・傾き deg 度の楕円（1 未満が中）"""
        c_, s_ = __import__("math").cos(__import__("math").radians(deg)), __import__("math").sin(__import__("math").radians(deg))
        x = math('SUBTRACT', px, cx); y = math('SUBTRACT', py, cy)
        xr = math('ADD', math('MULTIPLY', x, c_), math('MULTIPLY', y, s_)); yr = math('SUBTRACT', math('MULTIPLY', y, c_), math('MULTIPLY', x, s_))
        return ell(xr, yr, rx, ry)
    # 柄：ちょう結びのリボン（左右の輪・結び目・下へ垂れる 2 本）
    f = part(0.0, 0.03, 0.055, 0.060, 0.0)                                  # 結び目
    for g_ in (part(-0.17, 0.06, 0.16, 0.085, -14.0), part(0.17, 0.06, 0.16, 0.085, 14.0),   # 輪
               part(-0.08, -0.16, 0.045, 0.15, -22.0), part(0.09, -0.15, 0.045, 0.14, 26.0)):  # 垂れ
        f = math('MINIMUM', f, g_)
    mask = math('SUBTRACT', 1.0, math('SMOOTH_MIN', math('MAXIMUM', math('MULTIPLY', math('SUBTRACT', f, 0.8), 5.0), 0.0), 1.0, 0.0))
    mask = math('MINIMUM', math('MAXIMUM', mask, 0.0), 1.0)
    mix = Nn.new("ShaderNodeMix"); mix.data_type = 'RGBA'
    mix.inputs[6].default_value = (0.014, 0.014, 0.016, 1); mix.inputs[7].default_value = (0.034, 0.033, 0.036, 1)    # 黒地に、少しだけ明るい黒の柄
    L.new(mask, mix.inputs[0]); L.new(mix.outputs[2], b.inputs["Base Color"])
    mt.diffuse_color = (0.03, 0.03, 0.033, 1); mt.use_backface_culling = False
    return mt
KNIT = knit_mat(); JAC = jacquard_mat()
to_hide = set()

# ── ニット（体に沿う。ハイネック）────────────────────────
HEM = 1.000                                              # すそ（スカートの中に入る）
def NECKTOP(y): return 1.410+max(0.0, y+0.07)*0.40       # ハイネックの上のふち（後ろが少し高い）
def knit_sel(c):
    ax = abs(c.x)
    if ax > 0.17:
        if ax < 0.27 and c.z < HEM+0.03: return False                    # 腰の横の出っぱり（腕ではない）
        p = Vector((ax, c.y, c.z)); return (p-hand).dot(d) < 0.006      # 手首まで
    return HEM <= c.z <= NECKTOP(c.y)
bm, ksel = from_body(knit_sel)
inner = [v for v in bm.verts if not v.is_boundary]
for _ in range(6): bmesh.ops.smooth_vert(bm, verts=inner, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
bm.normal_update()
ZN = 1.365                                               # ここより上が首（ハイネック）
for v in bm.verts:
    ax = abs(v.co.x); c = v.co
    neck = ss((c.z-ZN)/0.02) if ax < 0.09 else 0.0
    if v.is_boundary:
        if ax > 0.30:                                   # 袖口
            s = 1 if c.x > 0 else -1; p = Vector((ax, c.y, c.z)); p += d*(0.008-(p-hand).dot(d))
            v.co = Vector((s*p.x, p.y, p.z))+v.normal*0.007
        elif c.z > 1.30:                                # えり（首のまわりに、ゆるく）
            v.co.z = NECKTOP(c.y); v.co += Vector((v.normal.x, v.normal.y, 0))*0.010
        else:                                           # すそ
            v.co.z = HEM; v.co += Vector((v.normal.x, v.normal.y, 0))*0.006
    else:
        off = 0.0040 if ax < 0.17 else 0.0050                 # 体にぴったり沿う薄手
        off += neck*(0.002+0.004*ss((c.z-(NECKTOP(c.y)-0.035))/0.01))   # 首は少しゆとり、上の 3.5cm は折り返しで厚い
        v.co += v.normal*off
# 胸の下・谷間で布が沈まないように：高さごとに、体の断面の凸包より内へ入らないようにする
_tp = [tuple(p.vertices) for p in me.polygons if all(inb[v] and abs(co[v].x) < 0.165 for v in p.vertices)]
_tb = BVHTree.FromPolygons(co, _tp); CYT = -0.04; NA = 72
def _hull(P):
    P = sorted(set(P))
    def cr(o, a, b): return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
    lo = []
    for q in P:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], q) <= 0: lo.pop()
        lo.append(q)
    up = []
    for q in reversed(P):
        while len(up) >= 2 and cr(up[-2], up[-1], q) <= 0: up.pop()
        up.append(q)
    return lo[:-1]+up[:-1]
def ring_hull(z):
    pts = []
    for a in range(NA):
        th = 2*math.pi*a/NA; dv = Vector((math.sin(th), -math.cos(th), 0))
        h = _tb.ray_cast(Vector((0, CYT, z))+dv*0.40, -dv, 0.40)
        r = (0.40-h[3]) if h[0] else 0.0; pts.append((r*math.sin(th), -r*math.cos(th)))
    H = _hull(pts)
    def ray(th):
        dxr, dyr = math.sin(th), -math.cos(th); best = 0.0
        for i in range(len(H)):
            (x1, y1), (x2, y2) = H[i], H[(i+1) % len(H)]
            ex, ey = x2-x1, y2-y1; den = dxr*ey-dyr*ex
            if abs(den) < 1e-9: continue
            t = (x1*ey-y1*ex)/den; uu = (x1*dyr-y1*dxr)/den
            if t > 0 and -1e-6 <= uu <= 1+1e-6: best = max(best, t)
        return best
    return [ray(2*math.pi*a/NA) for a in range(NA)]
ZH0, ZH1 = 1.10, 1.33; zb = [ZH0+0.01*i for i in range(int((ZH1-ZH0)/0.01)+1)]
hulls = [ring_hull(z) for z in zb]
def r_hull(th, z):
    fz = (z-ZH0)/0.01; i = max(0, min(len(zb)-2, int(fz))); w = max(0, min(1, fz-i))
    f = (th % (2*math.pi))/(2*math.pi)*NA; a = int(f) % NA; fa = f-int(f)
    def at(h): return h[a]+(h[(a+1) % NA]-h[a])*fa
    return at(hulls[i])*(1-w)+at(hulls[i+1])*w
for v in bm.verts:
    c = v.co; ax = abs(c.x)
    if not (ZH0 <= c.z <= ZH1) or c.y > CYT: continue  # 前側だけ（胸の下・谷間）
    wx = 1-ss((ax-0.12)/0.04)
    if wx <= 0: continue
    dx, dy = c.x, c.y-CYT; r = math.hypot(dx, dy)
    if r < 1e-5: continue
    th = math.atan2(dx, -dy); rt = r_hull(th, c.z)+0.0065
    k = wx*ss((c.z-ZH0)/0.03)*ss((ZH1-c.z)/0.03)
    if rt > r: nr = r+(rt-r)*k; v.co.x = dx/r*nr; v.co.y = CYT+dy/r*nr
_front = [v for v in bm.verts if not v.is_boundary and abs(v.co.x) < 0.14 and 1.12 < v.co.z < 1.32 and v.co.y < -0.02]
for _ in range(6): bmesh.ops.smooth_vert(bm, verts=_front, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
ring = [v for v in bm.verts if not v.is_boundary and any(ed.other_vert(v).is_boundary for ed in v.link_edges)]
bmesh.ops.smooth_vert(bm, verts=ring, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
knit = newobj("Girl_Knit", bm, KNIT)
sd = knit.modifiers.new("Solidify", 'SOLIDIFY'); sd.thickness = 0.0025; sd.offset = 1.0
to_hide |= erode(ksel, 2)

# ── フレアスカート（ひざ下丈）と、リボンの垂れ ──────────────────
polys = [tuple(p.vertices) for p in me.polygons if all(inb[v] and abs(co[v].x) < 0.30 for v in p.vertices)]
bvh = BVHTree.FromPolygons(co, polys)
def body_r(th, z, cy):
    dv = Vector((math.sin(th), -math.cos(th), 0)); h = bvh.ray_cast(Vector((0, cy, z))+dv*0.45, -dv, 0.45)
    return (0.45-h[3]) if h[0] else 0.0
ZW = 1.075; ZH = 0.445; NC = 120; NR = 20; NF = 13      # ウエスト・すその高さ、まわりの分割、縦の分割、ドレープの数
def flare_r(th, t):
    ex = 0.118+(0.305-0.118)*t**0.85; ey = 0.092+(0.275-0.092)*t**0.85
    fr = 1/math.sqrt((math.sin(th)/ex)**2+(math.cos(th)/ey)**2)
    return fr*(1+0.075*t**1.3*math.sin(NF*th+0.6+0.5*math.sin(3*th)))   # ゆるい波（ドレープ）
def smax(a, b, k):
    """なめらかな max：体に沿う形とフレアの形の境目で、角（腰の横のくぼみ）を作らない"""
    return (a+b+math.sqrt((a-b)**2+k*k))/2
bm = bmesh.new(); uv = bm.loops.layers.uv.new("UVMap"); uvp = bm.loops.layers.uv.new("Pattern"); rows = []
tsamp = [(j/NR)**1.15 for j in range(NR+1)]              # 上ほど細かく
for j, t in enumerate(tsamp):
    z = ZW+(ZH-ZW)*t; cy = -0.045+0.010*t; ringv = []
    for i in range(NC):
        th = 2*math.pi*i/NC
        br = max(body_r(th, z, cy), body_r(th, min(z+0.04, ZW), cy) if j > 0 else 0)+0.010
        r = smax(br, flare_r(th, t), 0.035*ss(t/0.15)) if t > 0.05 else br
        ringv.append(bm.verts.new((r*math.sin(th), cy-r*math.cos(th), z)))
    rows.append(ringv)
# 柄の UV：まわりの長さ・上からの長さ（m）
arc = []
for j in range(NR+1):
    a = [0.0]
    for i in range(NC): a.append(a[-1]+(rows[j][(i+1) % NC].co-rows[j][i].co).length)
    arc.append(a)
down = [[0.0]*NC]
for j in range(NR): down.append([down[-1][i]+(rows[j+1][i].co-rows[j][i].co).length for i in range(NC)])
# 本物のフレアスカートのように 8 枚の布（はぎ）に分け、布ごとに、まん中からの長さで柄を並べる。
# まわりの長さで通しで並べると、すそほど円周が長いぶん、後ろへ行くほど柄が横へずれて伸びる
G = 8
def arc_at(jj, ic):
    k = int(ic); w = ic-k; return arc[jj][k]*(1-w)+arc[jj][min(k+1, NC)]*w
for j in range(NR):
    for i in range(NC):
        a, b = rows[j], rows[j+1]; i2 = (i+1) % NC
        f = bm.faces.new((a[i], b[i], b[i2], a[i2]))
        g = (i*G)//NC; ic = (g+0.5)*NC/G
        for l, (ii, jj) in zip(f.loops, ((i, j), (i, j+1), (i+1, j+1), (i+1, j))):
            l[uv].uv = (ii/NC, 1-jj/NR)
            l[uvp].uv = (arc[jj][ii]-arc_at(jj, ic)+g*0.37, -down[jj][ii % NC])
skirt_bm = bm

# リボンの垂れ：ちょう結び（前の少し右寄り）から、スカートの表面に沿って 2 本下ろす
KX = -0.045; KZ = 1.050                                  # 結び目（本人の右が -X）
def skirt_surface(th, z):
    t = (ZW-z)/(ZW-ZH); t = max(0.0, min(1.0, t)); t = t**(1/1.15)
    t2 = max(0.0, min(1.0, (ZW-z)/(ZW-ZH)))
    cy = -0.045+0.010*t2
    br = max(body_r(th, z, cy), body_r(th, min(z+0.04, ZW), cy))+0.010
    r = smax(br, flare_r(th, t2), 0.035*ss(t2/0.15)) if t2 > 0.05 else br
    return r, cy
TAILS = [(-0.014, 0.530, -0.040), (0.014, 0.490, 0.030)]  # （横のずれ（m）、先の高さ、すそでの広がり（m））
RW = 0.052                                               # リボンの幅
th0 = math.atan2(KX, 0.11)
for dxk, zend, spread in TAILS:
    NS = 18; L0 = []; R0 = []
    for s in range(NS+1):
        q = s/NS; z = KZ-0.020+(zend-(KZ-0.020))*q
        r, cy = skirt_surface(th0, z)
        th = th0+(dxk+spread*q)/max(r, 0.1)
        r, cy = skirt_surface(th, z); r += 0.009+0.004*q
        tw = 0.15*math.sin(q*math.pi*1.3)                 # 少しねじれる
        hw = RW/2*(1-0.15*q)
        c = Vector((r*math.sin(th), cy-r*math.cos(th), z)); tan = Vector((math.cos(th), math.sin(th), 0))
        nrm = Vector((math.sin(th), -math.cos(th), 0))
        side = (tan*math.cos(tw)+nrm*math.sin(tw))*hw
        cut = 0.012 if s == NS else 0.0                   # 先はななめに切る
        L0.append(bm.verts.new(c-side+Vector((0, 0, cut)))); R0.append(bm.verts.new(c+side-Vector((0, 0, cut))))
    for s in range(NS):
        f = bm.faces.new((L0[s], L0[s+1], R0[s+1], R0[s]))
        for l, (sx, sy) in zip(f.loops, ((0, s), (0, s+1), (1, s+1), (1, s))):
            l[uv].uv = (0.0, 0.0); l[uvp].uv = (sx*RW+3.0+dxk*7, -sy/NS*(KZ-zend))
skirt = newobj("Knit_Skirt", skirt_bm, JAC)

# ── リボンベルトと、ちょう結び ─────────────────────────
bm = bmesh.new(); uv = bm.loops.layers.uv.new("UVMap"); uvp = bm.loops.layers.uv.new("Pattern")
ZB0, ZB1 = 1.032, 1.072; NB = 120; bands = []
for z in (ZB0, (ZB0+ZB1)/2, ZB1):
    ringv = []
    for i in range(NB):
        th = 2*math.pi*i/NB; cy = -0.045
        r = max(body_r(th, z, cy), body_r(th, min(z+0.03, ZW), cy))+0.016
        ringv.append(bm.verts.new((r*math.sin(th), cy-r*math.cos(th), z)))
    bands.append(ringv)
for j in range(2):
    for i in range(NB):
        a, b = bands[j], bands[j+1]; i2 = (i+1) % NB
        f = bm.faces.new((a[i], a[i2], b[i2], b[i]))
        for l, (ii, jj) in zip(f.loops, ((i, j), (i+1, j), (i+1, j+1), (i, j+1))):
            l[uv].uv = (0, 0); l[uvp].uv = (ii*0.0065, jj*0.02)
# ちょう結び：結び目の前に、左右へ張り出す輪を 2 つ
rK, cyK = skirt_surface(th0, KZ); rK += 0.022
K = Vector((rK*math.sin(th0), cyK-rK*math.cos(th0), KZ)); NRM = Vector((math.sin(th0), -math.cos(th0), 0)); TAN = Vector((math.cos(th0), math.sin(th0), 0)); UP = Vector((0, 0, 1))
def ribbon_loop(sgn, length, droop):
    """結び目から横へ出て戻る輪（帯の幅 RW）。sgn = 1 で本人の左（+X 側）へ"""
    NS = 20; A = []; B = []
    for s in range(NS+1):
        a = 2*math.pi*s/NS
        # 輪は、前の層で横へ出て、うしろの層で戻る（布の面は前を向き、幅は上下）。先は少し下がる
        x = sgn*length*(0.5-0.5*math.cos(a)); zz = -droop*(0.5-0.5*math.cos(a))
        c = K+TAN*x+UP*zz+NRM*(0.016+0.011*math.sin(a))
        w = (RW*0.5)*(0.45+0.75*math.sin(a/2))            # 結び目ではしぼり、輪の先で広がる
        A.append(bm.verts.new(c-UP*w)); B.append(bm.verts.new(c+UP*w))
    for s in range(NS):
        f = bm.faces.new((A[s], A[s+1], B[s+1], B[s]))
        for l, (sx, sy) in zip(f.loops, ((0, s), (0, s+1), (1, s+1), (1, s))): l[uv].uv = (0, 0); l[uvp].uv = (sx*RW+1.0+sgn, sy*0.008)
ribbon_loop(1, 0.110, 0.018); ribbon_loop(-1, 0.104, 0.026)
# 結び目：小さな筒
NK = 12; top = []; bot = []
for i in range(NK):
    a = 2*math.pi*i/NK; p = K+NRM*0.020+TAN*math.cos(a)*0.012+NRM*math.sin(a)*0.008
    top.append(bm.verts.new(p+UP*0.021)); bot.append(bm.verts.new(p-UP*0.021))
for i in range(NK):
    i2 = (i+1) % NK; f = bm.faces.new((bot[i], bot[i2], top[i2], top[i]))
    for l, (sx, sy) in zip(f.loops, ((i, 0), (i+1, 0), (i+1, 1), (i, 1))): l[uv].uv = (0, 0); l[uvp].uv = (sx*0.006+5, sy*0.034)
sash = newobj("Knit_Sash", bm, JAC)
sd = sash.modifiers.new("Solidify", 'SOLIDIFY'); sd.thickness = 0.002; sd.offset = 0.0

def mat(name, col, rough, **kw):
    mt = bpy.data.materials.get(name) or bpy.data.materials.new(name); mt.use_nodes = True
    b = next(n for n in mt.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*col, 1); b.inputs["Roughness"].default_value = rough
    for k, v in kw.items(): b.inputs[k].default_value = v
    mt.diffuse_color = (*col, 1); mt.use_backface_culling = False
    return mt
# ── 白のインナーパンツ（スカートの中。座る・乗り物に乗るときに見えてもよいように）──
#   名前を Knit_Inner にすると、bind_rig.py がスカートのめり込み防止の相手に入れる
#   形はショーツ：すそ（脚の穴）は股から腰の横へ斜めに上がる。股は布で覆う（股の下 0.787 より低い所まで取る）。
#   後ろは前より深く、おしりを覆う。ふちに縁取り（少し厚く）、前のまん中に小さなリボン
def _leg_cut(c):
    u = abs(c.x); back = ss((c.y+0.01)/0.05)
    return 0.780+0.125*ss((u-0.035)/0.120)-0.040*back*ss((u-0.03)/0.08)
def _waist(c): return 1.008+0.006*ss((c.y+0.02)/0.06)      # 上のふちはニットのすそ（1.000）の下へ 8mm 入れる（すき間に地肌がのぞいた。深く入れると腰の横でニットから突き出た）
def inner_sel(c): return abs(c.x) < 0.22 and _leg_cut(c) <= c.z <= _waist(c)
bm, isel = from_body(inner_sel)
bm.normal_update()
for v in bm.verts: v.co += v.normal*0.0028
# すそのふちを、体の面の段々ではなく、なめらかな線にそろえる（ふちに沿ってならし、肌の上へ戻す）
_ipolys = [tuple(p.vertices) for p in me.polygons if all(inb[v] for v in p.vertices)]
_ibvh = BVHTree.FromPolygons(co, _ipolys)
_rim = [v for v in bm.verts if v.is_boundary]
for _ in range(10):
    _nw = {}
    for v in _rim:
        nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
        if len(nb) == 2: _nw[v] = v.co*0.5+(nb[0].co+nb[1].co)*0.25
    for v, c_ in _nw.items(): v.co = c_
# 股：体のくぼみに沿わせず、ならして平らな布で覆う（形が出ないように）。ならしたあと、肌より内へ入った所は外へ出す
_crotch = [v for v in bm.verts if not v.is_boundary and abs(v.co.x) < 0.06 and v.co.z < 0.875]
for _ in range(25): bmesh.ops.smooth_vert(bm, verts=_crotch, factor=0.6, use_axis_x=True, use_axis_y=True, use_axis_z=True)
for v in _crotch:
    loc, nor, idx, dist = _ibvh.find_nearest(v.co)
    if loc is not None and ((v.co-loc).dot(nor) < 0.003): v.co = loc+nor*0.003
for v in _rim:                                           # 縁取り：ふちは少し厚く浮かせる
    loc, nor, idx, dist = _ibvh.find_nearest(v.co)
    if loc is not None: v.co = loc+nor*0.0042
# 前のまん中の小さなリボン（輪 2 つと結び目）
_top = max((v.co for v in bm.verts if abs(v.co.x) < 0.01 and v.co.y < -0.05), key=lambda p: p.z)
def _blob(c, rx, ry, rz):
    rings = []
    for i in range(1, 5):
        a = math.pi*i/5
        rings.append([bm.verts.new(c+Vector((rx*math.sin(a)*math.cos(k*math.pi/4), ry*math.sin(a)*math.sin(k*math.pi/4), rz*math.cos(a)))) for k in range(8)])
    for i in range(3):
        for k in range(8): bm.faces.new((rings[i][k], rings[i][(k+1) % 8], rings[i+1][(k+1) % 8], rings[i+1][k]))
    for ring, z in ((rings[0], rz), (rings[-1], -rz)):
        cv = bm.verts.new(c+Vector((0, 0, z)))
        for k in range(8): bm.faces.new((ring[k], ring[(k+1) % 8], cv) if z > 0 else (ring[(k+1) % 8], ring[k], cv))
_bc = Vector((0.0, _top.y-0.0035, _top.z-0.010))
_blob(_bc+Vector((0.0055, 0, 0.0015)), 0.0050, 0.0018, 0.0030); _blob(_bc+Vector((-0.0055, 0, 0.0015)), 0.0050, 0.0018, 0.0030)
_blob(_bc, 0.0020, 0.0022, 0.0022)
innerw = newobj("Knit_Inner", bm, mat("Inner_White", (0.90, 0.89, 0.87), 0.75, **{"Sheen Weight": 0.2}))
to_hide |= erode(isel, 2)

# ── 黒のパンプス（底は薄く、かかとに太めのブロックヒール）。実際の足の位置（co_real）で作る ──
#   足は custom-heel でかかとが上がっている。底は足の裏に沿わせ（厚さ 5mm）、かかとの下から地面までヒールを立てる
cr = co_real
fpoly = [tuple(p.vertices) for p in me.polygons if all(inb[v] and cr[v].z < 0.20 for v in p.vertices)]
fbvh = BVHTree.FromPolygons(cr, fpoly)
F = [cr[i] for i in range(len(cr)) if inb[i] and cr[i].x > 0.04 and cr[i].z < 0.13]
toe = min(c.y for c in F); heel = max(c.y for c in F)
SOLE = 0.005
NS = 20; st = []
for i in range(NS+1):
    t = i/NS; y = heel+(toe-heel)*(0.02+0.96*t)
    sl = [c for c in F if abs(c.y-y) < 0.010]
    zlo = min(c.z for c in sl); sl = [c for c in sl if c.z < zlo+0.055]
    st.append([t, y, min(c.x for c in sl)-0.004, max(c.x for c in sl)+0.004, max(c.z for c in sl), zlo])
for _ in range(2):
    st = [st[0]]+[[st[i][0], st[i][1]]+[(st[i-1][j]+2*st[i][j]+st[i+1][j])/4 for j in (2, 3, 4, 5)] for i in range(1, NS)]+[st[-1]]
TC = 0.60                     # ここから先（つま先側）は甲を覆う
def topline(t): return 0.040 if t < 0.12 else max(0.016, 0.040-(t-0.12)/0.30*0.024)
W = 3; A = 7
bm = bmesh.new(); solef = []; keep = set()
def build(sgn):
    secs = []
    for (t, y, xl, xr, zt, zlo) in st:
        cx = (xl+xr)/2; w = (xr-xl)/2
        if t < 0.05: w *= 0.78
        if t > 0.93: w *= 0.78
        zb = zlo-0.0015; H = zt-zb
        closed = t > TC; tl = topline(t) if not closed else min(0.020, H*0.5)
        L = [bm.verts.new((sgn*(cx-w*(1+0.03*math.sin(math.pi*q/(W-1)))), y, zb+tl*q/(W-1))) for q in range(W)]
        R = [bm.verts.new((sgn*(cx+w*(1+0.03*math.sin(math.pi*q/(W-1)))), y, zb+tl*q/(W-1))) for q in range(W)]
        SL = [bm.verts.new((sgn*(cx-w*1.02), y, zb)), bm.verts.new((sgn*(cx-w*1.02), y, zb-SOLE))]      # 薄い底
        SR = [bm.verts.new((sgn*(cx+w*1.02), y, zb)), bm.verts.new((sgn*(cx+w*1.02), y, zb-SOLE))]
        for v in SL+SR+[L[0], R[0]]: keep.add(v)
        top = []
        if closed:
            Hh = min(H+0.004, 0.045)
            for a in range(1, A):
                ang = math.pi*a/A; top.append(bm.verts.new((sgn*(cx-w*math.cos(ang)), y, zb+tl+(Hh-tl)*math.sin(ang)**0.8)))
        secs.append((closed, L, top, R, SL, SR, zb))
    def face(vs, sole=False):
        try:
            f = bm.faces.new(vs if sgn > 0 else vs[::-1])
            if sole: solef.append(f)
        except ValueError: pass
    for i in range(NS):
        (c0, L0, T0_, R0, SL0, SR0, _), (c1, L1, T1, R1, SL1, SR1, _) = secs[i], secs[i+1]
        for q in range(W-1):
            face([L0[q], L0[q+1], L1[q+1], L1[q]]); face([R0[q+1], R0[q], R1[q], R1[q+1]])
        face([SL0[0], L0[0], L1[0], SL1[0]], True); face([R0[0], SR0[0], SR1[0], R1[0]], True)
        face([SL0[1], SL0[0], SL1[0], SL1[1]], True); face([SR0[0], SR0[1], SR1[1], SR1[0]], True)
        face([SL0[1], SL1[1], SR1[1], SR0[1]], True)
        if c0 and c1:
            a = [L0[-1]]+T0_+[R0[-1]]; b = [L1[-1]]+T1+[R1[-1]]
            for q in range(len(a)-1): face([a[q], a[q+1], b[q+1], b[q]])
    c, L, T, R, SL, SR, zb = secs[-1]; s = st[-1]; cx = (s[2]+s[3])/2
    tip = bm.verts.new((sgn*cx, s[1]-0.012, zb+0.010)); tipb = bm.verts.new((sgn*cx, s[1]-0.014, zb)); tipg = bm.verts.new((sgn*cx, s[1]-0.014, zb-SOLE))
    for v in (tipb, tipg): keep.add(v)
    ringv = L+T+R[::-1]
    for q in range(len(ringv)-1): face([ringv[q], ringv[q+1], tip])
    face([L[0], tip, tipb]); face([tip, R[0], tipb])
    face([SL[0], L[0], tipb], True); face([R[0], SR[0], tipb], True)
    face([SL[1], SL[0], tipb, tipg], True); face([SR[0], SR[1], tipg, tipb], True); face([SL[1], tipg, SR[1]], True)
    c, L, T, R, SL, SR, zb = secs[0]; s = st[0]; cx = (s[2]+s[3])/2
    hb = [bm.verts.new((sgn*cx, s[1]+0.007, zb+topline(0)*q/(W-1))) for q in range(W)]
    hg = bm.verts.new((sgn*cx, s[1]+0.008, zb-SOLE)); keep.add(hg); keep.add(hb[0])
    for q in range(W-1): face([L[q+1], L[q], hb[q], hb[q+1]]); face([R[q], R[q+1], hb[q+1], hb[q]])
    face([L[0], SL[0], hb[0]], True); face([SR[0], R[0], hb[0]], True)
    face([SL[0], SL[1], hg, hb[0]], True); face([SR[1], SR[0], hb[0], hg], True); face([SL[1], SR[1], hg], True)
    # ブロックヒール：かかとの下（前から 3 割まで）から地面まで。上はかかとの幅いっぱい、下は少し細く・前寄り
    s0 = st[1]; s1 = min(st, key=lambda r: abs(r[0]-0.27))
    yb = st[0][1]+0.004; yf = s1[1]; cx0 = (s0[2]+s0[3])/2; hw = (s0[3]-s0[2])/2*0.86
    zt_b = st[0][5]-0.0015-SOLE; zt_f = s1[5]-0.0015-SOLE
    top4 = [bm.verts.new((sgn*(cx0-hw), yb, zt_b)), bm.verts.new((sgn*(cx0+hw), yb, zt_b)),
            bm.verts.new((sgn*(cx0+hw), yf, zt_f)), bm.verts.new((sgn*(cx0-hw), yf, zt_f))]
    bw = hw*0.80; yb2 = yb-0.006; yf2 = yf+0.010
    bot4 = [bm.verts.new((sgn*(cx0-bw), yb2, 0.0)), bm.verts.new((sgn*(cx0+bw), yb2, 0.0)),
            bm.verts.new((sgn*(cx0+bw), yf2, 0.0)), bm.verts.new((sgn*(cx0-bw), yf2, 0.0))]
    for v in top4+bot4: keep.add(v)
    face([bot4[3], bot4[2], bot4[1], bot4[0]], True)
    for k in range(4):
        k2 = (k+1) % 4; face([top4[k], top4[k2], bot4[k2], bot4[k]], True)
build(1); build(-1)
for v in bm.verts:
    if v in keep: continue
    loc, nor, idx, dist = fbvh.find_nearest(v.co)
    if loc and ((v.co-loc).dot(nor) < 0 or dist < 0.0055):                # 足の肌が透けないよう、5.5mm 離す
        p = loc+nor*0.0055; v.co.x = p.x; v.co.y = p.y
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0003)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
_sf = set(f for f in solef if f.is_valid)
for f in bm.faces: f.material_index = 1 if f in _sf else 0
# 甲の革を 1 段細かくして、つま先の角ばりを消す。分けたあと、足から離し直す
_up = [e for e in bm.edges if e.link_faces and all(f.material_index == 0 for f in e.link_faces)]
bmesh.ops.subdivide_edges(bm, edges=_up, cuts=1, use_grid_fill=True, smooth=1.0)
for v in bm.verts:
    if any(f.material_index == 1 for f in v.link_faces): continue
    loc, nor, idx, dist = fbvh.find_nearest(v.co)
    if loc and ((v.co-loc).dot(nor) < 0 or dist < 0.0055):
        p = loc+nor*0.0055; v.co.x = p.x; v.co.y = p.y
shoes = newobj("Knit_Shoes", bm, [mat("Flat_Leather", (0.018, 0.017, 0.019), 0.32, **{"Coat Weight": 0.0}), mat("Flat_Sole", (0.03, 0.025, 0.022), 0.5)], shift=False)
for p in shoes.data.polygons: p.use_smooth = p.material_index == 0
# 靴の中の足を隠す：足の裏と、つま先の覆われた所だけ。はき口より上まで隠すと、肌に穴が開いてギザギザに見える
def _zlo(y):
    r = min(st, key=lambda q: abs(q[1]-y)); return r[5]
def _t(y): return (y-heel)/(toe-heel)
to_hide |= {i for i in range(len(cr)) if inb[i] and abs(cr[i].x) > 0.04 and cr[i].z < 0.13 and heel+0.01 > cr[i].y > toe-0.01
            and (cr[i].z < _zlo(cr[i].y)+0.004 or (_t(cr[i].y) > TC+0.12 and cr[i].z < _zlo(cr[i].y)+0.013))}

# ── 肌を隠す・ほかのコーデを隠す ──
body.remove(list(to_hide)); hid.add(list(to_hide), 1.0, 'REPLACE')
KEEP = {"Girl_Body", "Girl_Brows", "Girl_MouthBag", "Girl_Teeth", "Girl_Hair", "Girl_Knit", "Knit_Skirt", "Knit_Sash", "Knit_Shoes", "Knit_Inner"}
for o in bpy.data.objects:
    if o.type == 'MESH' and o.parent is rig or o.name in KEEP:
        h = o.name not in KEEP
        o.hide_viewport = h; o.hide_render = h; o.hide_set(h)
print("knit outfit built. hidden", len(to_hide),{o.name: len(o.data.polygons) for o in (knit, skirt, sash, innerw, shoes)})
rig.data.pose_position = _pose
exec(compile(open("C:\\Users\\shuji\\Documents\\girl-blender\\scripts\\bind_rig.py", encoding="utf-8").read(), "bind_rig.py", "exec"), {"__name__": "__main__"})
# 髪のめり込み防止の相手に、ニットを入れる（bind_rig.py はニットを知らないので）
hr = bpy.data.objects.get("Girl_Hair"); po = hr and next((x for x in hr.modifiers if x.name == "PushOut"), None)
if po:
    ng = po.node_group; ids = {it.name: it.identifier for it in ng.interface.items_tree if it.item_type == 'SOCKET' and it.in_out == 'INPUT'}
    getattr(po.properties.inputs, ids["Target B"]).value = knit
