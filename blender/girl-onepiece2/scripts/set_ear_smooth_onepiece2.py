# 5 人目（ワンピース 2）の、耳の前と上の肌のすじ（段差）をならす（Blender の中で exec する）。シェイプキー custom-ear-around-smooth を作り直す（何度流してもよい）。
#   耳（頂点グループ ears）のまわり（前 RF・上 RU・下 RD の範囲）の肌を、となりの頂点の平均へ近づける（ラプラシアンでならす）。
#   耳そのものと、範囲の外は動かさない。範囲のふちに向かって弱める
#   耳の大きさ・寝かせ方・頭の幅などを変えたキーの境目に、耳の前から上へ縦のすじができていた
import bpy
import numpy as np
ITER = globals().get("ITER", 40); RF = 0.045; RU = 0.080; RD = 0.040; RB = 0.015
ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks
k0 = kb.get("custom-ear-around-smooth")
if k0: k0.value = 0.0
n = len(me.vertices)
def co_of(k): a = np.zeros(n*3); k.data.foreach_get("co", a); return a.reshape(n, 3)
B = co_of(kb["Basis"]); mix = B.copy()
for k in kb:
    if k.name in ("Basis", "custom-ear-around-smooth") or k.name.startswith("exp-") or k.mute or k.value == 0: continue
    mix += (co_of(k)-B)*k.value
ei = ob.vertex_groups["ears"].index
ear = np.array([any(g.group == ei and g.weight > 0.01 for g in v.groups) for v in me.vertices])
bodyg = {ob.vertex_groups["body"].index, ob.vertex_groups["hidden_by_clothes"].index}
real = np.array([any(g.group in bodyg and g.weight > 0.5 for g in v.groups) for v in me.vertices])
adj = [[] for _ in range(n)]
for e in me.edges: a, b = e.vertices; adj[a].append(b); adj[b].append(a)
def ss(x): x = np.clip(x, 0, 1); return x*x*(3-2*x)
W = np.zeros(n)
for sg in (1, -1):
    E = mix[ear & (sg*mix[:, 0] > 0)]
    y0, y1 = E[:, 1].min(), E[:, 1].max(); z0, z1 = E[:, 2].min(), E[:, 2].max()
    s = (sg*mix[:, 0] > 0.04) & real & ~ear
    dy = np.where(mix[:, 1] < y0, (y0-mix[:, 1])/RF, np.where(mix[:, 1] > y1, (mix[:, 1]-y1)/RB, 0.0))
    dz = np.where(mix[:, 2] > z1, (mix[:, 2]-z1)/RU, np.where(mix[:, 2] < z0, (z0-mix[:, 2])/RD, 0.0))
    W = np.maximum(W, s*(1-ss(np.hypot(dy, dz))))
P = mix.copy(); mv = np.where(W > 0.01)[0]
for _ in range(ITER):
    Q = P.copy()
    for i in mv:
        nb = adj[i]
        if nb: Q[i] = P[i]+(P[nb].mean(0)-P[i])*0.5*W[i]
    P = Q
D = P-mix
print("ear-around smooth: verts", len(mv), "max move mm", round(float(np.linalg.norm(D, axis=1).max())*1000, 2))
k = k0 or ob.shape_key_add(name="custom-ear-around-smooth", from_mix=False)
k.data.foreach_set("co", (B+D).ravel()); k.value = 1.0; me.update()
