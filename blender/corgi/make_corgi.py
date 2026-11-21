# ウェルシュ・コーギー（ペンブローク）の「こむぎ」を作る（Blender の中で exec する）。何度実行してもよい（作り直す）。
#   1) 形：球・だ円体をたくさん重ねて置き、ボクセルのリメッシュで 1 つの面にまとめ、ならして、面を減らす
#   2) 色：位置から決めて頂点カラーに塗る（赤茶に白：口先・額の筋・胸・おなか・足先・お尻の下。耳の内側は桃色）
#   3) 目・鼻・舌：別の小さなメッシュ（リメッシュしない）
#   4) 骨：腰 → 背 → 胸 → 首 → 頭（耳）、しっぽ、脚 4 本（上・下・足先）。ウェイトは自動
# 向き：Blender では -Y が前・+X が犬の左・Z が上。原点は足元。体高（肩）約 0.29m・体長 約 0.62m。
# 書き出しは export_corgi.py（GLB。three.js では +Z が前になる）。
import bpy, bmesh, math
import numpy as np
from mathutils import Vector, Matrix, Euler

VOXEL = globals().get("VOXEL", 0.0045); FACES = globals().get("FACES", 22000)

for o in list(bpy.data.objects):
    if o.name.startswith("Corgi"): bpy.data.objects.remove(o, do_unlink=True)
for coll in (bpy.data.meshes, bpy.data.armatures):
    for d in list(coll):
        if d.name.startswith("Corgi") and d.users == 0: coll.remove(d)
col = bpy.data.collections.get("Corgi") or bpy.data.collections.new("Corgi")
if col.name not in bpy.context.scene.collection.children: bpy.context.scene.collection.children.link(col)

bpy.context.view_layer.update()
def desel():
    for o in bpy.data.objects:
        try: o.select_set(False)
        except Exception: pass

# ── 1) 形 ──
bm = bmesh.new()
def ell(c, r, rot=(0, 0, 0)):
    """だ円体。c … 中心、r … 半径（数 1 つなら球）、rot … 回転（度）"""
    if isinstance(r, (int, float)): r = (r, r, r)
    M = Matrix.Translation(Vector(c)) @ Euler([math.radians(a) for a in rot]).to_matrix().to_4x4() @ Matrix.Diagonal((*r, 1))
    bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=12, radius=1.0, matrix=M)
def sweep(pts, n=6):
    """球を並べて作る管。pts … [(中心, 半径), …]。半径は数か (x, y, z)"""
    for (a, ra), (b, rb) in zip(pts, pts[1:]):
        for i in range(n+1):
            t = i/n; c = Vector(a).lerp(Vector(b), t)
            if isinstance(ra, (int, float)): r = ra+(rb-ra)*t
            else: r = tuple(x+(y-x)*t for x, y in zip(ra, rb))
            ell(c, r)
# 胴：胸は深く、胴は長く、お尻は丸くふわふわ
ell((0, -0.130, 0.228), (0.104, 0.118, 0.108))
ell((0, 0.030, 0.226), (0.099, 0.190, 0.096))
ell((0, 0.195, 0.232), (0.106, 0.110, 0.106))
for s in (1, -1): ell((s*0.046, 0.262, 0.212), (0.068, 0.066, 0.086))      # お尻の 2 つの丸み（桃のような形）
ell((0, 0.305, 0.292), (0.026, 0.030, 0.026))                              # 短いしっぽ
ell((0, -0.212, 0.222), (0.078, 0.052, 0.090))                             # 胸の白い毛のふくらみ
# 首と頭（きつね顔：頭は丸く、口先は細め。ほおの毛がふっくら）
sweep([((0, -0.185, 0.270), 0.088), ((0, -0.248, 0.335), 0.074)])
ell((0, -0.283, 0.382), (0.096, 0.098, 0.086))
for s in (1, -1):
    ell((s*0.060, -0.290, 0.350), (0.054, 0.054, 0.046))                   # ほお
    ell((s*0.030, -0.335, 0.412), (0.030, 0.030, 0.022))                   # 目の上のふくらみ
ell((0, -0.325, 0.405), (0.046, 0.040, 0.034))                             # 額
sweep([((0, -0.345, 0.360), (0.050, 0.046, 0.042)), ((0, -0.408, 0.352), (0.035, 0.032, 0.029))], n=8)      # 口先
ell((0, -0.378, 0.336), (0.032, 0.042, 0.018))                             # 下あご
# 耳：大きな立ち耳（先は丸い三角。少し外へ開く）
for s in (1, -1):
    base = Vector((s*0.058, -0.262, 0.440)); tip = Vector((s*0.104, -0.256, 0.550))
    for i in range(13):
        t = i/12; c = base.lerp(tip, t); w = 0.062*(1-t)**0.8+0.013
        ell(c+Vector((0, 0.004*math.sin(math.pi*t), 0)), (w, 0.0125, 0.020), rot=(0, -s*22, s*6))
# 脚：短くて太め。足先は丸い
for s in (1, -1):
    sweep([((s*0.064, -0.140, 0.180), 0.050), ((s*0.068, -0.134, 0.100), 0.036), ((s*0.068, -0.138, 0.042), 0.031)])      # 前脚
    ell((s*0.068, -0.156, 0.023), (0.036, 0.050, 0.023))
    ell((s*0.076, 0.168, 0.172), (0.052, 0.078, 0.078))                                                                   # もも
    sweep([((s*0.078, 0.150, 0.112), 0.040), ((s*0.079, 0.198, 0.060), 0.029), ((s*0.079, 0.190, 0.034), 0.029)])        # 後ろ脚（かかとが後ろへ出る）
    ell((s*0.079, 0.172, 0.023), (0.034, 0.050, 0.023))
me = bpy.data.meshes.new("CorgiBody"); bm.to_mesh(me); bm.free()
body = bpy.data.objects.new("CorgiBody", me); col.objects.link(body)
desel()
body.select_set(True); bpy.context.view_layer.objects.active = body
md = body.modifiers.new("Remesh", 'REMESH'); md.mode = 'VOXEL'; md.voxel_size = VOXEL; md.adaptivity = 0.0
bpy.ops.object.modifier_apply(modifier=md.name)
md = body.modifiers.new("Smooth", 'SMOOTH'); md.factor = 0.5; md.iterations = 28
bpy.ops.object.modifier_apply(modifier=md.name)
md = body.modifiers.new("Decimate", 'DECIMATE'); md.ratio = min(1.0, FACES/max(1, len(body.data.polygons)*2))      # 四角形 → 三角形で 2 倍になる
bpy.ops.object.modifier_apply(modifier=md.name)
me = body.data; me.validate(); me.update()
# 足の裏を地面（z = 0）にそろえ、左右対称に近づける
zmin = min(v.co.z for v in me.vertices)
for v in me.vertices: v.co.z -= zmin
for p in me.polygons: p.use_smooth = True
print("body", len(me.vertices), "verts", len(me.polygons), "faces", "size", [round(max(v.co[i] for v in me.vertices)-min(v.co[i] for v in me.vertices), 3) for i in range(3)])

# ── 2) 色（頂点カラー。線形の色で入れる） ──
def lin(c): return tuple(((x/12.92) if x <= 0.04045 else ((x+0.055)/1.055)**2.4) for x in c)
RED = np.array(lin((0.84, 0.50, 0.21))); RED_D = np.array(lin((0.74, 0.40, 0.15))); CREAM = np.array(lin((0.93, 0.74, 0.50)))
WHITE = np.array(lin((0.97, 0.95, 0.91))); PINK = np.array(lin((0.93, 0.66, 0.62)))
def ss(a, b, x): t = np.clip((x-a)/(b-a), 0, 1); return t*t*(3-2*t)
n = len(me.vertices); co = np.zeros(n*3); me.vertices.foreach_get("co", co); co = co.reshape(n, 3)
nr = np.zeros(n*3); me.vertices.foreach_get("normal", nr); nr = nr.reshape(n, 3)
X, Y, Z = co[:, 0], co[:, 1], co[:, 2]; AX = np.abs(X)
wob = 0.006*np.sin(X*90+Z*70)+0.005*np.sin(Y*110+X*40)                     # 境目を少しゆらす
c = np.tile(RED, (n, 1))
COAT = globals().get("COAT", "tricolor")                                   # "tricolor"（黒・茶・白）か "red"（赤茶・白）
if COAT == "tricolor":
    # 黒：背中から首の上・頭のてっぺん・耳の外側まで。境目の高さは、胴 → 首 → 頭 と上がっていく。ほお・脚の付け根・お尻は茶のまま
    BLACK = np.array(lin((0.075, 0.068, 0.066)))
    hline = np.interp(Y, [-0.50, -0.300, -0.250, -0.170, 0.230, 0.300], [0.404, 0.404, 0.345, 0.238, 0.238, 0.268])
    blk = ss(0.0, 0.028, Z+wob-hline)
    blk = blk*(1-ss(0.012, 0.004, np.hypot(AX-0.033, Z-0.430))*(Y < -0.31))                       # 目の上の茶色い丸（まろまゆ）
    c = c+(BLACK-c)*blk[:, None]
else:
    c = c+(RED_D-c)*(ss(0.2, 0.8, nr[:, 2])*ss(-0.20, -0.05, Y)*ss(0.24, 0.30, Z))[:, None]*0.8        # 背中は少し濃い
c = c+(CREAM-c)*(ss(0.30, 0.20, Z+wob)*ss(-0.2, 0.3, -nr[:, 2])*0.6)[:, None]                       # わき腹の下は淡い
w = np.zeros(n)
w = np.maximum(w, ss(0.125, 0.085, Z+wob)*(Y < 0.0))                                               # 前脚の白い靴下
w = np.maximum(w, ss(0.075, 0.050, Z+wob)*(Y >= 0.0))                                              # 後ろ脚は足先だけ
w = np.maximum(w, ss(-0.15, -0.65, nr[:, 2])*ss(0.21, 0.17, Z)*ss(0.30, 0.20, np.abs(Y-0.02)))     # おなか
w = np.maximum(w, ss(-0.165, -0.200, Y+wob)*ss(0.335, 0.300, Z+wob)*ss(0.105, 0.070, AX))          # 胸
w = np.maximum(w, ss(-0.235, -0.262, Y)*ss(0.345, 0.325, Z+wob)*ss(0.075, 0.045, AX))              # のど
w = np.maximum(w, ss(-0.352, -0.372, Y+wob*0.5)*ss(0.30, 0.33, Z)*ss(0.392, 0.374, Z))             # 口先（目の高さより下だけ。目のまわりは茶のままにして、白いまゆが見えるように）
w = np.maximum(w, ss(0.012, 0.005, AX+wob*0.15-0.005*ss(0.400, 0.375, Z))*ss(-0.275, -0.31, Y)*ss(0.470, 0.445, Z)*(Z > 0.34))      # 額の白い筋（口先へ向かって広がる）
w = np.maximum(w, ss(0.235, 0.275, Y+wob)*ss(0.225, 0.180, Z+wob)*0.85)                            # お尻の下（淡いクリーム）
w = np.maximum(w, ss(0.0125, 0.0065, np.hypot((AX-0.041)*0.85, Z-0.433))*(Y < -0.31))                      # 目の上の白い丸（まろまゆ）
c = c+(WHITE-c)*w[:, None]
ear = ss(0.440, 0.462, Z)*ss(0.026, 0.040, AX)
c = c+(PINK-c)*(ear*ss(0.45, 0.85, -nr[:, 1]))[:, None]                                            # 耳の内側（前を向いた面だけ。ふちは赤茶のまま）
# 脚を短くする：ひじ・ひざより下（z < 0.13）を縮め、その上はそのぶん下げる（色は元の高さで決めてある）
LEG = globals().get("LEG", 0.70)
def fz(z): return z*LEG if z < 0.13 else z-0.13*(1-LEG)
for v in me.vertices: v.co.z = fz(v.co.z)
ca = me.color_attributes.new("Col", 'FLOAT_COLOR', 'POINT')
ca.data.foreach_set("color", np.concatenate([c, np.ones((n, 1))], axis=1).ravel()); me.color_attributes.active_color = ca; me.color_attributes.render_color_index = 0
def material(name, rough, vcol=True, color=(1, 1, 1)):
    mt = bpy.data.materials.get(name) or bpy.data.materials.new(name); mt.use_nodes = True; nt = mt.node_tree
    b = next(x for x in nt.nodes if x.type == "BSDF_PRINCIPLED"); b.inputs["Roughness"].default_value = rough
    for l in list(b.inputs["Base Color"].links): nt.links.remove(l)
    if vcol:
        a = next((x for x in nt.nodes if x.type == "VERTEX_COLOR"), None) or nt.nodes.new("ShaderNodeVertexColor"); a.layer_name = "Col"
        nt.links.new(a.outputs["Color"], b.inputs["Base Color"])
    else: b.inputs["Base Color"].default_value = (*lin(color), 1)
    return mt
FUR = material("CorgiFur", 0.88)
me.materials.append(FUR)

# ── 3) 目・鼻・舌 ──
def part(name, build, mat):
    b2 = bmesh.new(); build(b2); m2 = bpy.data.meshes.new(name); b2.to_mesh(m2); b2.free()
    for p in m2.polygons: p.use_smooth = True
    m2.materials.append(mat); o = bpy.data.objects.new(name, m2); col.objects.link(o); return o
def sph(b2, c, r, seg=16):
    if isinstance(r, (int, float)): r = (r, r, r)
    bmesh.ops.create_uvsphere(b2, u_segments=seg, v_segments=seg//2+2, radius=1.0, matrix=Matrix.Translation(Vector((c[0], c[1], fz(c[2])))) @ Matrix.Diagonal((*r, 1)))
EYE = material("CorgiEye", 0.12, False, (0.07, 0.035, 0.02)); NOSE = material("CorgiNose", 0.30, False, (0.03, 0.025, 0.025))
SHINE = material("CorgiShine", 0.2, False, (1, 1, 1)); TONGUE = material("CorgiTongue", 0.55, False, (0.93, 0.50, 0.52))
def eyes(b2):
    for s in (1, -1): sph(b2, (s*0.0375, -0.3590, 0.3950), (0.0180, 0.0150, 0.0200))
def shine(b2):
    for s in (1, -1): sph(b2, (s*0.0375+0.0055, -0.3725, 0.4020), 0.0042, 10)
def nose(b2):
    sph(b2, (0, -0.4380, 0.3620), (0.0180, 0.0130, 0.0140))
def tongue(b2):
    # 口先の下から前へ出て、先が下がる薄い舌
    pts = [Vector((0, -0.385, fz(0.333))), Vector((0, -0.412, fz(0.329))), Vector((0, -0.432, fz(0.318))), Vector((0, -0.441, fz(0.302)))]
    rows = []
    for i, p in enumerate(pts):
        wd = (0.014, 0.015, 0.014, 0.010)[i]
        rows.append([b2.verts.new(p+Vector((x*wd, 0, 0.004*(1-x*x)-0.002))) for x in (-1, -0.5, 0, 0.5, 1)])
    for i in range(len(rows)-1):
        for k in range(4): b2.faces.new((rows[i][k], rows[i][k+1], rows[i+1][k+1], rows[i+1][k]))
parts = [part("CorgiEyes", eyes, EYE), part("CorgiShine", shine, SHINE), part("CorgiNose", nose, NOSE)]
tng = part("CorgiTongue", tongue, TONGUE); TONGUE.use_backface_culling = False
sm = tng.modifiers.new("Solidify", 'SOLIDIFY'); sm.thickness = 0.004

# ── 4) 骨 ──
arm = bpy.data.armatures.new("CorgiRig"); rig = bpy.data.objects.new("CorgiRig", arm); col.objects.link(rig)
desel()
rig.select_set(True); bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode='EDIT')
def bone(name, head, tail, parent=None, connect=False):
    b = arm.edit_bones.new(name); b.head = (head[0], head[1], fz(head[2])); b.tail = (tail[0], tail[1], fz(tail[2])); b.roll = 0
    if parent: b.parent = arm.edit_bones[parent]; b.use_connect = connect
    return b
bone("hips", (0, 0.205, 0.235), (0, 0.060, 0.235))
bone("spine", (0, 0.060, 0.235), (0, -0.110, 0.240), "hips", True)
bone("chest", (0, -0.110, 0.240), (0, -0.195, 0.268), "spine", True)
bone("neck", (0, -0.195, 0.268), (0, -0.258, 0.342), "chest", True)
bone("head", (0, -0.258, 0.342), (0, -0.300, 0.430), "neck", True)
bone("tail", (0, 0.285, 0.275), (0, 0.335, 0.300), "hips")
for s, n_ in ((1, "L"), (-1, "R")):
    bone("ear"+n_, (s*0.058, -0.262, 0.442), (s*0.102, -0.256, 0.545), "head")
    bone("frontUpper"+n_, (s*0.065, -0.140, 0.195), (s*0.068, -0.134, 0.100), "chest")
    bone("frontLower"+n_, (s*0.068, -0.134, 0.100), (s*0.068, -0.140, 0.036), "frontUpper"+n_, True)
    bone("frontPaw"+n_, (s*0.068, -0.140, 0.036), (s*0.068, -0.195, 0.016), "frontLower"+n_, True)
    bone("hindUpper"+n_, (s*0.076, 0.170, 0.200), (s*0.078, 0.150, 0.110), "hips")
    bone("hindLower"+n_, (s*0.078, 0.150, 0.110), (s*0.079, 0.196, 0.050), "hindUpper"+n_, True)
    bone("hindPaw"+n_, (s*0.079, 0.196, 0.050), (s*0.079, 0.140, 0.016), "hindLower"+n_, True)
# 骨のローカル X を、どれも犬の左（+X）へそろえる（ゲームでは「ローカル X で回す = 前後に振る」と決めて動かす）
for b in arm.edit_bones:
    d = (b.tail-b.head).normalized(); b.align_roll(Vector((1, 0, 0)).cross(d))
bpy.ops.object.mode_set(mode='OBJECT')
# 体：ウェイトは自動（うまく付かなければ、いちばん近い骨へ）
desel()
body.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
unw = sum(1 for v in me.vertices if not v.groups or sum(g.weight for g in v.groups) < 1e-4)
print("unweighted verts", unw)
# 目・鼻・舌は頭の骨にぴったり付ける
for o in parts+[tng]:
    o.vertex_groups.new(name="head").add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
    o.parent = rig; o.modifiers.new("Armature", 'ARMATURE').object = rig
# 口先の目印（くわえた物を置く所）。頭の骨に付けた空のオブジェクト
mouth = bpy.data.objects.new("CorgiMouth", None); col.objects.link(mouth); mouth.empty_display_size = 0.02
mouth.parent = rig; mouth.parent_type = 'BONE'; mouth.parent_bone = "head"; bpy.context.view_layer.update()
mouth.matrix_world = Matrix.Translation((0, -0.432, fz(0.338)))
print("corgi built")
