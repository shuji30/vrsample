# 5 人目（ワンピース 2）の顔立ちの雰囲気を、昭和のアイドル風（ぱっちりした目・ふっくら丸いほお・小さめの鼻・やさしい笑顔）に寄せる。
# 特定の人に似せるのではなく、顔のシェイプキーの効き具合と髪の色を変えるだけ（Blender の中で exec する。何度流してもよい）。
#   KEYS … シェイプキーの値（左右のあるものは l- / r- の両方に入れる）。HAIR … 髪の地の色とつやの帯の色
import bpy
KEYS = globals().get("KEYS", {
    "eye-scale-incr": 0.5,           # 目の大きさは 4 人目のまま（0.62 に大きくしたら、目が離れて見え、宇宙人のようになった）
    "eye-corner2-up": 0.0,           # 目じりを上げない（きりっとさせず、やわらかく。0.1 から）
    "cheek-volume-incr": 0.55,       # ほおのふくらみは 4 人目のまま（0.85 では下ぶくれの丸顔になった）
    "chin-bones-decr": 0.45,         # あごの骨っぽさを消す（0.3 から）
    "nose-scale-horiz-decr": 1.0,    # 鼻を小さく（0.8 から）
    "nose-scale-vert-decr": 0.7,     # 鼻すじを短く（0.45 から）
    "nose-point-up": 0.45,           # 鼻先を少し上へ（0.35 から）
    "custom-soft-smile": 1.0,        # （中身が空のキー。ふだんのほほえみは下の custom-idol-smile で入れる）
    "custom-face-narrow": 1.0,       # 顔の下半分（えら・あご）を細く、卵形に（0〜0.7 ではえらが張って角ばった。耳は素の形に戻したので、耳たぶの下のくびれはもう出ない）
    "mouth-scale-horiz-incr": 0.0,   # 口を横に広げない（0.2 から。笑顔と重なって口が横に広く平たく見えた）
    "chin-height-decr": 0.4,         # あごを伸ばす（0.8 では顔の下段が短く、下ぶくれに見えた。下段を中段の 0.85〜0.9 倍に）
    # 彫刻家の目で：鼻すじの面が平たく広く、額から鼻先まで明るい帯になっていた。鼻すじを細くして稜線を立て、顔の中心を締める
    "nose-width1-decr": 0.8,         # 鼻すじの上（目のあいだ）を細く（0.35 から）
    "nose-width2-decr": 0.6,         # 鼻すじのなかほどを細く（0.25 から）
    "nose-greek-incr": 0.35,         # 額から鼻すじへまっすぐ通す（0.1 から）
    # 輪郭：ほお骨から下があごまでまっすぐ広く落ちていた。あご先とえらを少し締めて卵形に
    "chin-width-decr": 0.45,         # あご先を少し細く（0.38 から。0.25 に広げたら顔が四角く見えた）
})
HAIR = globals().get("HAIR", ((0.022, 0.012, 0.008, 1), (0.15, 0.085, 0.055, 1)))   # 黒に近いこげ茶（3 枚目の参考の写真に合わせる）
ob = bpy.data.objects["Girl_Body"]; kb = ob.data.shape_keys.key_blocks
done = {}
for k, v in KEYS.items():
    for name in ([k] if k in kb else ["l-"+k, "r-"+k]):
        if name in kb:
            kb[name].slider_max = max(kb[name].slider_max, v); kb[name].value = v; done[name] = v
ob["vibe"] = {k: float(v) for k, v in KEYS.items()}
# ふだんのほほえみ（custom-idol-smile）：笑顔の表情（exp-happy）の動きを SMILE の割合で、目の下 2.5cm より下（口元・ほお）だけ写す。
#   custom-soft-smile は中身が空だった。目のまわりまで写すと、別のオブジェクトのまつ毛とずれる
import numpy as np
SMILE = globals().get("SMILE", 0.1)       # 0.4 では唇が開いて不自然、0.2 でも口が横に広く見えた
_n = len(ob.data.vertices)
def _co(k): a = np.zeros(_n*3); k.data.foreach_get("co", a); return a.reshape(_n, 3)
_B = _co(kb["Basis"]); _D = _co(kb["exp-happy"])-_B
_rig = bpy.data.objects["Girl_Rig"]; _ez = _rig.data.bones["leftEye"].head_local.z
# 高さは今の形（キーを混ぜた形）で比べる。Basis は身長・頭身を変える前の形で、高さがずれている
_mix = _B.copy()
for _k in kb:
    if _k.name in ("Basis", "custom-idol-smile") or _k.name.startswith("exp-") or _k.mute or _k.value == 0: continue
    _mix += (_co(_k)-_B)*_k.value
_w = np.clip((_ez-0.025-_mix[:, 2])/0.015, 0, 1); _w = _w*_w*(3-2*_w)
_ks = kb.get("custom-idol-smile") or ob.shape_key_add(name="custom-idol-smile", from_mix=False)
_ks.data.foreach_set("co", (_B+_D*_w[:, None]).ravel()); _ks.value = SMILE
H = bpy.data.materials["Hair"].node_tree.nodes
H["Mix"].inputs[6].default_value = HAIR[0]; H["Mix"].inputs[7].default_value = HAIR[1]
ob.data.update()
print("vibe set", done)
