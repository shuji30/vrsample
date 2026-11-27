# 5 人目（ワンピース 2）の顔を、昭和のアイドル風（横に長く目じりの切れたアーモンド形の目・太めでなだらかな眉・小さく短い鼻・
# 小さくふっくらした唇・小さめの耳）に寄せる（Blender の中で exec する。何度流してもよい）。特定の人に似せるのではない。
#   1. KEYS … 顔のシェイプキーの値（左右のあるものは l- / r- の両方に入れる）。set_vibe_onepiece2.py のあとに流す
#   2. custom-idol-eye … 目じりを OUTX 外へのばし、DROOP 下げる（切れ長に。目の玉は動かさない）
#   3. まつ毛（Girl_LashStrands・Girl_LashLowerStrands）を set_lash_fit_onepiece2.py で今の目の形に合わせ直す
#   4. 眉（Girl_Brows）の形を作り直す。UV の u（内 0 → 外 1）と v（下 0・上 1）から、高さ・太さ・長さを決めて、肌の上に貼る
#      （今の形からの差ではないので、何度流しても同じ形になる）。眉は肌に描くものなので、影は落とさない
import bpy, math, bmesh
import numpy as np
from mathutils import Vector, kdtree
from mathutils.bvhtree import BVHTree

KEYS = globals().get("KEYS", {
    # 目：横に長いアーモンド形。上まぶたが黒目の上を少し隠し、目じりは長く切れる（丸くしたら幼く見えた。参考の写真の目の形に）
    "eye-height2-decr": 0.8,          # まぶたのまん中を下げ、黒目の上を隠す（0.3 から。1.2 では眠そうに見えた）
    "custom-eye-slant": 0.3,          # 目じりのつり上がり（1.0 から。たれ目にする）
    "custom-eye-almond": 1.0,         # アーモンド形のまま
    "eye-scale-incr": 0.6,            # 目の大きさ（0.5 から。0.62 より大きくすると目が離れて見える）
    # 鼻：短く、低く、小さく
    "nose-scale-vert-decr": 1.0,      # 鼻すじを短く（0.7 から）
    "nose-scale-depth-decr": 0.6,     # 鼻を低く（0.25 から）
    "custom-nose-bridge": 0.3,        # 鼻すじの稜線（0.7 から。額から鼻先まで明るい帯が通っていた）
    "nose-width1-decr": 0.4,          # 鼻すじの上を細くしすぎない（0.8 では眉間から鼻先まで明るい帯が通り、鼻が長く見えた）
    "nose-flaring-decr": 0.7,         # 小鼻を小さく（0.35 から）
    # ほお：ムチッとした若い丸み
    "cheek-volume-incr": 0.65,        # 0.55 から（0.9・0.75 ではほおが張って顔が広く見えた）
    "custom-young-cheek": 1.6,        # 1.0 から
    "custom-cheek-puff": 1.15,        # 1.0 から（1.3 では顔が広く見えた）
    # 輪郭：ほおの丸みは残して、下ほおとあごを少し細く
    "custom-lower-cheek-puff": 0.5,   # 1.0 から（0.7 でもまだ広かった）
    "custom-round-face": 0.6,         # 1.0 から
    "chin-width-decr": 0.62,          # 0.45 から（0.7 ではあごがとがった）
    "nose-trans-up": -2.0,            # 鼻を下げる（-1.1 から。-1.6 でもまだ高かった）
    "mouth-trans-up": 0.5,            # 口を少し上げて、鼻と口のあいだを狭める（0.3 から）
    # 口：小さく、ふっくら、口角を少し上げる
    "mouth-scale-horiz-decr": 0.35,   # 口の幅を小さく
    "custom-mouth-wider": 0.3,        # 口を横に広げるキー（1.0 から）
    "custom-lip-thin": 0.6,           # 唇を薄くするキー（1.0 から。0.4 では口を開けると唇が浮き輪のようにふくらんだ）
    "mouth-upperlip-volume-incr": 0.15,
    "mouth-lowerlip-volume-incr": 0.2,
    "mouth-angles-up": 0.3,           # 口角を上げる
    "mouth-trans-backward": 1.15,     # 横から見て唇が鼻先と同じくらい前に出ていた（0.9 から。1.4 では歯が下唇の下から透けた）
    "mouth-scale-depth-decr": 0.35,
    # 耳：小さく（聖子ちゃんカットではほぼ髪に隠れる）
    "ear-scale-decr": 0.7,            # 0.35 から
})
DROOP = globals().get("DROOP", 0.0014)   # 目じりを下げる量（m。マイナスで上げる）。たれ目に
OUTX = globals().get("OUTX", 0.0025)     # 目じりを外へのばす量（m。切れ長に）
# 眉：内側の端の下のふちの高さ BROW_DZ（目の骨 leftEye の基本の位置からの高さ。靴を替えると体ごと上下するので、ワールドの高さでは決めない）、
#   弧の高さ BROW_ARCH、太さ BROW_TH（内・中・眉尻）、長さの倍率 BROW_LEN（元は 11.5〜53mm）
BROW_DZ = globals().get("BROW_DZ", 0.0130)       # 0.045 では眉が高く、まぶたとのあいだが広すぎた（0.0185 でもまだ高かった）
BROW_ARCH = globals().get("BROW_ARCH", 0.0035)
BROW_TH = globals().get("BROW_TH", (0.0060, 0.0066, 0.0020)); BROW_LEN = globals().get("BROW_LEN", 1.38)   # 0.88・1.05・1.18 では短かった
BROW_X0 = globals().get("BROW_X0", 0.0080)       # 眉頭の位置（顔のまん中から。元は 11.5mm。まん中へ寄せる）
BROW_GAP = 0.0006                        # 肌から浮かせる量（1.8mm 浮かせたら、眉の下に影が出て、斜めから見ると眉尻が離れた）

ob = bpy.data.objects["Girl_Body"]; kb = ob.data.shape_keys.key_blocks
rig = bpy.data.objects["Girl_Rig"]

def body_world():
    """今のシェイプキーで混ぜた体の頂点（基本の姿勢・細分化なし・ワールド座標）"""
    mods = [m for m in ob.modifiers if m.type in ("SUBSURF", "MASK")]; st = [m.show_viewport for m in mods]
    for m in mods: m.show_viewport = False
    pp = rig.data.pose_position; rig.data.pose_position = "REST"; bpy.context.view_layer.update()
    e = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = e.to_mesh()
    a = np.zeros(len(m.vertices)*3); m.vertices.foreach_get("co", a); e.to_mesh_clear()
    for m_, s in zip(mods, st): m_.show_viewport = s
    rig.data.pose_position = pp; bpy.context.view_layer.update()
    M = np.array(ob.matrix_world); return a.reshape(-1, 3)@M[:3, :3].T+M[:3, 3]

def ss(t): t = np.clip(t, 0, 1); return t*t*(3-2*t)

# 目の玉（動かさない・まつ毛の追従にも使わない頂点）
EXCL = set()
for g in ("helper-l-eye", "helper-r-eye", "HelperGeometry"):
    vg = ob.vertex_groups.get(g)
    if vg:
        gi = vg.index; EXCL |= {v.index for v in ob.data.vertices if any(x.group == gi and x.weight > 0.5 for x in v.groups)}
# 見えている肌（体の MASK と同じ "body" の頂点）。補助メッシュ（まつ毛・髪・タイツ用の殻）は眉を貼る面に入れない
_gb = ob.vertex_groups["body"].index
SKIN = {v.index for v in ob.data.vertices if any(x.group == _gb and x.weight > 0 for x in v.groups)}-EXCL

B0 = body_world()
# 1. キー
for k, v in KEYS.items():
    for n in ([k] if k in kb else ["l-"+k, "r-"+k]):
        if n in kb:
            kb[n].slider_min = min(kb[n].slider_min, v); kb[n].slider_max = max(kb[n].slider_max, v); kb[n].value = v
        else: print("missing key", n)
# 2. 目じりを外へのばし、少し下げる（形は、キーを足す前の今の形で決める。custom-idol-eye 自身はいったん 0 にしてから測る）
_ki = kb.get("custom-idol-eye") or ob.shape_key_add(name="custom-idol-eye", from_mix=False)
_ki.value = 0.0; ob.data.update(); Bm = body_world()
_e = rig.matrix_world@rig.data.bones["leftEye"].head_local
cx, cz = abs(_e.x), _e.z
x = np.abs(Bm[:, 0])
w = ss((x-cx+0.002)/0.016)*ss((1.0-np.sqrt(((x-cx-0.006)/0.026)**2+((Bm[:, 2]-cz)/0.018)**2))/0.5)*(Bm[:, 1] < -0.12)
w[list(EXCL)] = 0
_n = len(Bm); _b = np.zeros(_n*3); kb["Basis"].data.foreach_get("co", _b); _b = _b.reshape(-1, 3)
_d = np.zeros((_n, 3)); _d[:, 2] = -DROOP*w; _d[:, 0] = np.sign(Bm[:, 0])*OUTX*w
_ki.data.foreach_set("co", (_b+_d).ravel()); _ki.value = 1.0
ob.data.update()
B1 = body_world()

# 2b. 下まぶたのふちをならす（custom-lowlid-clean）：ふちが角ばった折れ線で、まん中に V 字のへこみがあり、目の下のラインががたがたに見えた。
#   下まぶたのふちの帯（目の玉は除く）だけを、縮まないならし方（Taubin）で、高さと前後の向きにならす
_kl = kb.get("custom-lowlid-clean") or ob.shape_key_add(name="custom-lowlid-clean", from_mix=False)
_kl.value = 0.0; ob.data.update(); Bl = body_world(); _n = len(Bl)
_eyemat = {i for i, mt in enumerate(ob.data.materials) if mt and mt.name.startswith("Eye")}
_eyev = np.zeros(_n, bool)
for _p in ob.data.polygons:
    if _p.material_index in _eyemat: _eyev[list(_p.vertices)] = True
_gb = ob.vertex_groups["body"].index
_body = np.array([any(x.group == _gb and x.weight > 0 for x in v.groups) for v in ob.data.vertices])
_x = np.abs(Bl[:, 0])
_wl = ss((1-np.sqrt(((_x-cx)/0.016)**2+((Bl[:, 2]-(cz-0.0055))/0.0055)**2))/0.3)*_body*(~_eyev)*(Bl[:, 2] < cz-0.0005)
_E = np.zeros((len(ob.data.edges), 2), int); ob.data.edges.foreach_get("vertices", _E.ravel())
_deg = np.bincount(_E.ravel(), minlength=_n).astype(float)
def _lap(P):
    S = np.zeros_like(P); np.add.at(S, _E[:, 0], P[_E[:, 1]]); np.add.at(S, _E[:, 1], P[_E[:, 0]]); return S/np.maximum(_deg, 1)[:, None]-P
_P = Bl.copy()
for _it in range(120):
    _P[:, 2] += 0.5*_wl*_lap(_P)[:, 2]; _P[:, 2] -= 0.53*_wl*_lap(_P)[:, 2]
    _P[:, 1] += 0.3*_wl*_lap(_P)[:, 1]; _P[:, 1] -= 0.32*_wl*_lap(_P)[:, 1]
_bb = np.zeros(_n*3); kb["Basis"].data.foreach_get("co", _bb)
_kl.data.foreach_set("co", (_bb.reshape(-1, 3)+_P-Bl).ravel()); _kl.value = 1.0; ob.data.update()

# 2c. しわを取る（custom-smooth-wrinkle）：目じりの外に、下まぶたから回り込む弧の折れ線があり、口のまわりには上唇のふちに沿った横の線と、
#   口角の切れ込みがあって、しわに見えた。目じりの外側と口のまわり（唇・目の玉と、そのすぐそば 0.5mm は動かさない）をならす
_kw = kb.get("custom-smooth-wrinkle") or ob.shape_key_add(name="custom-smooth-wrinkle", from_mix=False)
_kw.value = 0.0; ob.data.update(); Bw = body_world()
_lipmat = {i for i, mt in enumerate(ob.data.materials) if mt and mt.name in ("Lips", "Teeth", "Tongue", "MouthInner")}
_fix = np.zeros(_n, bool)
for _p in ob.data.polygons:
    if _p.material_index in _eyemat or _p.material_index in _lipmat: _fix[list(_p.vertices)] = True
from mathutils import kdtree as _kdt
_kf = _kdt.KDTree(int(_fix.sum()))
for _j, _i in enumerate(np.where(_fix)[0]): _kf.insert(Bw[_i], _j)
_kf.balance()
_dfix = np.array([_kf.find(Bw[i])[2] for i in range(_n)])
_away = ss((_dfix-0.0005)/0.0010)     # 1.5〜4mm を守ったら、しわ（目の玉・唇のすぐそば）が残った
_lp = Bw[[i for p in ob.data.polygons if p.material_index in _lipmat and ob.data.materials[p.material_index].name == "Lips" for i in p.vertices]]
_mc = _lp.mean(0); _mw = (_lp[:, 0].max()-_lp[:, 0].min())/2
_xw = np.abs(Bw[:, 0])
_we = ss((1-np.sqrt(((_xw-(cx+0.013))/0.010)**2+((Bw[:, 2]-(cz-0.001))/0.009)**2))/0.4)
_wm = ss((1-np.sqrt((Bw[:, 0]/(_mw+0.012))**2+((Bw[:, 2]-_mc[2])/0.020)**2))/0.4)*(Bw[:, 1] < _mc[1]+0.02)
_ww = np.maximum(_we, _wm)*_body*_away
_P = Bw.copy()
for _it in range(90):
    _P += 0.5*_ww[:, None]*_lap(_P); _P -= 0.53*_ww[:, None]*_lap(_P)
_kw.data.foreach_set("co", (_bb.reshape(-1, 3)+_P-Bw).ravel()); _kw.value = 1.0; ob.data.update()

# 2d. 鼻すじを目の下から始める（custom-nose-root-flat）：眉間から鼻先まで稜線が通り、目のあいだに鼻すじの左右の影が出ていた。
#   目の高さより上（目の下 1.2cm から眉の上まで）の鼻すじの帯（顔のまん中から 1.6cm）を、横と前後の向きにならして平らにする
_kn = kb.get("custom-nose-root-flat") or ob.shape_key_add(name="custom-nose-root-flat", from_mix=False)
_kn.value = 0.0; ob.data.update(); Bn = body_world()
_lashmat = {i for i, mt in enumerate(ob.data.materials) if mt and mt.name.startswith(("Eye", "Lash"))}
_fixn = np.zeros(_n, bool)
for _p in ob.data.polygons:
    if _p.material_index in _lashmat: _fixn[list(_p.vertices)] = True
_xn = np.abs(Bn[:, 0]); _zn = Bn[:, 2]; _ey = rig.data.bones["leftEye"].head_local.y
_wn = ss((_zn-(cz-0.012))/0.012)*ss((cz+0.032-_zn)/0.012)*ss((0.016-_xn)/0.006)*_body*(~_fixn)*(Bn[:, 1] < _ey-0.02)
_P = Bn.copy()
for _it in range(80):
    _L = _lap(_P); _P[:, 0] += 0.5*_wn*_L[:, 0]; _P[:, 1] += 0.5*_wn*_L[:, 1]
_kn.data.foreach_set("co", (_bb.reshape(-1, 3)+_P-Bn).ravel()); _kn.value = 1.0; ob.data.update()

# 2e. 上唇のふちの段を取る（custom-lip-edge-smooth）：上唇のふちのすぐ上で肌が奥へ急に折れ込み、正面から見て、
#   ふちが薄い板のように浮いて両わき（まん中から 1.2cm）で段になっていた。上唇のふちから 4mm の帯を、前後の向きに強く、
#   縦の向きに弱くならす（縦を強くすると上唇の山が消えた）
_ke = kb.get("custom-lip-edge-smooth") or ob.shape_key_add(name="custom-lip-edge-smooth", from_mix=False)
_ke.value = 0.0; ob.data.update(); Be = body_world()
_lipi = [i for i, mt in enumerate(ob.data.materials) if mt and mt.name == "Lips"][0]
_inm = {i for i, mt in enumerate(ob.data.materials) if mt and mt.name in ("Teeth", "Tongue", "MouthInner")}
_il = np.zeros(_n, bool); _ii = np.zeros(_n, bool); _is = np.zeros(_n, bool)
for _p in ob.data.polygons:
    if _p.material_index == _lipi: _il[list(_p.vertices)] = True
    elif _p.material_index in _inm: _ii[list(_p.vertices)] = True
    else: _is[list(_p.vertices)] = True
_bd = np.where(_il & _is)[0]; _ub = _bd[Be[_bd, 2] > np.median(Be[_il, 2])-0.001]
_kde = _kdt.KDTree(len(_ub))
for _j, _i in enumerate(_ub): _kde.insert(Be[_i], _j)
_kde.balance()
_we = ss((0.004-np.array([_kde.find(Be[i])[2] for i in range(_n)]))/0.0025)*(~_ii)*_body
_P = Be.copy()
for _it in range(150):
    _L = _lap(_P); _P[:, 1] += 0.6*_we*_L[:, 1]; _P[:, 2] += 0.08*_we*_L[:, 2]
_ke.data.foreach_set("co", (_bb.reshape(-1, 3)+_P-Be).ravel()); _ke.value = 1.0; ob.data.update()

# 3. まつ毛を今の目の形に合わせ直す（set_lash_fit_onepiece2.py。保管した直す前のまつ毛を、まぶたのふちの補助メッシュの動きで運ぶ）
import os
exec(open(os.path.join(os.path.dirname(bpy.data.filepath), "scripts", "set_lash_fit_onepiece2.py"), encoding="utf-8").read(), {})
exec(open(os.path.join(os.path.dirname(bpy.data.filepath), "scripts", "set_blink_fit_onepiece2.py"), encoding="utf-8").read(), {})   # まばたきも合わせ直す

# 4. 眉
#   肌だけに当てる（補助メッシュには頭を 1cm ほど外から包む殻や、まぶたの前に出るまつ毛用の面があり、それに当てると眉が浮いた）
bvh = BVHTree.FromPolygons([Vector(p) for p in B1], [tuple(p.vertices) for p in ob.data.polygons if all(i in SKIN for i in p.vertices)])
br = bpy.data.objects["Girl_Brows"]; me = br.data; M = br.matrix_world; Mi = M.inverted().to_3x3()
uvl = me.uv_layers.active; uv = {}
for l in me.loops: uv[l.vertex_index] = uvl.data[l.index].uv.copy()
XO = [11.5, 14.2, 16.9, 21.3, 25.8, 30.3, 34.9, 39.4, 43.9, 48.5, 53.0]     # 元の眉の頂点の横位置（mm。u = 0, 0.1, … 1）
basis = me.shape_keys.key_blocks["Basis"]
Dv = []
for i, kd_ in enumerate(basis.data):
    p = M@kd_.co; s = 1 if p.x > 0 else -1
    u = uv[i].x; xo = np.interp(u, np.linspace(0, 1, 11), XO); t = (xo-11.5)/41.5
    xn = BROW_X0+(xo-11.5)*BROW_LEN/1000
    bot = cz+BROW_DZ+BROW_ARCH*math.sin(math.pi*t*0.85)-0.0015*float(ss((t-0.75)/0.25))     # 眉尻は少し下げる
    th = BROW_TH[0]+(BROW_TH[1]-BROW_TH[0])*float(ss(t/0.4))-(BROW_TH[1]-BROW_TH[2])*float(ss((t-0.45)/0.55))
    z = bot+(th if uv[i].y > 0.5 else 0.0)
    h = bvh.ray_cast(Vector((s*xn, -1, z)), Vector((0, 1, 0)))
    q = h[0]+h[1]*BROW_GAP if h[0] else Vector((s*xn, p.y, z))
    Dv.append(Mi@(q-p))
for kbk in me.shape_keys.key_blocks:               # 表情のキー（驚き・笑顔）も同じだけ動かす
    for i, d in enumerate(Dv): kbk.data[i].co += d
me.update(); br.visible_shadow = False
ob["idol_face"] = {k: float(v) for k, v in KEYS.items()}
print("idol face set")

# 5. 眉の表情（まばたき・やすらぎ）：眉を下げたら、まばたきで眉の下の肌が最大 5.8mm 動くようになり、肌に貼った眉頭が肌に埋もれて欠けた。
#   眉にも、すぐ下の肌と同じだけ動く表情キーを作り、体の同じ名前の表情キーの値で動かす（眉の驚き・笑顔のキーと同じドライバー）
from mathutils import kdtree as _kdt2
_n = len(ob.data.vertices)
def _kco(k): a = np.zeros(_n*3); k.data.foreach_get("co", a); return a.reshape(-1, 3)
_Bf = body_world(); _Bas = _kco(kb["Basis"])
_kdb = _kdt2.KDTree(_n)
for _i, _p in enumerate(_Bf): _kdb.insert(_p, _i)
_kdb.balance()
_bm = br.data; _bk = _bm.shape_keys; _Mb = np.array(br.matrix_world); _Mbi = np.linalg.inv(_Mb)[:3, :3]
_bb = np.array([list(d.co) for d in _bk.key_blocks["Basis"].data]); _Wb = _bb@_Mb[:3, :3].T+_Mb[:3, 3]
_near = [_kdb.find_n(_p, 4) for _p in _Wb]
for _name in ("exp-blink", "exp-blinkLeft", "exp-blinkRight", "exp-relaxed"):
    if _name not in kb: continue
    _D = _kco(kb[_name])-_Bas
    _dw = np.array([np.average([_D[i] for _, i, _ in r], axis=0, weights=[1/(d+1e-4) for _, _, d in r]) for r in _near])
    _k = _bk.key_blocks.get(_name) or br.shape_key_add(name=_name, from_mix=False)
    _k.data.foreach_set("co", (_bb+_dw@_Mbi.T).ravel()); _k.value = 0.0
    _path = 'key_blocks["%s"].value' % _name
    if not any(d.data_path == _path for d in (_bk.animation_data.drivers if _bk.animation_data else [])):
        _fc = _k.driver_add("value"); _dr = _fc.driver; _dr.type = "AVERAGE"
        _v = _dr.variables.new(); _v.name = "var"; _v.type = "SINGLE_PROP"
        _v.targets[0].id_type = "KEY"; _v.targets[0].id = ob.data.shape_keys; _v.targets[0].data_path = _path
_bm.update()
print("brow expression keys follow skin")
