# 5 人目（ワンピース 2）の脇の下〜腰の横（背中側の筋肉のあたり）の張り出しを寄せて、脇の下からまっすぐ下りる線にする
# （Blender の中で exec する。何度流してもよい）。シェイプキー custom-side-slim を作り直す。流したあとは服を流し直す。
#   体のサイズを合わせた（set_size_onepiece2.py）とき、胸まわりを広げた倍率が脇の下まで効き、後ろから見て脇の下が外へふくらんでいた。
#   高さ Z0〜Z1 のあいだ（いちばん強いのは ZP）で、胴の横（|x| が大きい所）を胴のまん中へ寄せる。腕は動かさない。
#   胸の前（前に出た所）は弱めて、バストの寸法は変えない
import bpy
import numpy as np
K = globals().get("K", 0.08)                        # いちばん強い所で、横の幅を何割寄せるか
Z0, ZP, Z1 = 1.07, 1.15, 1.22
ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks; rig = bpy.data.objects["Girl_Rig"]
k0 = kb.get("custom-side-slim")
if k0: k0.value = 0.0
n = len(me.vertices)
def co_of(k): a = np.zeros(n*3); k.data.foreach_get("co", a); return a.reshape(n, 3)
B = co_of(kb["Basis"]); mix = B.copy()
for k in kb:
    if k.name in ("Basis", "custom-side-slim") or k.name.startswith("exp-") or k.mute or k.value == 0: continue
    mix += (co_of(k)-B)*k.value
names = {g.index: g.name for g in ob.vertex_groups}
armw = np.zeros(n)
for v in me.vertices:
    tot = sum(g.weight for g in v.groups if names[g.group] in rig.data.bones)
    if tot > 1e-6: armw[v.index] = sum(g.weight for g in v.groups if any(s in names[g.group] for s in ("UpperArm", "LowerArm", "Hand")))/tot
def ss(x): x = np.clip(x, 0, 1); return x*x*(3-2*x)
z = mix[:, 2]; ax = np.abs(mix[:, 0])
wz = np.where(z < ZP, ss((z-Z0)/(ZP-Z0)), ss((Z1-z)/(Z1-ZP)))
wx = ss((ax-0.08)/0.04)                              # 胴の横だけ（まん中と胸のふくらみは動かさない）
wy = ss((mix[:, 1]+0.14)/0.04)                       # 胸のいちばん前（y が -0.14 より前）は動かさない。前から見た脇の張り出し（胸の横、y -0.07 あたり）も寄せる
w = K*wz*wx*wy*(1-armw)
D = np.zeros((n, 3)); D[:, 0] = -mix[:, 0]*w
print("side slim: max move mm", round(float(np.abs(D).max())*1000, 1))
k = k0 or ob.shape_key_add(name="custom-side-slim", from_mix=False)
k.data.foreach_set("co", (B+D).ravel()); k.value = 1.0; me.update()
