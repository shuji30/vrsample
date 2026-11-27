# 5 人目（ワンピース 2）の耳を付け直す（Blender の中で exec する。何度流してもよい）。
#   顔・頭を直したシェイプキー（custom-*）が耳のまわりだけを不ぞろいにゆがめていて、耳の前に縦の段差、耳の上に稜線ができ、
#   耳が頭から生えた板のように見えた（耳たぶもとがっていた）。そこで、
#   1. MakeHuman の素の耳（Basis に耳のキー ear-* だけを足した形。大きさは SCALE_DECR、頭への寄せ方は WING_DECR）を取る
#   2. 耳のまわりの肌（耳から 3〜5 周外の頂点）が、Basis から今の形へどう動いたかを、拡大・回転・移動の 1 つの動き（相似変換）として当てはめる
#   3. 耳をその動きで丸ごと運んで置き（OFFSET だけずらす）、付け根の 2〜4 周でなじませる
#   を custom-ear-reattach に入れる。耳の直しの古いキー（custom-ear-attach）は 0 にする
import bpy
import numpy as np

SCALE_DECR = globals().get("SCALE_DECR", 0.3)            # 耳を小さくする量（0.7 では 5cm に縮んで小さすぎた）
WING_DECR = globals().get("WING_DECR", 1.0)              # 耳を頭に沿わせる量
OFFSET = np.array(globals().get("OFFSET", (0.0, -0.008, -0.012)))   # 耳を置く位置のずれ（m。-y が前）。素の頭の基準だと耳が高すぎ、後ろすぎた
BLEND = (1.0, 1.0, 0.75, 0.45, 0.2)                      # 耳（0 周）から 4 周外までのなじませ方

ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks; rig = bpy.data.objects["Girl_Rig"]

def body_world():
    mods = [m for m in ob.modifiers if m.type in ("SUBSURF", "MASK")]; st = [m.show_viewport for m in mods]
    for m in mods: m.show_viewport = False
    pp = rig.data.pose_position; rig.data.pose_position = "REST"; bpy.context.view_layer.update()
    e = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = e.to_mesh()
    a = np.zeros(len(m.vertices)*3); m.vertices.foreach_get("co", a); e.to_mesh_clear()
    for m_, s in zip(mods, st): m_.show_viewport = s
    rig.data.pose_position = pp; bpy.context.view_layer.update()
    M = np.array(ob.matrix_world); return a.reshape(-1, 3)@M[:3, :3].T+M[:3, 3]

n = len(me.vertices)
def co(k): a = np.zeros(n*3); k.data.foreach_get("co", a); return a.reshape(-1, 3)

for s in ("l-", "r-"):
    kb[s+"ear-scale-decr"].value = SCALE_DECR; kb[s+"ear-wing-decr"].value = WING_DECR
for name in ("custom-ear-attach", "custom-ear-reattach"):
    if name in kb: kb[name].value = 0.0
ob.data.update()
M = body_world()                                          # 付け直す前の今の形
P0 = co(kb["Basis"]); Pe = P0.copy()
for k in kb:
    if k.name[:2] in ("l-", "r-") and k.name[2:].startswith("ear-") and k.value != 0 and not k.mute:
        Pe += (co(k)-P0)*k.value

gi = ob.vertex_groups["ears"].index; gb = ob.vertex_groups["body"].index
ear = np.zeros(n, bool); body = np.zeros(n, bool)
for v in me.vertices:
    for g in v.groups:
        if g.group == gi and g.weight > 0: ear[v.index] = True
        if g.group == gb and g.weight > 0: body[v.index] = True
E = np.zeros((len(me.edges), 2), int); me.edges.foreach_get("vertices", E.ravel())
def dil(m):
    r = m.copy(); r[E[m[E[:, 0]], 1]] = True; r[E[m[E[:, 1]], 0]] = True; return r
rings = [ear]
for i in range(6): rings.append(dil(rings[-1]))

def similarity(A, B):                                     # A を B に重ねる相似変換（Umeyama）
    ma = A.mean(0); mb = B.mean(0); a = A-ma; b = B-mb
    U, S, Vt = np.linalg.svd(b.T@a/len(A)); d = np.sign(np.linalg.det(U@Vt)); Dm = np.diag([1, 1, d])
    R = U@Dm@Vt; s = np.trace(np.diag(S)@Dm)/((a**2).sum()/len(A)); return s, R, mb-s*R@ma

D = np.zeros((n, 3))
for side in (1, -1):
    sd = np.sign(M[:, 0]) == side
    ring = rings[5] & ~rings[2] & body & sd
    s, R, t = similarity(P0[ring], M[ring])
    T = (s*(R@Pe.T)).T+t+OFFSET*np.array([side, 1, 1])
    w = np.zeros(n)
    for i in range(len(BLEND)-1, -1, -1): w[rings[i]] = BLEND[i]
    w *= sd
    D += (T-M)*w[:, None]
k = kb.get("custom-ear-reattach") or ob.shape_key_add(name="custom-ear-reattach", from_mix=False)
k.data.foreach_set("co", (P0+D).ravel()); k.value = 1.0
ob.data.update()
L = body_world()[ear & (M[:, 0] > 0)]
print("ear reattached. size (cm) h=%.1f w=%.1f  z %.3f-%.3f" % ((L[:, 2].max()-L[:, 2].min())*100, (L[:, 1].max()-L[:, 1].min())*100, L[:, 2].min(), L[:, 2].max()))
