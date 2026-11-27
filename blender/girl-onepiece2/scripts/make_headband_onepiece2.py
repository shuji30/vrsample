# 5 人目（ワンピース 2）の白いカチューシャとリボン（Girl_HairBand）を作る（Blender の中で exec する）。髪（make_hair_onepiece2_bob.py）のあとに実行する。
#   カチューシャ：頭の中心（hair_params の C）を通る面の上で、髪の表面に沿って耳の上から耳の上まで。てっぺんは前へ TILT 度かたむける
#   リボン：本人の左（+X）の、てっぺんから BOW_A 度の所。2 つの輪・結び目・2 本の垂れ
#   名前を Girl_Hair で始めると、bind_rig.py が頭の骨に付け（耳より下は髪の揺れ）、書き出しでも髪と同じに扱われる
import bpy, bmesh, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

TILT = globals().get("TILT", 18.0)          # てっぺんを前へかたむける角度（度）。大きいほど前髪の近く
W = globals().get("W", 0.013)               # 幅（m）
SPAN = globals().get("SPAN", 100.0)         # てっぺんから左右に何度まで（90 で真横）
BOW_A = globals().get("BOW_A", 62.0)        # リボンの位置（てっぺんから本人の左へ何度）
GAP = 0.0015                                # 髪から浮かせる量（2.5mm では浮いて見えた）

rig = bpy.data.objects["Girl_Rig"]; was = rig.data.pose_position; rig.data.pose_position = 'REST'
ob = bpy.data.objects["Girl_Body"]; hair = bpy.data.objects["Girl_Hair"]
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get(); vs = []; ps = []
for _h in (hair, bpy.data.objects.get("Girl_HairLayer")):      # 上の層（聖子ちゃんカットの毛束）があれば、その上にも乗せる
    if _h is None or _h.hide_render: continue
    e = _h.evaluated_get(dg); m = e.to_mesh(); _b = len(vs)
    vs += [_h.matrix_world @ v.co for v in m.vertices]; ps += [tuple(_b+i for i in p.vertices) for p in m.polygons]; e.to_mesh_clear()
bvh = BVHTree.FromPolygons(vs, ps)
hp = ob["hair_params"]; C = Vector(hp["C"])+Vector(ob["heel_shift"])
T = math.radians(TILT)
up = Vector((0, -math.sin(T), math.cos(T)))           # 面の中の「上」（てっぺんの向き）
nrm = Vector((0, math.cos(T), math.sin(T)))            # 面の向き（カチューシャの幅の向き）
def surf(a):
    """てっぺんから a（ラジアン。+ が本人の左）の向きの、髪の表面の点と、外向き"""
    d = (Vector((1, 0, 0))*math.sin(a)+up*math.cos(a)).normalized()
    h = bvh.ray_cast(C+d*0.35, -d, 0.35)
    if h[0] is None: return C+d*0.12, d
    return h[0], d
bm = bmesh.new(); bm.loops.layers.uv.new("UVMap"); N = 160; rows = []; pts = []     # UV は書き出しで色を焼くのに要る（無地なので 0 のまま）
for i in range(N+1):
    a = math.radians(-SPAN+2*SPAN*i/N); p, d = surf(a); pts.append((a, p, d))
# 半径：髪の表面より内へ入らず、なめらかに。先に表面の高い所をまわりへ広げ（最大値のならし）、それから平均でならす
#   （ならした半径と表面の高い方を選ぶと、髪がふくらんだ所で「く」の字に折れた）
rad = [(p-C).length for _, p, _ in pts]
env = [max(rad[max(0, k-8):k+9]) for k in range(len(rad))]
for _ in range(30): env = [env[0]]+[(env[k-1]+2*env[k]+env[k+1])/4 for k in range(1, len(env)-1)]+[env[-1]]
rad = [max(e, r) for e, r in zip(env, rad)]
for _ in range(4): rad = [rad[0]]+[(rad[k-1]+2*rad[k]+rad[k+1])/4 for k in range(1, len(rad)-1)]+[rad[-1]]
NWB = 5
for (a, p, d), r in zip(pts, rad):
    q = C+d*(r+GAP)
    rows.append([bm.verts.new(q+nrm*W*(j/(NWB-1)-0.5)+d*0.0015*math.sin(math.pi*j/(NWB-1))) for j in range(NWB)])   # 断面はまん中が少し盛り上がった丸い帯
for k in range(N):
    for j in range(NWB-1): bm.faces.new((rows[k][j], rows[k+1][j], rows[k+1][j+1], rows[k][j+1]))
# リボン：背中のリボンと同じ作り。帯を折り返した輪 2 つ（カチューシャに沿って前後へ。付け根でしぼり、先で幅広。中はくぼむ）、
#   結び目、V 字に切った垂れ 2 本（下へ、髪の表面に沿う）
a = math.radians(BOW_A); i0 = min(range(len(pts)), key=lambda k: abs(pts[k][0]-a))
_, p0, d0 = pts[i0]; B = C+d0*(rad[i0]+GAP+0.003)
tg = (pts[i0+1][1]-pts[i0-1][1]).normalized()          # カチューシャに沿う向き
out = d0
side_w = tg.cross(out).normalized()                     # リボンの幅の向き
def ribbon_loop(sg, L=0.028, H=0.008):
    NA, NW = 28, 5; rws = []
    for i in range(NA):
        a_ = 2*math.pi*i/NA; f = (1-math.cos(a_))/2
        c = B+tg*sg*L*f+out*(H*math.sin(a_)+0.002)
        w = 0.010+0.016*f**0.7
        rws.append([bm.verts.new(c+side_w*w*(j/(NW-1)-0.5)) for j in range(NW)])
    for i in range(NA):
        r0, r1 = rws[i], rws[(i+1) % NA]
        for j in range(NW-1): bm.faces.new((r0[j], r1[j], r1[j+1], r0[j+1]))
for sg in (1, -1): ribbon_loop(sg)
kn = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1.0)
for v in kn["verts"]: v.co = B+tg*v.co.x*0.006+side_w*v.co.y*0.0075+out*(v.co.z*0.005+0.004)
down = Vector((0, 0, -1)); down = (down-out*down.dot(out)).normalized()
for sg in (1, -1):                                      # 垂れ：下へ 7cm、少し開く。髪の表面から 2mm
    Nt = 14; tr = []
    for i in range(Nt+1):
        t_ = i/Nt; q = B+down*(0.005+0.070*t_)+tg*sg*(0.004+0.012*t_)
        dq = (q-C).normalized(); h = bvh.ray_cast(C+dq*0.35, -dq, 0.35)
        q = (h[0]+dq*0.002) if h[0] else q
        tw = (tg*sg*0.3+side_w).normalized(); w = 0.012
        tr.append((bm.verts.new(q-tw*w/2), bm.verts.new(q+tw*w/2)))
    for i in range(Nt-1):
        (a0, b0), (a1, b1) = tr[i], tr[i+1]; bm.faces.new((a0, a1, b1, b0))
    (a0, b0), (a1, b1) = tr[Nt-1], tr[Nt]; mid = bm.verts.new((a1.co+b1.co)/2-down*0.010)
    bm.faces.new((a0, a1, mid)); bm.faces.new((a0, mid, b0)); bm.faces.new((b0, mid, b1))
bm.normal_update()
old = bpy.data.objects.get("Girl_HairBand")
if old: bpy.data.objects.remove(old, do_unlink=True)
me = bpy.data.meshes.new("Girl_HairBand"); bm.to_mesh(me); bm.free()
for p in me.polygons: p.use_smooth = True
o = bpy.data.objects.new("Girl_HairBand", me); bpy.context.scene.collection.objects.link(o)
mt = bpy.data.materials.get("HairBand_White") or bpy.data.materials.new("HairBand_White"); mt.use_nodes = True
b = next(x for x in mt.node_tree.nodes if x.type == "BSDF_PRINCIPLED")
b.inputs["Base Color"].default_value = (0.95, 0.95, 0.94, 1); b.inputs["Roughness"].default_value = 0.35; b.inputs["Sheen Weight"].default_value = 0.4
mt.diffuse_color = (0.95, 0.95, 0.94, 1); mt.use_backface_culling = False
me.materials.append(mt)
sd = o.modifiers.new("Solidify", 'SOLIDIFY'); sd.thickness = 0.0035; sd.offset = -1.0
rig.data.pose_position = was
exec(compile(open("C:\\Users\\shuji\\Documents\\girl-blender\\scripts\\bind_rig.py", encoding="utf-8").read(), "bind_rig.py", "exec"), {"__name__": "__main__"})
print("headband built", len(me.vertices))
