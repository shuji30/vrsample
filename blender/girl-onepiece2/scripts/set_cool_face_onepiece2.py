# 5 人目（ワンピース 2）の顔を、少し大人っぽくすっきりした顔に寄せる（2026-11-28。Blender の中で exec する。何度流してもよい）。
# 特定の人に似せるのではない。ユーザーが選んだ 4 つだけを変え、髪・体・服・眉・ほお紅はそのまま。
#   1. 目の形：切れ長に（目を少し小さく・上まぶたを少し下げる・たれ目をやめて目じりをわずかに上げ、外へのばす）
#   2. 目の色：こげ茶 → グレーがかった青（Eye_Iris の地の色。書き出しで画像に焼かれる）
#   3. 目元のメイク：下まぶたと目じりのまわりに赤み（頂点の属性 mk_eyered。肌の材質で塗る）
#   4. 鼻と口：鼻すじを細く高く通し、唇を薄めの赤に
# 形は set_idol_face_onepiece2.py に KEYS・DROOP・OUTX を渡して流し直す（まつ毛・まばたきの合わせ直しも、その中で行う）。
# 唇の色は set_makeup_onepiece2.py に LIP_IN・LIP_OUT を渡して流し直す。
# 元の顔（昭和のアイドル風）に戻すときは、set_idol_face_onepiece2.py と set_makeup_onepiece2.py をそのまま流し、
# Eye の IrisRamp の要素 2〜6 を IRIS_IDOL に、Skin の EyeRedMul を 0 にする。
# 2026-11-29 に Blender 5.3 で流し、この顔で VRM を書き出した（models/girl-onepiece2.vrm）。目の形の値は 3 通りを並べて選んだ。
import bpy, os
import numpy as np

D = os.path.join(os.path.dirname(bpy.data.filepath), "scripts")
def run(name, g):
    exec(open(os.path.join(D, name), encoding="utf-8").read(), dict(g))

# --- 1・4 の形：set_idol_face_onepiece2.py の KEYS を写し、変えた所に「cool」と書く -------------------------------
KEYS = globals().get("KEYS", {
    # 目
    "eye-height2-decr": 1.6,          # cool：上まぶたを下げ、黒目の上をもう少し隠す（0.8 から。1.2 ではまだ丸かった）
    "eye-height3-incr": 0.0,          # cool：目じり側のまぶたを開けない（0.2 から）
    "eye-corner2-up": 0.3,            # cool：目じりを少し上げる（set_vibe の 0 から）。custom-eye-big・custom-eye-almond は中身が空のキーで効かない
    "custom-eye-slant": 0.5,          # cool：たれ目を弱める（0.3 から。0.8 では目が丸く見えた）
    "custom-eye-almond": 1.0,
    "eye-scale-incr": 0.3,            # cool：目を小さく（0.6 から）
    # 鼻
    "nose-scale-vert-decr": 0.6,      # cool：鼻すじを少し長く（1.0 から）
    "nose-scale-depth-decr": 0.25,    # cool：鼻を高く（0.6 から）
    "custom-nose-bridge": 0.6,        # cool：鼻すじの稜線を立てる（0.3 から）
    "nose-width1-decr": 0.7,          # cool：鼻すじの上を細く（0.4 から）
    "nose-width2-decr": 0.8,          # cool：鼻すじのなかほどを細く（set_vibe の 0.6 から）
    "nose-flaring-decr": 0.8,         # cool：小鼻をもう少し小さく（0.7 から）
    # ほお・輪郭
    "cheek-volume-incr": 0.55,        # cool：ほおの丸みを少し控える（0.65 から）
    "custom-young-cheek": 1.2,        # cool：（1.6 から）
    "custom-cheek-puff": 1.15,
    "custom-lower-cheek-puff": 0.5,
    "custom-round-face": 0.6,
    "chin-width-decr": 0.68,          # cool：あごを少し細く（0.62 から。0.7 ではとがった）
    "nose-trans-up": -1.6,            # cool：鼻が長くなったぶん、下げすぎない（-2.0 から）
    "mouth-trans-up": 0.5,
    # 口
    "mouth-scale-horiz-decr": 0.35,
    "custom-mouth-wider": 0.3,
    "custom-lip-thin": 0.9,           # cool：唇を薄く（0.6 から。小さいほど厚い）
    "mouth-upperlip-volume-incr": 0.15, # 元のまま（0 と 0.05 に下げると、custom-lip-thin 0.9 と重なって下唇の下に細い切れ目が出た）
    "mouth-lowerlip-volume-incr": 0.2,
    "mouth-angles-up": 0.15,          # cool：口角の上げを控える（0.3 から）
    "mouth-trans-backward": 1.15,
    "mouth-scale-depth-decr": 0.35,
    "ear-scale-decr": 0.7,
})
DROOP = globals().get("DROOP", 0.0)       # cool：目じりを下げない（0.0014 から）
OUTX = globals().get("OUTX", 0.005)       # cool：目じりを外へのばして切れ長に（0.0025 から）
KEYS = {**KEYS, **globals().get("KEY_OVERRIDES", {})}       # 試すときに一部だけ上書きする
run("set_idol_face_onepiece2.py", {"KEYS": KEYS, "DROOP": DROOP, "OUTX": OUTX})

# --- 4 の色：唇を薄めの赤に（合わせ目はやや深い赤、外側は明るい赤） ----------------------------------------------
LIP_IN = globals().get("LIP_IN", (0.62, 0.17, 0.19, 1)); LIP_OUT = globals().get("LIP_OUT", (0.80, 0.33, 0.33, 1))
run("set_makeup_onepiece2.py", {"LIP_IN": LIP_IN, "LIP_OUT": LIP_OUT})

# --- 2. 瞳の色：瞳は Eye 材質のグラデーション（IrisRamp）で描いている（Eye_Iris はどの面にも使っていない） ------------------
#   要素 2〜6 が虹彩（内のふち → 明るい帯 → 外のふち）。0〜1 は瞳孔、7〜8 は白目
IRIS_IDOL = ((0.02, 0.01, 0.006, 1), (0.045, 0.022, 0.011, 1), (0.025, 0.012, 0.007, 1), (0.008, 0.005, 0.004, 1), (0.008, 0.005, 0.004, 1))
IRIS = globals().get("IRIS", ((0.05, 0.08, 0.11, 1), (0.22, 0.32, 0.40, 1), (0.14, 0.21, 0.27, 1), (0.04, 0.06, 0.08, 1), (0.04, 0.06, 0.08, 1)))   # グレーがかった青（リニア）
_ramp = bpy.data.materials["Eye"].node_tree.nodes["IrisRamp"].color_ramp.elements
for _i, _c in zip(range(2, 7), IRIS): _ramp[_i].color = _c

# --- 3. 目元の赤み：下まぶたと目じりのまわり。重みを頂点の属性 mk_eyered に書き、肌の材質で塗る -----------------------
#   中心は目の骨（leftEye）。横の半径 RED_RX・縦の半径 RED_RZ、目の下ほど濃く（上まぶたは RED_UP の割合）、目じりの外へ RED_OUT 寄せる
#   中心は目の玉の中心から RED_DZ 下（見えている目の下の肌は、目の玉の中心から 1〜2.5cm 下。中心のままでは目の下が薄かった）
RED_COL = globals().get("RED_COL", (0.80, 0.36, 0.36, 1)); RED_K = globals().get("RED_K", 0.7)
RED_RX = globals().get("RED_RX", 0.025); RED_RZ = globals().get("RED_RZ", 0.013); RED_DZ = globals().get("RED_DZ", -0.006)   # 0.018・-0.009 ではほお紅とつながって、ほお全体が赤く見えた
RED_OUT = globals().get("RED_OUT", 0.004); RED_UP = globals().get("RED_UP", 0.45)
ob = bpy.data.objects["Girl_Body"]; rig = bpy.data.objects["Girl_Rig"]; me = ob.data
mods = [m for m in ob.modifiers if m.type in ("SUBSURF", "MASK")]; st = [m.show_viewport for m in mods]
for m in mods: m.show_viewport = False
pp = rig.data.pose_position; rig.data.pose_position = "REST"; bpy.context.view_layer.update()
e = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = e.to_mesh()
B = np.zeros(len(m.vertices)*3); m.vertices.foreach_get("co", B); e.to_mesh_clear(); B = B.reshape(-1, 3)
for m_, s in zip(mods, st): m_.show_viewport = s
rig.data.pose_position = pp; bpy.context.view_layer.update()
ey = rig.data.bones["leftEye"].head_local
x = np.abs(B[:, 0]); dz = B[:, 2]-ey.z
r = np.sqrt(((x-(abs(ey.x)+RED_OUT))/RED_RX)**2+((dz-RED_DZ)/RED_RZ)**2)
t = np.clip(1-r, 0, 1); w = np.sqrt(t*t*(3-2*t))                    # まん中は平らに濃く、ふちでなめらかに薄く
w *= np.where(dz > 0, RED_UP, 1.0)                                  # 上まぶたは薄く、下まぶた・目の下を濃く
w *= np.clip((ey.y+0.03-B[:, 1])/0.02, 0, 1)                        # 顔の前だけ
eyemat = {i for i, mt in enumerate(me.materials) if mt and mt.name.startswith("Eye")}
for p in me.polygons:                                               # 目の玉には塗らない
    if p.material_index in eyemat: w[list(p.vertices)] = 0
a = me.attributes.get("mk_eyered") or me.attributes.new("mk_eyered", "FLOAT", "POINT")
a.data.foreach_set("value", w.astype(np.float32)); me.update()
nt = bpy.data.materials["Skin"].node_tree; N = nt.nodes
# 下まぶたのピンク（NewLow）の前に挟む：… → MkLowMix → EyeRedMix → NewLow → 二重の線 → アイライン（線は赤みの上に描く）
mix = N.get("EyeRedMix")
if not mix:
    mix = N.new("ShaderNodeMix"); mix.name = "EyeRedMix"; mix.data_type = "RGBA"; mix.blend_type = "MULTIPLY"
    mix.location = (N["NewLow"].location.x-250, N["NewLow"].location.y+200)
    src = N["NewLow"].inputs[6].links[0].from_socket
    nt.links.new(src, mix.inputs[6]); nt.links.new(mix.outputs[2], N["NewLow"].inputs[6])
at = N.get("EyeRedAttr") or N.new("ShaderNodeAttribute"); at.name = "EyeRedAttr"; at.attribute_name = "mk_eyered"; at.location = (mix.location.x-400, mix.location.y)
mul = N.get("EyeRedMul") or N.new("ShaderNodeMath"); mul.name = "EyeRedMul"; mul.operation = "MULTIPLY"; mul.location = (mix.location.x-200, mix.location.y)
mul.inputs[1].default_value = RED_K
nt.links.new(next(o for o in at.outputs if o.type == "VALUE"), mul.inputs[0]); nt.links.new(mul.outputs[0], mix.inputs[0])
# 掛け合わせ（MULTIPLY）なので、色は「肌に重ねる赤みのフィルター」。白に近いほど薄い
mix.inputs[7].default_value = RED_COL
ob["cool_face"] = {"droop": DROOP, "outx": OUTX, "iris": list(IRIS), "red_k": RED_K}
print("cool face set", int((w > 0.01).sum()), "verts reddened")
