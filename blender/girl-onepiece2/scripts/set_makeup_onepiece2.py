# 5 人目（ワンピース 2）のメイク（Blender の中で exec する。何度流してもよい）。昭和のアイドル風に、やわらかく血色よく。
#   肌の材質（Skin）・唇（Lips）・眉（Brow）の色と、チークの位置と広がりを変える。形（シェイプキー）は変えない
#   チーク：中心 CHEEK_C（mk_pos の座標。x は顔のまん中からの横、z は高さ）、半径 CHEEK_R、濃さ CHEEK_K、色 CHEEK_COL
#     4 人目のチークは耳の近く（ほおの外側）に広く入っていた。ほおの高い所（笑うと盛り上がる所）へ寄せて、丸くまとめる
#   眉：ほぼ黒の硬い線だったので、やわらかいこげ茶に
#   唇：上下の唇の合わせ目まわり（LIP_IN）を青み寄りのローズ、外側（LIP_OUT）を明るいピンクに。立体感とふっくら感を出す
import bpy
CHEEK_C = globals().get("CHEEK_C", (0.050, 0.0, 1.505)); CHEEK_R = globals().get("CHEEK_R", 0.060); CHEEK_K = globals().get("CHEEK_K", 0.7)   # 丸いはんこに見えたので、薄く広くぼかし、目じりの下へ
CHEEK_COL = globals().get("CHEEK_COL", (0.90, 0.38, 0.44, 1))      # ローズピンク（2026-11-28 にほお紅を濃く。0.25 ではほとんど見えなかった）
BROW = globals().get("BROW", ((0.17, 0.11, 0.075, 1), (0.09, 0.055, 0.04, 1)))
LIP_IN = globals().get("LIP_IN", (0.74, 0.27, 0.33, 1)); LIP_OUT = globals().get("LIP_OUT", (0.86, 0.46, 0.48, 1))
S = bpy.data.materials["Skin"].node_tree.nodes
# 肌のつや：ざらつき 0.45・反射 0.5 では顔がビニールのように光り、額から鼻先まで明るい帯が出た。しっとりした肌に
SKIN_ROUGH = globals().get("SKIN_ROUGH", 0.58); SKIN_SPEC = globals().get("SKIN_SPEC", 0.35)
_bs = next(n for n in S if n.type == "BSDF_PRINCIPLED")
_bs.inputs["Roughness"].default_value = SKIN_ROUGH; _bs.inputs["Specular IOR Level"].default_value = SKIN_SPEC
S["CheekCenter"].inputs[1].default_value = CHEEK_C
S["CheekFalloff"].inputs["From Max"].default_value = CHEEK_R; S["CheekFalloff"].inputs["To Min"].default_value = CHEEK_K
S["CheekMix"].inputs[7].default_value = CHEEK_COL
B = next(n for n in bpy.data.materials["Brow"].node_tree.nodes if n.type == "MIX" and not n.inputs[6].is_linked)
B.inputs[6].default_value = BROW[0]; B.inputs[7].default_value = BROW[1]
L = bpy.data.materials["Lips"].node_tree.nodes["MkMix"]
L.inputs[6].default_value = LIP_IN; L.inputs[7].default_value = LIP_OUT
# 眉の高さ：眉の下のふちが上まつ毛の上の端とほぼ同じ高さで、まぶたの上に眉が乗り、顔が不自然だった。BROW_UP 上げる。
#   何度流しても重ならないよう、今まで上げた量（Girl_Brows["brow_up"]）との差だけ動かす（表情のキーも同じだけ）
import numpy as np
BROW_UP = globals().get("BROW_UP", 0.010)
br = bpy.data.objects["Girl_Brows"]; d = BROW_UP-float(br.get("brow_up", 0.0))
if abs(d) > 1e-6:
    for kbk in (br.data.shape_keys.key_blocks if br.data.shape_keys else []):
        a = np.zeros(len(kbk.data)*3); kbk.data.foreach_get("co", a); a = a.reshape(-1, 3); a[:, 2] += d; kbk.data.foreach_set("co", a.ravel())
    if not br.data.shape_keys:
        a = np.zeros(len(br.data.vertices)*3); br.data.vertices.foreach_get("co", a); a = a.reshape(-1, 3); a[:, 2] += d; br.data.vertices.foreach_set("co", a.ravel())
    br["brow_up"] = BROW_UP; br.data.update()
bpy.data.objects["Girl_Body"]["makeup"] = {"cheek_c": list(CHEEK_C), "cheek_r": CHEEK_R, "cheek_k": CHEEK_K, "brow_up": BROW_UP}
print("makeup set")

# ほお紅（2026-11-28 から）：位置を mk_pos（昔の顔の形で記録した座標。今の顔と最大 5mm ずれる）で決めていたので、ぼかしがゆがんで、
#   上下のふちがくっきりした帯に見えた。今の顔の形（基本の姿勢）から、ほお紅の重みを頂点の属性 mk_blush に書き、それで塗る。
#   中心は目の骨（leftEye）から横 BLUSH_DX・下 BLUSH_DZ、横の半径 BLUSH_RX・縦の半径 BLUSH_RZ。濃さは CHEEK_K、色は CHEEK_COL
#   顔の形を変えたら流し直す
BLUSH_DX = globals().get("BLUSH_DX", 0.016); BLUSH_DZ = globals().get("BLUSH_DZ", 0.024)
BLUSH_RX = globals().get("BLUSH_RX", 0.026); BLUSH_RZ = globals().get("BLUSH_RZ", 0.019)
_ob = bpy.data.objects["Girl_Body"]; _rig = bpy.data.objects["Girl_Rig"]; _me = _ob.data
_mods = [m for m in _ob.modifiers if m.type in ("SUBSURF", "MASK")]; _st = [m.show_viewport for m in _mods]
for m in _mods: m.show_viewport = False
_pp = _rig.data.pose_position; _rig.data.pose_position = "REST"; bpy.context.view_layer.update()
_e = _ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); _m = _e.to_mesh()
_B = np.zeros(len(_m.vertices)*3); _m.vertices.foreach_get("co", _B); _e.to_mesh_clear(); _B = _B.reshape(-1, 3)
for m, s in zip(_mods, _st): m.show_viewport = s
_rig.data.pose_position = _pp; bpy.context.view_layer.update()
_ey = _rig.data.bones["leftEye"].head_local
_x = np.abs(_B[:, 0]); _r = np.sqrt(((_x-(abs(_ey.x)+BLUSH_DX))/BLUSH_RX)**2+((_B[:, 2]-(_ey.z-BLUSH_DZ))/BLUSH_RZ)**2)
_t = np.clip(1-_r, 0, 1); _w = _t*_t*(3-2*_t)                    # まん中から外へなめらかに薄く
_w *= np.clip((_ey.y+0.03-_B[:, 1])/0.02, 0, 1)                    # 顔の前だけ（耳の方へ回り込まない）
_a = _me.attributes.get("mk_blush") or _me.attributes.new("mk_blush", "FLOAT", "POINT")
_a.data.foreach_set("value", _w.astype(np.float32)); _me.update()
_nt = bpy.data.materials["Skin"].node_tree; _N = _nt.nodes
_at = _N.get("BlushAttr") or _N.new("ShaderNodeAttribute"); _at.name = "BlushAttr"; _at.attribute_name = "mk_blush"; _at.location = (_N["CheekMix"].location.x-400, _N["CheekMix"].location.y-200)
_mul = _N.get("BlushMul") or _N.new("ShaderNodeMath"); _mul.name = "BlushMul"; _mul.operation = "MULTIPLY"; _mul.location = (_at.location.x+200, _at.location.y)
_mul.inputs[1].default_value = CHEEK_K
_nt.links.new(next(o for o in _at.outputs if o.type == "VALUE"), _mul.inputs[0]); _nt.links.new(_mul.outputs[0], _N["CheekMix"].inputs[0])
print("blush painted", int((_w > 0.01).sum()), "verts")
