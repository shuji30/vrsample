# 5 人目（ワンピース 2）のオートクチュールの飾り（Blender の中で exec する）。make_outfit_onepiece2.py のあとに流す（何度流してもよい）。
#   OP_Bow    … ウエストの後ろの大きなサテンのリボン。左右の輪（付け根でしぼり、先で幅広）・結び目・スカートの上を流れる 2 本の長い垂れ（先は V 字）
#   OP_Pearls … 背中のまん中のパールのボタン（襟ぐりからウエストまで）と、前の襟ぐりのレースに沿ったパールの列
#   位置は、今できている服（OP_Belt・OP_Dress・OP_Trim・OP_SkirtLace）の表面から決める（基本の姿勢で）
import bpy, bmesh, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

rig = bpy.data.objects["Girl_Rig"]; was = rig.data.pose_position; rig.data.pose_position = 'REST'
bpy.context.view_layer.update(); dg = bpy.context.evaluated_depsgraph_get()
def world_mesh(name):
    o = bpy.data.objects[name]; e = o.evaluated_get(dg); m = e.to_mesh()
    vs = [o.matrix_world @ v.co for v in m.vertices]; ps = [tuple(p.vertices) for p in m.polygons]; e.to_mesh_clear()
    return vs, BVHTree.FromPolygons(vs, ps)
def mat(name, col, rough, **kw):
    mt = bpy.data.materials.get(name) or bpy.data.materials.new(name); mt.use_nodes = True
    b = next(n for n in mt.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*col, 1); b.inputs["Roughness"].default_value = rough
    for k, v in kw.items(): b.inputs[k].default_value = v
    mt.diffuse_color = (*col, 1); mt.use_backface_culling = False
    return mt
def newobj(name, bm, mt):
    old = bpy.data.objects.get(name)
    if old: bpy.data.objects.remove(old, do_unlink=True)
    bm.normal_update(); me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o); me.materials.append(mt)
    return o
SATIN = mat("OP_Satin", (0.95, 0.94, 0.92), 0.28, **{"Coat Weight": 0.35, "Coat Roughness": 0.15, "Sheen Weight": 0.3})
PEARL = mat("OP_Pearl", (0.96, 0.94, 0.91), 0.18, **{"Coat Weight": 0.7, "Coat Roughness": 0.08, "Sheen Weight": 0.4})

# ── リボン ──
bv, _ = world_mesh("OP_Belt")
back = [v for v in bv if abs(v.x) < 0.012]; yb = max(v.y for v in back)
zs = [v.z for v in back]; zc = (min(zs)+max(zs))/2
K = Vector((0.0, yb+0.010, zc))                          # 結び目の中心（帯の後ろの表面の少し外）
_, sk = world_mesh("OP_SkirtLace")
bm = bmesh.new()
def loop(sg):
    """輪：結び目から横（±x）へ張り出し、背中から少し浮いて戻る平たい筒。リボンの幅は縦（z）。付け根でしぼり、先で幅広"""
    NA, NW = 32, 7; LX, LY = globals().get("BOW_LX", 0.090), globals().get("BOW_LY", 0.024)      # 輪の長さ（横）と、背中からの浮き
    rows = []
    for i in range(NA):
        a = 2*math.pi*i/NA
        x = sg*LX*(1-math.cos(a))/2*1.0; y = LY*math.sin(a)                       # 楕円（x は 0〜LX、y は ±LY）
        f = (1-math.cos(a))/2                                                    # 0：付け根、1：先
        w = 0.020+0.040*f**0.7                                                   # リボンの幅（付け根 2cm → 先 6cm）
        zc_ = 0.012*f                                                            # 先を少し上げる
        rows.append([bm.verts.new(K+Vector((x, y+0.004, zc_+w*(j/(NW-1)-0.5)))) for j in range(NW)])
    for i in range(NA):
        a, b_ = rows[i], rows[(i+1) % NA]
        for j in range(NW-1): bm.faces.new((a[j], b_[j], b_[j+1], a[j+1]))
for sg in (1, -1): loop(sg)
# 結び目：縦長のふくらんだ帯
kn = bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=10, radius=1.0)
for v in kn["verts"]: v.co = K+Vector((v.co.x*0.015, v.co.y*0.013+0.008, v.co.z*0.022))
# 垂れ：結び目から下へ、スカートの表面に沿って流れ、少し外へ開く。幅 4cm、長さ TAIL_L、先は V 字
TAIL_L = globals().get("TAIL_L", 0.40)
for sg in (1, -1):
    N = 30; rows = []
    for i in range(N+1):
        t = i/N; z = K.z-0.016-TAIL_L*t; x = sg*(0.014+0.075*t**1.1)   # 左右に開く
        h = sk.ray_cast(Vector((x, 0.6, z)), Vector((0, -1, 0)), 1.0)
        y = (h[0].y+0.006) if h[0] else K.y+0.03*t
        y = max(y, K.y-0.004+0.0*t) if t < 0.08 else y
        w = 0.050; tw = Vector((math.cos(0.25*sg*t), 0, -math.sin(0.25*sg*t)))     # 少しねじる
        vcut = 0.022*(1 if i == N else 0)
        rows.append((bm.verts.new(Vector((x, y, z))-tw*w/2+Vector((0, 0, vcut*0))), bm.verts.new(Vector((x, y, z))+tw*w/2)))
    # 先の V 字：まん中を上げる
    a, b_ = rows[-1]; mid = bm.verts.new((a.co+b_.co)/2+Vector((0, 0.001, 0.022)))
    for i in range(N-1):
        a, b_ = rows[i]; c, d = rows[i+1]; bm.faces.new((a, c, d, b_))
    a, b_ = rows[N-1]; c, d = rows[N]; bm.faces.new((a, c, mid)); bm.faces.new((a, mid, b_)); bm.faces.new((b_, mid, d))
bow = newobj("OP_Bow", bm, SATIN)
sd = bow.modifiers.new("Solidify", 'SOLIDIFY'); sd.thickness = 0.0015; sd.offset = 0.0

# ── パール ──
bm = bmesh.new()
def pearl(p, r):
    s = bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=7, radius=r)
    for v in s["verts"]: v.co += p
dv, dvb = world_mesh("OP_Dress")
bz = [v.z for v in dv if abs(v.x) < 0.01 and v.y > -0.02]; ztop = max(bz)-0.012; zbot = zc+0.030
NB = 7
for i in range(NB):                                       # 背中のボタン
    z = ztop-(ztop-zbot)*i/(NB-1)
    h = dvb.ray_cast(Vector((0, 0.6, z)), Vector((0, -1, 0)), 1.0)
    if h[0]: pearl(h[0]+h[1]*0.0035, 0.0040)
tv, tvb = world_mesh("OP_Trim")
xs = [v.x for v in tv]; zt = [v.z for v in tv]
xmin, xmax = min(xs), max(xs); zmid = min(zt)+(max(zt)-min(zt))*0.32
n = int((xmax-xmin)/0.016)
for i in range(n+1):                                     # 前の襟ぐりのレースに沿って
    x = xmin+0.006+(xmax-xmin-0.012)*i/max(1, n)
    h = tvb.ray_cast(Vector((x, -0.6, zmid)), Vector((0, 1, 0)), 1.0)
    if h[0]: pearl(h[0]+h[1]*0.0022, 0.0026)
pearls = newobj("OP_Pearls", bm, PEARL)

# ── パンプスの甲のリボン（OP_ShoeBows）：甲の革の上のふち（いちばん高い所）に、パステルピンクのサテンの小さなリボン。輪 2 つと結び目 ──
sv, _ = world_mesh("OP_Shoes")
RIB = mat("OP_ShoeRibbon", (0.95, 0.74, 0.80), 0.30, **{"Coat Weight": 0.3, "Sheen Weight": 0.4})
bm = bmesh.new()
for sg in (1, -1):
    S_ = [v for v in sv if sg*v.x > 0.02]
    ymid = (min(v.y for v in S_)+max(v.y for v in S_))/2
    top = max((v for v in S_ if v.y < ymid-0.01), key=lambda v: v.z)          # 甲の革の上のふち（前半分でいちばん高い所）
    c0 = Vector((top.x, top.y-0.004, top.z+0.003))
    for s2 in (1, -1):                                                        # 輪：左右（x）へ張り出す
        r = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1.0)
        for v in r["verts"]: v.co = c0+Vector((v.co.x*0.010+s2*0.009, v.co.y*0.006-0.002, v.co.z*0.008+0.003))       # 輪 1 つが幅 2cm（両方で 3.5cm くらい）
    r = bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=1.0)
    for v in r["verts"]: v.co = c0+Vector((v.co.x*0.005, v.co.y*0.005-0.004, v.co.z*0.005+0.003))
    for s2 in (1, -1):                                                        # 垂れ：短く下へ
        r = bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=1.0)
        for v in r["verts"]: v.co = c0+Vector((v.co.x*0.004+s2*0.006, v.co.y*0.002-0.007, v.co.z*0.012-0.008))
shoebows = newobj("OP_ShoeBows", bm, RIB)
rig.data.pose_position = was
exec(compile(open("C:\\Users\\shuji\\Documents\\girl-blender\\scripts\\bind_rig.py", encoding="utf-8").read(), "bind_rig.py", "exec"), {"__name__": "__main__"})
print("couture: bow", len(bow.data.vertices), "pearls", len(pearls.data.vertices), "shoe bows", len(shoebows.data.vertices))
