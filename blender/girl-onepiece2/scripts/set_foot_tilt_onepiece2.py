# 5 人目（ワンピース 2）の足を、ハイヒールの角度につま先立ちにする（Blender の中で exec する。何度流してもよい）。シェイプキー custom-foot-tilt を作り直す。
#   custom-heel を作られた範囲より大きく効かせると、足首が引き伸ばされてゆがんだ。ここでは関節のまわりに回す：
#   1) 足（Foot・Toes の骨の重み）を、足首の関節（Foot の骨の根元）を通る左右の軸のまわりに ANG 度、つま先が下がる向きに回す
#   2) 指（Toes の骨の重み）は、回したあとの指の付け根の関節のまわりに -ANG 度回して、床に平らに戻す
#   3) 指の裏が元の高さになるよう、体全体を持ち上げる
#   骨・頭に付く物・heel_shift などは、set_heel_onepiece2.py と同じ仕組み（KEY を渡す）で動かす。流したあとは靴・服・髪を流し直す
import bpy, math
import numpy as np
ANG = globals().get("ANG", 12.0)
ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks; rig = bpy.data.objects["Girl_Rig"]
k0 = kb.get("custom-foot-tilt")
if k0 and k0.value != 0:
    # 今の傾きをいったん戻す（骨なども戻す）
    exec(compile(open(__file__.replace("set_foot_tilt_onepiece2.py", "set_heel_onepiece2.py") if "__file__" in globals() else r"C:\Users\shuji\vrsample\blender\girl-onepiece2\scripts\set_heel_onepiece2.py", encoding="utf-8").read(), "set_heel", "exec"),
         {"__name__": "__main__", "HEEL": 0.0, "KEY": "custom-foot-tilt"})
n = len(me.vertices)
def co_of(k): a = np.zeros(n*3); k.data.foreach_get("co", a); return a.reshape(n, 3)
B = co_of(kb["Basis"]); mix = B.copy()
for k in kb:
    if k.name in ("Basis", "custom-foot-tilt") or k.name.startswith("exp-") or k.mute or k.value == 0: continue
    mix += (co_of(k)-B)*k.value
names = {g.index: g.name for g in ob.vertex_groups}
bodyg = {ob.vertex_groups["body"].index, ob.vertex_groups["hidden_by_clothes"].index}
real = np.array([any(g.group in bodyg and g.weight > 0.5 for g in v.groups) for v in me.vertices])
D = np.zeros((n, 3))
def rotx(P, piv, a):
    c, s = math.cos(a), math.sin(a); Q = P-piv
    return np.stack([Q[:, 0], Q[:, 1]*c-Q[:, 2]*s, Q[:, 1]*s+Q[:, 2]*c], 1)+piv
A = math.radians(ANG)
for side, sg in (("left", 1), ("right", -1)):
    ank = np.array(rig.data.bones[side+"Foot"].head_local); ball = np.array(rig.data.bones[side+"Toes"].head_local)
    wf = np.zeros(n); wt = np.zeros(n)
    for v in me.vertices:
        tot = sum(g.weight for g in v.groups if names[g.group] in rig.data.bones)
        if tot > 1e-6:
            wf[v.index] = sum(g.weight for g in v.groups if names[g.group] in (side+"Foot", side+"Toes"))/tot
            wt[v.index] = sum(g.weight for g in v.groups if names[g.group] == side+"Toes")/tot
    P1 = rotx(mix, ank, A)
    ball1 = rotx(ball[None, :], ank, A)[0]
    P2 = rotx(P1, ball1, -A)
    D += (P1-mix)*wf[:, None]+(P2-P1)*wt[:, None]
# 体全体を持ち上げて、指の裏を元の高さに
toe = real & (np.abs(mix[:, 0]) > 0.03) & (mix[:, 2] < 0.06) & (mix[:, 1] < np.percentile(mix[real & (mix[:, 2] < 0.13)][:, 1], 25))
dz = float(mix[toe][:, 2].min()-(mix+D)[toe][:, 2].min())
D[:, 2] += dz
k = k0 or ob.shape_key_add(name="custom-foot-tilt", from_mix=False)
k.data.foreach_set("co", (B+D).ravel()); k.value = 0.0; me.update()
print("foot tilt key built: ANG", ANG, "lift mm", round(dz*1000, 1))
exec(compile(open(r"C:\Users\shuji\vrsample\blender\girl-onepiece2\scripts\set_heel_onepiece2.py", encoding="utf-8").read(), "set_heel", "exec"),
     {"__name__": "__main__", "HEEL": 1.0, "KEY": "custom-foot-tilt"})
