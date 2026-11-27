# 5 人目（ワンピース 2）の靴を、既製のモデル（Sketchfab「Burgundy Mary Jane Shoes」作者 mangoon14、CC-BY 4.0）から作る（Blender の中で exec する）。
#   取り込んだ左の靴（MJ_L。つま先 -Y、かかとの後ろ y=0、床 z=0 に置き直し、面を 1/10 に減らしたもの。
#   左右がくっついた 1 つのモデルを切り分けたので、内側の壁に穴としわがあった。外側の半分を鏡に写して左右対称にしてある）を、
#   形は変えずに大きさだけ合わせて置き、OP_MaryJaneL / OP_MaryJaneR（右は鏡写し）にする：
#   1) 全体を S 倍（横だけ SX 倍）、足の向き（YAW 度）に回し、靴のかかとの後ろを足のかかとの後ろ GAP 後ろに置く。床は z=0
#   2) 色：元の写真の色（えんじ）から色味を抜き、明るさのむらだけ残した白いエナメルの絵を作って貼る
#   3) 骨組みに付け、靴の中に入る足の肌を隠す
#   ヒールは元の約 7cm から下げ、中敷きを足の裏に合わせる（足の傾きは set_foot_tilt_onepiece2.py の ANG 0。かかとの下 5.4cm）
#   クレジット（CC-BY）："Burgundy Mary Jane Shoes" by mangoon14 (Sketchfab) — CC BY 4.0
import bpy, math
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
S = globals().get("S", 1.05); SX = globals().get("SX", 0.88); YAW = globals().get("YAW", -2.5)
GAP = globals().get("GAP", 0.004); DX = globals().get("DX", -0.004)
src = bpy.data.objects["MJ_L"]
ob = bpy.data.objects["Girl_Body"]; rig = bpy.data.objects["Girl_Rig"]
was = rig.data.pose_position; rig.data.pose_position = 'REST'
mods = [m for m in ob.modifiers if m.type in ('MASK', 'SUBSURF')]; st = [m.show_viewport for m in mods]
for m in mods: m.show_viewport = False
bpy.context.view_layer.update(); e = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); me_ = e.to_mesh()
co = np.array([tuple(v.co) for v in me_.vertices]); vn = np.array([tuple(v.normal) for v in me_.vertices]); e.to_mesh_clear()
for m, s in zip(mods, st): m.show_viewport = s
gi = {g.name: g.index for g in ob.vertex_groups}; bi = {gi["body"], gi["hidden_by_clothes"]}
def foot_idx(side):
    return [v.index for v in ob.data.vertices if any(g.group in (gi[side+"Foot"], gi[side+"Toes"]) and g.weight > 0.3 for g in v.groups)
            and any(g.group in bi and g.weight > 0.5 for g in v.groups)]
F = co[foot_idx("left")]
hx = F[F[:, 1] > F[:, 1].max()-0.03][:, 0].mean()+DX
P = np.array([tuple(v.co) for v in src.data.vertices])
# ヒールを低く：指の付け根（PIV_Y。靴底が床から上がり始める所）より後ろを下げる（かかとの後ろで LOWER）。
#   下げる量は u^POW（u は指の付け根 0 → かかとの後ろ 1）。POW を 1 より小さくして、土踏まずのあたりを早めに下げる
#   （まっすぐの割合だと、靴の中敷きの急な上りが残り、土踏まずの肌が靴底の横から出た）。
#   ヒールの柱（Y_BLK より後ろで Z_BLK より下）は、床の面を残して上下に縮める。値は取り込んだときの寸法
LOWER = globals().get("LOWER", 0.046); POW = globals().get("POW", 0.5)
PIV_Y = -0.13; Y_BLK = -0.062; Z_BLK = 0.068
d = LOWER*np.clip((P[:, 1]-PIV_Y)/(0-PIV_Y), 0, 1)**POW
# 甲のベルト（Y_STRAP より前で高い所）は、両脇の付け根（Y_STRAP）と同じだけ下げる。
#   後ろほど多く下げると、付け根だけ下がってベルトの前が残り、甲から浮いた長い輪になった
Y_STRAP = -0.085
def _ss(x): x = np.clip(x, 0, 1); return x*x*(3-2*x)
d_anchor = LOWER*((Y_STRAP-PIV_Y)/(0-PIV_Y))**POW
w = _ss((P[:, 2]-0.085)/0.025)*_ss((Y_STRAP+0.005-P[:, 1])/0.010)
d = d+w*np.maximum(0.0, d_anchor-d)
blk = (P[:, 1] > Y_BLK) & (P[:, 2] < Z_BLK)
P[:, 2] = np.where(blk, P[:, 2]*(1-d/Z_BLK), P[:, 2]-d)
P[:, 2] = np.maximum(P[:, 2], 0.0)
P = P*np.array([S*SX, S, S])
a = math.radians(YAW); c, s = math.cos(a), math.sin(a)
Q = P@np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]]).T+np.array([hx, F[:, 1].max()+GAP, 0])
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
L = make("OP_MaryJaneL", False); Rr = make("OP_MaryJaneR", True)
# 材質：白いエナメル。元の色の絵から色味を抜き、明るさを白の近くへ寄せる（縫い目・ボタンのかげは残る）
m0 = src.data.materials[0]
tex0 = next(n for n in m0.node_tree.nodes if n.type == "TEX_IMAGE" and n.image and "baseColor" in n.image.name).image
img = bpy.data.images.get("OP_MaryJaneWhite")
if img is None or tuple(img.size) != tuple(tex0.size):
    if img: bpy.data.images.remove(img)
    img = bpy.data.images.new("OP_MaryJaneWhite", tex0.size[0], tex0.size[1])
px = np.array(tex0.pixels[:]).reshape(-1, 4)
lum = px[:, :3]@np.array([0.299, 0.587, 0.114])
lo, hi = np.percentile(lum, 5), np.percentile(lum, 99)
t = np.clip((lum-lo)/max(hi-lo, 1e-6), 0, 1)
v_ = 0.88+0.10*t                                                  # 暗い所 0.88・明るい所 0.98（暗くすると青っぽいしみに見えた）
out = np.stack([v_*0.985, v_*0.975, v_*0.965, np.ones_like(v_)], 1)
img.pixels.foreach_set(out.ravel().astype(np.float32)); img.pack()
mt = bpy.data.materials.get("OP_MaryJaneEnamel") or bpy.data.materials.new("OP_MaryJaneEnamel"); mt.use_nodes = True
nt = mt.node_tree
for n in list(nt.nodes):
    if n.type not in ("BSDF_PRINCIPLED", "OUTPUT_MATERIAL"): nt.nodes.remove(n)
b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
ti = nt.nodes.new("ShaderNodeTexImage"); ti.image = img; nt.links.new(ti.outputs["Color"], b.inputs["Base Color"])
nimg = next((n.image for n in m0.node_tree.nodes if n.type == "TEX_IMAGE" and n.image and "normal" in n.image.name), None)
if nimg:
    tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = nimg; tn.image.colorspace_settings.name = "Non-Color"
    nm = nt.nodes.new("ShaderNodeNormalMap"); nt.links.new(tn.outputs["Color"], nm.inputs["Color"]); nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
b.inputs["Roughness"].default_value = 0.22; b.inputs["Metallic"].default_value = 0.0
b.inputs["Coat Weight"].default_value = 1.0; b.inputs["Coat Roughness"].default_value = 0.03
mt.diffuse_color = (0.95, 0.94, 0.93, 1)
for o in (L, Rr):
    o.data.materials.clear(); o.data.materials.append(mt)
    o.parent = rig
# 隠す肌：肌の外側（法線の向き）HIDE_R 以内に靴があれば隠す
HIDE_R = globals().get("HIDE_R", 0.012); POKE_R = globals().get("POKE_R", 0.02)
hide = []
CXS = {s_: float(np.mean(co[foot_idx(s_)][:, 0])) for s_ in ("left", "right")}   # 足の真ん中の x
for side, o in (("left", L), ("right", Rr)):
    bvh = BVHTree.FromPolygons([Vector(v.co) for v in o.data.vertices], [tuple(p_.vertices) for p_ in o.data.polygons])
    for i in foot_idx(side):
        p = Vector(co[i]); n = Vector(vn[i])
        if n.length < 1e-6: continue
        n.normalize()
        if bvh.ray_cast(p+n*0.0002, n, HIDE_R)[0] is not None: hide.append(i); continue
        # 靴の壁より少し外へ出た肌（つま先の横など）：内側 POKE_R 以内に靴の壁があり、真上が靴でおおわれていれば隠す
        #   （壁は肌のすぐ内側にあるので、隠しても穴にならない。履き口のふちの肌は、真上に靴が無いので残る）
        #   真上は、肌から 1.2cm 足の内側へ寄った所から見る（つま先は上へ行くほど細いので、壁の外の肌の真上には靴が無い）
        #   指の間の肌は法線が前後を向くので、法線の向きと、足の真ん中の線（x=CXS）へ向かう向きの両方から見る
        if bvh.ray_cast(p-n*0.0002, -n, POKE_R)[0] is None: continue
        nh = Vector((n.x, n.y, 0)); nh = nh.normalized() if nh.length > 1e-6 else nh
        tc = Vector((1.0 if CXS[side] > p.x else -1.0, 0, 0))
        up = Vector((0, 0, 1)); lift = Vector((0, 0, 0.0005))
        if any(bvh.ray_cast(q+lift, up, 0.06)[0] is not None for q in (p-nh*0.012, p+tc*0.012, p+tc*0.024)):
            hide.append(i)
# 隠す肌をならす：まわりの点の多数決で、ぎざぎざのかけらと小さな穴を消す
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
# 見えている足の肌のうち、まわりとつながっていない小さなかけら（ISLAND 頂点より少ない）も隠す（壁の外に出た肌の粒が残った）
ISLAND = globals().get("ISLAND", 40)
_vis = _zone-_hs; _seen = set()
for s0 in list(_vis):
    if s0 in _seen: continue
    comp = []; st = [s0]; to_leg = False
    while st:
        i = st.pop()
        if i in _seen: continue
        _seen.add(i); comp.append(i)
        for j in _adj[i]:
            if j not in _zone: to_leg = True                     # 足の外（脚）の肌へつながっていれば、かけらではない
            elif j in _vis and j not in _seen: st.append(j)
    if len(comp) < ISLAND and not to_leg: _hs.update(comp)
hide = sorted(_hs)
body = ob.vertex_groups["body"]; hid = ob.vertex_groups["hidden_by_clothes"]
allfoot = foot_idx("left")+foot_idx("right")
body.add(allfoot, 1.0, 'REPLACE'); hid.remove(allfoot)
body.remove(hide); hid.add(hide, 1.0, 'REPLACE')
# 前の靴は隠す
for n in ("OP_Shoes", "OP_ShoeBows", "OP_PumpL", "OP_PumpR", "PumpL", "MJ_L", "MJ_R0", "MJ_pair"):
    o = bpy.data.objects.get(n)
    if o: o.hide_viewport = True; o.hide_render = True
rig.data.pose_position = was
exec(compile(open("C:\\Users\\shuji\\Documents\\girl-blender\\scripts\\bind_rig.py", encoding="utf-8").read(), "bind_rig.py", "exec"), {"__name__": "__main__"})
print("mary janes:", len(L.data.vertices), "verts each, hidden skin", len(hide))
