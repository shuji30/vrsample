# 4 人目（ワンピースの子）の顔を作る（Blender の中で exec する）。girl-onepiece.blend で実行する。
#   3 人目（ニットコーデ）の make_face_knit.py の写しで、値だけを変えてある。体型（細め・ヒール・胸・首）は 3 人目と同じ。
#   大人っぽく、やわらかい顔：卵形で、ほおは少しふっくら。目は切れ長のアーモンド形を、ほほえむように少し細める（下まぶたを上げる）。
#   鼻筋が通り、鼻先が少し上向き。口は閉じたまま口角を上げた、おだやかなほほえみ。唇はほどよい厚み。
#   肩は細く、なで肩ぎみ。首は細く長い。メイク：ローズのチーク（はっきりめ）、ローズベージュの唇、まぶたにブラウン。眉は黒に近いこげ茶。
#   髪（Girl_Hair。黒髪を後ろへなでつけ、えりあしの低い位置で結んで黒いリボン）は、最後に make_hair_onepiece2.py で作り直す。
# 元の手順（vrgame2/blender/girl/README.md）の fit_face.py → make_face_cute.py を、この子の値で通す。
import bpy

S = "C:\\Users\\shuji\\Documents\\girl-blender\\scripts\\"
def run(f, g): g = dict(g); g["__name__"] = "__main__"; exec(compile(open(S+f, encoding="utf-8").read(), f, "exec"), g)
ob = bpy.data.objects["Girl_Body"]; kb = ob.data.shape_keys.key_blocks
for _k0 in ("custom-soft-smile", "custom-neck-thick", "custom-face-narrow", "custom-skull-narrow", "custom-skull-short", "custom-ear-fit", "custom-ear-tilt", "custom-ear-front", "custom-ear-smooth", "custom-eyeout-smooth", "custom-jaw-smooth", "custom-lowlid-smooth", "custom-ear-flat", "custom-eyecorner-smooth", "custom-lidcorner", "custom-cheekbone-under", "custom-cheekjaw-smooth"):   # 測る前に 0 に戻し、あとで入れ直す（ほほえみは下の「笑顔」、首と顔の幅は「顔の下半分の幅」の所）
    if _k0 in kb: kb[_k0].value = 0.0

# 足：かかとを上げる（ヒール約 5cm）。靴底は薄く（6.6mm）。体はそのぶん上と前へ動く（measured: (0, -0.0239, +0.0189)）
kb["custom-heel"].slider_max = max(kb["custom-heel"].slider_max, 1.5)
kb["custom-heel"].value = 1.25; kb["custom-sole-lift"].value = 0.3
ob["heel_shift"] = (0.0, -0.0239, 0.0409)

# 身長と頭身：はだしで HEIGHT（床から頭のてっぺんまで）、頭の高さ（あご先〜てっぺん）を HEAD_H にする（7.2 頭身）。
#   体全体（custom-height）：床のまん中（原点）を支点に一様に大きく（小さく）する（倍率 HEIGHT_S）。
#   頭（custom-head-small）：あご先を支点に、あごより上を HEAD_S 倍にする（下の「小顔」の所）。
#   いまの形（custom-height を 0 にしたとき）のあご先とてっぺんを測って、2 つの倍率を決める。
#   はだしの高さ＝てっぺんの高さ－体が靴で持ち上がったぶん（heel_shift の z）。3 人目のままだと 159.2cm・頭 17.9cm（8.9 頭身）
#   額を縮める所（custom-forehead-short）は今の頭に対する割合で動くので、1 回目はずれが残る。2 回実行するとそろう
HEIGHT = 1.600; HEAD_H = 0.222
import numpy as np
if "custom-height" in kb: kb["custom-height"].value = 0.0
_rgh = bpy.data.objects.get("Girl_Rig"); _wash = _rgh.data.pose_position if _rgh else None
if _rgh: _rgh.data.pose_position = 'REST'
_mkh = next(m for m in ob.modifiers if m.type == 'MASK'); _mkh.show_viewport = False; bpy.context.view_layer.update()
_evh = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); _mh = _evh.to_mesh()
_ch = np.zeros(len(_mh.vertices)*3); _mh.vertices.foreach_get("co", _ch); _evh.to_mesh_clear(); _ch = _ch.reshape(-1, 3)
_mkh.show_viewport = True
if _rgh: _rgh.data.pose_position = _wash
_gih = {ob.vertex_groups["body"].index, ob.vertex_groups["hidden_by_clothes"].index}
_realh = np.array([any(g.group in _gih and g.weight > 0.5 for g in v.groups) for v in ob.data.vertices])
_top0 = float(_ch[_realh][:, 2].max())-ob["heel_shift"][2]
_ym0 = float(_ch[_realh & (np.abs(_ch[:, 0]) < 0.01) & (_ch[:, 2] > 1.40) & (_ch[:, 2] < 1.52)][:, 1].min())                 # 鼻先
_chin0 = float(_ch[_realh & (np.abs(_ch[:, 0]) < 0.01) & (_ch[:, 1] < _ym0+0.045) & (_ch[:, 2] > 1.38) & (_ch[:, 2] < 1.52)][:, 2].min())-ob["heel_shift"][2]   # あご先
HEIGHT_S = (HEIGHT-HEAD_H)/_chin0                       # あご先の高さが HEIGHT－HEAD_H になる倍率
_hs_prev = ob["head_small"][3] if "head_small" in ob else 0.93
HEAD_S_NEW = _hs_prev*HEAD_H/(HEIGHT_S*(_top0-_chin0))  # いまの頭（_top0－_chin0）を、体の倍率をかけたうえで HEAD_H にする
print("head: was", round(_top0-_chin0, 4), "heads", round(_top0/(_top0-_chin0), 2), "-> HEAD_S", round(HEAD_S_NEW, 4))
_Bh0 = np.zeros(len(ob.data.vertices)*3); kb["Basis"].data.foreach_get("co", _Bh0)
_khh = kb.get("custom-height") or ob.shape_key_add(name="custom-height", from_mix=False)
_khh.data.foreach_set("co", _Bh0*HEIGHT_S); _khh.value = 1.0; ob.data.update()
ob["height_s"] = HEIGHT_S
print("height: barefoot was", round(_top0, 4), "scale", round(HEIGHT_S, 5))

# 首と耳：首を細く長くし、頭を首の真上へ（前へ出すぎていた）。耳は少し下げて後ろへ（あごの角の上に）
#   custom-neck-long … 元の形（Basis）で、首の付け根（z 1.385）から上へなだらかに頭を動かす。耳（ears）はさらに動かす
import numpy as np
NECK_D = (0.0, 0.012, -0.014); EAR_D = (0.0, -0.009, -0.021)      # 頭を首の真上へ。首の長さは 3 人目（z 0.012）より 2.6cm 短い（あご先〜のどのくぼみが頭の高さの約 0.3 倍）。耳は下げて前へ：上下は目の高さと口の高さの間に収める（3 人目は (0, 0.003, -0.003)）
_me = ob.data; _n = len(_me.vertices); _B = np.zeros(_n*3); kb["Basis"].data.foreach_get("co", _B); _B = _B.reshape(-1, 3)
def _ss(x): x = np.clip(x, 0, 1); return x*x*(3-2*x)
_w = _ss((_B[:, 2]-1.385)/0.060)
_w *= np.where(_B[:, 2] < 1.445, 1-_ss((np.abs(_B[:, 0])-0.06)/0.04), 1.0)     # 付け根の近くでは、肩（僧帽筋）は動かさない
_D = _w[:, None]*np.array(NECK_D)
_ears = ob.vertex_groups["ears"].index
_ew = np.zeros(_n)
for _v in _me.vertices:
    for g in _v.groups:
        if g.group == _ears: _ew[_v.index] = g.weight
_D += _ew[:, None]*np.array(EAR_D)
_k = kb.get("custom-neck-long") or ob.shape_key_add(name="custom-neck-long", from_mix=False)
_k.data.foreach_set("co", (_B+_D).ravel()); _k.value = 1.0
kb["neck-scale-horiz-decr"].value = 0.0                   # 首の太さは、下の custom-neck-thick で顔の幅に合わせる（3 人目は 0.45 で細く）
kb["measure-shoulder-dist-decr"].slider_max = max(kb["measure-shoulder-dist-decr"].slider_max, 1.2)
kb["measure-shoulder-dist-decr"].value = 1.25             # 肩幅を狭く（肩幅が頭の高さの約 1.6 倍になるように。3 人目は 0.2）。骨組みはこのあと作り直すので、肩の関節も動く
HEAD_DY, HEAD_DZ = NECK_D[1], NECK_D[2]                  # 頭が動いたぶん（髪・チーク・眉に足す）

# 頭の大きさ（custom-head-small）：あご先を支点に、あごより上（顔・耳・頭）を HEAD_S 倍にする。首から下は変えない。
# HEAD_S は、上の「身長と頭身」で決めた値（頭の高さが HEAD_H になる）。3 人目は 0.93（小顔）
HEAD_S = HEAD_S_NEW
if "custom-head-small" in kb: kb["custom-head-small"].value = 0.0
_rgs = bpy.data.objects.get("Girl_Rig"); _wass = _rgs.data.pose_position if _rgs else None
if _rgs: _rgs.data.pose_position = 'REST'
_mks = next(m for m in ob.modifiers if m.type == 'MASK'); _mks.show_viewport = False; bpy.context.view_layer.update()
_evs = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); _ms = _evs.to_mesh()
_cs = np.zeros(len(_ms.vertices)*3); _ms.vertices.foreach_get("co", _cs); _evs.to_mesh_clear(); _cs = _cs.reshape(-1, 3)
_mks.show_viewport = True
if _rgs: _rgs.data.pose_position = _wass
_gis = {ob.vertex_groups["body"].index, ob.vertex_groups["hidden_by_clothes"].index}
_reals = np.array([any(g.group in _gis and g.weight > 0.5 for g in v.groups) for v in ob.data.vertices])
_jh = ob.vertex_groups["joint-head"].index
_hy = float(np.mean([_cs[v.index][1] for v in ob.data.vertices if any(g.group == _jh and g.weight > 0.5 for g in v.groups)]))
_ymin = float(_cs[_reals & (np.abs(_cs[:, 0]) < 0.01) & (_cs[:, 2] > 1.40) & (_cs[:, 2] < 1.52)][:, 1].min())   # 顔のいちばん前（鼻先）
_fc = _cs[_reals & (np.abs(_cs[:, 0]) < 0.01) & (_cs[:, 1] < _ymin+0.045) & (_cs[:, 2] > 1.38) & (_cs[:, 2] < 1.52)]   # あご（首の前は入れない）
_zc = float(_fc[:, 2].min())                              # あご先の高さ
HEAD_PIV = np.array([0.0, _hy, _zc])
_wh = _ss((_cs[:, 2]-(_zc-0.030))/0.030)
_Dh = (HEAD_PIV+(_cs-HEAD_PIV)*HEAD_S-_cs)*_wh[:, None]
_kh = kb.get("custom-head-small") or ob.shape_key_add(name="custom-head-small", from_mix=False)
_Bh = np.zeros(_n*3); kb["Basis"].data.foreach_get("co", _Bh)
_kh.data.foreach_set("co", (_Bh.reshape(-1, 3)+_Dh).ravel()); _kh.value = 1.0; ob.data.update()
ob["head_small"] = [float(HEAD_PIV[0]), float(HEAD_PIV[1]), float(HEAD_PIV[2]), HEAD_S]
print("head small: pivot", np.round(HEAD_PIV, 3), "scale", HEAD_S)

# 胸をおわん型に（custom-bust-lift）：ふくらみの頂点が低く下を向いていたので、上の付け根を支点に持ち上げて前・上へ向け、
# 上側のへこみを少し埋めて丸くする。左右それぞれ、胸の前でいちばん前に出た点（頂点）から決める
BUST_LIFT_DEG = 18.0; BUST_R = 0.095; BUST_UPPER_FILL = 0.008
from mathutils import Matrix, Vector as _V
if "custom-bust-lift" in kb: kb["custom-bust-lift"].value = 0.0
_rg = bpy.data.objects.get("Girl_Rig"); _wasb = _rg.data.pose_position if _rg else None
if _rg: _rg.data.pose_position = 'REST'
_mkb = next(m for m in ob.modifiers if m.type == 'MASK'); _mkb.show_viewport = False; bpy.context.view_layer.update()
_evb = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); _mb = _evb.to_mesh()
_cb = np.zeros(len(_mb.vertices)*3); _mb.vertices.foreach_get("co", _cb); _evb.to_mesh_clear(); _cb = _cb.reshape(-1, 3)
_mkb.show_viewport = True
if _rg: _rg.data.pose_position = _wasb
_gi2 = {ob.vertex_groups["body"].index, ob.vertex_groups["hidden_by_clothes"].index}
_real = np.array([any(g.group in _gi2 and g.weight > 0.5 for g in v.groups) for v in ob.data.vertices])   # 体の肌（補助の形は除く）
_Db = np.zeros((_n, 3)); _rot = np.array(Matrix.Rotation(-np.radians(BUST_LIFT_DEG), 3, 'X'))   # 支点より前・下の点が、前と上へ動く向き
for _sg in (1, -1):
    _sel = (_sg*_cb[:, 0] > 0.04) & (_sg*_cb[:, 0] < 0.15) & (_cb[:, 2] > 1.10) & (_cb[:, 2] < 1.34) & (_cb[:, 1] < -0.02) & _real
    _ap = _cb[_sel][np.argmin(_cb[_sel][:, 1])]                     # 頂点（いちばん前）
    _cen = _ap+np.array([0.0, 0.045, 0.0])                           # ふくらみの中心（頂点の奥）
    _d = np.linalg.norm((_cb-_cen)*np.array([1.0, 0.8, 1.0]), axis=1)
    _wb = _ss(1-_d/BUST_R)*(_cb[:, 1] < _cen[1]+0.02)*(_sg*_cb[:, 0] > 0.0)*_real
    _piv = _ap+np.array([0.0, 0.06, 0.065])                          # 上の付け根（支点）
    _rel = _cb-_piv; _rp = _rel @ _rot.T
    _Db += (_rp-_rel)*_wb[:, None]
    _up = _ss((_cb[:, 2]-_ap[2])/0.04)*_ss((_ap[2]+0.08-_cb[:, 2])/0.03)*_wb    # 上側を少し前へ
    _Db[:, 1] -= BUST_UPPER_FILL*_up
    print("bust apex", _sg, np.round(_ap, 3))
_kbl = kb.get("custom-bust-lift") or ob.shape_key_add(name="custom-bust-lift", from_mix=False)
_Bb = np.zeros(_n*3); kb["Basis"].data.foreach_get("co", _Bb)
_kbl.data.foreach_set("co", (_Bb.reshape(-1, 3)+_Db).ravel()); _kbl.value = 1.0; ob.data.update()
# 目を寄せる（custom-eye-in）：目の玉と目のまわり（目の玉の中心から 1.8cm まで。3.6cm でなじませる）を、顔のまん中へ EYE_IN 寄せる。
#   目の玉は形を変えずに動かす。骨組み（目の骨）はこのあと作り直すので、目の骨も一緒に動く
EYE_IN = 0.0030
if "custom-eye-in" in kb: kb["custom-eye-in"].value = 0.0
_rgi = bpy.data.objects.get("Girl_Rig"); _wasi = _rgi.data.pose_position if _rgi else None
if _rgi: _rgi.data.pose_position = 'REST'
_mki = next(m for m in ob.modifiers if m.type == 'MASK'); _mki.show_viewport = False; bpy.context.view_layer.update()
_evi = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); _mi_ = _evi.to_mesh()
_ci = np.zeros(len(_mi_.vertices)*3); _mi_.vertices.foreach_get("co", _ci); _evi.to_mesh_clear(); _ci = _ci.reshape(-1, 3)
_mki.show_viewport = True
if _rgi: _rgi.data.pose_position = _wasi
_Di = np.zeros((_n, 3))
for _gn, _sg in (("helper-l-eye", 1), ("helper-r-eye", -1)):
    _gi_ = ob.vertex_groups[_gn].index
    _eb_ = np.array([any(g.group == _gi_ and g.weight > 0.5 for g in v.groups) for v in ob.data.vertices])
    _ce_ = _ci[_eb_].mean(0)
    _w = (1-_ss((np.linalg.norm(_ci-_ce_, axis=1)-0.018)/0.018))*(_sg*_ci[:, 0] > 0.004)
    _w[_eb_] = 1.0
    _Di[:, 0] += -_sg*EYE_IN*_w
_Bi = np.zeros(_n*3); kb["Basis"].data.foreach_get("co", _Bi)
_kei = kb.get("custom-eye-in") or ob.shape_key_add(name="custom-eye-in", from_mix=False)
_kei.data.foreach_set("co", (_Bi.reshape(-1, 3)+_Di).ravel()); _kei.value = 1.0; ob.data.update()

# なで肩（custom-shoulder-slope）：首の付け根から肩先までの上のラインを、首の横からすぐになだらかに下がる、内側にくぼんだ曲線にする。
#   元の形は、首の付け根から 6cm ほど水平に出てから肩先で急に落ちる、角ばった肩だった。
#   SLOPE_X（首の中心からの横の距離）ごとに SLOPE_DZ だけ下げる。腕（横 22cm より外）は、肩先と同じだけ全体を下げる。
#   胴は胸の高さから下へ向かって弱める。骨組みはこのあと作り直すので、肩の関節も下がる
SLOPE_X = (0.050, 0.060, 0.080, 0.100, 0.120, 0.140, 0.160, 0.180, 0.200)
SLOPE_DZ = (0.0, -0.006, -0.012, -0.018, -0.022, -0.022, -0.019, -0.015, -0.011)
if "custom-shoulder-slope" in kb: kb["custom-shoulder-slope"].value = 0.0
_rgs2 = bpy.data.objects.get("Girl_Rig"); _wass2 = _rgs2.data.pose_position if _rgs2 else None
if _rgs2: _rgs2.data.pose_position = 'REST'
_mks2 = next(m for m in ob.modifiers if m.type == 'MASK'); _mks2.show_viewport = False; bpy.context.view_layer.update()
_evs2 = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); _ms2 = _evs2.to_mesh()
_cs2 = np.zeros(len(_ms2.vertices)*3); _ms2.vertices.foreach_get("co", _cs2); _evs2.to_mesh_clear(); _cs2 = _cs2.reshape(-1, 3)
_mks2.show_viewport = True
if _rgs2: _rgs2.data.pose_position = _wass2
_ax2 = np.abs(_cs2[:, 0]); _z2 = _cs2[:, 2]
_dz2 = np.interp(_ax2, SLOPE_X, SLOPE_DZ)
_wz2 = _ss((_z2-1.150)/0.120)*(1-_ss((_z2-1.440)/0.030))          # 胸の高さから上（頭は動かさない）
_wa2 = _ss((_ax2-0.220)/0.040)*(_z2 < 1.440)                       # 腕は高さに関係なく全体を
_D2s = np.zeros((_n, 3)); _D2s[:, 2] = _dz2*np.maximum(_wz2, _wa2)
_Bs2 = np.zeros(_n*3); kb["Basis"].data.foreach_get("co", _Bs2)
_kss = kb.get("custom-shoulder-slope") or ob.shape_key_add(name="custom-shoulder-slope", from_mix=False)
_kss.data.foreach_set("co", (_Bs2.reshape(-1, 3)+_D2s).ravel()); _kss.value = 1.0; ob.data.update()
print("shoulder slope: max drop mm", round(float(-_D2s[:, 2].min())*1000, 1))
exec(compile(open(S+"make_rig.py", encoding="utf-8").read(), "make_rig.py", "exec"), {"__name__": "__main__"})   # 骨組みを作り直す
# make_rig.py の自動ウェイトは、目の骨と髪の揺れ骨（hairSwing）にも肌の重みを付けてしまう（口まわりの肌が目と髪の揺れで
# 引っ張られ、ゲームで歯が見えたり口の中がはみ出したりする）。目の玉以外の肌に付いたそれらの重みを、頭の骨へ移す
_vg = {g.name: g for g in ob.vertex_groups}; _gi = {g.index: g.name for g in ob.vertex_groups}
_eyeball = {_vg[n].index for n in ("helper-l-eye", "helper-r-eye")}
_moved = 0
for _v in ob.data.vertices:
    if any(g.group in _eyeball and g.weight > 0.5 for g in _v.groups): continue
    _w = sum(g.weight for g in _v.groups if _gi[g.group] in ("leftEye", "rightEye", "hairSwing"))
    if _w <= 0: continue
    _h = next((g.weight for g in _v.groups if _gi[g.group] == "head"), 0.0)
    for n in ("leftEye", "rightEye", "hairSwing"): _vg[n].remove([_v.index])
    _vg["head"].add([_v.index], _h+_w, 'REPLACE'); _moved += 1
print("moved eye/hairSwing weights to head:", _moved)
run("set_slim.py", {"LIMB": 0.86, "LEG": 0.88, "TORSO": 0.90})   # 体を細く（腕 0.86・脚 0.88・胴 0.90 倍。背や手足の長さは変えない）

# 顔の下半分の幅（custom-face-narrow）と首の太さ（custom-neck-thick）を、両方から寄せる。
#   顔：あごの角（えらの高さ）の幅を JAW_W にする。えら・あご・ほおの下を、まん中を軸に横へ縮める。目の高さより上は動かさない
#   首：首の幅を、どの高さでも NECK_W にする（まっすぐな筒）。
#   頭を大きくしたので（HEAD_S）、首がそのままだと細すぎた。高さ 5mm ごとに今の首の幅を測り、その高さの倍率を決めて、
#   首の中心を軸に横へ広げる（前後は横の半分の割合）。すでに太い所（付け根の肩の筋肉）は広げない。肩・顔は動かさない。
#   （高さで一律の倍率にすると、あごの下だけ太く、えりの近くが細い、くねった首になった）
#   体を細くした（set_slim）あとの形で測る
JAW_W = 0.105; NECK_W = 0.100
for _kn in ("custom-neck-thick", "custom-face-narrow", "custom-skull-narrow", "custom-skull-short", "custom-ear-fit", "custom-ear-tilt", "custom-ear-front", "custom-ear-smooth", "custom-eyeout-smooth", "custom-jaw-smooth", "custom-lowlid-smooth", "custom-ear-flat", "custom-eyecorner-smooth", "custom-lidcorner", "custom-cheekbone-under", "custom-cheekjaw-smooth"):
    if _kn in kb: kb[_kn].value = 0.0
_rgn = bpy.data.objects["Girl_Rig"]; _wasn = _rgn.data.pose_position; _rgn.data.pose_position = 'REST'
_mkn = next(m for m in ob.modifiers if m.type == 'MASK'); _mkn.show_viewport = False; bpy.context.view_layer.update()
_evn = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); _mn = _evn.to_mesh()
_cn = np.zeros(len(_mn.vertices)*3); _mn.vertices.foreach_get("co", _cn); _evn.to_mesh_clear(); _cn = _cn.reshape(-1, 3)
_mkn.show_viewport = True; _rgn.data.pose_position = _wasn
_bn = {ob.vertex_groups["body"].index, ob.vertex_groups["hidden_by_clothes"].index}      # 服の下に隠した肌（えりの中の首）も測る
_skn = np.array([any(g.group in _bn and g.weight > 0.5 for g in v.groups) for v in ob.data.vertices]) & (_ew < 0.05)   # 耳は入れない
_zc = float(ob["head_small"][2])                         # あご先の高さ
def _wid(z0, z1, ylim=None):
    sel = _skn & (_cn[:, 2] > z0) & (_cn[:, 2] < z1) & (np.abs(_cn[:, 0]) < 0.11)
    if ylim is not None: sel &= _cn[:, 1] > ylim
    return float(_cn[sel][:, 0].max()-_cn[sel][:, 0].min()) if sel.any() else 0.0
_ych = float(_cn[_skn & (np.abs(_cn[:, 0]) < 0.01) & (np.abs(_cn[:, 2]-_zc) < 0.006)][:, 1].min())     # あご先の前後の位置
_jaw = _wid(_zc+0.035, _zc+0.045)                         # あごの角（えら）の高さの顔の幅
FACE_K = min(1.0, max(0.88, JAW_W/max(_jaw, 1e-4)))   # 細くするのは 0.88 倍まで（0.81 倍では、ほおの下がくびれた）
_Zf = _cn[:, 2]
_wf = _ss((_Zf-(_zc-0.030))/0.020)*(1-_ss((_Zf-(_zc+0.030))/0.075))    # あごの下から、ほおの下へ向かってなだらかに弱め、目の高さ（あご先の約 10cm 上）で 0
# ほおの高さ（あご先の 3cm 上〜眉の少し上）も CHEEK_K 倍に細くする。眉より上は custom-skull-narrow が細くする
CHEEK_K = 0.92
_EZf = bpy.data.materials["Skin"].node_tree.nodes["LidCenter"].inputs["Z"].default_value
_wm = _ss((_Zf-(_zc+0.010))/0.030)*(1-_ss((_Zf-(_EZf+0.010))/0.030))
_Df = np.zeros((_n, 3)); _Df[:, 0] = _cn[:, 0]*((FACE_K-1)*_wf+(CHEEK_K-1)*_wm)
_eyes_f = {ob.vertex_groups[n].index for n in ("helper-l-eye", "helper-r-eye")}
_eyeb_f = np.array([any(g.group in _eyes_f and g.weight > 0.5 for g in v.groups) for v in ob.data.vertices])
def _keep_eye_socket(D, co):
    """目のまわり（目の玉の中心から 2.4cm まで。4.2cm でなじませる）は、横に縮めずに、目の玉と同じだけ平行に動かす。
    縮めると、まぶたの肌だけが細くなって目の玉と合わなくなり、下まぶたの段（白っぽいふち）・目じりの折れ目・目の下の割れができた"""
    for sg in (1, -1):
        eb = _eyeb_f & (sg*co[:, 0] > 0)
        if not eb.any(): continue
        ce = co[eb].mean(0); de = float(D[eb, 0].mean())
        r = 1-_ss((np.linalg.norm(co-ce, axis=1)-0.026)/0.030); r *= (sg*co[:, 0] > 0)
        D[:, 0] = D[:, 0]*(1-r)+de*r
_keep_eye_socket(_Df, _cn)
for _grp in ((_ew > 0.05) & (_cn[:, 0] > 0), (_ew > 0.05) & (_cn[:, 0] < 0)):
    if _grp.any(): _Df[_grp, 0] = float(_Df[_grp, 0].mean())         # 耳は、形を変えずに平行に動かす
_Bf = np.zeros(_n*3); kb["Basis"].data.foreach_get("co", _Bf)
_kfn = kb.get("custom-face-narrow") or ob.shape_key_add(name="custom-face-narrow", from_mix=False)
_kfn.data.foreach_set("co", (_Bf.reshape(-1, 3)+_Df).ravel()); _kfn.value = 1.0; ob.data.update()
_cn = _cn+_Df                                             # 以下は、顔を細くしたあとの形で測る

# 頭の幅（custom-skull-narrow）：額から後頭部の横幅を SKULL_K 倍にする。頭を大きくした（HEAD_S）ぶん、幅が 18cm をこえて広すぎた。
#   縮めるのは、眉より上（額・頭のてっぺん）と、耳より後ろ（後頭部）。目・ほお・口のある顔の前は動かさない。
#   目の玉は形を変えずに位置だけ、耳も形を変えずに付け根が動いたぶんだけ、平行に動かす
SKULL_K = 0.86
_EZs0 = bpy.data.materials["Skin"].node_tree.nodes["LidCenter"].inputs["Z"].default_value      # 目の高さ（前回の値）
_eyes_g = {ob.vertex_groups[n].index for n in ("helper-l-eye", "helper-r-eye")}
_eyeb = np.array([any(g.group in _eyes_g and g.weight > 0.5 for g in v.groups) for v in ob.data.vertices])
_earm = _ew > 0.05
_ear_y = float(_cn[_earm][:, 1].mean())                  # 耳の前後の位置
_Zs, _Ys = _cn[:, 2], _cn[:, 1]
_w_up = _ss((_Zs-(_EZs0+0.004))/0.025)                   # 眉のあたりから上
_w_bk = _ss((_Ys-(_ear_y-0.020))/0.040)*_ss((_Zs-(_zc+0.030))/0.030)    # 耳の 2cm 前から後ろへなだらかに（4cm 前からだと、目じりのすぐ後ろに段ができ、目じりの皺になった）
_ws = np.maximum(_w_up, _w_bk)
for _sg in (1, -1):                                       # 目のまわり（目の玉の中心から 3.5cm まで。6.5cm でなじませる）は細くしない
    _ebs = _eyeb & (_sg*_cn[:, 0] > 0)
    if _ebs.any(): _ws *= 1-(1-_ss((np.linalg.norm(_cn-_cn[_ebs].mean(0), axis=1)-0.035)/0.030))*(_sg*_cn[:, 0] > 0)
_Ds = np.zeros((_n, 3)); _Ds[:, 0] = _cn[:, 0]*(SKULL_K-1)*_ws
for _grp in (_eyeb & (_cn[:, 0] > 0), _eyeb & (_cn[:, 0] < 0), _earm & (_cn[:, 0] > 0), _earm & (_cn[:, 0] < 0)):
    if _grp.any(): _Ds[_grp, 0] = float(_Ds[_grp, 0].mean())         # 目の玉・耳は、まとめて平行に動かす
_keep_eye_socket(_Ds, _cn)                                # まぶたも、目の玉と一緒に動かす
_ks_ = kb.get("custom-skull-narrow") or ob.shape_key_add(name="custom-skull-narrow", from_mix=False)
_ks_.data.foreach_set("co", (_Bf.reshape(-1, 3)+_Ds).ravel()); _ks_.value = 1.0; ob.data.update()
_cn = _cn+_Ds
print("skull narrow:", SKULL_K, "ear y", round(_ear_y, 3))

# 頭の前後の長さ（custom-skull-short）：横から見て後頭部が張り出しすぎていた（額〜後頭部 21.3cm。耳から後ろが 9.5cm）。
#   耳の中心より後ろを、耳の中心を基準に前後へ SKULL_BACK_K 倍に縮める。あごより下（首の後ろ）と顔の前は動かさない。耳は動かさない
SKULL_BACK_K = 0.76
_w_sb = _ss((_cn[:, 1]-_ear_y)/0.015)*_ss((_cn[:, 2]-(_zc-0.040))/0.080)*(~_earm)   # 首の後ろへなだらかに弱める（あごの 1.5cm 上で急に止めると、えりあしにこぶができた）
_Dsb = np.zeros((_n, 3)); _Dsb[:, 1] = -(np.maximum(_cn[:, 1]-_ear_y, 0.0))*(1-SKULL_BACK_K)*_w_sb
_ksb = kb.get("custom-skull-short") or ob.shape_key_add(name="custom-skull-short", from_mix=False)
_ksb.data.foreach_set("co", (_Bf.reshape(-1, 3)+_Dsb).ravel()); _ksb.value = 1.0; ob.data.update()
_cn = _cn+_Dsb
print("skull short:", SKULL_BACK_K, "back moved mm", round(float(-_Dsb[:, 1].min())*1000, 1))

# 耳の大きさと高さ（custom-ear-fit）：耳の上を目の高さ、耳たぶを口の高さにそろえる（上下の大きさを合わせ、前後も同じ割合）。
#   目と口の高さは、前回この顔を作ったときの値（LidCenter・唇の合わせ目）を使う。目や口を動かしたら 2 回実行するとそろう
_LZ = bpy.data.materials["Skin"].node_tree.nodes["LidCenter"].inputs["Z"].default_value
_MZ = bpy.data.materials["Lips"].node_tree.nodes["MkSub"].inputs[1].default_value
_ein0 = _ew > 0.5
_et0, _eb0 = float(_cn[_ein0][:, 2].max()), float(_cn[_ein0][:, 2].min())
EAR_H = 0.82; EAR_DEPTH = 0.92; EAR_FWD = 0.005           # 耳を小さく丸く（縦は目〜口の高さの 0.82 倍、前後はそのうえ 0.92 倍）、ほお側（前）へ 5mm
_es = (_LZ-_MZ)/max(_et0-_eb0, 1e-4)*EAR_H
def _ear_spread(sg, reach=0.018):
    """耳の動きを、まわりの肌へなだらかに広げる重み（耳で 1、耳から reach 離れて 0）。耳の重みだけで動かすと、付け根につなぎ目ができた"""
    ep = _cn[(_ew > 0.5) & (sg*_cn[:, 0] > 0)]; dn = np.full(_n, 1.0)
    idx = np.nonzero((sg*_cn[:, 0] > 0.03))[0]
    for i0 in range(0, len(idx), 2000):
        b = idx[i0:i0+2000]; dn[b] = np.sqrt(((_cn[b, None, :]-ep[None, :, :])**2).sum(-1)).min(1)
    return np.maximum(np.clip(_ew, 0, 1), 1-_ss(dn/reach))*(sg*_cn[:, 0] > 0)
_spr = {1: _ear_spread(1), -1: _ear_spread(-1)}
_Df2 = np.zeros((_n, 3))
for _sg in (1, -1):
    _sel = _ein0 & (_sg*_cn[:, 0] > 0)
    if not _sel.any(): continue
    _c0 = _cn[_sel].mean(0); _zt = (_LZ+_MZ)/2
    _new_z = _zt+(_cn[:, 2]-(_et0+_eb0)/2)*_es; _new_y = _c0[1]-EAR_FWD+(_cn[:, 1]-_c0[1])*_es*EAR_DEPTH
    _m = _spr[_sg]
    _Df2[:, 2] += (_new_z-_cn[:, 2])*_m; _Df2[:, 1] += (_new_y-_cn[:, 1])*_m
_kef = kb.get("custom-ear-fit") or ob.shape_key_add(name="custom-ear-fit", from_mix=False)
_kef.data.foreach_set("co", (_Bf.reshape(-1, 3)+_Df2).ravel()); _kef.value = 1.0; ob.data.update()
_cn = _cn+_Df2
print("ear fit: was", round(_eb0, 4), round(_et0, 4), "-> mouth", round(_MZ, 4), "eye", round(_LZ, 4), "scale", round(_es, 3))

# 耳たぶを前へ（custom-ear-tilt）：耳の上は動かさず、下へ行くほど前へ（耳たぶで EAR_LOBE_FWD）。耳の付け根の肌も、耳の重みのぶんだけついてくる
EAR_LOBE_FWD = 0.004
_ezs = _cn[_ew > 0.5][:, 2]; _etop, _ebot = float(_ezs.max()), float(_ezs.min())
_Dt = np.zeros((_n, 3)); _Dt[:, 1] = -EAR_LOBE_FWD*_ss((_etop-_cn[:, 2])/(_etop-_ebot))*np.maximum(_spr[1], _spr[-1])
_kt_ = kb.get("custom-ear-tilt") or ob.shape_key_add(name="custom-ear-tilt", from_mix=False)
_kt_.data.foreach_set("co", (_Bf.reshape(-1, 3)+_Dt).ravel()); _kt_.value = 1.0; ob.data.update()
_cn = _cn+_Dt
# 耳の前側を顔に埋める（custom-ear-front）：耳の前のふちが頭から浮いて、縦の線に見えた。
#   耳の前側（前のふちから耳の奥行きの 45% まで）を、同じ高さ・前後の位置の頭の肌の横の位置へ寄せる（前のふちで肌から 0.5mm 外）
EAR_FRONT_MAX = 0.003                                     # 埋める量は 3mm まで（13mm 押し込むと、耳がつぶれて不気味になった）
_Df3 = np.zeros((_n, 3)); _skin_only = _sk_e & (_ew < 0.02) if "_sk_e" in dir() else (_ew < 0.02)
_skin_only = np.array([any(g.group in (ob.vertex_groups["body"].index, ob.vertex_groups["hidden_by_clothes"].index) and g.weight > 0.5 for g in v.groups) for v in ob.data.vertices]) & (_ew < 0.02)
for _sg in (1, -1):
    _sel = (_ew > 0.5) & (_sg*_cn[:, 0] > 0)
    if not _sel.any(): continue
    _yf = float(_cn[_sel][:, 1].min()); _yb = float(_cn[_sel][:, 1].max()); _dep = max(_yb-_yf, 1e-4)
    _hs_ = _cn[_skin_only & (_sg*_cn[:, 0] > 0.03)]
    for _i in np.nonzero(_sel)[0]:
        _t = (_cn[_i, 1]-_yf)/_dep
        if _t > 0.45: continue
        _d2 = (_hs_[:, 1]-_cn[_i, 1])**2+(_hs_[:, 2]-_cn[_i, 2])**2
        _hx = float(np.abs(_hs_[np.argsort(_d2)[:4], 0]).mean())+0.0005
        _ax = abs(_cn[_i, 0])
        if _ax > _hx: _Df3[_i, 0] = _sg*max(_hx-_ax, -EAR_FRONT_MAX)*(1-_ss(_t/0.45))
_kfr = kb.get("custom-ear-front") or ob.shape_key_add(name="custom-ear-front", from_mix=False)
_kfr.data.foreach_set("co", (_Bf.reshape(-1, 3)+_Df3).ravel()); _kfr.value = 1.0; ob.data.update()
_cn = _cn+_Df3
print("ear front buried max mm", round(float(np.abs(_Df3).max())*1000, 2))
# 耳を頭に寄せる（custom-ear-flat）：耳が頭から板のように立って、前の面が頬から離れて見えた。
#   耳の頂点の、付け根（耳の外周の横の位置）からの横の出っぱりを EAR_FLAT 倍にする。付け根は動かさない
EAR_FLAT = 0.70
_Df4 = np.zeros((_n, 3))
_ed_e = np.zeros(len(ob.data.edges)*2, int); ob.data.edges.foreach_get("vertices", _ed_e); _ed_e = _ed_e.reshape(-1, 2)
_ein_e = _ew > 0.5; _cr_e = _ed_e[_ein_e[_ed_e[:, 0]] != _ein_e[_ed_e[:, 1]]]
_rim_e = np.zeros(_n, bool); _rim_e[_cr_e.ravel()] = True; _rim_e &= _ein_e
for _sg in (1, -1):
    _sel = _ein_e & (_sg*_cn[:, 0] > 0); _rm = _rim_e & (_sg*_cn[:, 0] > 0)
    if not _rm.any(): continue
    _rp_ = _cn[_rm]
    for _i in np.nonzero(_sel)[0]:
        _d2 = (_rp_[:, 1]-_cn[_i, 1])**2+(_rp_[:, 2]-_cn[_i, 2])**2
        _bx = float(np.abs(_rp_[np.argsort(_d2)[:3], 0]).mean())         # その高さ・前後の付け根の横の位置
        _ax = abs(_cn[_i, 0])
        if _ax > _bx: _Df4[_i, 0] = _sg*(_ax-_bx)*(EAR_FLAT-1)
_kfl = kb.get("custom-ear-flat") or ob.shape_key_add(name="custom-ear-flat", from_mix=False)
_kfl.data.foreach_set("co", (_Bf.reshape(-1, 3)+_Df4).ravel()); _kfl.value = 1.0; ob.data.update()
_cn = _cn+_Df4
print("ear flat max mm", round(float(np.abs(_Df4).max())*1000, 2))
# 耳のつなぎ目をならす（custom-ear-smooth）：耳の外周（耳の頂点のうち、耳でない頂点ととなり合う所）と、そこから 1.2cm までの肌を、
# まわりの頂点の平均へ寄せる（耳の重みは 0 か 1 なので、耳を動かすと付け根に段ができる）。耳の外周は弱め、耳の中と目の玉は動かさない。動かすのは 3mm まで
_sk_e = np.array([any(g.group in (ob.vertex_groups["body"].index, ob.vertex_groups["hidden_by_clothes"].index) and g.weight > 0.5 for g in v.groups) for v in ob.data.vertices]) & ~_eyeb_f
_ed = np.zeros(len(ob.data.edges)*2, int); ob.data.edges.foreach_get("vertices", _ed); _ed = _ed.reshape(-1, 2)
_ed = _ed[_sk_e[_ed[:, 0]] & _sk_e[_ed[:, 1]]]
_ed_all = np.zeros(len(ob.data.edges)*2, int); ob.data.edges.foreach_get("vertices", _ed_all); _ed_all = _ed_all.reshape(-1, 2)
_ein = _ew > 0.5; _cross = _ed_all[_ein[_ed_all[:, 0]] != _ein[_ed_all[:, 1]]]
_root = np.zeros(_n, bool); _root[_cross.ravel()] = True; _root &= _ein          # 耳の外周
_rp = _cn[_root]
print("ear root verts", len(_rp))
_dn = np.full(_n, 1.0)
_near = np.abs(_cn[:, 0]) > 0.03                          # 頭の横だけ測る
for _i0 in range(0, _n, 2000):                            # 耳の付け根の頂点までの、いちばん近い距離
    _blk = np.arange(_i0, min(_n, _i0+2000)); _blk = _blk[_near[_blk]]
    if len(_blk) and len(_rp): _dn[_blk] = np.sqrt(((_cn[_blk, None, :]-_rp[None, :, :])**2).sum(-1)).min(1)
_we = np.where(_ein, 0.8*_root, 1-_ss(_dn/0.015))*_sk_e
_cnt = np.zeros(_n); np.add.at(_cnt, _ed[:, 0], 1); np.add.at(_cnt, _ed[:, 1], 1); _cnt = np.maximum(_cnt, 1)
_P = _cn.copy()
for _ in range(30):
    _acc = np.zeros((_n, 3)); np.add.at(_acc, _ed[:, 0], _P[_ed[:, 1]]); np.add.at(_acc, _ed[:, 1], _P[_ed[:, 0]])
    _P = _P+(_acc/_cnt[:, None]-_P)*0.5*_we[:, None]
_dd = _P-_cn; _ln = np.linalg.norm(_dd, axis=1); _dd *= np.minimum(1.0, 0.003/np.maximum(_ln, 1e-9))[:, None]
_kes = kb.get("custom-ear-smooth") or ob.shape_key_add(name="custom-ear-smooth", from_mix=False)
_kes.data.foreach_set("co", (_Bf.reshape(-1, 3)+_dd).ravel()); _kes.value = 1.0; ob.data.update()
_cn = _cn+_dd
print("ear tilt mm", round(EAR_LOBE_FWD*1000, 1), "| ear smooth max mm", round(float(np.abs(_dd).max())*1000, 2))
_nk = min(_wid(_zc-0.035+0.005*i, _zc-0.030+0.005*i, _ych+0.03) for i in range(7))     # 首のいちばん細い所（あごの下〜付け根）
_ns_ = _skn & (np.abs(_cn[:, 0]) < 0.07) & (np.abs(_cn[:, 2]-(_zc-0.02)) < 0.01)
_ycn = float((_cn[_ns_][:, 1].max()+_cn[_ns_][:, 1].min())/2)       # 首の前後の中心
_Zn = _cn[:, 2]
_tw = NECK_W                                              # めざす首の幅
_zs = np.arange(_zc-0.090, _zc+0.0151, 0.005)             # 高さごとの倍率（あご先の 9cm 下から 1.5cm 上まで）
_ks = np.array([min(1.5, max(1.0, _tw/_w_)) if _w_ > 0.03 else 1.0 for _w_ in (_wid(z-0.0025, z+0.0025, _ych+0.03) for z in _zs)])   # 測れない高さは 1 倍
for _ in range(3): _ks = np.convolve(np.pad(_ks, 1, mode='edge'), [0.25, 0.5, 0.25], mode='valid')    # 高さ方向になめらかに
_kv = np.interp(_Zn, _zs, _ks, left=1.0, right=1.0)
_wn = _ss((_Zn-(_zc-0.095))/0.015)*(1-_ss((_Zn-(_zc+0.005))/0.020))       # 端はなだらかに 0 へ
_wn *= np.where(_Zn > _zc-0.020, _ss((_cn[:, 1]-(_ych+0.025))/0.020), 1.0)   # あごの下は、あご先より後ろだけ（あご・口は動かさない）
_wn *= 1-_ss((np.abs(_cn[:, 0])-0.070)/0.030)                       # 肩は動かさない
_kk = 1+(_kv-1)*_wn
_Dn = np.zeros((_n, 3)); _Dn[:, 0] = _cn[:, 0]*(_kk-1); _Dn[:, 1] = (_cn[:, 1]-_ycn)*(_kk-1)*0.5
_Bn = np.zeros(_n*3); kb["Basis"].data.foreach_get("co", _Bn)
_knt = kb.get("custom-neck-thick") or ob.shape_key_add(name="custom-neck-thick", from_mix=False)
_knt.data.foreach_set("co", (_Bn.reshape(-1, 3)+_Dn).ravel()); _knt.value = 1.0; ob.data.update()
print("face narrow: jaw", round(_jaw, 4), "scale", round(FACE_K, 3), "| neck thick: neck", round(_nk, 4), "target", round(_tw, 4), "scale by height", np.round(_ks, 2).tolist())
# 眉：体全体の倍率（HEIGHT_S）を、床のまん中を支点にかける（前回の倍率との比だけ）
_br = bpy.data.objects["Girl_Brows"]; _rh = HEIGHT_S/_br.get("height_s", 1.0)
if abs(_rh-1) > 1e-6:
    _ks = _br.data.shape_keys.key_blocks if _br.data.shape_keys else []
    for _v in _br.data.vertices: _v.co *= _rh
    for _k in _ks:
        for _d in _k.data: _d.co *= _rh
    _br["height_s"] = HEIGHT_S; _br.data.update()
# 眉は、どのスクリプトも高さを動かさないので、体が上へ動いたぶんをここで動かす（前後は make_face_cute.py が肌に沿わせる）
BROW_DZ = -0.006                                         # 眉を下げる量（m）
_br = bpy.data.objects["Girl_Brows"]; _tz = ob["heel_shift"][2]+HEAD_DZ+BROW_DZ; _dz = _tz-_br.get("heel_z", 0.022)
if abs(_dz) > 1e-6:
    _ks = _br.data.shape_keys.key_blocks if _br.data.shape_keys else []
    for _v in _br.data.vertices: _v.co.z += _dz
    for _k in _ks:
        for _d in _k.data: _d.co.z += _dz
    _br["heel_z"] = _tz; _br.data.update()
# 眉を寄せる：左右とも内側（眉間側）へ。前後は make_face_cute.py が肌に沿わせ直す
BROW_DX = -0.0065                                        # 目を寄せたぶん（custom-eye-in・eye-trans-out）、眉も寄せる
_ddx = BROW_DX-_br.get("brow_dx", 0.0)
if abs(_ddx) > 1e-6:
    _ks = _br.data.shape_keys.key_blocks if _br.data.shape_keys else []
    for _v in _br.data.vertices: _v.co.x += _ddx*(1 if _v.co.x > 0 else -1)
    for _k in _ks:
        for _d in _k.data: _d.co.x += _ddx*(1 if _d.co.x > 0 else -1)
    _br["brow_dx"] = BROW_DX; _br.data.update()
# 眉の長さ：眉頭は動かさず、眉尻を目じりの BROW_TAIL_OUT 外までにする（長すぎて、眉尻が目じりの 2cm 以上外まで伸びていた）。
#   眉頭からの横の距離を、左右それぞれ同じ割合で縮める。前後は make_face_cute.py が肌に沿わせ直す。何度実行しても同じ長さになる
BROW_TAIL_OUT = 0.008
_Nb = bpy.data.materials["Skin"].node_tree.nodes
_eye_out = _Nb["LidCenter"].inputs["X"].default_value+0.016                 # 目じり（目の中心 + 目の玉の半径くらい）
_ks_b = _br.data.shape_keys.key_blocks if _br.data.shape_keys else []
for _sg in (1, -1):
    _vi = [v.index for v in _br.data.vertices if _sg*v.co.x > 0]
    _x = np.array([_sg*_br.data.vertices[i].co.x for i in _vi]); _head = float(_x.min()); _tail = float(_x.max())
    _kx = max(0.3, (_eye_out+BROW_TAIL_OUT-_head)/max(_tail-_head, 1e-4))
    if abs(_kx-1) < 1e-4: continue
    for i in _vi:
        v = _br.data.vertices[i]; v.co.x = _sg*(_head+(_sg*v.co.x-_head)*_kx)
        for _k in _ks_b: _d = _k.data[i]; _d.co.x = _sg*(_head+(_sg*_d.co.x-_head)*_kx)
    print("brow length", _sg, round(_tail-_head, 4), "->", round((_tail-_head)*_kx, 4))
# 眉尻を上げる（きりっと）：眉頭は動かさず、眉尻ほど上へ（眉尻で BROW_TAIL_UP）。前回の量との差だけ動かすので、何度実行しても同じ
BROW_TAIL_UP = 0.0025
_dup = BROW_TAIL_UP-_br.get("tail_up", 0.0)
if abs(_dup) > 1e-7:
    for _sg in (1, -1):
        _vi = [v.index for v in _br.data.vertices if _sg*v.co.x > 0]
        _x = np.array([_sg*_br.data.vertices[i].co.x for i in _vi]); _h0 = float(_x.min()); _t0 = float(_x.max())
        for i in _vi:
            _t = (_sg*_br.data.vertices[i].co.x-_h0)/max(_t0-_h0, 1e-4)
            _br.data.vertices[i].co.z += _dup*_t
            for _k in _ks_b: _k.data[i].co.z += _dup*_t
    _br["tail_up"] = BROW_TAIL_UP
_br.data.update()
_hs = ob["head_small"]; _piv = np.array(_hs[:3]); _ratio = _hs[3]/_br.get("head_s", 1.0)
if abs(_ratio-1) > 1e-6:
    _ks = _br.data.shape_keys.key_blocks if _br.data.shape_keys else []
    for _v in _br.data.vertices: _v.co = list(_piv+(np.array(_v.co)-_piv)*_ratio)
    for _k in _ks:
        for _d in _k.data: _d.co = list(_piv+(np.array(_d.co)-_piv)*_ratio)
    _br["head_s"] = _hs[3]; _br.data.update()

# 髪の土台：頭の実寸（左右 ±8.1cm・前後 ±8.9cm）に沿わせる。毛先はあごの下、前髪は眉の高さ
_hsh = np.array(ob["heel_shift"]); _cw = np.array([0.0, -0.056+HEAD_DY, 1.52+HEAD_DZ])*HEIGHT_S+_hsh      # 頭の中心（実際の位置。身長の倍率をかける）
_cw = HEAD_PIV+(_cw-HEAD_PIV)*HEAD_S                                                          # 小顔で縮めたぶん、中心も動かす
_hk = HEIGHT_S*HEAD_S/0.93                               # 頭の大きさの、3 人目（RX などの値を決めたとき）に対する比
# 頭の幅（SKULL_K）と、後頭部を前へ寄せたぶん（SKULL_BACK_K）も、髪の土台に入れる（入れないと、髪の流れの毛束が頭から浮いて折れる）
_ryk = 0.100*_hk; _rback = _ryk*(1-SKULL_BACK_K)*0.5                # 前後の半径の、後ろが縮んだぶんの半分
_cw = _cw+np.array([0.0, -_rback, 0.0])
p = ob["hair_params"].to_dict(); p.update(RX=0.091*_hk*(1+SKULL_K)/2, RY=_ryk-_rback, RZ=0.098*_hk, C=list(_cw-_hsh), ZB=float(HEAD_PIV[2])-_hsh[2]+0.010, BANG=50); ob["hair_params"] = p

# 目：切れ長。目じりはほとんど上げない（上げると釣り目すぎた）
EYE_DOWN = 5.2                                           # 目の高さ（下げる量のシェイプキー。元の値は 2.8）
for k, v in {"l-eye-height2-incr": 0.0, "r-eye-height2-incr": 0.0, "l-eye-height2-decr": 0.30, "r-eye-height2-decr": 0.30, "l-eye-scale-incr": 0.5, "r-eye-scale-incr": 0.5,
             "l-eye-corner2-up": 0.1, "r-eye-corner2-up": 0.1, "l-eye-height1-incr": 0.0, "r-eye-height1-incr": 0.0,
             "l-eye-trans-out": 0.0, "r-eye-trans-out": 0.0, "l-eye-trans-down": EYE_DOWN, "r-eye-trans-down": EYE_DOWN,
             "l-eye-corner1-down": 0.0, "r-eye-corner1-down": 0.0}.items():     # 目じりを下げるキーは使わない（元の 2.9 でも 1.0 でも、目じりの外に皺ができた）
    kb[k].slider_max = max(kb[k].slider_max, v); kb[k].value = v
run("fit_face.py", {"EYE_SX": 0.0, "EYE_SZ": 0.0, "EYE_BALL": 0.0, "EYE_TILT": 0.0, "BANG_DZ": 0.030})      # 前髪は眉の上で切る（眉がきちんと見えるように）

# 目の輪郭をアーモンド形に（custom-eye-almond）：下まぶたの外側を持ち上げ、上まぶたの目じり側を少し下ろして、
# 目じりで上下の線が細く閉じるようにする（下まぶたが外へ流れて、目じりの先に白目がはみ出していた）。
# まつ毛・アイラインの線は、このあとの make_face_cute.py が実際の目の開きに合わせ直す
EYE_LOW_OUT_UP = 0.0; EYE_UP_OUT_DOWN = 0.0      # アーモンド形にはしない（目じりの外へ折れ目がのびた）
if "custom-eye-almond" in kb: kb["custom-eye-almond"].value = 0.0
_rig = bpy.data.objects["Girl_Rig"]; _was = _rig.data.pose_position; _rig.data.pose_position = 'REST'
_mk = next(m for m in ob.modifiers if m.type == 'MASK'); _mk.show_viewport = False; bpy.context.view_layer.update()
_ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); _m = _ev.to_mesh()
_co = np.zeros(len(_m.vertices)*3); _m.vertices.foreach_get("co", _co); _ev.to_mesh_clear(); _co = _co.reshape(-1, 3)
_mk.show_viewport = True; _rig.data.pose_position = _was
_N = bpy.data.materials["Skin"].node_tree.nodes
_EX = _N["LidCenter"].inputs["X"].default_value; _EZ = _N["LidCenter"].inputs["Z"].default_value
def _crv(mn, dx):
    n = bpy.data.materials[mn].node_tree.nodes
    return n["Math.004"].inputs[1].default_value*dx*dx+n["LashSlope"].inputs[1].default_value*dx+n["LashBase"].inputs[1].default_value
_eg = {ob.vertex_groups[n].index for n in ("helper-l-eye", "helper-r-eye")}
_ball = np.array([any(g.group in _eg and g.weight > 0.5 for g in v.groups) for v in ob.data.vertices])
_dx = np.abs(_co[:, 0])-_EX; _Z = _co[:, 2]; _Y = _co[:, 1]
_up = _EZ+_crv("Lash", _dx); _lo = _EZ+_crv("LashLower", _dx); _mid = (_up+_lo)/2
_fall = (1-_ss((np.hypot(_dx, _Z-_EZ)-0.016)/0.012))*(_Y < -0.07)*(~_ball)
_dz = np.where(_Z < _mid,
               EYE_LOW_OUT_UP*_ss((_dx-0.003)/0.011)*np.where(_Z < _lo, 1-_ss((_lo-_Z)/0.010), 1.0),
               -EYE_UP_OUT_DOWN*_ss((_dx-0.005)/0.010)*np.where(_Z > _up, 1-_ss((_Z-_up)/0.008), 1.0))*_fall
_Bk = np.zeros(_n*3); kb["Basis"].data.foreach_get("co", _Bk)
_ka = kb.get("custom-eye-almond") or ob.shape_key_add(name="custom-eye-almond", from_mix=False)
_D2 = np.zeros((_n, 3)); _D2[:, 2] = _dz; _D2[:, 1] = -1.0*np.maximum(_dz, 0)     # 持ち上げた下まぶたは前へも出す（目の玉が透けないように）
_ka.data.foreach_set("co", (_Bk.reshape(-1, 3)+_D2).ravel()); _ka.value = 1.0; ob.data.update()

# 額を短く（custom-forehead-short）：眉より上の頭を、眉の高さを基準に縦へ縮める（目・眉の位置は変えない）。髪の土台もそのぶん下げる
FOREHEAD_F = 0.85
if "custom-forehead-short" in kb: kb["custom-forehead-short"].value = 0.0
_rig.data.pose_position = 'REST'; _mk.show_viewport = False; bpy.context.view_layer.update()
_ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); _m = _ev.to_mesh()
_co = np.zeros(len(_m.vertices)*3); _m.vertices.foreach_get("co", _co); _ev.to_mesh_clear(); _co = _co.reshape(-1, 3)
_mk.show_viewport = True; _rig.data.pose_position = _was
_Zb = _EZ+0.017                                          # 眉の高さ
_D3 = np.zeros((_n, 3)); _D3[:, 2] = -(1-FOREHEAD_F)*np.maximum(0.0, _co[:, 2]-_Zb)*(_co[:, 2] > 1.40)
_kf = kb.get("custom-forehead-short") or ob.shape_key_add(name="custom-forehead-short", from_mix=False)
_kf.data.foreach_set("co", (_Bk.reshape(-1, 3)+_D3).ravel()); _kf.value = 1.0; ob.data.update()
_hp0 = ob["hair_params"].to_dict(); _ctop = _hp0["C"][2]+ob["heel_shift"][2]+_hp0["RZ"]
_hp0["RZ"] = _hp0["RZ"]-(1-FOREHEAD_F)*(_ctop-_Zb); ob["hair_params"] = _hp0
print("forehead shortened: top moved mm", round(float(-_D3[:, 2].min())*1000, 1), "hair RZ", round(_hp0["RZ"], 4))

# 目頭のしわをならす（custom-eyein-smooth）：目頭から鼻のわきへの段差（縦の筋）と、目頭の下の折れ目。
# 目の開いている所（まぶたのふち）と目の玉は動かさず、目頭より鼻側の肌だけを、まわりの頂点の平均へ寄せる
if "custom-eyein-smooth" in kb: kb["custom-eyein-smooth"].value = 0.0
_rig.data.pose_position = 'REST'; _mk.show_viewport = False; bpy.context.view_layer.update()
_ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); _m = _ev.to_mesh()
_co = np.zeros(len(_m.vertices)*3); _m.vertices.foreach_get("co", _co); _ev.to_mesh_clear(); _co = _co.reshape(-1, 3)
_mk.show_viewport = True; _rig.data.pose_position = _was
_names = [s.name for s in ob.material_slots]; _sk = np.zeros(_n, bool)
for _p in ob.data.polygons:
    if _names[_p.material_index] == "Skin": _sk[list(_p.vertices)] = True
_bi = ob.vertex_groups["body"].index
_sk &= np.array([any(g.group == _bi and g.weight > 0.5 for g in v.groups) for v in ob.data.vertices]) & ~_ball
_dx = np.abs(_co[:, 0])-_EX; _Z = _co[:, 2]; _Y = _co[:, 1]
_we = np.exp(-(((_dx+0.020)/0.010)**2+((_Z-(_EZ-0.004))/0.013)**2))*_ss((-0.0125-_dx)/0.004)*(_Y < -0.09)*_sk
_we[_we < 0.02] = 0
_ed = np.zeros(len(ob.data.edges)*2, int); ob.data.edges.foreach_get("vertices", _ed); _ed = _ed.reshape(-1, 2)
_ed = _ed[_sk[_ed[:, 0]] & _sk[_ed[:, 1]]]
_cnt = np.zeros(_n); np.add.at(_cnt, _ed[:, 0], 1); np.add.at(_cnt, _ed[:, 1], 1); _cnt = np.maximum(_cnt, 1)
_P = _co.copy()
for _ in range(30):
    _acc = np.zeros((_n, 3)); np.add.at(_acc, _ed[:, 0], _P[_ed[:, 1]]); np.add.at(_acc, _ed[:, 1], _P[_ed[:, 0]])
    _P = _P+(_acc/_cnt[:, None]-_P)*0.5*_we[:, None]
_dd = _P-_co; _ln = np.linalg.norm(_dd, axis=1); _dd *= np.minimum(1.0, 0.002/np.maximum(_ln, 1e-9))[:, None]
_ke = kb.get("custom-eyein-smooth") or ob.shape_key_add(name="custom-eyein-smooth", from_mix=False)
_ke.data.foreach_set("co", (_Bk.reshape(-1, 3)+_dd).ravel()); _ke.value = 1.0; ob.data.update()
print("eye-inner smooth max mm", round(float(np.abs(_dd).max())*1000, 2))

# 口まわりのしわをならす（custom-mouth-smooth）：小鼻のわきから口角の外を通ってあごへ下りる影の線、唇のまわりの盛り上がり、
# 下唇の下の横のくぼみ。唇そのものは動かさず、まわりの肌だけを、まわりの頂点の平均へ寄せる。鼻と口を下げたあとの位置で計算する
for _kn, _kv in (("nose-trans-up", -1.1), ("mouth-trans-up", 0.30)):
    kb[_kn].slider_min = min(kb[_kn].slider_min, _kv); kb[_kn].value = _kv
if "custom-mouth-smooth" in kb: kb["custom-mouth-smooth"].value = 0.0
_rig.data.pose_position = 'REST'; _mk.show_viewport = False; bpy.context.view_layer.update()
_ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); _m = _ev.to_mesh()
_co = np.zeros(len(_m.vertices)*3); _m.vertices.foreach_get("co", _co); _ev.to_mesh_clear(); _co = _co.reshape(-1, 3)
_mk.show_viewport = True; _rig.data.pose_position = _was
_names = [s.name for s in ob.material_slots]; _skin = np.zeros(_n, bool); _lip = np.zeros(_n, bool)
for _p in ob.data.polygons:
    if _names[_p.material_index] == "Skin": _skin[list(_p.vertices)] = True
    if _names[_p.material_index] == "Lips": _lip[list(_p.vertices)] = True
_skin &= ~_lip
_bi = ob.vertex_groups["body"].index; _mi = _names.index("MouthInner")
_vis = np.array([any(g.group == _bi and g.weight > 0.5 for g in v.groups) for v in ob.data.vertices])   # 体の中の補助の頂点は除く
_inner = np.zeros(_n, bool)
for _p in ob.data.polygons:
    if _p.material_index == _mi: _inner[list(_p.vertices)] = True                                     # 口の中の縁も除く
_skin &= _vis & ~_inner
_AX = np.abs(_co[:, 0]); _Z = _co[:, 2]; _Y = _co[:, 1]
_ZC = float(_co[_lip][:, 2].mean())
_wm = _ss((0.058-_AX)/0.012)*_ss((_Z-(_ZC-0.040))/0.010)*_ss((_ZC+0.024-_Z)/0.008)*_ss((-0.132-_Y)/0.006)*_skin   # 口角の奥（唇の内側へ巻き込む所）は除く
_ed = np.zeros(len(ob.data.edges)*2, int); ob.data.edges.foreach_get("vertices", _ed); _ed = _ed.reshape(-1, 2)
_ok = _skin | _lip; _ed = _ed[_ok[_ed[:, 0]] & _ok[_ed[:, 1]]]
_cnt = np.zeros(_n); np.add.at(_cnt, _ed[:, 0], 1); np.add.at(_cnt, _ed[:, 1], 1); _cnt = np.maximum(_cnt, 1)
_P = _co.copy()
for _ in range(40):
    _acc = np.zeros((_n, 3)); np.add.at(_acc, _ed[:, 0], _P[_ed[:, 1]]); np.add.at(_acc, _ed[:, 1], _P[_ed[:, 0]])
    _P = _P+(_acc/_cnt[:, None]-_P)*0.5*_wm[:, None]
_dd = _P-_co; _ln = np.linalg.norm(_dd, axis=1); _dd *= np.minimum(1.0, 0.003/np.maximum(_ln, 1e-9))[:, None]; _P = _co+_dd   # 動かすのは 3mm まで
_km = kb.get("custom-mouth-smooth") or ob.shape_key_add(name="custom-mouth-smooth", from_mix=False)
_km.data.foreach_set("co", (_Bk.reshape(-1, 3)+(_P-_co)).ravel()); _km.value = 1.0; ob.data.update()
print("mouth smooth max mm", round(float(np.abs(_P-_co).max())*1000, 2))

# 輪郭・鼻・口
KEYS = {"head-round": 0.5, "head-oval": 0.45, "custom-cheek-puff": 0.25, "l-cheek-volume-incr": 0.55, "r-cheek-volume-incr": 0.55,
        "chin-height-decr": 0.55, "custom-jaw-slim": 0.50, "chin-width-decr": 0.38, "head-invertedtriangular": 0.05, "mouth-angles-up": 0.10,
        "nose-scale-vert-decr": 0.45, "nose-point-up": 0.35, "nose-scale-depth-incr": 0.0, "nose-scale-depth-decr": 0.25, "nose-greek-incr": 0.10,   # 鼻は低めに "nose-scale-horiz-decr": 0.75,
        "mouth-scale-horiz-decr": 0.40, "mouth-upperlip-volume-incr": 0.0, "mouth-lowerlip-volume-incr": 0.10, "mouth-trans-backward": 0.90,
        "mouth-scale-vert-decr": 0.15, "l-cheek-inner-incr": 0.0, "r-cheek-inner-incr": 0.0,
        "nose-trans-up": -1.1, "mouth-trans-up": 0.30}           # 鼻と口を下げる（元は鼻 -0.6・口 0.85）
run("make_face_cute.py", {"KEYS": KEYS, "LIP_LOWER_UP": 0.0032, "LIP_UPPER_DOWN": 0.0030, "CHEEKBONE": 0.0, "CHEEK_OUT": 0.0,
                          "EYE_IN_DOWN": 0.0025, "EYE_OUT_UP": 0.0034, "EYE_LOW_IN_UP": 0.0030,
                          "FOREHEAD": 0.0020, "TEMPLE_IN": 0.0020})       # 額の盛り上げは弱く（額を縮めたので、元の 6mm だと額の上が出っぱる）

# 頭の上を丸く（custom-skull-round）：額を縦に縮めると、額の上とてっぺんの後ろに角ができるので、眉より上の頭をならして丸める
if "custom-skull-round" in kb: kb["custom-skull-round"].value = 0.0
_rig.data.pose_position = 'REST'; _mk.show_viewport = False; bpy.context.view_layer.update()
_ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); _m = _ev.to_mesh()
_co = np.zeros(len(_m.vertices)*3); _m.vertices.foreach_get("co", _co); _ev.to_mesh_clear(); _co = _co.reshape(-1, 3)
_mk.show_viewport = True; _rig.data.pose_position = _was
_ws = _ss((_co[:, 2]-(_Zb+0.008))/0.045)*(1-_ew)*_sk       # 眉の 1.2cm 上から上へ。耳は動かさない
_ed = np.zeros(len(ob.data.edges)*2, int); ob.data.edges.foreach_get("vertices", _ed); _ed = _ed.reshape(-1, 2)
_ed = _ed[_sk[_ed[:, 0]] & _sk[_ed[:, 1]]]
_cnt = np.zeros(_n); np.add.at(_cnt, _ed[:, 0], 1); np.add.at(_cnt, _ed[:, 1], 1); _cnt = np.maximum(_cnt, 1)
_P = _co.copy()
for _ in range(25):
    _acc = np.zeros((_n, 3)); np.add.at(_acc, _ed[:, 0], _P[_ed[:, 1]]); np.add.at(_acc, _ed[:, 1], _P[_ed[:, 0]])
    _P = _P+(_acc/_cnt[:, None]-_P)*0.5*_ws[:, None]
_dd = _P-_co; _ln = np.linalg.norm(_dd, axis=1); _dd *= np.minimum(1.0, 0.008/np.maximum(_ln, 1e-9))[:, None]
_ks2 = kb.get("custom-skull-round") or ob.shape_key_add(name="custom-skull-round", from_mix=False)
_ks2.data.foreach_set("co", (_Bk.reshape(-1, 3)+_dd).ravel()); _ks2.value = 1.0; ob.data.update()
print("skull round max mm", round(float(np.abs(_dd).max())*1000, 2))

# こめかみをならす（custom-temple-smooth）：目じりの横から耳の前・上の、くぼみと段差の筋。耳・目・まつ毛は動かさない
if "custom-temple-smooth" in kb: kb["custom-temple-smooth"].value = 0.0
_rig.data.pose_position = 'REST'; _mk.show_viewport = False; bpy.context.view_layer.update()
_ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); _m = _ev.to_mesh()
_co = np.zeros(len(_m.vertices)*3); _m.vertices.foreach_get("co", _co); _ev.to_mesh_clear(); _co = _co.reshape(-1, 3)
_mk.show_viewport = True; _rig.data.pose_position = _was
_AXt = np.abs(_co[:, 0]); _Zt = _co[:, 2]; _Yt = _co[:, 1]
_wt = _ss((_AXt-0.050)/0.012)*_ss((_Zt-(_EZ-0.025))/0.012)*_ss((_EZ+0.070-_Zt)/0.020)*_ss((0.010-_Yt)/0.020)*(1-_ss(_ew*3))*_sk
_ear = np.zeros(_n, bool); _ear[_ew > 0.05] = True          # 耳のまわりの頂点は、ならす相手にも入れない
_skt = _sk & ~_ear
_ed = np.zeros(len(ob.data.edges)*2, int); ob.data.edges.foreach_get("vertices", _ed); _ed = _ed.reshape(-1, 2)
_ed = _ed[_skt[_ed[:, 0]] & _skt[_ed[:, 1]]]
_cnt = np.zeros(_n); np.add.at(_cnt, _ed[:, 0], 1); np.add.at(_cnt, _ed[:, 1], 1); _cnt = np.maximum(_cnt, 1)
_wt *= _skt
_P = _co.copy()
for _ in range(35):
    _acc = np.zeros((_n, 3)); np.add.at(_acc, _ed[:, 0], _P[_ed[:, 1]]); np.add.at(_acc, _ed[:, 1], _P[_ed[:, 0]])
    _P = _P+(_acc/_cnt[:, None]-_P)*0.5*_wt[:, None]
_dd = _P-_co; _ln = np.linalg.norm(_dd, axis=1); _dd *= np.minimum(1.0, 0.004/np.maximum(_ln, 1e-9))[:, None]
_kt = kb.get("custom-temple-smooth") or ob.shape_key_add(name="custom-temple-smooth", from_mix=False)
_kt.data.foreach_set("co", (_Bk.reshape(-1, 3)+_dd).ravel()); _kt.value = 1.0; ob.data.update()
print("temple smooth max mm", round(float(np.abs(_dd).max())*1000, 2))

# 目じりと輪郭をならす（custom-eyeout-smooth・custom-jaw-smooth）。顔の形を何段も重ねて変えたので、つなぎ目に折れ目やこぶが残った：
#   目じり … 目の形（アーモンド形・目じりを上げる）が重なって、目じりのまぶたのふちが外へ突き出し、横へ折れ目がのびていた
#   輪郭 … 耳たぶの下から、あごの角を通って首へ下りる所に、縦のこぶと横のくぼみがあった
#   どちらも、まわりの頂点の平均へ寄せる。目の玉・耳・唇は動かさない
def _smooth_key(name, w, iters, limit):
    if name in kb: kb[name].value = 0.0
    _rig.data.pose_position = 'REST'; _mk.show_viewport = False; bpy.context.view_layer.update()
    _ev2 = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); _m2 = _ev2.to_mesh()
    _c2 = np.zeros(len(_m2.vertices)*3); _m2.vertices.foreach_get("co", _c2); _ev2.to_mesh_clear(); _c2 = _c2.reshape(-1, 3)
    _mk.show_viewport = True; _rig.data.pose_position = _was
    ww = w(_c2)*_sk*(_ew < 0.05)
    ed = np.zeros(len(ob.data.edges)*2, int); ob.data.edges.foreach_get("vertices", ed); ed = ed.reshape(-1, 2)
    ok = _sk & (_ew < 0.5); ed = ed[ok[ed[:, 0]] & ok[ed[:, 1]]]
    cnt = np.zeros(_n); np.add.at(cnt, ed[:, 0], 1); np.add.at(cnt, ed[:, 1], 1); cnt = np.maximum(cnt, 1)
    P = _c2.copy()
    for _ in range(iters):
        acc = np.zeros((_n, 3)); np.add.at(acc, ed[:, 0], P[ed[:, 1]]); np.add.at(acc, ed[:, 1], P[ed[:, 0]])
        P = P+(acc/cnt[:, None]-P)*0.5*ww[:, None]
    dd = P-_c2; ln = np.linalg.norm(dd, axis=1); dd *= np.minimum(1.0, limit/np.maximum(ln, 1e-9))[:, None]
    k = kb.get(name) or ob.shape_key_add(name=name, from_mix=False)
    k.data.foreach_set("co", (_Bk.reshape(-1, 3)+dd).ravel()); k.value = 1.0; ob.data.update()
    print(name, "max mm", round(float(np.abs(dd).max())*1000, 2))
_lips_v = np.zeros(_n, bool)
for _p in ob.data.polygons:
    if ob.material_slots[_p.material_index].name in ("Lips", "MouthInner"): _lips_v[list(_p.vertices)] = True
_Nn2 = bpy.data.materials["Skin"].node_tree.nodes
_EXo = _Nn2["LidCenter"].inputs["X"].default_value; _EZo = _Nn2["LidCenter"].inputs["Z"].default_value
EYEOUT_SMOOTH = False                                     # 目じりのならしは使わない（まぶたの肌が動いて、目じりに目の玉の白がのぞいた）
if "custom-eyeout-smooth" in kb: kb["custom-eyeout-smooth"].value = 0.0
if EYEOUT_SMOOTH: _smooth_key("custom-eyeout-smooth",
            lambda c: (lambda dx: _ss((dx-0.010)/0.004)*(1-_ss((dx-0.032)/0.010))*(1-_ss((np.abs(c[:, 2]-(_EZo+0.002))-0.012)/0.008))*(c[:, 1] < -0.06))(np.abs(c[:, 0])-_EXo)*(~_ball),
            30, 0.0020)                                   # 強くすると、まぶたの肌が動いて目の玉（白）が見えた
_zc2 = float(ob["head_small"][2]); _MZ2 = bpy.data.materials["Lips"].node_tree.nodes["MkSub"].inputs[1].default_value
_eary = float(np.mean([_Bk.reshape(-1, 3)[i][1] for i in np.nonzero(_ew > 0.5)[0]])) if (_ew > 0.5).any() else -0.06
_smooth_key("custom-jaw-smooth",
            lambda c: _ss((np.abs(c[:, 0])-0.025)/0.015)*_ss((c[:, 2]-(_zc2-0.045))/0.015)*(1-_ss((c[:, 2]-(_MZ2+0.005))/0.012))
                      *_ss((c[:, 1]-(_eary-0.060))/0.015)*(1-_ss((c[:, 1]-(_eary+0.045))/0.015))*(~_lips_v),
            40, 0.004)
# 下まぶたの棚をならす（custom-lowlid-smooth）：下まぶたのふちの下が、目の玉より前へ棚のように張り出して、白っぽい帯に見えた。
#   目の玉にくっついたふち（目の玉の表面から 1.5mm 以内）は動かさず、その下 1.6cm までの肌をならす
_eyc = {}
for _sg in (1, -1):
    _ebm = _ball & (_sg*_co[:, 0] > 0)
    if _ebm.any(): _eyc[_sg] = (_co[_ebm].mean(0), float(np.linalg.norm(_co[_ebm]-_co[_ebm].mean(0), axis=1).max()))
def _lowlid_w(c):
    w = np.zeros(len(c))
    for sg, (ce, R) in _eyc.items():
        dz = ce[2]-c[:, 2]; dx = np.abs(c[:, 0]-ce[0])
        band = _ss((dz-0.002)/0.003)*(1-_ss((dz-0.016)/0.004))*(1-_ss((dx-0.016)/0.006))*(sg*c[:, 0] > 0)*(c[:, 1] < ce[1])
        pin = _ss((np.linalg.norm(c-ce, axis=1)-R-0.0015)/0.0015)
        w = np.maximum(w, band*pin)
    return w*(~_ball)
_smooth_key("custom-lowlid-smooth", _lowlid_w, 40, 0.0025)

# まぶたのふち（まつ毛の材質の頂点と、目の玉の表面から 2mm 以内）は、下のならしで動かさない
_lidpin = np.zeros(_n, bool)
for _p in ob.data.polygons:
    if ob.material_slots[_p.material_index].name in ("Lash", "LashLower"): _lidpin[list(_p.vertices)] = True
def _nearball(c, gap):
    m = np.zeros(len(c), bool)
    for sg, (ce, R) in _eyc.items(): m |= np.linalg.norm(c-ce, axis=1) < R+gap
    return m
# 目じりと目頭の折れ目・横線をならす（custom-eyecorner-smooth）：目じりの外 2.5cm と、目頭から鼻のわきまで。まぶたのふちは止める
def _corner_w(c):
    w = np.zeros(len(c))
    for sg, (ce, R) in _eyc.items():
        dx = sg*(c[:, 0]-ce[0]); dz = np.abs(c[:, 2]-(ce[2]+0.001))
        outer = _ss((dx-0.012)/0.004)*(1-_ss((dx-0.034)/0.008))*(1-_ss((dz-0.010)/0.006))
        inner = _ss((-dx-0.010)/0.004)*(1-_ss((-dx-0.026)/0.006))*(1-_ss((dz-0.012)/0.006))
        w = np.maximum(w, (outer+inner)*(sg*c[:, 0] > 0)*(c[:, 1] < ce[1]+0.01))
    return np.clip(w, 0, 1)*(~_lidpin)*(~_nearball(c, 0.002))*(~_ball)
_smooth_key("custom-eyecorner-smooth", _corner_w, 50, 0.0030)

# まぶたのふちの形を作り直す（custom-lidcorner）：目頭と目じりで、上まぶたのふちの終わりが折れて皺・横線に見えた。
#   まつ毛の両端（目頭・目じり）から LID_R 以内の肌とまぶたのふち（目の玉は除く）を、まわりの頂点の平均へ寄せてならす。
#   そのとき、各頂点の目の玉の中心からの距離は変えない（目の玉の表面に沿ってだけ動かす）ので、まぶたが目から浮いたり、
#   すき間が開いて白目がのぞいたりしない
LID_R = 0.009
if "custom-lidcorner" in kb: kb["custom-lidcorner"].value = 0.0
_rig.data.pose_position = 'REST'; _mk.show_viewport = False; bpy.context.view_layer.update()
_evl = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); _mlc = _evl.to_mesh()
_cl = np.zeros(len(_mlc.vertices)*3); _mlc.vertices.foreach_get("co", _cl); _evl.to_mesh_clear(); _cl = _cl.reshape(-1, 3)
_mk.show_viewport = True; _rig.data.pose_position = _was
_lw = np.zeros(_n); _lc_ce = np.zeros((_n, 3))
for _sg, (_ce, _R) in _eyc.items():
    _ls = _lidpin & (_sg*_cl[:, 0] > 0)
    if not _ls.any(): continue
    _lp = _cl[_ls]
    for _cor in (_lp[np.argmax(_sg*_lp[:, 0])], _lp[np.argmin(_sg*_lp[:, 0])]):     # 目じり・目頭
        _w = 1-_ss((np.linalg.norm(_cl-_cor, axis=1)-0.003)/(LID_R-0.003))
        _w *= (_sg*_cl[:, 0] > 0)
        _upd = _w > _lw; _lw[_upd] = _w[_upd]; _lc_ce[_upd] = _ce
_okl = (_sk | _lidpin) & ~_ball
_lw *= _okl
_edl = np.zeros(len(ob.data.edges)*2, int); ob.data.edges.foreach_get("vertices", _edl); _edl = _edl.reshape(-1, 2)
_edl = _edl[_okl[_edl[:, 0]] & _okl[_edl[:, 1]]]
_cnl = np.zeros(_n); np.add.at(_cnl, _edl[:, 0], 1); np.add.at(_cnl, _edl[:, 1], 1); _cnl = np.maximum(_cnl, 1)
_r0 = np.linalg.norm(_cl-_lc_ce, axis=1)                    # 目の玉の中心からの距離（これを保つ）
_P = _cl.copy(); _act = _lw > 0
for _ in range(40):
    _acc = np.zeros((_n, 3)); np.add.at(_acc, _edl[:, 0], _P[_edl[:, 1]]); np.add.at(_acc, _edl[:, 1], _P[_edl[:, 0]])
    _P = _P+(_acc/_cnl[:, None]-_P)*0.5*_lw[:, None]
    _v = _P[_act]-_lc_ce[_act]; _P[_act] = _lc_ce[_act]+_v/np.maximum(np.linalg.norm(_v, axis=1), 1e-9)[:, None]*_r0[_act][:, None]
_dl = _P-_cl; _ln = np.linalg.norm(_dl, axis=1); _dl *= np.minimum(1.0, 0.0025/np.maximum(_ln, 1e-9))[:, None]
_klc = kb.get("custom-lidcorner") or ob.shape_key_add(name="custom-lidcorner", from_mix=False)
_klc.data.foreach_set("co", (_Bk.reshape(-1, 3)+_dl).ravel()); _klc.value = 1.0; ob.data.update()
print("lid corner max mm", round(float(_ln.max())*1000, 2), "verts", int(_act.sum()))

# ほお骨（custom-cheekbone-under）：目の真下（目の中心の 2.6cm 下・少し外）に、なだらかな高まりを作る。
#   共通の make_face_cute.py のほお骨は目じりの外にあり、横へも張り出させていた（CHEEKBONE・CHEEK_OUT を 0 にして使わない）
CHEEKBONE_UNDER = 0.0030
if "custom-cheekbone-under" in kb: kb["custom-cheekbone-under"].value = 0.0
_Dcb = np.zeros((_n, 3))
for _sg, (_ce, _R) in _eyc.items():
    _w = np.exp(-(((_sg*(_co[:, 0]-_ce[0])-0.006)/0.016)**2+((_co[:, 2]-(_ce[2]-0.026))/0.013)**2))*(_sg*_co[:, 0] > 0)*(_co[:, 1] < -0.06)*_sk*(~_ball)
    _w[_w < 0.02] = 0
    _dir = np.array([_sg*0.25, -1.0, 0.15]); _dir /= np.linalg.norm(_dir)
    _Dcb += _w[:, None]*_dir*CHEEKBONE_UNDER
_kcb = kb.get("custom-cheekbone-under") or ob.shape_key_add(name="custom-cheekbone-under", from_mix=False)
_kcb.data.foreach_set("co", (_Bk.reshape(-1, 3)+_Dcb).ravel()); _kcb.value = 1.0; ob.data.update()

# ほおからあごの輪郭をならす（custom-cheekjaw-smooth）：顔の形を何段も重ねて変えたので、ほおの横〜あごの線が波打っていた。
#   目の下 1.5cm から、あごの下まで。鼻・唇・目のまわり・耳は動かさない
_smooth_key("custom-cheekjaw-smooth",
            lambda c: _ss((np.abs(c[:, 0])-0.028)/0.012)*_ss((_EZo-0.015-c[:, 2])/0.010)*_ss((c[:, 2]-(_zc2-0.035))/0.012)
                      *(c[:, 1] < _eary+0.010)*(~_lips_v)*(~_nearball(c, 0.006)),
            60, 0.0045)
run("bake_face_pos.py", {})                             # 顔の模様の位置を書き直す

# メイク
N = bpy.data.materials["Skin"].node_tree.nodes
for i in (0, 1): N[f"MkMole{i}Fall"].inputs["To Min"].default_value = 0.0          # ほくろなし
N["CheekCenter"].inputs[1].default_value[2] = 1.467+ob["heel_shift"][2]+HEAD_DZ                                 # チークは高めに、控えめに
N["CheekFalloff"].inputs["To Min"].default_value = 0.17
N["CheekMix"].inputs[7].default_value = (0.90, 0.48, 0.47, 1)
L = bpy.data.materials["Lips"].node_tree.nodes; lb = next(n for n in L if n.type == "BSDF_PRINCIPLED")
L["MkMix"].inputs[6].default_value = (0.70, 0.32, 0.32, 1); L["MkMix"].inputs[7].default_value = (0.84, 0.50, 0.47, 1)    # ローズベージュ
lb.inputs["Coat Weight"].default_value = 0.22; lb.inputs["Roughness"].default_value = 0.36   # 少しつや
n = bpy.data.materials["LashLower"].node_tree.nodes["LashLen"]                       # 下まつ毛は、ほとんど見えない長さに
n.inputs["To Min"].default_value = -0.0005; n.inputs["To Max"].default_value = -0.0011
br = bpy.data.materials["Brow"]; bb = next(x for x in br.node_tree.nodes if x.type == "BSDF_PRINCIPLED")
bb.inputs["Base Color"].default_value = (0.07, 0.05, 0.04, 1); br.diffuse_color = (0.07, 0.05, 0.04, 1)      # 黒に近いこげ茶（髪に合わせる）
n = bpy.data.materials["Lash"].node_tree.nodes["LashLen"]                            # 上まつ毛も控えめに
n.inputs["To Min"].default_value = 0.0016; n.inputs["To Max"].default_value = 0.0034
N["MkWingMix"].inputs[7].default_value = (0.14, 0.09, 0.075, 1)                        # 目じりのラインは控えめに（濃くすると目じりが切れこんで見えた）
# アイシャドウ：上まぶたにブラウン（まぶた全体に淡いベージュ、目のきわと目じり側を少し濃く）
N["MkShadowMix"].inputs[7].default_value = (0.80, 0.56, 0.46, 1); N["MkShadowFall"].inputs[3].default_value = 0.30
N["MkShadow2Mix"].inputs[7].default_value = (0.55, 0.33, 0.24, 1); N["MkShadow2Fall"].inputs[3].default_value = 0.28
# 太さは半分：縦のつぶし具合を 2 倍にし、まつ毛のきわから離れないよう中心を下げる
_EXs = N["LidCenter"].inputs["X"].default_value; _EZs = N["LidCenter"].inputs["Z"].default_value
N["MkShadowScl"].inputs[1].default_value = (1.0, 0.0, 2.9); N["MkShadowSub"].inputs[1].default_value = (_EXs+0.003, 0.0, _EZs+0.0055)
N["MkShadow2Scl"].inputs[1].default_value = (1.0, 0.0, 2.8); N["MkShadow2Sub"].inputs[1].default_value = (_EXs+0.021, 0.0, _EZs+0.0040)
# 黒目：瞳の色の帯（目の玉の中心からの角度）の大きさ。この子は小さくしすぎない（3 人目は 0.88）。元の位置は下の表
IRIS_SCALE = 0.88
_ir = bpy.data.materials["Eye"].node_tree.nodes["IrisRamp"].color_ramp.elements
for _e, _p0 in zip(_ir, (0.0, 0.178, 0.201, 0.29, 0.38, 0.466, 0.5, 0.535, 1.0)):
    _e.position = _p0 if _p0 in (0.0, 1.0) else _p0*IRIS_SCALE
# マスカラ：上まつ毛を濃い黒にして少し長く、下まつ毛も細く少しだけ
for _mn, _a, _b, _c in (("Lash", 0.0021, 0.0048, (0.004, 0.003, 0.003, 1)), ("LashLower", -0.0008, -0.0017, (0.02, 0.014, 0.012, 1))):
    _nn = bpy.data.materials[_mn].node_tree.nodes; _nn["LashLen"].inputs["To Min"].default_value = _a; _nn["LashLen"].inputs["To Max"].default_value = _b
    next(x for x in _nn if x.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = _c
# チーク：ほおの高い所に、ローズをはっきりめに（3 人目より広く、濃く）
_ez = N["LidCenter"].inputs["Z"].default_value
N["CheekCenter"].inputs[1].default_value = (0.050, 0.0, _ez-0.027)
N["CheekFalloff"].inputs["From Max"].default_value = 0.048; N["CheekFalloff"].inputs["To Min"].default_value = 0.22
N["CheekMix"].inputs[7].default_value = (0.92, 0.48, 0.48, 1)
# 唇の合わせ目を測り直して、表情（口の開き・歯・口の中）を作り直す：唇の中央の表側で、いちばん奥へ引っこんだ所の高さ
# （唇どうしは接しているので、すき間では測れない。make_expressions.py の「いちばん奥の 4 点」は口の中の頂点まで拾って上にずれる）
_rig.data.pose_position = 'REST'; _mk.show_viewport = False
for _kk in kb:
    if _kk.name.startswith("exp-"): _kk.value = 0.0
bpy.context.view_layer.update()
_ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); _m = _ev.to_mesh()
_co = np.zeros(len(_m.vertices)*3); _m.vertices.foreach_get("co", _co); _ev.to_mesh_clear(); _co = _co.reshape(-1, 3)
_mk.show_viewport = True; _rig.data.pose_position = _was
_lc = _co[_lip]; _lc = _lc[np.abs(_lc[:, 0]) < 0.004]; _lc = _lc[_lc[:, 1] < _lc[:, 1].min()+0.006]
ZC_SEAM = float(_lc[np.argmax(_lc[:, 1]), 2])
print("lip seam z", round(ZC_SEAM, 4))
_fe = r"C:\Users\shuji\vrsample\blender\girl-onepiece2\scripts\make_expressions_onepiece2.py"
exec(compile(open(_fe, encoding="utf-8").read(), _fe, "exec"), {"__name__": "__main__", "ZC_SEAM": ZC_SEAM})
bpy.data.materials["Lips"].node_tree.nodes["MkSub"].inputs[1].default_value = ZC_SEAM       # 唇の色の中心も合わせ目に

# 笑顔（exp-happy）を作り直す：口を閉じたままのほほえみ。make_expressions.py の笑顔は口が開いてぎこちなかった。
#   目は「くつろぎ」（exp-relaxed）の穏やかに細める形を元にし、口角を上げて少し横・奥へ引き、ほおの高い所を持ち上げる。
#   上唇と下唇を同じだけ動かすので、口は開かない。上の歯は少し下ろす（口を開けて笑ったときに見えるように）
SMILE_CORNER_UP = 0.0050; SMILE_CORNER_OUT = 0.0032; SMILE_CORNER_BACK = 0.0034; SMILE_CHEEK_UP = 0.0040; SMILE_EYES = 1.0; SMILE_LOWLID_UP = 0.0014
_Bk2 = np.zeros(_n*3); kb["Basis"].data.foreach_get("co", _Bk2); _Bk2 = _Bk2.reshape(-1, 3)
_Rk = np.zeros(_n*3); kb["exp-relaxed"].data.foreach_get("co", _Rk); _Rk = _Rk.reshape(-1, 3)-_Bk2
_eyem = _co[:, 2] > ZC_SEAM+0.030                                   # くつろぎの形のうち、目のまわりだけを使う
_Dsm = _Rk*(_eyem[:, None]*SMILE_EYES)
_lc2 = _co[_lip]; _cx = float(np.abs(_lc2[:, 0]).max()); _cz = float(_lc2[np.argmax(np.abs(_lc2[:, 0])), 2])     # 口角
_AXs = np.abs(_co[:, 0]); _Zs = _co[:, 2]; _sgs = np.sign(_co[:, 0])
_front = _ss((-0.10-_co[:, 1])/0.02)
_wc = np.exp(-(((_AXs-_cx)/0.024)**2+((_Zs-_cz)/0.017)**2))*_ss(_AXs/0.016)*_front          # 口角から唇の外側半分へなだらかに（一点だけ上げると猫の口になる）
_Dsm[:, 2] += SMILE_CORNER_UP*_wc; _Dsm[:, 0] += _sgs*SMILE_CORNER_OUT*_wc; _Dsm[:, 1] += SMILE_CORNER_BACK*_wc
_wk = np.exp(-(((_AXs-0.045)/0.020)**2+((_Zs-(_cz+0.030))/0.018)**2))*_front                # ほおの高い所
_Dsm[:, 2] += SMILE_CHEEK_UP*_wk; _Dsm[:, 1] -= 0.0018*_wk
# 目が笑う：下まぶた（目の下 0〜1.2cm）を押し上げる。目の玉は動かさない
_Nn = bpy.data.materials["Skin"].node_tree.nodes; _EXh = _Nn["LidCenter"].inputs["X"].default_value; _EZh = _Nn["LidCenter"].inputs["Z"].default_value
_eg2 = {ob.vertex_groups[n].index for n in ("helper-l-eye", "helper-r-eye")}
_ball2 = np.array([any(g.group in _eg2 and g.weight > 0.5 for g in v.groups) for v in ob.data.vertices])
_wl = np.exp(-((_AXs-_EXh)/0.016)**2)*_ss((_EZh-_Zs)/0.004)*(1-_ss((_EZh-0.014-_Zs)/0.006))*_front*(~_ball2)
_Dsm[:, 2] += SMILE_LOWLID_UP*_wl
# ふだんの顔に、口を閉じたおだやかなほほえみを少しだけ入れる（custom-soft-smile）：上のほほえみの形の SOFT_SMILE 倍。
# 目を少し細め、口角とほおを上げる。書き出しでは、いまの形が基本の形になるので、この形のまま表情が足される
SOFT_SMILE = 0.25                                        # 目を細めすぎないよう弱く（きりっとした目元）
_ksm = kb.get("custom-soft-smile") or ob.shape_key_add(name="custom-soft-smile", from_mix=False)
_ksm.data.foreach_set("co", (_Bk2+_Dsm*SOFT_SMILE).ravel()); _ksm.value = 1.0
kb["exp-happy"].data.foreach_set("co", (_Bk2+_Dsm).ravel()); kb["exp-happy"].value = 0.0; ob.data.update()
_tth = bpy.data.objects["Girl_Teeth"].data.shape_keys.key_blocks
_nth = len(_tth["Basis"].data)//2                       # 前半が上の歯（make_expressions.py の作り順）
for _i, _d in enumerate(_tth["exp-happy"].data):
    _c = _tth["Basis"].data[_i].co.copy()
    if _i < _nth: _c.z -= 0.0030                          # 笑顔では上の歯を下ろす（口を開けて笑ったとき、上の歯がのぞく）
    _d.co = _c
print("happy rebuilt: corner", round(_cx, 4), round(_cz, 4))

# 「え」と「い」を作り直す：make_expressions.py の「い」（口を小さめに縦に開く形）を「え」に使う。
# 「い」は「イー」の口：上下の歯をかみ合わせ、唇を横長に開いて歯並びを見せる。
#   上唇は持ち上げ、下唇は下げる。すき間の高さは口の幅いっぱいでほぼ同じにし、口角だけ細く閉じる（横長の形）。
#   合わせ目でつながっている頂点が上唇・下唇のどちらかは、「あ」で下へ動く頂点かどうかで見分ける
IH_UP_LIP = 0.0022; IH_LOW_LIP = 0.0026; IH_WIDE = 0.0020; IH_TEETH_W = 1.12
_Ih = np.zeros(_n*3); kb["exp-ih"].data.foreach_get("co", _Ih); _Ih = _Ih.reshape(-1, 3)-_Bk2
kb["exp-ee"].data.foreach_set("co", (_Bk2+_Ih).ravel())
_Aa = np.zeros(_n*3); kb["exp-aa"].data.foreach_get("co", _Aa); _Aa = _Aa.reshape(-1, 3)-_Bk2
_lowj = _Aa[:, 2] < -0.002                                     # 「あ」で下がる頂点＝下唇・あご側
_Wl = _cx
_prof = np.clip(1-(_AXs/_Wl)**4, 0, 1)                          # 横長：まん中から口角の手前まで平ら、口角で 0
_reach = _ss((_Wl+0.006-_AXs)/0.008)*_front
_wu = (~_lowj)*(1-_ss((_Zs-(ZC_SEAM+0.004))/0.010))*_ss((_Zs-(ZC_SEAM-0.004))/0.002)*_reach      # 上唇とそのすぐ上
_wd = _lowj*(1-_ss(((ZC_SEAM-0.004)-_Zs)/0.012))*_reach                                           # 下唇とそのすぐ下
_Dih = np.zeros((_n, 3))
_Dih[:, 2] = IH_UP_LIP*_prof*_wu-IH_LOW_LIP*_prof*_wd
_wcw = np.exp(-(((_AXs-_cx)/0.020)**2+((_Zs-_cz)/0.014)**2))*_ss(_AXs/0.012)*_front
_Dih[:, 0] += _sgs*IH_WIDE*_wcw; _Dih[:, 1] += 0.0012*_wcw
kb["exp-ih"].data.foreach_set("co", (_Bk2+_Dih).ravel()); ob.data.update()
_tB = [d.co.copy() for d in _tth["Basis"].data]; _tI = [d.co.copy() for d in _tth["exp-ih"].data]
for _i, _d in enumerate(_tth["exp-ee"].data): _d.co = _tI[_i]
_nt2 = len(_tB)//2                                             # 前半が上の歯
_ub = min(_tB[i].z for i in range(_nt2)); _lt = max(_tB[i].z for i in range(_nt2, len(_tB)))
for _i, _d in enumerate(_tth["exp-ih"].data):
    _c = _tB[_i].copy(); _c.x *= IH_TEETH_W
    if _i < _nt2: _c.z += (ZC_SEAM-0.0050)-_ub                  # 上の歯の先を、合わせ目の 5mm 下へ（上唇の下に上の歯が見える）
    else: _c.z += (ZC_SEAM-0.0038)-_lt                          # 下の歯の先を、上の歯の裏へ 1.2mm 重ねる（かみ合わせ）
    _d.co = _c
print("ih/ee rebuilt")

# 笑顔（exp-happy）を「い」の口から作り直す：歯をかみ合わせて見せ、口角とほおを持ち上げる。目は細めない
_Dhp = _Dih.copy(); HAPPY_LIFT = 0.5                           # 口角・ほおの持ち上げの強さ（ほほえみの形に対する割合）
_Dhp[:, 2] += SMILE_CORNER_UP*HAPPY_LIFT*_wc; _Dhp[:, 0] += _sgs*SMILE_CORNER_OUT*_wc*0.5; _Dhp[:, 1] += SMILE_CORNER_BACK*_wc
_Dhp[:, 2] += SMILE_CHEEK_UP*HAPPY_LIFT*_wk; _Dhp[:, 1] -= 0.0018*HAPPY_LIFT*_wk
kb["exp-happy"].data.foreach_set("co", (_Bk2+_Dhp).ravel()); ob.data.update()
for _i, _d in enumerate(_tth["exp-happy"].data): _d.co = _tth["exp-ih"].data[_i].co.copy()
print("happy = ih mouth + smile (eyes open)")

# 「あ」「う」「お」の開きを控えめに：
#   あ … make_expressions.py の「う」の形（小さめに丸く開く）を使う（元の「あ」は開きすぎ）
#   う … 口をすぼめる：唇を中央へ寄せて前へ突き出し、小さく丸く開ける
#   お … 口をすぼめて前へ出し、元の「お」の 5.5 割の開き（「う」より少し大きく丸く）
OU_OPEN = 0.40; OU_PUCKER = 0.30; OU_FWD = 0.0035; OH_SCALE = 0.55; OH_PUCKER = 0.22; OH_FWD = 0.0028
def _kd(name):
    a = np.zeros(_n*3); kb[name].data.foreach_get("co", a); return a.reshape(-1, 3)-_Bk2
_Ou0 = _kd("exp-ou"); _Oh0 = _kd("exp-oh")
_tBv = [d.co.copy() for d in _tth["Basis"].data]
_tOu = [d.co.copy() for d in _tth["exp-ou"].data]; _tOh = [d.co.copy() for d in _tth["exp-oh"].data]
kb["exp-aa"].data.foreach_set("co", (_Bk2+_Ou0).ravel())
for _i, _d in enumerate(_tth["exp-aa"].data): _d.co = _tOu[_i]
_wm2 = np.exp(-((_AXs/(_cx+0.006))**2+((_Zs-ZC_SEAM)/0.016)**2))*_front              # 口のまわり
_Dou = _Ou0*OU_OPEN
_Dou[:, 0] -= _co[:, 0]*OU_PUCKER*_wm2                                                 # 中央へ寄せる
_Dou[:, 1] -= OU_FWD*_wm2                                                              # 前へ突き出す
kb["exp-ou"].data.foreach_set("co", (_Bk2+_Dou).ravel())
for _i, _d in enumerate(_tth["exp-ou"].data): _d.co = _tBv[_i].lerp(_tOu[_i], OU_OPEN)
_Doh = _Oh0*OH_SCALE                                           # お：すぼめて、うより少し大きく丸く開ける
_Doh[:, 0] -= _co[:, 0]*OH_PUCKER*_wm2; _Doh[:, 1] -= OH_FWD*_wm2
kb["exp-oh"].data.foreach_set("co", (_Bk2+_Doh).ravel())
for _i, _d in enumerate(_tth["exp-oh"].data): _d.co = _tBv[_i].lerp(_tOh[_i], OH_SCALE)
ob.data.update()
print("aa/ou/oh rebuilt")
TEETH_UP_SHORTEN = 0.0
TEETH_UP_HIDE = 0.5            # 口を開けた（あ）とき、上唇の下に見えている上の歯の長さの、この割合を隠す
# 上の歯を短く：make_expressions.py の上の歯（高さ 13mm の帯）は、口を開けると長く見えるので、下のふちを上へ 2 割詰める（4 割だと上唇に隠れて見えなくなる）
_t = bpy.data.objects["Girl_Teeth"]; _zc = bpy.data.materials["Lips"].node_tree.nodes["MkSub"].inputs[1].default_value
_tb = _t.data.shape_keys.key_blocks["Basis"]
_upv = list(range(len(_tb.data)//2))          # make_expressions.py は上の歯 → 下の歯の順に作る（高さで選ぶと、上へ反った下の歯の両端まで入る）
_ztop = max(_tb.data[i].co.z for i in _upv)
_dzt = {i: TEETH_UP_SHORTEN*(_ztop-_tb.data[i].co.z) for i in _upv}
for _k in _t.data.shape_keys.key_blocks:
    for i, dz in _dzt.items(): _k.data[i].co.z += dz
for i, dz in _dzt.items(): _t.data.vertices[i].co.z = _tb.data[i].co.z
_t.data.update()
# 口を開けた（あ）形で、上唇の下のふち（中央）と上の歯の先（中央）を測り、見えている長さの TEETH_UP_HIDE だけ上の歯を上げる
_rig.data.pose_position = 'REST'; _mk.show_viewport = False
_tk = _t.data.shape_keys.key_blocks; kb["exp-aa"].value = 1.0; _tk["exp-aa"].value = 1.0; bpy.context.view_layer.update()
_dg = bpy.context.evaluated_depsgraph_get()
_e1 = ob.evaluated_get(_dg); _m1 = _e1.to_mesh(); _c1 = np.zeros(len(_m1.vertices)*3); _m1.vertices.foreach_get("co", _c1); _e1.to_mesh_clear(); _c1 = _c1.reshape(-1, 3)
_e2 = _t.evaluated_get(_dg); _m2 = _e2.to_mesh(); _c2 = np.zeros(len(_m2.vertices)*3); _m2.vertices.foreach_get("co", _c2); _e2.to_mesh_clear(); _c2 = _c2.reshape(-1, 3)
kb["exp-aa"].value = 0.0; _tk["exp-aa"].value = 0.0; _mk.show_viewport = True; _rig.data.pose_position = _was
_ul = _lip & (np.abs(_co[:, 0]) < 0.004) & (_c1[:, 2] > _co[:, 2]-0.0005)       # 上唇の中央：口を開けても下がらない唇の頂点（_co は口を閉じた形）
_ul &= _co[:, 1] < _co[_ul, 1].min()+0.008                                     # 表側だけ
_lipbot = float(_c1[_ul, 2].min())
_nt = len(_c2)//2; _tc = np.abs(_c2[:_nt, 0]) < 0.003; _toothbot = float(_c2[:_nt][_tc, 2].min())
_lift = max(0.0, (_lipbot-_toothbot)*TEETH_UP_HIDE)
for _k in _tk:
    for i in range(_nt): _k.data[i].co.z += _lift
for i in range(_nt): _t.data.vertices[i].co.z = _tk["Basis"].data[i].co.z
_t.data.update()
print("upper teeth visible mm", round((_lipbot-_toothbot)*1000, 1), "lifted mm", round(_lift*1000, 1))
# 髪：前髪の毛先をまっすぐに（毛先を欠くノイズを弱める）
H = bpy.data.materials["Hair"].node_tree.nodes
H["TipK1"].inputs[1].default_value = 0.7; H["TipK2"].inputs[1].default_value = 0.25
H["Mix"].inputs[6].default_value = (0.012, 0.010, 0.011, 1); H["Mix"].inputs[7].default_value = (0.11, 0.095, 0.09, 1)   # 黒髪（地の色・つやの帯）
_hp = ob["hair_params"].to_dict(); _hp["__name__"] = "__main__"
_f = r"C:\Users\shuji\vrsample\blender\girl-onepiece2\scripts\make_hair_onepiece2.py"
exec(compile(open(_f, encoding="utf-8").read(), _f, "exec"), _hp)
_fb = r"C:\Users\shuji\vrsample\blender\girl-onepiece2\scripts\make_brows_onepiece2.py"
exec(compile(open(_fb, encoding="utf-8").read(), _fb, "exec"), {"__name__": "__main__"})
print("onepiece face done")
