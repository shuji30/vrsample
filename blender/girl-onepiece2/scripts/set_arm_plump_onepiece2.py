# 5 人目（ワンピース 2）の二の腕をふっくらさせる（Blender の中で exec する。何度流してもよい）。シェイプキー custom-arm-plump を作り直す。
#   体を細くした（set_slim.py の LIMB 0.86）ので、二の腕が細すぎた。上腕の骨（leftUpperArm / rightUpperArm）を軸に、
#   骨に直角な向きへ K 倍に広げる（骨の長さ方向には動かさない）。肩の付け根とひじの近くでは弱めてなじませる。
#   内側と下側（わきの下に向いた側）を少し強くして、やわらかい丸みにする。流したあとは服を流し直す
import bpy
import numpy as np
K = globals().get("K", 1.20)
ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks; rig = bpy.data.objects["Girl_Rig"]
k0 = kb.get("custom-arm-plump")
if k0: k0.value = 0.0
n = len(me.vertices)
def co_of(k): a = np.zeros(n*3); k.data.foreach_get("co", a); return a.reshape(n, 3)
B = co_of(kb["Basis"]); mix = B.copy()
for k in kb:
    if k.name in ("Basis", "custom-arm-plump") or k.name.startswith("exp-") or k.mute or k.value == 0: continue
    mix += (co_of(k)-B)*k.value
def ss(x): x = np.clip(x, 0, 1); return x*x*(3-2*x)
gi = {g.name: g.index for g in ob.vertex_groups}
D = np.zeros((n, 3))
for side in ("left", "right"):
    bn = rig.data.bones[side+"UpperArm"]; h = np.array(bn.head_local); t = np.array(bn.tail_local)
    L = np.linalg.norm(t-h); d = (t-h)/L; gidx = gi[side+"UpperArm"]
    w = np.zeros(n)
    for v in me.vertices:
        for g in v.groups:
            if g.group == gidx: w[v.index] = g.weight
    r = mix-h; s = r @ d; perp = r-np.outer(s, d)
    f = s/L
    along = ss(f/0.20)*ss((1.08-f)/0.30)                      # 肩の付け根・ひじの近くは弱める（袖から出ている所は効かせる）
    down = np.clip(-perp[:, 2]/(np.linalg.norm(perp, axis=1)+1e-9), 0, 1)
    D += perp*((K-1)*(1+0.4*down)*along*w)[:, None]
print("arm plump: max move mm", round(float(np.linalg.norm(D, axis=1).max())*1000, 1))
k = k0 or ob.shape_key_add(name="custom-arm-plump", from_mix=False)
k.data.foreach_set("co", (B+D).ravel()); k.value = 1.0; me.update()
