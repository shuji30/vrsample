# 5 人目（ワンピース 2）の耳を、MakeHuman の素の耳を土台にした自然な耳にする（Blender の中で exec する。何度流してもよい）。
#   4 人目で足した耳の直し（custom-ear-*）と、5 人目で試した丸め（custom-ear-round）・まわりのならし（custom-ear-around-smooth）は、
#   どれも耳の形を崩していた（上がとがる・細い・耳たぶがとがる・付け根にすじ）。全部 0 にして、素の耳（上が丸い C の字で、
#   耳のふちの巻き・内側の山・穴のくぼみがはっきりしている）に戻し、大きさと頭への寄せ方だけ MakeHuman のキーで決める
import bpy
SCALE_DECR = globals().get("SCALE_DECR", 0.35)     # 耳を少し小さく（写真の耳のように控えめに）
WING_DECR = globals().get("WING_DECR", 1.0)        # 耳を頭に沿わせる（正面から見て細い三日月形が少し見えるくらい。0.5 では横へ張り出した）
ob = bpy.data.objects["Girl_Body"]; kb = ob.data.shape_keys.key_blocks
off = [k.name for k in kb if k.name.startswith("custom-ear-")]
for n in off: kb[n].value = 0.0
for s in ("l-", "r-"):
    kb[s+"ear-scale-decr"].value = SCALE_DECR; kb[s+"ear-wing-decr"].value = WING_DECR
ob.data.update()
print("ears natural. off:", off)
