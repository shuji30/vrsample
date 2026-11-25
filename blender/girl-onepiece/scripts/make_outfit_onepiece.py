# 4 人目（ワンピース）の服を作る（Blender の中で exec する）。girl-onepiece.blend で、make_face_onepiece.py のあとに実行する。
#   布は、黒地にピンクの大きな花と、金とくすんだ緑の葉を織り出した、少し光るジャカード（OP_Floral）
#   OP_Dress  … ワンピースの上身ごろ。首に沿うスタンドカラー、ふくらんだ短いパフスリーブ。すそはスカートの中へ入れる
#   OP_Skirt  … ワンピースのスカート部分（ひざ丈のフレア。布は上身ごろと同じ）
#                名前に Skirt を入れると、bind_rig.py が腰と脚に付け、OP_Inner をめり込み防止の相手にする
#   OP_Belt   … ウエストのベリー色（マゼンタ寄り）の太いベルト（布）
#   OP_Inner  … 白のショーツ（スカートの中。3 人目と同じ形）
#   OP_Shoes  … 黒のストラップサンダル。つま先の帯・かかとを包む後ろ・足首の帯。底とブロックヒールはベージュ
# 3 人目の make_outfit_knit.py の写しを元にしている。寸法（m）は 3 人目の体（足が平らで靴底 2.2cm、身長の倍率 1）で書いてあり、
# この子は身長と頭身を変えてあるので（Girl_Body["height_s"]）、作る間は体の座標をその倍率で割り、できた服に倍率を掛け戻す。
# ヒールで体が動いたぶん（heel_shift との差 T0）も、作る間だけ戻す。靴だけは、実際の足の位置で作る。
import bpy, bmesh, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree

rig = bpy.data.objects["Girl_Rig"]; _pose = rig.data.pose_position; rig.data.pose_position = 'REST'
ob = bpy.data.objects["Girl_Body"]; me = ob.data
HS = float(ob.get("height_s", 1.0))
T0 = Vector(ob["heel_shift"])-Vector((0, 0, 0.022))
mk = next(m for m in ob.modifiers if m.type == 'MASK')
mk.show_viewport = False; bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get(); e = ob.evaluated_get(dg); m = e.to_mesh()
co_real = [v.co.copy() for v in m.vertices]; e.to_mesh_clear(); mk.show_viewport = True
co = [(c-T0)/HS for c in co_real]
body = ob.vertex_groups["body"]; hid = ob.vertex_groups["hidden_by_clothes"]
gi = {body.index, hid.index}
inb = [any(g.group in gi and g.weight > 0.5 for g in v.groups) for v in me.vertices]
# ほかのコーデで隠していた肌を、いったん全部見せる（このコーデで隠す所は、最後に決め直す）
allv = [i for i in range(len(co)) if inb[i]]
body.add(allv, 1.0, 'REPLACE'); hid.remove(allv)

def joint(n, src=None):
    src = src or co; j = ob.vertex_groups[n].index
    ps = [src[v.index] for v in me.vertices if any(g.group == j and g.weight > 0.5 for g in v.groups)]
    return sum(ps, Vector())/len(ps)
shoulder = joint("joint-l-shoulder"); elbow = joint("joint-l-elbow"); ua = (elbow-shoulder).normalized()
knee = joint("joint-l-knee")
def ss(t): t = max(0, min(1, t)); return t*t*(3-2*t)

def newobj(name, bm, mats, shift=True):
    old = bpy.data.objects.get(name)
    if old: bpy.data.objects.remove(old, do_unlink=True)
    if shift:
        for v in bm.verts: v.co = v.co*HS+T0             # 身長の倍率とヒールで体が動いたぶん、服も動かす
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
def smooth_rim(bm, n=10):
    """ふち（穴の縁）を、体の面の段々ではなく、なめらかな線にそろえる"""
    rim = [v for v in bm.verts if v.is_boundary]
    for _ in range(n):
        nw = {}
        for v in rim:
            nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
            if len(nb) == 2: nw[v] = v.co*0.5+(nb[0].co+nb[1].co)*0.25
        for v, c_ in nw.items(): v.co = c_
def mat(name, col, rough, **kw):
    mt = bpy.data.materials.get(name) or bpy.data.materials.new(name); mt.use_nodes = True
    b = next(n for n in mt.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    for l in list(b.inputs["Base Color"].links): mt.node_tree.links.remove(l)
    b.inputs["Base Color"].default_value = (*col, 1); b.inputs["Roughness"].default_value = rough
    for k, v in kw.items(): b.inputs[k].default_value = v
    mt.diffuse_color = (*col, 1); mt.use_backface_culling = False
    return mt

# ── 材質 ──
def floral_mat():
    """黒地に、ピンクの大きな花（5 枚の花びら）と、金とくすんだ緑の葉。UV「Pattern」（単位は m）で描く。
    花と葉は、ボロノイの点ごとに置き、点ごとの乱数で、置くか・向き・大きさ・色を変える"""
    mt = bpy.data.materials.get("OP_Floral")
    if mt: bpy.data.materials.remove(mt)
    mt = bpy.data.materials.new("OP_Floral"); mt.use_nodes = True; nt = mt.node_tree; Nn = nt.nodes; L = nt.links
    b = next(n for n in Nn if n.type == "BSDF_PRINCIPLED")
    b.inputs["Sheen Weight"].default_value = 0.3
    def lk(x, sock):
        if isinstance(x, (int, float, tuple)): sock.default_value = x
        else: L.new(x, sock)
    def M(op, a, b_=None, c_=None):
        n = Nn.new("ShaderNodeMath"); n.operation = op
        for k, x in enumerate((a, b_, c_)):
            if x is not None: lk(x, n.inputs[k])
        return n.outputs[0]
    def V(op, a, b_=None):
        n = Nn.new("ShaderNodeVectorMath"); n.operation = op
        for k, x in enumerate((a, b_)):
            if x is not None: lk(x, n.inputs[k])
        return n.outputs["Vector"]
    def VS(a, k):
        n = Nn.new("ShaderNodeVectorMath"); n.operation = 'SCALE'; lk(a, n.inputs[0]); n.inputs["Scale"].default_value = k; return n.outputs["Vector"]
    def sep(v):
        n = Nn.new("ShaderNodeSeparateXYZ"); L.new(v, n.inputs[0]); return n.outputs
    def smooth(e0, e1, x):          # e0〜e1 で 0 → 1 になめらかに
        t = M('MINIMUM', M('MAXIMUM', M('DIVIDE', M('SUBTRACT', x, e0), e1-e0), 0.0), 1.0)
        return M('MULTIPLY', M('MULTIPLY', t, t), M('SUBTRACT', 3.0, M('MULTIPLY', t, 2.0)))
    def mixc(f, a, c):
        n = Nn.new("ShaderNodeMix"); n.data_type = 'RGBA'; lk(f, n.inputs[0]); lk(a, n.inputs[6]); lk(c, n.inputs[7]); return n.outputs[2]
    uvn = Nn.new("ShaderNodeUVMap"); uvn.uv_map = "Pattern"
    noi = Nn.new("ShaderNodeTexNoise"); noi.inputs["Scale"].default_value = 18.0; L.new(uvn.outputs["UV"], noi.inputs["Vector"])
    co_ = V('ADD', uvn.outputs["UV"], VS(V('SUBTRACT', noi.outputs["Color"], (0.5, 0.5, 0.5)), 0.012))   # 座標を少し揺らす（手描きの柄らしく）
    def cells(P, off):
        q = V('ADD', VS(co_, 1.0/P), off)
        vo = Nn.new("ShaderNodeTexVoronoi"); vo.voronoi_dimensions = '2D'; vo.inputs["Scale"].default_value = 1.0; L.new(q, vo.inputs["Vector"])
        x, y, _ = sep(V('SUBTRACT', q, vo.outputs["Position"]))
        return x, y, sep(vo.outputs["Color"])
    # 花：間隔 14cm。点の 8.5 割に置く。丸い 6 枚の花びら（牡丹ふう）。外の花びらは濃いピンク、内へ行くほど淡く、
    # 花びらの重なりに影の線。中心は黄色いしべ
    fx, fy, fr = cells(0.14, (0.0, 0.0, 0.0))
    ang = M('ARCTAN2', fy, fx); rr = M('SQRT', M('ADD', M('MULTIPLY', fx, fx), M('MULTIPLY', fy, fy)))
    ph = M('MULTIPLY', fr[1], 6.283)
    size = M('ADD', 0.68, M('MULTIPLY', fr[2], 0.22))                                 # 花の大きさを点ごとに変える（となりの点との境目で切れないよう、半径は間隔の 0.4 まで）
    petal = M('MULTIPLY', M('ADD', 0.40, M('MULTIPLY', 0.045, M('ABSOLUTE', M('SINE', M('ADD', M('MULTIPLY', ang, 3.0), ph))))), size)
    fl = M('MULTIPLY', M('SUBTRACT', 1.0, smooth(-0.015, 0.0, M('SUBTRACT', rr, petal))), smooth(0.13, 0.17, fr[0]))
    # 布の継ぎ目（柄の貼り方が切りかわる所）の近くには、花も葉も置かない。頂点の属性 NoSeam（1 で置く、0 で置かない）
    nsn = Nn.new("ShaderNodeAttribute"); nsn.attribute_type = 'GEOMETRY'; nsn.attribute_name = "NoSeam"; noseam = nsn.outputs["Fac"]
    fl = M('MULTIPLY', fl, noseam)
    tone = M('DIVIDE', rr, petal)
    wav = M('ABSOLUTE', M('SINE', M('ADD', M('MULTIPLY', ang, 3.0), M('ADD', ph, M('MULTIPLY', tone, 2.0)))))
    ring = smooth(0.80, 0.97, M('ABSOLUTE', M('SINE', M('MULTIPLY', M('ADD', tone, M('MULTIPLY', wav, 0.12)), 7.5))))   # 花びらの重なりの線
    pink = mixc(smooth(0.15, 1.0, tone), (0.99, 0.88, 0.84, 1), (0.90, 0.50, 0.60, 1))
    pink = mixc(M('MULTIPLY', ring, 0.45), pink, (0.70, 0.30, 0.42, 1))
    pink = mixc(smooth(0.0, 0.06, M('SUBTRACT', 0.12, tone)), pink, (0.95, 0.80, 0.42, 1))   # 花のまん中（しべ）
    # 葉：間隔 8cm。細長い楕円を、点ごとの向きで置く。金か、くすんだ緑
    lx, ly, lr = cells(0.080, (3.7, 1.3, 0.0))
    la = M('MULTIPLY', lr[0], 6.283); ca = M('COSINE', la); sa = M('SINE', la)
    xr = M('ADD', M('MULTIPLY', lx, ca), M('MULTIPLY', ly, sa)); yr = M('SUBTRACT', M('MULTIPLY', ly, ca), M('MULTIPLY', lx, sa))
    e = M('ADD', M('POWER', M('DIVIDE', xr, 0.46), 2.0), M('POWER', M('DIVIDE', yr, 0.19), 2.0))
    lf = M('MULTIPLY', M('SUBTRACT', 1.0, smooth(0.85, 1.0, e)), smooth(0.08, 0.12, lr[1]))
    rib = smooth(0.0, 0.02, M('SUBTRACT', 0.025, M('ABSOLUTE', yr)))                   # 葉の中心の筋
    gold = M('GREATER_THAN', lr[2], 0.40)
    lcol = mixc(gold, (0.12, 0.15, 0.12, 1), (0.62, 0.50, 0.26, 1))
    lcol = mixc(M('MULTIPLY', rib, 0.6), lcol, (0.05, 0.05, 0.04, 1))
    leaf = M('MULTIPLY', M('MULTIPLY', lf, M('SUBTRACT', 1.0, fl)), noseam)          # 葉は花の下
    col = mixc(leaf, (0.018, 0.017, 0.020, 1), lcol)
    col = mixc(fl, col, pink)
    L.new(col, b.inputs["Base Color"])
    gm = M('MULTIPLY', leaf, gold)
    L.new(M('MULTIPLY', gm, 0.85), b.inputs["Metallic"])                               # 金の葉だけ光らせる
    L.new(M('ADD', 0.62, M('MULTIPLY', gm, -0.30)), b.inputs["Roughness"])
    mt.diffuse_color = (0.05, 0.04, 0.045, 1); mt.use_backface_culling = False
    return mt
FAB = floral_mat()
BELT = mat("OP_Belt", (0.50, 0.05, 0.20), 0.45, **{"Sheen Weight": 0.4, "Coat Weight": 0.15})
to_hide = set()

# ── 上身ごろ（体に沿う。スタンドカラー・パフスリーブ）────────────────────────
HEM = 1.000                                              # すそ（スカートの中に入る）
SLEEVE = 0.125                                           # 袖の長さ（肩の関節から、二の腕に沿って）
# スタンドカラーの高さは、あご先から決める（首の長さを変えても、あごにぶつからず、首が少し見えるように）
CHIN_L = (float(ob["head_small"][2])-T0.z)/HS            # あご先の高さ（服を作る座標で）
COLLAR_GAP = 0.045                                       # えりの上のふち（前）を、あご先の何 m 下にするか
ZN = CHIN_L-COLLAR_GAP-0.030                             # ここより上が首（スタンドカラー）
def NECK(c): return CHIN_L-COLLAR_GAP+max(0.0, c.y+0.05)*0.25       # スタンドカラーの上のふち（後ろが少し高い）
def dress_sel(c):
    ax = abs(c.x)
    if ax > 0.165:
        if c.z < 1.10: return False                      # 腰の横（腕ではない）
        p = Vector((ax, c.y, c.z)); return (p-shoulder).dot(ua) < SLEEVE
    return HEM <= c.z <= NECK(c)
bm, dsel = from_body(dress_sel)
inner = [v for v in bm.verts if not v.is_boundary]
for _ in range(6): bmesh.ops.smooth_vert(bm, verts=inner, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
smooth_rim(bm, 8)
bm.normal_update()
for v in bm.verts:
    ax = abs(v.co.x); c = v.co
    # パフスリーブ：肩の少し先から袖口まで、まん中がいちばんふくらむ（袖口はしぼる）
    ts = (Vector((ax, c.y, c.z))-shoulder).dot(ua) if ax > 0.12 else -1.0
    puff = math.sin(math.pi*min(1.0, max(0.0, (ts+0.02)/(SLEEVE+0.02))))**0.8 if ts > -0.02 else 0.0
    neck = ss((c.z-ZN)/0.02) if ax < 0.09 else 0.0
    if v.is_boundary:
        if ax > 0.165 and c.z > HEM+0.05:               # 袖口：しぼって、ふちは少し浮かせる（肩幅を狭めると袖口が 0.20 より内へ入り、すそと取り違えて腰まで垂れた）
            v.co += v.normal*0.007
        elif c.z > 1.30:                                # えり（首のまわりに、ゆるく）
            v.co.z = NECK(c); v.co += Vector((v.normal.x, v.normal.y, 0))*0.007
        else:                                           # すそ
            v.co.z = HEM; v.co += Vector((v.normal.x, v.normal.y, 0))*0.006
    else:
        v.co += v.normal*(0.0045+0.024*puff+neck*0.003)
# 胸の下・谷間で布が沈まないように：高さごとに、体の断面の凸包より内へ入らないようにする（3 人目と同じ）
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
ZH0, ZH1 = 1.10, 1.31; zb = [ZH0+0.01*i for i in range(int((ZH1-ZH0)/0.01)+1)]
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
_front = [v for v in bm.verts if not v.is_boundary and abs(v.co.x) < 0.14 and 1.12 < v.co.z < 1.30 and v.co.y < -0.02]
for _ in range(6): bmesh.ops.smooth_vert(bm, verts=_front, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
# 柄の UV（単位は m）。貼り方は面ごとに決める（1 枚の面の中で貼り方が混ざると、その面に柄がつぶれて線になる）。
#   胴：前と後ろから平らに投影する（横 x・高さ z）。継ぎ目はわき
#   袖：腕を軸にした円筒（腕のまわりの長さ・肩からの長さ）。継ぎ目は袖付け（肩の関節の輪）と、袖の下
#   （袖も正面から投影すると、横を向いた面で柄が四角くつぶれた）
uvp = bm.loops.layers.uv.new("Pattern"); uv0 = bm.loops.layers.uv.new("UVMap")
SIDE_A0, SIDE_A1, SIDE_Z = 58.0, 122.0, 1.235
FRONT_DU, FRONT_DV = 0.03, 0.11                          # 前身ごろの柄の位置（横・縦）。胸元に花が来るようにずらす
_e1 = (Vector((0, 0, 1))-ua*ua.z).normalized(); _e2 = ua.cross(_e1)     # 腕に直角な向き（上・前後）。角度の継ぎ目（±180°）は袖の下
def _arm(c):
    p = Vector((abs(c.x), c.y, c.z))-shoulder; t = p.dot(ua); q = p-ua*t
    return t, math.atan2(q.dot(_e2), q.dot(_e1))
for f in bm.faces:
    cc = f.calc_center_median()
    sleeve = abs(cc.x) > 0.08 and cc.z > 1.10 and _arm(cc)[0] > 0.0
    back = cc.y > -0.03
    _ang = abs(math.degrees(math.atan2(cc.x, -(cc.y+0.03))))
    # 胴の横は、横から投影する。分け目は胴のまわりの角度で決める（面の向きで決めると、継ぎ目がジグザグになった）。
    # 肩の上（上を向いた面）は前後から
    side = not sleeve and SIDE_A0 < _ang < SIDE_A1 and cc.z < SIDE_Z
    if sleeve: a0 = _arm(cc)[1]
    for l in f.loops:
        c = l.vert.co
        if sleeve:
            t, a = _arm(c); a += 2*math.pi*round((a0-a)/(2*math.pi))
            l[uvp].uv = (a*0.055+(2.0 if c.x > 0 else 4.0), t)
        elif side:
            l[uvp].uv = ((c.y if c.x > 0 else -c.y)+(6.0 if c.x > 0 else 7.0), c.z)
        else:
            l[uvp].uv = ((0.9-c.x) if back else c.x+FRONT_DU, c.z+(0.0 if back else FRONT_DV))
        l[uv0].uv = (0, 0)
# 継ぎ目からの近さ（NoSeam）：袖付け・わき・肩の上（前後の分け目）から 1.8cm までは 0、そこから 2.5cm かけて 1 へ（継ぎ目は面の大きさぶん段々になる）
#   継ぎ目は面のふちに沿って段々になるので、その近くに柄があると、細切れのかけらが並んで見えた
_ns = bm.verts.layers.float.new("NoSeam")
for v in bm.verts:
    c = v.co; d = 1.0
    if abs(c.x) > 0.08 and c.z > 1.10: d = min(d, abs(_arm(c)[0]))
    a_ = abs(math.degrees(math.atan2(c.x, -(c.y+0.03))))
    if c.z < SIDE_Z+0.02: d = min(d, min(abs(a_-SIDE_A0), abs(a_-SIDE_A1))*math.pi/180*0.13)
    if SIDE_A0-5 < a_ < SIDE_A1+5: d = min(d, abs(c.z-SIDE_Z))
    if c.z > SIDE_Z-0.02: d = min(d, abs(c.y+0.03))
    v[_ns] = ss((d-0.018)/0.025)*ss((0.62-abs(v.normal.z))/0.15)      # 上を向いた所（肩の上）も、前から投影すると柄が縦につぶれるので、無地にする
dress = newobj("OP_Dress", bm, FAB)
sd = dress.modifiers.new("Solidify", 'SOLIDIFY'); sd.thickness = 0.002; sd.offset = 1.0
to_hide |= erode(dsel, 2)

# ── スカート部分（ひざ丈のフレア）と、リボンの垂れ ──────────────────
_armg = {g.index for g in ob.vertex_groups if g.name in ("leftUpperArm", "rightUpperArm", "leftLowerArm", "rightLowerArm", "leftHand", "rightHand")}
_arm = [sum(g.weight for g in v.groups if g.group in _armg) > 0.3 for v in me.vertices]      # 腕・手（なで肩にして腕を下げたら、手がウエストの高さに入り、ベルトがそこまで伸びた）
polys = [tuple(p.vertices) for p in me.polygons if all(inb[v] and not _arm[v] and abs(co[v].x) < 0.30 for v in p.vertices)]
bvh = BVHTree.FromPolygons(co, polys)
def body_r(th, z, cy):
    dv = Vector((math.sin(th), -math.cos(th), 0)); h = bvh.ray_cast(Vector((0, cy, z))+dv*0.45, -dv, 0.45)
    return (0.45-h[3]) if h[0] else 0.0
ZW = 1.075; ZH = knee.z-0.035; NC = 120; NR = 18; NF = 11   # ウエスト・すそ（ひざのすぐ下）の高さ、まわりの分割、縦の分割、ドレープの数
def flare_r(th, t):
    ex = 0.118+(0.285-0.118)*t**0.85; ey = 0.092+(0.255-0.092)*t**0.85
    fr = 1/math.sqrt((math.sin(th)/ex)**2+(math.cos(th)/ey)**2)
    return fr*(1+0.07*t**1.3*math.sin(NF*th+0.6+0.5*math.sin(3*th)))   # ゆるい波（ドレープ）
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
arc = []
for j in range(NR+1):
    a = [0.0]
    for i in range(NC): a.append(a[-1]+(rows[j][(i+1) % NC].co-rows[j][i].co).length)
    arc.append(a)
down = [[0.0]*NC]
for j in range(NR): down.append([down[-1][i]+(rows[j+1][i].co-rows[j][i].co).length for i in range(NC)])
# 8 枚の布（はぎ）に分け、布ごとに、まん中からの長さで柄を並べる（すそほど円周が長いので、通しで並べると柄が横へずれる）
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

_ns = skirt_bm.verts.layers.float.new("NoSeam")                 # スカートは、どこにも柄を置く
for v in skirt_bm.verts: v[_ns] = 1.0
skirt = newobj("OP_Skirt", skirt_bm, FAB)

# ── ウエストの太いベルト（ベリー色の布。幅 6cm）────────────────
bm = bmesh.new(); uv = bm.loops.layers.uv.new("UVMap")
ZB0, ZB1 = 1.030, 1.090; NB = 120; bands = []
for k in range(5):
    z = ZB0+(ZB1-ZB0)*k/4; ringv = []
    for i in range(NB):
        th = 2*math.pi*i/NB; cy = -0.045
        r = max(body_r(th, z, cy), body_r(th, min(z+0.03, ZW), cy) if z < ZW else 0.0)+0.013+0.002*math.sin(math.pi*k/4)
        ringv.append(bm.verts.new((r*math.sin(th), cy-r*math.cos(th), z)))
    bands.append(ringv)
for j in range(4):
    for i in range(NB):
        a, b = bands[j], bands[j+1]; i2 = (i+1) % NB
        bm.faces.new((a[i], a[i2], b[i2], b[i]))
belt = newobj("OP_Belt", bm, BELT)
sd = belt.modifiers.new("Solidify", 'SOLIDIFY'); sd.thickness = 0.002; sd.offset = 1.0

# ── 白のインナーパンツ（3 人目と同じショーツ）──
#   名前を OP_Inner にすると、bind_rig.py がスカート（OP_Skirt）のめり込み防止の相手に入れる
def _leg_cut(c):
    u = abs(c.x); back = ss((c.y+0.01)/0.05)
    return 0.780+0.125*ss((u-0.035)/0.120)-0.040*back*ss((u-0.03)/0.08)
def _waist(c): return 1.008+0.006*ss((c.y+0.02)/0.06)      # 上のふちは上身ごろのすそ（1.000）の下へ入れる
def inner_sel(c): return abs(c.x) < 0.22 and _leg_cut(c) <= c.z <= _waist(c)
bm, isel = from_body(inner_sel)
bm.normal_update()
for v in bm.verts: v.co += v.normal*0.0028
_ipolys = [tuple(p.vertices) for p in me.polygons if all(inb[v] for v in p.vertices)]
_ibvh = BVHTree.FromPolygons(co, _ipolys)
smooth_rim(bm, 10)
_rim = [v for v in bm.verts if v.is_boundary]
_crotch = [v for v in bm.verts if not v.is_boundary and abs(v.co.x) < 0.06 and v.co.z < 0.875]
for _ in range(25): bmesh.ops.smooth_vert(bm, verts=_crotch, factor=0.6, use_axis_x=True, use_axis_y=True, use_axis_z=True)
for v in _crotch:
    loc, nor, idx, dist = _ibvh.find_nearest(v.co)
    if loc is not None and ((v.co-loc).dot(nor) < 0.003): v.co = loc+nor*0.003
for v in _rim:
    loc, nor, idx, dist = _ibvh.find_nearest(v.co)
    if loc is not None: v.co = loc+nor*0.0042
innerw = newobj("OP_Inner", bm, mat("Inner_White", (0.90, 0.89, 0.87), 0.75, **{"Sheen Weight": 0.2}))
to_hide |= erode(isel, 2)

# ── 黒のストラップサンダル。実際の足の位置（co_real）で作る ──
#   3 人目のパンプスの作りを元に、甲を覆う革は、つま先の帯（TA〜TB）とかかとを包む後ろだけにする。足首に帯を巻く。
#   底は足の裏に沿わせ（厚さ 5mm）、かかとの下から地面までブロックヒールを立てる
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
TA, TB = 0.69, 0.81                                      # つま先の帯（足の長さに対する位置）
HEELB = 0.16                                             # ここまで（かかと側）は後ろを包む
def strap(t): return TA < t < TB
def topline(t): return 0.034 if t < 0.12 else 0.030
W = 3; A = 7
bm = bmesh.new(); solef = []; keep = set()
def build(sgn):
    secs = []
    for (t, y, xl, xr, zt, zlo) in st:
        cx = (xl+xr)/2; w = (xr-xl)/2
        if t < 0.05: w *= 0.78
        if t > 0.93: w *= 0.78
        zb = zlo-0.0015; H = zt-zb
        closed = strap(t); tl = topline(t) if not closed else min(0.018, H*0.5)
        L = [bm.verts.new((sgn*(cx-w*(1+0.03*math.sin(math.pi*q/(W-1)))), y, zb+tl*q/(W-1))) for q in range(W)]
        R = [bm.verts.new((sgn*(cx+w*(1+0.03*math.sin(math.pi*q/(W-1)))), y, zb+tl*q/(W-1))) for q in range(W)]
        SL = [bm.verts.new((sgn*(cx-w*1.02), y, zb)), bm.verts.new((sgn*(cx-w*1.02), y, zb-SOLE))]
        SR = [bm.verts.new((sgn*(cx+w*1.02), y, zb)), bm.verts.new((sgn*(cx+w*1.02), y, zb-SOLE))]
        for v in SL+SR+[L[0], R[0]]: keep.add(v)
        top = []
        if closed:
            Hh = min(H+0.004, 0.045)
            for a in range(1, A):
                ang = math.pi*a/A; top.append(bm.verts.new((sgn*(cx-w*math.cos(ang)), y, zb+tl+(Hh-tl)*math.sin(ang)**0.8)))
        secs.append((t, closed, L, top, R, SL, SR, zb))
    def face(vs, sole=False):
        try:
            f = bm.faces.new(vs if sgn > 0 else vs[::-1])
            if sole: solef.append(f)
        except ValueError: pass
    for i in range(NS):
        (t0, c0, L0, T0_, R0, SL0, SR0, _), (t1, c1, L1, T1, R1, SL1, SR1, _) = secs[i], secs[i+1]
        if (t0 < HEELB and t1 < HEELB) or (c0 and c1):   # 革：かかとの後ろと、つま先の帯だけ
            for q in range(W-1):
                face([L0[q], L0[q+1], L1[q+1], L1[q]]); face([R0[q+1], R0[q], R1[q], R1[q+1]])
        face([SL0[0], L0[0], L1[0], SL1[0]], True); face([R0[0], SR0[0], SR1[0], R1[0]], True)
        face([SL0[1], SL0[0], SL1[0], SL1[1]], True); face([SR0[0], SR0[1], SR1[1], SR1[0]], True)
        face([SL0[1], SL1[1], SR1[1], SR0[1]], True)
        if c0 and c1:
            a = [L0[-1]]+T0_+[R0[-1]]; b = [L1[-1]]+T1+[R1[-1]]
            for q in range(len(a)-1): face([a[q], a[q+1], b[q+1], b[q]])
    _, c, L, T, R, SL, SR, zb = secs[-1]; s = st[-1]; cx = (s[2]+s[3])/2
    tipb = bm.verts.new((sgn*cx, s[1]-0.014, zb)); tipg = bm.verts.new((sgn*cx, s[1]-0.014, zb-SOLE))      # つま先は底だけ（開いている）
    for v in (tipb, tipg): keep.add(v)
    face([SL[0], L[0], tipb], True); face([L[0], R[0], tipb], True); face([R[0], SR[0], tipb], True)
    face([SL[1], SL[0], tipb, tipg], True); face([SR[0], SR[1], tipg, tipb], True); face([SL[1], tipg, SR[1]], True)
    _, c, L, T, R, SL, SR, zb = secs[0]; s = st[0]; cx = (s[2]+s[3])/2
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
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
for v in bm.verts:
    if v in keep: continue
    loc, nor, idx, dist = fbvh.find_nearest(v.co)
    if loc and ((v.co-loc).dot(nor) < 0 or dist < 0.0045):                # 足の肌が透けないよう、4.5mm 離す
        p = loc+nor*0.0045; v.co.x = p.x; v.co.y = p.y
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0003)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
_sf = set(f for f in solef if f.is_valid)
for f in bm.faces: f.material_index = 1 if f in _sf else 0
# 足首の帯：足首の関節のすぐ上を、肌から 3mm 離して一周する（高さ 9mm）。後ろは、かかとの革から帯まで細い帯でつなぐ
for sgn in (1, -1):
    ank = joint("joint-l-ankle", cr); ank = Vector((sgn*ank.x, ank.y, ank.z+0.012))
    ring = []
    for zz in (ank.z-0.0045, ank.z+0.0045):
        rv = []
        for i in range(36):
            th = 2*math.pi*i/36; dv = Vector((math.sin(th), -math.cos(th), 0))
            h = fbvh.ray_cast(Vector((ank.x, ank.y, zz))+dv*0.12, -dv, 0.12)
            r = (0.12-h[3]) if h[0] else 0.035
            rv.append(bm.verts.new(Vector((ank.x, ank.y, zz))+dv*(r+0.003)))
        ring.append(rv)
    for i in range(36):
        i2 = (i+1) % 36; bm.faces.new((ring[0][i], ring[0][i2], ring[1][i2], ring[1][i]))
    # 後ろの帯：かかとの革の上（後ろのまん中）から、足首の帯の下まで
    hb_top = max((v for v in bm.verts if sgn*v.co.x > 0.02 and v.co.z < ank.z-0.02 and v.co.y > heel-0.005), key=lambda v: v.co.z+v.co.y*0.2).co
    rb = ring[0][18].co                                   # 後ろのまん中（th = π）
    q = [bm.verts.new(hb_top+Vector((-0.006, 0.001, 0))), bm.verts.new(hb_top+Vector((0.006, 0.001, 0))),
         bm.verts.new(rb+Vector((0.006, 0, 0))), bm.verts.new(rb+Vector((-0.006, 0, 0)))]
    bm.faces.new(q)
bm.normal_update()
shoes = newobj("OP_Shoes", bm, [mat("OP_SandalBlack", (0.020, 0.018, 0.020), 0.35, **{"Coat Weight": 0.1}), mat("OP_SandalSole", (0.55, 0.40, 0.27), 0.6)], shift=False)
for p in shoes.data.polygons: p.use_smooth = p.material_index == 0
sd = shoes.modifiers.new("Solidify", 'SOLIDIFY'); sd.thickness = 0.0015; sd.offset = 1.0
# 靴の中の足を隠す：足の裏だけ（つま先は見せる）
def _zlo(y):
    r = min(st, key=lambda q: abs(q[1]-y)); return r[5]
to_hide |= {i for i in range(len(cr)) if inb[i] and abs(cr[i].x) > 0.04 and cr[i].z < 0.13 and heel+0.01 > cr[i].y > toe-0.01
            and cr[i].z < _zlo(cr[i].y)+0.003}

# ── 肌を隠す・ほかのコーデを隠す ──
body.remove(list(to_hide)); hid.add(list(to_hide), 1.0, 'REPLACE')
KEEP = {"Girl_Body", "Girl_Brows", "Girl_MouthBag", "Girl_Teeth", "Girl_Hair", "OP_Dress", "OP_Skirt", "OP_Belt", "OP_Shoes", "OP_Inner"}
for o in bpy.data.objects:
    if o.type == 'MESH' and o.parent is rig or o.name in KEEP:
        h = o.name not in KEEP
        o.hide_viewport = h; o.hide_render = h; o.hide_set(h)
for n in ("Girl_HairBob", "Girl_HairBun", "Girl_HairDown", "Girl_HairTwin", "Girl_HairWavy"):     # 試作の髪も隠す
    o = bpy.data.objects.get(n)
    if o: o.hide_viewport = True; o.hide_render = True; o.hide_set(True)
print("onepiece outfit built. hidden", len(to_hide), {o.name: len(o.data.polygons) for o in (dress, skirt, belt, innerw, shoes)}, "knee z", round(knee.z, 3))
rig.data.pose_position = _pose
exec(compile(open("C:\\Users\\shuji\\Documents\\girl-blender\\scripts\\bind_rig.py", encoding="utf-8").read(), "bind_rig.py", "exec"), {"__name__": "__main__"})
# 髪のめり込み防止の相手に、上身ごろを入れる（bind_rig.py はワンピースを知らないので）
hr = bpy.data.objects.get("Girl_Hair"); po = hr and next((x for x in hr.modifiers if x.name == "PushOut"), None)
if po:
    ng = po.node_group; ids = {it.name: it.identifier for it in ng.interface.items_tree if it.item_type == 'SOCKET' and it.in_out == 'INPUT'}
    getattr(po.properties.inputs, ids["Target B"]).value = dress
