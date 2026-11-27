# 5 人目（ワンピース 2）のまつ毛（Girl_LashStrands・Girl_LashLowerStrands）を、今の目の形に合わせ直す（Blender の中で exec する。何度流してもよい）。
#   目の形のキーを変えると、別のオブジェクトのまつ毛は置いていかれる。近くの肌の動きの平均で動かしたら、まぶたのふちより上の肌の動きが
#   混ざって根元が 1〜4mm 浮き、段になった（がたがた）。まぶたのふちへ光線で合わせ直したら、付け根の黒い帯が黒目にかぶった。
#   そこで、目の形を変える前のきれいなまつ毛（_LashOrig_Upper・_LashOrig_Lower。親なし・非表示で保管。書き出しには入らない）を、
#   MakeHuman のまつ毛用の補助メッシュ（helper-?-eyelashes-1・-2。まぶたのふちに沿っていて、目の形のキーと一緒に正確に動く）の
#   動きだけで運ぶ。毛 1 本は形を保ったまま、根元にいちばん近い補助メッシュの頂点の動きで丸ごと動かす
#   ORIG … 保管したまつ毛に合う、目の形のキーの値（2026-11-28 に目を直す前の値）
import bpy, bmesh
import numpy as np
from mathutils import kdtree

ORIG = globals().get("ORIG", {"eye-height2-decr": 0.3, "custom-eye-slant": 1.0, "custom-eye-almond": 1.0, "eye-scale-incr": 0.5,
                              "custom-idol-eye": 0.0})
PAIRS = (("_LashOrig_Upper", "Girl_LashStrands"), ("_LashOrig_Lower", "Girl_LashLowerStrands"))

ob = bpy.data.objects["Girl_Body"]; kb = ob.data.shape_keys.key_blocks; rig = bpy.data.objects["Girl_Rig"]
def body_world():
    mods = [m for m in ob.modifiers if m.type in ("SUBSURF", "MASK")]; st = [m.show_viewport for m in mods]
    for m in mods: m.show_viewport = False
    pp = rig.data.pose_position; rig.data.pose_position = "REST"; bpy.context.view_layer.update()
    e = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = e.to_mesh()
    a = np.zeros(len(m.vertices)*3); m.vertices.foreach_get("co", a); e.to_mesh_clear()
    for m_, s in zip(mods, st): m_.show_viewport = s
    rig.data.pose_position = pp; bpy.context.view_layer.update()
    M = np.array(ob.matrix_world); return a.reshape(-1, 3)@M[:3, :3].T+M[:3, 3]
def names(k): return [k] if k in kb else ["l-"+k, "r-"+k]

B1 = body_world()                                         # 今の目
now = {n: kb[n].value for k in ORIG for n in names(k) if n in kb}
for k, v in ORIG.items():
    for n in names(k):
        if n in kb: kb[n].value = v
ob.data.update(); B0 = body_world()                       # 直す前の目
for n, v in now.items(): kb[n].value = v
ob.data.update()

H = []
for g in ("helper-l-eyelashes-1", "helper-l-eyelashes-2", "helper-r-eyelashes-1", "helper-r-eyelashes-2"):
    gi = ob.vertex_groups[g].index
    H += [v.index for v in ob.data.vertices if any(x.group == gi and x.weight > 0.5 for x in v.groups)]
H = np.array(sorted(set(H)))
kd = kdtree.KDTree(len(H))
for j, i in enumerate(H): kd.insert(B0[i], j)
kd.balance()
D = B1-B0

for src_name, dst_name in PAIRS:
    src = bpy.data.objects[src_name]; dst = bpy.data.objects[dst_name]
    sm = src.data; dm = dst.data; n = len(sm.vertices)
    assert n == len(dm.vertices)
    Ms = np.array(src.matrix_world); Md = np.array(dst.matrix_world); Mdi = np.linalg.inv(Md)
    bm = bmesh.new(); bm.from_mesh(sm); bm.verts.ensure_lookup_table()
    comp = -np.ones(n, int); c = 0
    for v in bm.verts:                                     # 毛 1 本 = つながった頂点のかたまり
        if comp[v.index] >= 0: continue
        st = [v]; comp[v.index] = c
        while st:
            a = st.pop()
            for ed in a.link_edges:
                b = ed.other_vert(a)
                if comp[b.index] < 0: comp[b.index] = c; st.append(b)
        c += 1
    bm.free()
    def world(k): a = np.zeros(n*3); k.data.foreach_get("co", a); a = a.reshape(-1, 3); return a@Ms[:3, :3].T+Ms[:3, 3]
    W0 = world(sm.shape_keys.key_blocks[0])
    dl = np.zeros((n, 3))
    for ci in range(c):
        ids = np.where(comp == ci)[0]
        root = min(ids, key=lambda i: kd.find(W0[i])[2])      # 補助メッシュにいちばん近い頂点＝根元
        r = kd.find_n(W0[root], 3); w = np.array([1/(d+2e-4) for _, _, d in r])
        dl[ids] = (np.array([D[H[j]] for _, j, _ in r])*w[:, None]).sum(0)/w.sum()
    BLINK = ("exp-blink", "exp-blinkLeft", "exp-blinkRight")
    for kname in [k.name for k in sm.shape_keys.key_blocks]:
        Wo = world(sm.shape_keys.key_blocks[kname])
        if kname in BLINK:                                    # まばたきで動く毛は、閉じた位置を元のまま（体のまばたきも元の閉じた位置に合わせてある）
            mv = np.clip(np.linalg.norm(Wo-W0, axis=1)/0.0005, 0, 1)[:, None]
            Wk = Wo+dl*(1-mv)
        else: Wk = Wo+dl
        loc = Wk@Mdi[:3, :3].T+Mdi[:3, 3]
        dm.shape_keys.key_blocks[kname].data.foreach_set("co", loc.ravel())
    dm.update()
    print(dst_name, "fitted. strands", c, "move max mm", round(float(np.abs(dl).max())*1000, 2))

# 仕上げ：毛の付け根を、見えている白目のふちにそろえる。補助メッシュで運んだだけでは、上まつ毛の付け根の下の端が
#   まん中で 1.3〜1.7mm 浮き（肌のすき間が見える）、目じり側で 0.8mm 白目にかぶって、がたがたに見えた。
#   見たままの体（細分化込み）に正面から光線を当てて白目のふちの高さを測り、毛 1 本ずつの付け根の端（上まつ毛は一番下、
#   下まつ毛は一番上）を SEAT だけ外側にそろえる。動かす量は隣どうしでならして、付け根の線を 1 本のなめらかな線にする
SEAT = globals().get("SEAT", 0.00015)
from mathutils import Vector
from mathutils.bvhtree import BVHTree
_pp = rig.data.pose_position; rig.data.pose_position = "REST"; bpy.context.view_layer.update()
_e = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); _m = _e.to_mesh(); _M = ob.matrix_world
_eyemat = {i for i, mt in enumerate(ob.data.materials) if mt and mt.name.startswith("Eye")}
_iseye = [p.material_index in _eyemat for p in _m.polygons]
_bvh = BVHTree.FromPolygons([_M @ v.co for v in _m.vertices], [tuple(p.vertices) for p in _m.polygons]); _e.to_mesh_clear()
def _edge_z(x, z0, upper):
    zs = np.arange(z0+0.006, z0-0.006, -0.0001) if upper else np.arange(z0-0.006, z0+0.006, 0.0001)
    prev = None
    for z in zs:
        h = _bvh.ray_cast(Vector((x, -1, z)), Vector((0, 1, 0)))
        if h[0] is None: continue
        if _iseye[h[2]] and prev is False: return z
        prev = _iseye[h[2]]
    return None
for name, upper in (("Girl_LashStrands", True), ("Girl_LashLowerStrands", False)):
    o = bpy.data.objects[name]; me = o.data; n = len(me.vertices); Mo = np.array(o.matrix_world); Mi = np.linalg.inv(Mo)[:3, :3]
    co = np.zeros(n*3); me.shape_keys.key_blocks[0].data.foreach_get("co", co); co = co.reshape(-1, 3); W = co@Mo[:3, :3].T+Mo[:3, 3]
    bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
    comp = -np.ones(n, int); c = 0
    for v in bm.verts:
        if comp[v.index] >= 0: continue
        st = [v]; comp[v.index] = c
        while st:
            a = st.pop()
            for ed in a.link_edges:
                b = ed.other_vert(a)
                if comp[b.index] < 0: comp[b.index] = c; st.append(b)
        c += 1
    bm.free()
    rows = []
    for ci in range(c):
        ids = np.where(comp == ci)[0]; k = ids[np.argmin(W[ids, 2])] if upper else ids[np.argmax(W[ids, 2])]
        ez = _edge_z(W[k, 0], W[k, 2], upper)
        rows.append([ci, ids, W[k, 0], (ez+(SEAT if upper else -SEAT)-W[k, 2]) if ez is not None else np.nan])
    dl = np.zeros((n, 3))
    for side in (1, -1):
        L = sorted([r for r in rows if np.sign(r[2]) == side], key=lambda r: r[2])
        d = np.array([r[3] for r in L]); ok = ~np.isnan(d)
        d = np.interp(np.arange(len(d)), np.where(ok)[0], d[ok])
        d = np.array([np.median(d[max(0, i-3):i+4]) for i in range(len(d))])
        d = np.array([d[max(0, i-3):i+4].mean() for i in range(len(d))])
        for r, dd in zip(L, d): dl[r[1], 2] = dd
    dloc = dl@Mi.T
    _b0 = np.zeros(n*3); me.shape_keys.key_blocks[0].data.foreach_get("co", _b0); _b0 = _b0.reshape(-1, 3)
    for kbk in me.shape_keys.key_blocks:
        a = np.zeros(n*3); kbk.data.foreach_get("co", a); a = a.reshape(-1, 3)
        mv = np.clip(np.linalg.norm(a-_b0, axis=1)/0.0005, 0, 1)[:, None] if kbk.name in ("exp-blink", "exp-blinkLeft", "exp-blinkRight") else 0.0
        kbk.data.foreach_set("co", (a+dloc*(1-mv)).ravel())
    me.update()
    print(name, "seated. move mm max", round(float(np.abs(dl).max())*1000, 2))
rig.data.pose_position = _pp; bpy.context.view_layer.update()
