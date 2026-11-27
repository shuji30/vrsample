# 5 人目（ワンピース 2）の服を作る（Blender の中で exec する）。girl-onepiece2.blend で実行する。
# 4 人目の make_outfit_onepiece.py の写しを、白いレースのワンピースに作り替えた（LACE = True）。
#   OP_Dress  … 上身ごろ。四角い襟ぐり（SQUARE）、ふくらんだ短いパフスリーブ。布は白い生地に白い花のレース（OP_Lace）
#   OP_Trim   … 襟ぐりの前のふちのレース（ふちがスカラップ、透かしの菱形）
#   OP_Frill  … 袖口のレースのフリル（袖口をしぼった下に垂れる）
#   OP_Skirt  … スカートの下の段（薄い白い布。ひざ上丈でふんわり広がる）
#   OP_SkirtLace … スカートの上の段（レース。下の段より短く、すそはスカラップ）
#   OP_Belt   … ウエストの白い帯。OP_Shoes … 白のストラップサンダル
# ここから下は、4 人目のときの説明（ジャカードの柄・ベルト・黒のサンダル）
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
_sub = [x for x in ob.modifiers if x.type == 'SUBSURF']; _sub_st = [x.show_viewport for x in _sub]      # 細分化も外して測る（頂点の番号を体のメッシュとそろえる）
for x in _sub: x.show_viewport = False
mk.show_viewport = False; bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get(); e = ob.evaluated_get(dg); m = e.to_mesh()
co_real = [v.co.copy() for v in m.vertices]; e.to_mesh_clear(); mk.show_viewport = True
for x, s_ in zip(_sub, _sub_st): x.show_viewport = s_
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
LACE = True                                              # 白いレース（5 人目）。False で 4 人目の黒地のジャカード
def floral_mat():
    """黒地に、ピンクの大きな花（5 枚の花びら）と、金とくすんだ緑の葉。UV「Pattern」（単位は m）で描く。
    花と葉は、ボロノイの点ごとに置き、点ごとの乱数で、置くか・向き・大きさ・色を変える"""
    _nm = "OP_Lace" if LACE else "OP_Floral"
    mt = bpy.data.materials.get(_nm)
    if mt: bpy.data.materials.remove(mt)
    mt = bpy.data.materials.new(_nm); mt.use_nodes = True; nt = mt.node_tree; Nn = nt.nodes; L = nt.links
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
    fx, fy, fr = cells(0.075 if LACE else 0.14, (0.0, 0.0, 0.0))        # レースは花を小さく、こまかく
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
    if LACE:                                             # 白い花の刺しゅう：花びらは地より明るく、重なりの線は少し灰色
        pink = mixc(smooth(0.15, 1.0, tone), (0.985, 0.985, 0.975, 1), (0.95, 0.95, 0.94, 1))
        pink = mixc(M('MULTIPLY', ring, 0.55), pink, (0.70, 0.70, 0.69, 1))
        pink = mixc(smooth(0.0, 0.06, M('SUBTRACT', 0.12, tone)), pink, (0.88, 0.88, 0.86, 1))
    else:
        pink = mixc(smooth(0.15, 1.0, tone), (0.99, 0.88, 0.84, 1), (0.90, 0.50, 0.60, 1))
        pink = mixc(M('MULTIPLY', ring, 0.45), pink, (0.70, 0.30, 0.42, 1))
        pink = mixc(smooth(0.0, 0.06, M('SUBTRACT', 0.12, tone)), pink, (0.95, 0.80, 0.42, 1))   # 花のまん中（しべ）
    # 葉：間隔 8cm。細長い楕円を、点ごとの向きで置く。金か、くすんだ緑
    lx, ly, lr = cells(0.045 if LACE else 0.080, (3.7, 1.3, 0.0))
    la = M('MULTIPLY', lr[0], 6.283); ca = M('COSINE', la); sa = M('SINE', la)
    xr = M('ADD', M('MULTIPLY', lx, ca), M('MULTIPLY', ly, sa)); yr = M('SUBTRACT', M('MULTIPLY', ly, ca), M('MULTIPLY', lx, sa))
    e = M('ADD', M('POWER', M('DIVIDE', xr, 0.46), 2.0), M('POWER', M('DIVIDE', yr, 0.19), 2.0))
    lf = M('MULTIPLY', M('SUBTRACT', 1.0, smooth(0.85, 1.0, e)), smooth(0.08, 0.12, lr[1]))
    rib = smooth(0.0, 0.02, M('SUBTRACT', 0.025, M('ABSOLUTE', yr)))                   # 葉の中心の筋
    gold = M('GREATER_THAN', lr[2], 0.40)
    lcol = mixc(gold, (0.12, 0.15, 0.12, 1), (0.62, 0.50, 0.26, 1)) if not LACE else mixc(gold, (0.93, 0.93, 0.92, 1), (0.96, 0.96, 0.95, 1))
    lcol = mixc(M('MULTIPLY', rib, 0.6), lcol, (0.05, 0.05, 0.04, 1) if not LACE else (0.74, 0.74, 0.73, 1))
    leaf = M('MULTIPLY', M('MULTIPLY', lf, M('SUBTRACT', 1.0, fl)), noseam)          # 葉は花の下
    col = mixc(leaf, (0.018, 0.017, 0.020, 1) if not LACE else (0.88, 0.82, 0.80, 1), lcol)      # レースの地は、下のブラッシュピンクの裏地が透けた色
    col = mixc(fl, col, pink)
    L.new(col, b.inputs["Base Color"])
    gm = M('MULTIPLY', leaf, gold)
    L.new(M('MULTIPLY', gm, 0.0 if LACE else 0.85), b.inputs["Metallic"])                               # 金の葉だけ光らせる
    L.new(M('ADD', 0.62, M('MULTIPLY', gm, -0.30)), b.inputs["Roughness"])
    mt.diffuse_color = (0.05, 0.04, 0.045, 1) if not LACE else (0.92, 0.92, 0.90, 1); mt.use_backface_culling = False
    if LACE: b.inputs["Sheen Weight"].default_value = 0.5
    return mt
FAB = floral_mat()
BELT = mat("OP_Belt", (0.50, 0.05, 0.20), 0.45, **{"Sheen Weight": 0.4, "Coat Weight": 0.15}) if not LACE else \
       mat("OP_BeltWhite", (0.93, 0.93, 0.91), 0.40, **{"Sheen Weight": 0.5, "Coat Weight": 0.10})      # 白いサテンの帯
to_hide = set()

# ── 上身ごろ（体に沿う。スタンドカラー・パフスリーブ）────────────────────────
HEM = 1.000                                              # すそ（スカートの中に入る）
SLEEVE = 0.125                                           # 袖の長さ（肩の関節から、二の腕に沿って）
PUFF = 0.034 if LACE else 0.024                         # パフスリーブのふくらみ（m）
# スタンドカラーの高さは、あご先から決める（首の長さを変えても、あごにぶつからず、首が少し見えるように）
CHIN_L = (float(ob["head_small"][2])-T0.z)/HS            # あご先の高さ（服を作る座標で）
COLLAR_GAP = 0.045                                       # えりの上のふち（前）を、あご先の何 m 下にするか
ZN = CHIN_L-COLLAR_GAP-0.030                             # ここより上が首（スタンドカラー）
def NECK(c): return CHIN_L-COLLAR_GAP+max(0.0, c.y+0.05)*0.25       # スタンドカラーの上のふち（後ろが少し高い）
# 肩出し（OFF_SHOULDER）：えりを作らず、肩の関節の少し下を、胸・二の腕・背中まで横一直線に通る襟ぐりにする。
#   袖は、襟ぐりから下の短いパフスリーブになる。OFF_DROP … 肩の関節の上から、襟ぐりまで下げる量（m）
OFF_SHOULDER = bool(globals().get("OFF_SHOULDER", ob.get("off_shoulder", False)))
OFF_DROP = float(globals().get("OFF_DROP", ob.get("off_drop", 0.035)))
def ZOFF(c): return shoulder.z-OFF_DROP-0.006*(1-ss(abs(c.x)/0.12))*(c.y < 0)      # 前のまん中だけ、ほんの少し下げる
# 肩出しの袖（OFF_CAP）：袖は肩の先の丸みの上だけを包み（肩の首寄りは出す）、脇の下は布を付けない（脇が見える）。
#   OFF_XN … ここより首寄り（|x| が小さい所）は襟ぐりの線まで出す。OFF_ARM … 脇の上の、布を付けない高さ（肩の関節から下へ）
#   OFF_CAP … 袖の長さ（肩の関節から腕に沿って）。袖は腕の上側だけ（腕の上から ±OFF_CAPA 度）
OFF_XN = 0.112; OFF_ARM = 0.070; OFF_CAP = 0.075; OFF_CAPA = 80.0
# ホルターネック（OFF_HALTER）：肩の先の袖を付けず、胸元の左右から 2 本のひもを首に沿わせて、首の後ろで結ぶ（OP_Strap）
OFF_HALTER = OFF_SHOULDER and bool(globals().get("OFF_HALTER", ob.get("off_halter", False)))
def off_sel(c):
    ax = abs(c.x)
    if ax <= OFF_XN: return c.z <= ZOFF(c)
    if OFF_HALTER: return ax < 0.165 and c.z <= shoulder.z-OFF_ARM      # ホルターネック：袖は付けず、わきは脇の下より下だけ
    if ax < 0.165:                                        # 肩の上（布）と、その下の脇（出す）
        return c.z >= shoulder.z-0.004 or c.z <= shoulder.z-OFF_ARM
    p = Vector((ax, c.y, c.z))-shoulder; t = p.dot(ua)
    if t > OFF_CAP: return False
    q = p-ua*t
    if q.length < 1e-6: return True
    return q.normalized().dot((Vector((0, 0, 1))-ua*ua.z).normalized()) > math.cos(math.radians(OFF_CAPA))
# 四角い襟ぐり（SQUARE）：前は胸の上を横一直線（肩の関節から SQ_DF 下）、後ろは SQ_DB 下。横は |x| = SQ_X で、肩の上を前から後ろへ
SQUARE = bool(globals().get("SQUARE", ob.get("square_neck", False)))
SQ_X = 0.082; SQ_DF = 0.060; SQ_DB = 0.035
def sq_top(c):
    if abs(c.x) >= SQ_X: return 9.0                       # 肩の上（襟ぐりの外）は、上まで布（ZN で切ると、なで肩の上が出て肩出しに見えた）
    return shoulder.z-(SQ_DF if c.y < -0.035 else SQ_DB)
def dress_sel(c):
    ax = abs(c.x)
    if OFF_SHOULDER and not off_sel(c): return False
    if SQUARE and ax <= 0.165 and c.z > sq_top(c): return False
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
    ts = (Vector((ax, c.y, c.z))-shoulder).dot(ua) if (ax > 0.150 and c.z > shoulder.z-0.075) else -1.0   # 袖だけ（脇の胴まで含めると、脇の下で身ごろがふくらんだ）
    puff = math.sin(math.pi*min(1.0, max(0.0, (ts+0.02)/(SLEEVE+0.02))))**0.8 if ts > -0.02 else 0.0
    if LACE: puff = math.sin(math.pi*min(1.0, max(0.0, (ts+0.02)/(SLEEVE+0.005))))**0.6 if ts > -0.02 else 0.0     # ちょうちん袖：袖口のすぐ手前までふくらませて、袖口でしぼる
    neck = ss((c.z-ZN)/0.02) if ax < 0.09 else 0.0
    if v.is_boundary:
        if OFF_SHOULDER and c.z > HEM+0.08:            # 肩出しの襟ぐり・袖口・脇：体から少し浮かせる
            v.co += v.normal*0.006
        elif ax > 0.165 and c.z > HEM+0.05:               # 袖口：しぼって、ふちは少し浮かせる（肩幅を狭めると袖口が 0.20 より内へ入り、すそと取り違えて腰まで垂れた）
            v.co += v.normal*0.007
        elif SQUARE and c.z > HEM+0.08:                 # 四角い襟ぐり：体から少し浮かせるだけ
            v.co += v.normal*0.005
        elif c.z > 1.30:                                # えり（首のまわりに、ゆるく）
            v.co.z = NECK(c); v.co += Vector((v.normal.x, v.normal.y, 0))*0.007
        else:                                           # すそ
            v.co.z = HEM; v.co += Vector((v.normal.x, v.normal.y, 0))*0.006
    else:
        v.co += v.normal*(0.0045+PUFF*puff+neck*0.003)
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

# ── 5 人目：襟ぐりの前のふちのレース（OP_Trim）と、袖口のレースのフリル（OP_Frill）──
for _nm in ("OP_Trim", "OP_Frill"):
    _old = bpy.data.objects.get(_nm)
    if _old: bpy.data.objects.remove(_old, do_unlink=True)
def trim_mat():
    """白いレースのテープ：まん中に透かしの菱形（穴から肌が見える色）が並び、菱形のまわりに糸の線"""
    mt = bpy.data.materials.get("OP_TrimLace")
    if mt: bpy.data.materials.remove(mt)
    mt = bpy.data.materials.new("OP_TrimLace"); mt.use_nodes = True; nt = mt.node_tree; Nn = nt.nodes; L = nt.links
    b = next(x for x in Nn if x.type == "BSDF_PRINCIPLED"); b.inputs["Roughness"].default_value = 0.6; b.inputs["Sheen Weight"].default_value = 0.5
    def M(op, a, c=None):
        x = Nn.new("ShaderNodeMath"); x.operation = op
        for k_, y in enumerate((a, c)):
            if y is None: continue
            if isinstance(y, (int, float)): x.inputs[k_].default_value = y
            else: L.new(y, x.inputs[k_])
        return x.outputs[0]
    def sm(e0, e1, x_):
        q = M('MINIMUM', M('MAXIMUM', M('DIVIDE', M('SUBTRACT', x_, e0), e1-e0), 0.0), 1.0)
        return M('MULTIPLY', M('MULTIPLY', q, q), M('SUBTRACT', 3.0, M('MULTIPLY', q, 2.0)))
    u_ = Nn.new("ShaderNodeUVMap"); u_.uv_map = "Pattern"; sp = Nn.new("ShaderNodeSeparateXYZ"); L.new(u_.outputs["UV"], sp.inputs[0])
    du = M('MULTIPLY', M('SUBTRACT', M('FRACT', M('DIVIDE', sp.outputs[0], 0.018)), 0.5), 0.018)
    dv = M('ADD', sp.outputs[1], 0.011)
    dd = M('ADD', M('DIVIDE', M('ABSOLUTE', du), 0.0065), M('DIVIDE', M('ABSOLUTE', dv), 0.0055))
    hole = M('SUBTRACT', 1.0, sm(0.85, 1.0, dd))
    ring = M('MULTIPLY', sm(1.05, 1.15, dd), M('SUBTRACT', 1.0, sm(1.25, 1.35, dd)))
    m1 = Nn.new("ShaderNodeMix"); m1.data_type = 'RGBA'; L.new(hole, m1.inputs[0]); m1.inputs[6].default_value = (0.97, 0.97, 0.96, 1); m1.inputs[7].default_value = (0.86, 0.66, 0.56, 1)
    m2 = Nn.new("ShaderNodeMix"); m2.data_type = 'RGBA'; L.new(M('MULTIPLY', ring, 0.6), m2.inputs[0]); L.new(m1.outputs[2], m2.inputs[6]); m2.inputs[7].default_value = (0.72, 0.72, 0.71, 1)
    L.new(m2.outputs[2], b.inputs["Base Color"]); mt.diffuse_color = (0.95, 0.95, 0.94, 1); mt.use_backface_culling = False
    return mt
if LACE and SQUARE:
    # 襟ぐりの前：ふちから下へ 2.2cm のテープ。上のふちはぎざぎざ（山の間隔 1.8cm、高さ 8mm）で、ふちから肌の上へ出る
    ZNF = shoulder.z-SQ_DF; XT = SQ_X-0.004; NXT = 96
    bmT = bmesh.new(); uvT = bmT.loops.layers.uv.new("Pattern"); uvT0 = bmT.loops.layers.uv.new("UVMap")
    VS_ = (-0.022, -0.014, -0.006, 0.0, None)            # None … ぎざぎざの山
    grid = []
    for i in range(NXT+1):
        x = -XT+2*XT*i/NXT; col = []
        for v_ in VS_:
            dz = v_ if v_ is not None else 0.0015+0.008*(1-abs(2*((x/0.018+0.5) % 1.0)-1))
            h = _tb.ray_cast(Vector((x, -0.6, ZNF+dz)), Vector((0, 1, 0)), 1.0)
            q = (h[0]+h[1]*0.0080) if h[0] else Vector((x, -0.10, ZNF+dz))
            col.append((bmT.verts.new(q), (x, dz)))
        grid.append(col)
    for i in range(NXT):
        for j in range(len(VS_)-1):
            f = bmT.faces.new((grid[i][j][0], grid[i+1][j][0], grid[i+1][j+1][0], grid[i][j+1][0]))
            for l, (ii, jj) in zip(f.loops, ((i, j), (i+1, j), (i+1, j+1), (i, j+1))):
                l[uvT].uv = grid[ii][jj][1]; l[uvT0].uv = (0, 0)
    trim = newobj("OP_Trim", bmT, trim_mat())
if LACE:
    # 袖口のフリル：袖口（肩の関節から腕に沿って SLEEVE）を少し上から、腕のまわりに、下へ FR_L 垂れて外へ広がるレース。
    # ふちは細かく波打たせ、すそは山形にする
    _ap = [tuple(p.vertices) for p in me.polygons if all(inb[v] for v in p.vertices)]
    _ab = BVHTree.FromPolygons(co, _ap)
    FR_L = 0.040; NA_ = 64; NRF = 6
    bmF = bmesh.new(); uvF = bmF.loops.layers.uv.new("Pattern"); uvF0 = bmF.loops.layers.uv.new("UVMap"); nsF = bmF.verts.layers.float.new("NoSeam")
    _e1 = (Vector((0, 0, 1))-ua*ua.z).normalized(); _e2 = ua.cross(_e1)
    for sg in (1, -1):
        rows_ = []
        for j in range(NRF+1):
            s_ = j/NRF; tt = SLEEVE-0.008+FR_L*s_; ring_ = []
            for a in range(NA_):
                ang = 2*math.pi*a/NA_; d = _e1*math.cos(ang)+_e2*math.sin(ang)
                c0 = shoulder+ua*tt; h = _ab.ray_cast(c0, d, 0.12)          # 腕の中心から外へ（外から当てると、胴の側で胴の面に当たり、フリルが胴まで伸びた）
                r0 = h[3] if h[0] else 0.040
                r = r0+0.010+0.014*s_**1.2+0.004*math.sin(9*ang)*s_         # 外へ広がり、ふちが波打つ
                q = c0+d*r
                if j == NRF: q += ua*(0.005*abs(math.sin(math.pi*((a*12/NA_) % 1.0))))        # すその山形
                q = Vector((sg*q.x, q.y, q.z))
                v = bmF.verts.new(q); v[nsF] = 1.0; ring_.append((v, (ang*r0, tt)))
            rows_.append(ring_)
        for j in range(NRF):
            for a in range(NA_):
                a2 = (a+1) % NA_
                vs = (rows_[j][a][0], rows_[j][a2][0], rows_[j+1][a2][0], rows_[j+1][a][0])
                f = bmF.faces.new(vs if sg > 0 else vs[::-1])
                for l, (jj, aa) in zip(f.loops, ((j, a), (j, a2), (j+1, a2), (j+1, a))):
                    u0, v0 = rows_[jj][aa][1]
                    if aa == 0 and a == NA_-1: u0 += 2*math.pi*0.045
                    l[uvF].uv = (u0+(2.0 if sg > 0 else 4.0), v0); l[uvF0].uv = (0, 0)
    frill = newobj("OP_Frill", bmF, FAB)

# ── ホルターネックのひも（OP_Strap）：胸元の左右から首に沿って上がり、首の後ろで結ぶ。結び目と短い垂れ ──
_old = bpy.data.objects.get("OP_Strap")
if _old: bpy.data.objects.remove(_old, do_unlink=True)
# NO_STRAP … ひもを付けない（ベアトップ）。体のカスタムプロパティ no_strap で決める
NO_STRAP = bool(globals().get("NO_STRAP", ob.get("no_strap", False)))
if OFF_HALTER and not NO_STRAP:
    _bp = [tuple(p.vertices) for p in me.polygons if all(inb[v] for v in p.vertices)]
    _bv = BVHTree.FromPolygons(co, _bp)
    neckj = joint("joint-neck"); NC = Vector((0.0, neckj.y, 0.0))
    SW = 0.011; SOFF = 0.0035                             # ひもの幅・肌から浮かせる量
    def on_skin(p, out):
        """p の近くの肌の上（out の向きから当てる）に置く"""
        h = _bv.ray_cast(p+out*0.08, -out, 0.16)
        if h[0] is None:
            loc, nor, i_, d_ = _bv.find_nearest(p); return loc+nor*SOFF, nor
        return h[0]+h[1]*SOFF, h[1]
    ZB = shoulder.z+0.045                                 # 首のつけ根の高さ
    def strap_path(sg):
        """胸元から首の横を通って首の後ろまで。どの点も、首の中心の軸から外へ向けて肌に置く（置く向きを途中で変えると、首元で「く」の字に折れた）"""
        x0 = 0.058                                        # 胸元のひもの付け根（まん中から）
        z0 = ZOFF(Vector((x0, -0.1, 0)))-0.035          # 身ごろの上のふちより下（身ごろの中）から出す。ふちで止めると、すき間が見えた
        A = Vector((sg*x0, NC.y-0.13, z0))                # 胸元（首の軸から前へ離れた所）
        a1 = math.radians(62.0); r1 = 0.050
        B = Vector((sg*math.sin(a1)*r1, NC.y-math.cos(a1)*r1, ZB))     # 首の横（少し前寄り）
        pts = []; N = 44
        for i in range(N+1):
            s = i/N
            if s <= 0.5:                                  # 胸元から首の横へ、まっすぐ
                R = A.lerp(B, s/0.5)
            else:                                         # 首のまわりを後ろへ（首の付け根に沿って少し上がる）
                t = (s-0.5)/0.5; ang = a1+(math.radians(172.0)-a1)*t
                R = Vector((sg*math.sin(ang)*r1, NC.y-math.cos(ang)*r1, ZB+0.012*sstep_(t)))
            d = Vector((R.x, R.y-NC.y, 0)).normalized()
            h = _bv.ray_cast(Vector((0, NC.y, R.z))+d*0.30, -d, 0.30)
            if h[0] is None: q, nor = on_skin(R, d)
            else: q, nor = h[0]+h[1]*SOFF, h[1]
            pts.append((q, nor))
        # 折れが残らないよう、線をならす（両端は動かさない）
        for _ in range(4):
            pts = [pts[0]]+[((pts[k-1][0]+pts[k][0]*2+pts[k+1][0])/4, pts[k][1]) for k in range(1, len(pts)-1)]+[pts[-1]]
        return pts
    def sstep_(t): t = max(0, min(1, t)); return t*t*(3-2*t)
    bmS = bmesh.new()
    def ribbon(pts, w=SW):
        rows = []
        for i, (q, nor) in enumerate(pts):
            tg = (pts[min(i+1, len(pts)-1)][0]-pts[max(i-1, 0)][0]).normalized()
            side = tg.cross(nor).normalized()
            rows.append((bmS.verts.new(q-side*w/2), bmS.verts.new(q+side*w/2)))
        for a, b in zip(rows, rows[1:]): bmS.faces.new((a[0], a[1], b[1], b[0]))
    for sg in (1, -1): ribbon(strap_path(sg))
    # 結び目と垂れ（首の後ろ）
    hk = _bv.ray_cast(NC+Vector((0, 0.20, ZB+0.012)), Vector((0, -1, 0)), 0.3)
    K = (hk[0]+Vector((0, 0.010, 0))) if hk[0] else NC+Vector((0, 0.07, ZB))
    kn = bmesh.ops.create_uvsphere(bmS, u_segments=10, v_segments=6, radius=0.009)
    for v in kn["verts"]: v.co = Vector((v.co.x*1.3, v.co.y*0.8, v.co.z))+K
    for sg in (1, -1):                                    # 垂れ：結び目から下へ、少し外へ開く
        tail = []
        for i in range(9):
            t = i/8; q = K+Vector((sg*(0.006+0.012*t), 0.003+0.004*t, -0.065*t))
            hq = _bv.find_nearest(q)
            nor = Vector((0, 1, 0))
            if hq[0] is not None and (q-hq[0]).dot(hq[1]) < SOFF+0.004: q = hq[0]+hq[1]*(SOFF+0.004)
            tail.append((q, nor))
        ribbon(tail, 0.010)
    STRAP_M = mat("OP_Strap", (0.02, 0.018, 0.02), 0.5, **{"Sheen Weight": 0.3})
    strap = newobj("OP_Strap", bmS, STRAP_M)
    strap.data.materials[0].use_backface_culling = False

# ── スカート部分（ひざ丈のフレア）と、リボンの垂れ ──────────────────
_armg = {g.index for g in ob.vertex_groups if g.name in ("leftUpperArm", "rightUpperArm", "leftLowerArm", "rightLowerArm", "leftHand", "rightHand")}
_arm = [sum(g.weight for g in v.groups if g.group in _armg) > 0.3 for v in me.vertices]      # 腕・手（なで肩にして腕を下げたら、手がウエストの高さに入り、ベルトがそこまで伸びた）
polys = [tuple(p.vertices) for p in me.polygons if all(inb[v] and not _arm[v] and abs(co[v].x) < 0.30 for v in p.vertices)]
bvh = BVHTree.FromPolygons(co, polys)
def body_r(th, z, cy):
    dv = Vector((math.sin(th), -math.cos(th), 0)); h = bvh.ray_cast(Vector((0, cy, z))+dv*0.45, -dv, 0.45)
    return (0.45-h[3]) if h[0] else 0.0
ZW = 1.075; ZH = knee.z-0.035; NC = 120; NR = 18; NF = 11   # ウエスト・すそ（ひざのすぐ下）の高さ、まわりの分割、縦の分割、ドレープの数
FL_X, FL_Y, DRAPE = 0.285, 0.255, 0.07                   # すその広がり（横・前後の半径）とドレープの深さ
if LACE:
    # 5 人目：ひざ上丈で、ふんわり大きく広がる 2 段のスカート。下の段（OP_Skirt）は薄い白い布、
    # 上の段（OP_SkirtLace）はレースで、下の段より SK_OVER 短く、すそは SC_N 個の山のスカラップ（深さ SC_H）
    ZH = knee.z+0.070; NF = 14; FL_X, FL_Y, DRAPE = 0.335, 0.300, 0.085
    SK_OVER = 0.065; SC_N = 26; SC_H = 0.020
def flare_r(th, t):
    ex = 0.118+(FL_X-0.118)*t**0.85; ey = 0.092+(FL_Y-0.092)*t**0.85
    fr = 1/math.sqrt((math.sin(th)/ex)**2+(math.cos(th)/ey)**2)
    return fr*(1+DRAPE*t**1.3*math.sin(NF*th+0.6+0.5*math.sin(3*th)))   # ゆるい波（ドレープ）
def smax(a, b, k):
    """なめらかな max：体に沿う形とフレアの形の境目で、角（腰の横のくぼみ）を作らない"""
    return (a+b+math.sqrt((a-b)**2+k*k))/2
def build_skirt(zh, add=0.0, scallop=0, sc_h=0.0, nc=NC):
    """ウエスト ZW から zh までのスカート。広がりは、すそ ZH までの形（下の段）にそろえて、add だけ外へ出す。
    scallop > 0 のときは、すそを scallop 個の山のスカラップにする（山と山のあいだが上がる）"""
    bm = bmesh.new(); uv = bm.loops.layers.uv.new("UVMap"); uvp = bm.loops.layers.uv.new("Pattern"); rows = []
    tsamp = [(j/NR)**1.15 for j in range(NR+1)]          # 上ほど細かく
    for j, ts_ in enumerate(tsamp):
        z0 = ZW+(zh-ZW)*ts_; ringv = []
        for i in range(nc):
            th = 2*math.pi*i/nc; z = z0
            if scallop:
                fr_ = (scallop*i/nc) % 1.0
                z += sc_h*(1-math.sin(math.pi*fr_))*ts_**8      # すそ（下の数段）だけ、山と山のあいだを上げる
            t = (z-ZW)/(ZH-ZW); cy = -0.045+0.010*t
            br = max(body_r(th, z, cy), body_r(th, min(z+0.04, ZW), cy) if j > 0 else 0)+0.010
            r = (smax(br, flare_r(th, t), 0.035*ss(t/0.15)) if t > 0.05 else br)+add*ss(t/0.2)
            ringv.append(bm.verts.new((r*math.sin(th), cy-r*math.cos(th), z)))
        rows.append(ringv)
    arc = []
    for j in range(NR+1):
        a = [0.0]
        for i in range(nc): a.append(a[-1]+(rows[j][(i+1) % nc].co-rows[j][i].co).length)
        arc.append(a)
    down = [[0.0]*nc]
    for j in range(NR): down.append([down[-1][i]+(rows[j+1][i].co-rows[j][i].co).length for i in range(nc)])
    # 8 枚の布（はぎ）に分け、布ごとに、まん中からの長さで柄を並べる（すそほど円周が長いので、通しで並べると柄が横へずれる）
    G = 8
    def arc_at(jj, ic):
        k = int(ic); w = ic-k; return arc[jj][k]*(1-w)+arc[jj][min(k+1, nc)]*w
    for j in range(NR):
        for i in range(nc):
            a, b = rows[j], rows[j+1]; i2 = (i+1) % nc
            f = bm.faces.new((a[i], b[i], b[i2], a[i2]))
            g = (i*G)//nc; ic = (g+0.5)*nc/G
            for l, (ii, jj) in zip(f.loops, ((i, j), (i, j+1), (i+1, j+1), (i+1, j))):
                l[uv].uv = (ii/nc, 1-jj/NR)
                l[uvp].uv = (arc[jj][ii]-arc_at(jj, ic)+g*0.37, -down[jj][ii % nc])
    _ns = bm.verts.layers.float.new("NoSeam")            # スカートは、どこにも柄を置く
    for v in bm.verts: v[_ns] = 1.0
    return bm
_old = bpy.data.objects.get("OP_SkirtLace")
if _old: bpy.data.objects.remove(_old, do_unlink=True)
if LACE:
    CHIFFON = mat("OP_Chiffon", (0.95, 0.85, 0.83), 0.55, **{"Sheen Weight": 0.6})      # 下の段の薄い布：ほんのりブラッシュピンク（白一色ののっぺり感をなくし、レースの下から血色がのぞく）
    skirt = newobj("OP_Skirt", build_skirt(ZH), CHIFFON)
    skirt_lace = newobj("OP_SkirtLace", build_skirt(ZH+SK_OVER, 0.010, SC_N, SC_H, 208), FAB)
else:
    skirt = newobj("OP_Skirt", build_skirt(ZH), FAB)

# ── ウエストの太いベルト（ベリー色の布。幅 6cm）────────────────
bm = bmesh.new(); uv = bm.loops.layers.uv.new("UVMap")
ZB0, ZB1 = (1.042, 1.088) if LACE else (1.030, 1.090); NB = 120; bands = []      # 5 人目は細めの白い帯（4.6cm）
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
# 股の高さ（脚のあいだの、まん中の肌のいちばん下）から脚ぐりの高さを決める。決まった高さ（0.780）のままだと、
# 脚を短くした（set_limbs_onepiece2.py）ら股が脚ぐりより上へ上がり、股の下が覆えなかった
_cz = min(co[i].z for i in range(len(co)) if inb[i] and abs(co[i].x) < 0.008 and 0.55 < co[i].z < 1.0)
LEG0 = _cz-0.015
print("crotch (build)", round(_cz, 4))
def _leg_cut(c):
    u = abs(c.x); back = ss((c.y+0.01)/0.05)
    return LEG0+0.125*ss((u-0.035)/0.120)-0.040*back*ss((u-0.03)/0.08)
def _waist(c): return 1.008+0.006*ss((c.y+0.02)/0.06)      # 上のふちは上身ごろのすそ（1.000）の下へ入れる
def inner_sel(c): return abs(c.x) < 0.22 and _leg_cut(c) <= c.z <= _waist(c)
bm, isel = from_body(inner_sel)
bm.normal_update()
for v in bm.verts: v.co += v.normal*0.0028
_ipolys = [tuple(p.vertices) for p in me.polygons if all(inb[v] for v in p.vertices)]
_ibvh = BVHTree.FromPolygons(co, _ipolys)
smooth_rim(bm, 10)
_rim = [v for v in bm.verts if v.is_boundary]
_crotch = [v for v in bm.verts if not v.is_boundary and abs(v.co.x) < 0.06 and v.co.z < LEG0+0.095]
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
NS = 20 if not LACE else 40; st = []                     # 5 人目は細かく刻む（細い帯を作れるように）
for i in range(NS+1):
    t = i/NS; y = heel+(toe-heel)*(0.02+0.96*t)
    sl = [c for c in F if abs(c.y-y) < 0.010]
    zlo = min(c.z for c in sl); sl = [c for c in sl if c.z < zlo+0.055]
    _m = 0.004 if not LACE else 0.0015                     # 5 人目：靴を足に沿わせて細く（足が大きく見えた）
    st.append([t, y, min(c.x for c in sl)-_m, max(c.x for c in sl)+_m, max(c.z for c in sl), zlo])
for _ in range(2 if not LACE else 12):                   # 5 人目は断面を細かく刻んだので、よくならす（靴底とふちが波打った）
    st = [st[0]]+[[st[i][0], st[i][1]]+[(st[i-1][j]+2*st[i][j]+st[i+1][j])/4 for j in (2, 3, 4, 5)] for i in range(1, NS)]+[st[-1]]
TA, TB = (0.69, 0.81) if not LACE else (0.705, 0.785)   # つま先の帯（足の長さに対する位置）。5 人目は細い帯
HEELB = 0.16                                             # ここまで（かかと側）は後ろを包む
PUMP = LACE                                              # 5 人目：つま先からかかとまで包むピンヒールのパンプス（足首の帯なし）
PUMP_T = 0.60                                           # ここ（足の長さに対する位置）からつま先までを甲の革でおおう
def strap(t): return (t > PUMP_T) if PUMP else (TA < t < TB)
def topline(t):
    if PUMP: return 0.040 if t < 0.10 else 0.040-0.028*min(1, (t-0.10)/0.35)**0.8   # 履き口：かかとは 4cm 包み、横は 1.2cm へなだらかに下がる（2.2cm ではミュールに見えた）
    return (0.034 if t < 0.12 else 0.030) if not LACE else (0.020 if t < 0.06 else 0.016*(1-min(1, (t-0.06)/0.10))+0.004)   # 5 人目：かかとの後ろは低く、前へなだらかに下げる（高い四角い箱に見えた）
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
            Hh = min(H+0.004, 0.045 if not LACE else 0.030)
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
        if PUMP or (t0 < HEELB and t1 < HEELB) or (c0 and c1):   # 革：かかとの後ろと、つま先の帯だけ（パンプスは横もぐるりと）
            for q in range(W-1):
                face([L0[q], L0[q+1], L1[q+1], L1[q]]); face([R0[q+1], R0[q], R1[q], R1[q+1]])
        face([SL0[0], L0[0], L1[0], SL1[0]], True); face([R0[0], SR0[0], SR1[0], R1[0]], True)
        face([SL0[1], SL0[0], SL1[0], SL1[1]], True); face([SR0[0], SR0[1], SR1[1], SR1[0]], True)
        face([SL0[1], SL1[1], SR1[1], SR0[1]], True)
        if c0 and c1:
            a = [L0[-1]]+T0_+[R0[-1]]; b = [L1[-1]]+T1+[R1[-1]]
            for q in range(len(a)-1): face([a[q], a[q+1], b[q+1], b[q]])
    _, c, L, T, R, SL, SR, zb = secs[-1]; s = st[-1]; cx = (s[2]+s[3])/2
    _tp = 0.014 if not LACE else (0.026 if PUMP else 0.004)   # つま先の底の出っぱり（パンプスはとがったポインテッドトウ）
    tipb = bm.verts.new((sgn*cx, s[1]-_tp, zb)); tipg = bm.verts.new((sgn*cx, s[1]-_tp, zb-SOLE))      # つま先は底だけ（開いている）
    for v in (tipb, tipg): keep.add(v)
    if PUMP:                                              # つま先をふさぐ：最後の断面の革を、つま先の先の 1 点へ集める（丸いつま先）
        Hl = (secs[-1][3][len(secs[-1][3])//2].co.z-zb) if secs[-1][3] else 0.02
        tipc = bm.verts.new((sgn*cx, s[1]-_tp+0.002, zb+0.006)); keep.add(tipc)        # つま先の先：低く前へとがらせる
        ring = L+T+R[::-1]
        for q in range(len(ring)-1): face([ring[q], ring[q+1], tipc])
        face([L[0], tipc, tipb] if False else [L[0], tipb, tipc][::-1]); face([R[0], tipc, tipb][::-1])
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
    yb = st[0][1]+0.004; yf = s1[1]; cx0 = (s0[2]+s0[3])/2; hw = (s0[3]-s0[2])/2*(0.86 if not LACE else 0.62)      # 5 人目は細めのヒール
    zt_b = st[0][5]-0.0015-SOLE; zt_f = s1[5]-0.0015-SOLE
    top4 = [bm.verts.new((sgn*(cx0-hw), yb, zt_b)), bm.verts.new((sgn*(cx0+hw), yb, zt_b)),
            bm.verts.new((sgn*(cx0+hw), yf, zt_f)), bm.verts.new((sgn*(cx0-hw), yf, zt_f))]
    bw = hw*0.80; yb2 = yb-0.006; yf2 = yf+0.010
    bot4 = [bm.verts.new((sgn*(cx0-bw), yb2, 0.0)), bm.verts.new((sgn*(cx0+bw), yb2, 0.0)),
            bm.verts.new((sgn*(cx0+bw), yf2, 0.0)), bm.verts.new((sgn*(cx0-bw), yf2, 0.0))]
    if LACE:
        # 5 人目：細いヒール。かかとの下に、断面が丸く、下へ細くすぼまる柱（上は楕円 横 HT_X×前後 HT_Y、地面で直径 HB_D）。
        #   ブロックヒールは四角く重く見えた。柱は少し前へ傾け、底に向かって内へ反らせる
        for v in top4+bot4: bm.verts.remove(v)
        HT_X, HT_Y, HB_D, NSEG, NR = 0.0060, 0.0075, 0.0020, 14, 10      # ピンヒール：上 1.2×1.5cm、地面で直径 4mm
        ct = Vector((sgn*cx0, yb-HT_Y-0.001, zt_b)); cb = Vector((sgn*cx0, yb-HT_Y-0.001, 0.0))      # かかとのいちばん後ろの下に、まっすぐ縦に立てる
        rings = []
        for j in range(NR+1):
            t_ = j/NR; c = ct.lerp(cb, t_)                                              # まっすぐ（反らせると、曲がって見えた）
            rx = HT_X+(HB_D-HT_X)*t_; ry = HT_Y+(HB_D-HT_Y)*t_                     # 上から下へまっすぐ細くなる
            rings.append([bm.verts.new((c.x+rx*math.cos(2*math.pi*a/NSEG), c.y+ry*math.sin(2*math.pi*a/NSEG), c.z)) for a in range(NSEG)])
        for v in sum(rings, []): keep.add(v)
        for j in range(NR):
            for a in range(NSEG):
                a2 = (a+1) % NSEG; face([rings[j][a], rings[j][a2], rings[j+1][a2], rings[j+1][a]], True)
        face(rings[-1][::-1], True); face(rings[0], True)
    else:
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
if PUMP:                                                  # パンプス：肌から離した革が頂点ごとにばらついて波打ったので、ならしてから、もう一度肌の外へ出す
    _up = [v for v in bm.verts if v not in keep]
    # 肌の細かいでこぼこ（指の付け根など）が革に写って横が波打ったので、よくならし、肌にもぐった所だけ押し戻す
    for it in range(40):
        bmesh.ops.smooth_vert(bm, verts=_up, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=False)   # 高さは動かさない（かかとの壁が下へつぶれた）
        if it % 4 == 3 or it == 39:
            for v in _up:
                loc, nor, idx, dist = fbvh.find_nearest(v.co)
                if loc and ((v.co-loc).dot(nor) < 0.0015): v.co = loc+nor*0.0015
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0003)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
_sf = set(f for f in solef if f.is_valid)
for f in bm.faces: f.material_index = 1 if f in _sf else 0
# 足首の帯：足首の関節のすぐ上を、肌から 3mm 離して一周する（高さ 9mm）。後ろは、かかとの革から帯まで細い帯でつなぐ
for sgn in (() if PUMP else (1, -1)):
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
shoes = newobj("OP_Shoes", bm, [mat("OP_PumpWhite", (0.93, 0.92, 0.90), 0.22, **{"Coat Weight": 0.6, "Coat Roughness": 0.08}), mat("OP_SandalSoleW", (0.90, 0.88, 0.85), 0.5)] if LACE else
               [mat("OP_SandalBlack", (0.020, 0.018, 0.020), 0.35, **{"Coat Weight": 0.1}), mat("OP_SandalSole", (0.55, 0.40, 0.27), 0.6)], shift=False)
for p in shoes.data.polygons: p.use_smooth = p.material_index == 0
sd = shoes.modifiers.new("Solidify", 'SOLIDIFY'); sd.thickness = 0.0015; sd.offset = 1.0
# 靴の中の足を隠す：足の裏だけ（つま先は見せる）
def _zlo(y):
    r = min(st, key=lambda q: abs(q[1]-y)); return r[5]
to_hide |= {i for i in range(len(cr)) if inb[i] and abs(cr[i].x) > 0.04 and cr[i].z < 0.13 and heel+0.01 > cr[i].y > toe-0.01
            and cr[i].z < _zlo(cr[i].y)+0.003}
if False:                                                # （パンプスの肌は make_pump_onepiece2.py で隠す。ここで隠すと甲の上まで消えて穴があいた）
    def _tt(y): return (heel-y)/max(1e-6, heel-toe)
    to_hide |= {i for i in range(len(cr)) if inb[i] and abs(cr[i].x) > 0.04 and cr[i].z < 0.13 and heel+0.01 > cr[i].y > toe-0.02
                and (_tt(cr[i].y) > PUMP_T or cr[i].z < _zlo(cr[i].y)+topline(_tt(cr[i].y))-0.004)}

# ── 肌を隠す・ほかのコーデを隠す ──
body.remove(list(to_hide)); hid.add(list(to_hide), 1.0, 'REPLACE')
KEEP = {"Girl_Body", "Girl_Brows", "Girl_MouthBag", "Girl_Teeth", "Girl_Hair", "Girl_HairLayer", "Girl_HairBand", "Girl_LashStrands", "Girl_LashLowerStrands", "OP_Dress", "OP_Strap", "OP_Skirt", "OP_SkirtLace", "OP_Trim", "OP_Frill", "OP_Belt", "OP_Shoes", "OP_Inner", "OP_Bow", "OP_Pearls", "OP_ShoeBows", "OP_PumpL", "OP_PumpR"}
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
