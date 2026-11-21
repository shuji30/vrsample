# 3 人目（ニットコーデの子）の顔を作る（Blender の中で exec する）。girl-knit.blend で実行する。
#   大人っぽい写実寄りの顔：細めの卵形で、あごは細く小さめ。切れ長のアーモンド形で、目頭が低く目じりが少し上がる（目の間はやや広め）。
#   鼻筋が通り、鼻先が少し上向き。口は小さめで口角は上げず、上唇は薄く山がはっきり、下唇は少しふっくら。横顔では鼻先より内側に入る。まつ毛・アイラインは控えめ。
#   首は細く長く、頭は首の真上に。耳は眉から鼻の下の高さ、あごの角の上。
#   ほくろはなし。チークは控えめ、唇は落ち着いたローズ、眉はこげ茶。
#   髪（Girl_Hair。黒髪・眉の上で切りそろえたぱっつん前髪のストレート・胸の上まで）は、最後に make_hair_knit.py で作り直す。
# 元の手順（vrgame2/blender/girl/README.md）の fit_face.py → make_face_cute.py を、この子の値で通す。
import bpy

S = "C:\\Users\\shuji\\Documents\\girl-blender\\scripts\\"
def run(f, g): g = dict(g); g["__name__"] = "__main__"; exec(compile(open(S+f, encoding="utf-8").read(), f, "exec"), g)
ob = bpy.data.objects["Girl_Body"]; kb = ob.data.shape_keys.key_blocks

# 足：かかとを上げる（ヒール約 5cm）。靴底は薄く（6.6mm）。体はそのぶん上と前へ動く（measured: (0, -0.0239, +0.0189)）
kb["custom-heel"].slider_max = max(kb["custom-heel"].slider_max, 1.5)
kb["custom-heel"].value = 1.25; kb["custom-sole-lift"].value = 0.3
ob["heel_shift"] = (0.0, -0.0239, 0.0409)

# 首と耳：首を細く長くし、頭を首の真上へ（前へ出すぎていた）。耳は少し下げて後ろへ（あごの角の上に）
#   custom-neck-long … 元の形（Basis）で、首の付け根（z 1.385）から上へなだらかに頭を動かす。耳（ears）はさらに動かす
import numpy as np
NECK_D = (0.0, 0.012, 0.012); EAR_D = (0.0, 0.003, -0.003)
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
kb["neck-scale-horiz-decr"].value = 0.45
HEAD_DY, HEAD_DZ = NECK_D[1], NECK_D[2]                  # 頭が動いたぶん（髪・チーク・眉に足す）

# 小顔（custom-head-small）：あご先を支点に、あごより上（顔・耳・頭）を HEAD_S 倍に縮める。首から下は変えない。
# 髪の大きさは縮めないので、小さくなった顔のまわりを髪がふんわり縁取る比率になる
HEAD_S = 0.93
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
# 眉は、どのスクリプトも高さを動かさないので、体が上へ動いたぶんをここで動かす（前後は make_face_cute.py が肌に沿わせる）
BROW_DZ = -0.003                                         # 眉を下げる量（m）
_br = bpy.data.objects["Girl_Brows"]; _tz = ob["heel_shift"][2]+HEAD_DZ+BROW_DZ; _dz = _tz-_br.get("heel_z", 0.022)
if abs(_dz) > 1e-6:
    _ks = _br.data.shape_keys.key_blocks if _br.data.shape_keys else []
    for _v in _br.data.vertices: _v.co.z += _dz
    for _k in _ks:
        for _d in _k.data: _d.co.z += _dz
    _br["heel_z"] = _tz; _br.data.update()
# 眉を寄せる：左右とも内側（眉間側）へ。前後は make_face_cute.py が肌に沿わせ直す
BROW_DX = -0.003
_ddx = BROW_DX-_br.get("brow_dx", 0.0)
if abs(_ddx) > 1e-6:
    _ks = _br.data.shape_keys.key_blocks if _br.data.shape_keys else []
    for _v in _br.data.vertices: _v.co.x += _ddx*(1 if _v.co.x > 0 else -1)
    for _k in _ks:
        for _d in _k.data: _d.co.x += _ddx*(1 if _d.co.x > 0 else -1)
    _br["brow_dx"] = BROW_DX; _br.data.update()
_hs = ob["head_small"]; _piv = np.array(_hs[:3]); _ratio = _hs[3]/_br.get("head_s", 1.0)
if abs(_ratio-1) > 1e-6:
    _ks = _br.data.shape_keys.key_blocks if _br.data.shape_keys else []
    for _v in _br.data.vertices: _v.co = list(_piv+(np.array(_v.co)-_piv)*_ratio)
    for _k in _ks:
        for _d in _k.data: _d.co = list(_piv+(np.array(_d.co)-_piv)*_ratio)
    _br["head_s"] = _hs[3]; _br.data.update()

# 髪の土台：頭の実寸（左右 ±8.1cm・前後 ±8.9cm）に沿わせる。毛先は胸の上、前髪は眉の高さ
_hsh = np.array(ob["heel_shift"]); _cw = np.array([0.0, -0.056+HEAD_DY, 1.52+HEAD_DZ])+_hsh      # 頭の中心（実際の位置）
_cw = HEAD_PIV+(_cw-HEAD_PIV)*HEAD_S                                                          # 小顔で縮めたぶん、中心も動かす
p = ob["hair_params"].to_dict(); p.update(RX=0.091, RY=0.100, RZ=0.098, C=list(_cw-_hsh), ZB=1.26, BANG=52); ob["hair_params"] = p

# 目：縦を細く、目じりを上げる
for k, v in {"l-eye-height2-incr": 0.0, "r-eye-height2-incr": 0.0, "l-eye-height2-decr": 0.2, "r-eye-height2-decr": 0.2, "l-eye-scale-incr": 0.8, "r-eye-scale-incr": 0.8,
             "l-eye-corner2-up": 1.0, "r-eye-corner2-up": 1.0, "l-eye-height1-incr": 0.0, "r-eye-height1-incr": 0.0,
             "l-eye-trans-out": 0.25, "r-eye-trans-out": 0.25}.items():
    kb[k].slider_max = max(kb[k].slider_max, v); kb[k].value = v
run("fit_face.py", {"EYE_SX": 0.30, "EYE_SZ": -0.03, "EYE_BALL": 0.13, "EYE_TILT": 8.0, "BANG_DZ": 0.016})

# 目の輪郭をアーモンド形に（custom-eye-almond）：下まぶたの外側を持ち上げ、上まぶたの目じり側を少し下ろして、
# 目じりで上下の線が細く閉じるようにする（下まぶたが外へ流れて、目じりの先に白目がはみ出していた）。
# まつ毛・アイラインの線は、このあとの make_face_cute.py が実際の目の開きに合わせ直す
EYE_LOW_OUT_UP = 0.0018; EYE_UP_OUT_DOWN = 0.0016
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
KEYS = {"head-round": 0.2, "head-oval": 0.75, "custom-cheek-puff": 0.0, "l-cheek-volume-incr": 0.3, "r-cheek-volume-incr": 0.3,
        "chin-height-decr": 0.45, "custom-jaw-slim": 0.55, "chin-width-decr": 0.4, "head-invertedtriangular": 0.1, "mouth-angles-up": 0.05,
        "nose-scale-vert-decr": 0.35, "nose-point-up": 0.30, "nose-scale-depth-incr": 0.85, "nose-greek-incr": 0.5, "nose-scale-horiz-decr": 0.7,
        "mouth-scale-horiz-decr": 0.45, "mouth-upperlip-volume-incr": 0.08, "mouth-lowerlip-volume-incr": 0.32, "mouth-trans-backward": 0.95,
        "mouth-scale-vert-decr": 0.15, "l-cheek-inner-incr": 0.0, "r-cheek-inner-incr": 0.0,
        "nose-trans-up": -1.1, "mouth-trans-up": 0.30}           # 鼻と口を下げる（元は鼻 -0.6・口 0.85）
run("make_face_cute.py", {"KEYS": KEYS, "LIP_LOWER_UP": 0.0008, "LIP_UPPER_DOWN": 0.0006, "CHEEKBONE": 0.0040,
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
run("bake_face_pos.py", {})                             # 顔の模様の位置を書き直す

# メイク
N = bpy.data.materials["Skin"].node_tree.nodes
for i in (0, 1): N[f"MkMole{i}Fall"].inputs["To Min"].default_value = 0.0          # ほくろなし
N["CheekCenter"].inputs[1].default_value[2] = 1.467+ob["heel_shift"][2]+HEAD_DZ                                 # チークは高めに、控えめに
N["CheekFalloff"].inputs["To Min"].default_value = 0.17
N["CheekMix"].inputs[7].default_value = (0.90, 0.48, 0.47, 1)
L = bpy.data.materials["Lips"].node_tree.nodes; lb = next(n for n in L if n.type == "BSDF_PRINCIPLED")
L["MkMix"].inputs[6].default_value = (0.68, 0.30, 0.28, 1); L["MkMix"].inputs[7].default_value = (0.80, 0.46, 0.42, 1)    # 落ち着いたコーラル寄りのローズ
lb.inputs["Coat Weight"].default_value = 0.12; lb.inputs["Roughness"].default_value = 0.42
n = bpy.data.materials["LashLower"].node_tree.nodes["LashLen"]                       # 下まつ毛は、ほとんど見えない長さに
n.inputs["To Min"].default_value = -0.0005; n.inputs["To Max"].default_value = -0.0011
br = bpy.data.materials["Brow"]; bb = next(x for x in br.node_tree.nodes if x.type == "BSDF_PRINCIPLED")
bb.inputs["Base Color"].default_value = (0.10, 0.065, 0.05, 1); br.diffuse_color = (0.10, 0.065, 0.05, 1)
n = bpy.data.materials["Lash"].node_tree.nodes["LashLen"]                            # 上まつ毛も控えめに
n.inputs["To Min"].default_value = 0.0016; n.inputs["To Max"].default_value = 0.0034
N["MkWingMix"].inputs[7].default_value = (0.20, 0.12, 0.10, 1)                         # 目じりのラインは細く薄く
# アイシャドウ：上まぶたにブルー（まぶた全体に淡く、目のきわと目じり側を少し濃く）
N["MkShadowMix"].inputs[7].default_value = (0.40, 0.55, 0.90, 1); N["MkShadowFall"].inputs[3].default_value = 0.30
N["MkShadow2Mix"].inputs[7].default_value = (0.26, 0.38, 0.72, 1); N["MkShadow2Fall"].inputs[3].default_value = 0.30
# 太さは半分：縦のつぶし具合を 2 倍にし、まつ毛のきわから離れないよう中心を下げる
_EXs = N["LidCenter"].inputs["X"].default_value; _EZs = N["LidCenter"].inputs["Z"].default_value
N["MkShadowScl"].inputs[1].default_value = (1.0, 0.0, 2.9); N["MkShadowSub"].inputs[1].default_value = (_EXs+0.003, 0.0, _EZs+0.0055)
N["MkShadow2Scl"].inputs[1].default_value = (1.0, 0.0, 2.8); N["MkShadow2Sub"].inputs[1].default_value = (_EXs+0.021, 0.0, _EZs+0.0040)
# 黒目を少し小さく：瞳の色の帯（目の玉の中心からの角度）を、瞳孔も含めて 12% 小さくする。元の位置は下の表
IRIS_SCALE = 0.88
_ir = bpy.data.materials["Eye"].node_tree.nodes["IrisRamp"].color_ramp.elements
for _e, _p0 in zip(_ir, (0.0, 0.178, 0.201, 0.29, 0.38, 0.466, 0.5, 0.535, 1.0)):
    _e.position = _p0 if _p0 in (0.0, 1.0) else _p0*IRIS_SCALE
# マスカラ：上まつ毛を濃い黒にして少し長く、下まつ毛も細く少しだけ
for _mn, _a, _b, _c in (("Lash", 0.0021, 0.0048, (0.004, 0.003, 0.003, 1)), ("LashLower", -0.0008, -0.0017, (0.02, 0.014, 0.012, 1))):
    _nn = bpy.data.materials[_mn].node_tree.nodes; _nn["LashLen"].inputs["To Min"].default_value = _a; _nn["LashLen"].inputs["To Max"].default_value = _b
    next(x for x in _nn if x.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = _c
# チーク：ほおの高い所に、薄いピンクをふんわり
_ez = N["LidCenter"].inputs["Z"].default_value
N["CheekCenter"].inputs[1].default_value = (0.050, 0.0, _ez-0.027)
N["CheekFalloff"].inputs["From Max"].default_value = 0.040; N["CheekFalloff"].inputs["To Min"].default_value = 0.30
N["CheekMix"].inputs[7].default_value = (0.93, 0.55, 0.55, 1)
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
_fe = r"C:\Users\shuji\vrsample\blender\girl-knit\scripts\make_expressions_knit.py"
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
H["Mix"].inputs[6].default_value = (0.012, 0.010, 0.011, 1); H["Mix"].inputs[7].default_value = (0.10, 0.085, 0.08, 1)   # 黒髪（地の色・つやの帯）   # こげ茶（地の色・つやの帯）
_hp = ob["hair_params"].to_dict(); _hp["__name__"] = "__main__"
_f = r"C:\Users\shuji\vrsample\blender\girl-knit\scripts\make_hair_knit.py"
exec(compile(open(_f, encoding="utf-8").read(), _f, "exec"), _hp)
_fb = r"C:\Users\shuji\vrsample\blender\girl-knit\scripts\make_brows_knit.py"
exec(compile(open(_fb, encoding="utf-8").read(), _fb, "exec"), {"__name__": "__main__"})
print("knit face done")
