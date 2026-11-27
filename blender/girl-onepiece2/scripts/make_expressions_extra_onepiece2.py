# 5 人目（ワンピース 2）に、怒り（exp-angry）と悲しみ（exp-sad）の表情を足す（Blender の中で exec する。何度流してもよい）。
#   VRM の基本の表情のうち、この 2 つだけ無かった。make_expressions_onepiece2.py は流し直さない（ほかの表情の手直しが消えるため）。
#   体（Girl_Body）：今ある部品の動きを足し合わせて作る
#     まぶた … まばたき（exp-blink）・やすらぎ（exp-relaxed）の動きを少しだけ（LID_BLINK・LID_RELAX）
#     口角   … mouth-angles-up の動きを逆向きに（MOUTH_DOWN）。口角が下がる
#     眉     … 眉のまわりの肌を、眉頭は BROW_IN、眉尻は BROW_OUT だけ上下させる（+ が上）。怒りは眉頭を下げて寄せ（BROW_PINCH）、悲しみは眉頭を上げる
#   眉（Girl_Brows）・まつ毛（Girl_LashStrands・Girl_LashLowerStrands）にも同じ名前のキーを作り、体のキーの値で動かす（ドライバー）
#   書き出し（export_vrm_onepiece2.py の EXPS）に angry・sad を入れてある
import bpy
import numpy as np

EXPR = globals().get("EXPR", {
    # 眉頭 3.5mm では表情が伝わらなかった
    "angry": dict(LID_BLINK=0.22, LID_RELAX=0.0, MOUTH_DOWN=0.6, BROW_IN=-0.0060, BROW_OUT=0.0020, BROW_PINCH=0.0030),
    "sad":   dict(LID_BLINK=0.10, LID_RELAX=0.35, MOUTH_DOWN=0.8, BROW_IN=0.0065, BROW_OUT=-0.0020, BROW_PINCH=0.0010),
})
ob = bpy.data.objects["Girl_Body"]; me = ob.data; kb = me.shape_keys.key_blocks; rig = bpy.data.objects["Girl_Rig"]; n = len(me.vertices)
def ss(t): t = np.clip(t, 0, 1); return t*t*(3-2*t)
def co(k, m=None):
    m = m or me; a = np.zeros(len(m.vertices)*3); k.data.foreach_get("co", a); return a.reshape(-1, 3)
def body_world():
    mods = [m for m in ob.modifiers if m.type in ("SUBSURF", "MASK")]; st = [m.show_viewport for m in mods]
    for m in mods: m.show_viewport = False
    pp = rig.data.pose_position; rig.data.pose_position = "REST"; bpy.context.view_layer.update()
    e = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = e.to_mesh()
    a = np.zeros(len(m.vertices)*3); m.vertices.foreach_get("co", a); e.to_mesh_clear()
    for m_, s in zip(mods, st): m_.show_viewport = s
    rig.data.pose_position = pp; bpy.context.view_layer.update()
    M = np.array(ob.matrix_world); return a.reshape(-1, 3)@M[:3, :3].T+M[:3, 3]

for e in EXPR:
    if "exp-"+e in kb: kb["exp-"+e].value = 0.0
ob.data.update()
B = body_world(); Bas = co(kb["Basis"])
D_blink = co(kb["exp-blink"])-Bas; D_relax = co(kb["exp-relaxed"])-Bas; D_mouth = co(kb["mouth-angles-up"])-Bas
eye = rig.data.bones["leftEye"].head_local; EZ = eye.z
# 眉のまわりの肌（目の玉・まつ毛の材質の頂点は動かさない）
_skip = {i for i, mt in enumerate(me.materials) if mt and mt.name.startswith(("Eye", "Lash"))}
fix = np.zeros(n, bool)
for p in me.polygons:
    if p.material_index in _skip: fix[list(p.vertices)] = True
def brow_delta(P, BI, BO, PI):
    """点 P（ワールド）での眉の動き。眉頭（顔のまん中から 1〜3cm）は BI、眉尻は BO だけ上下し、眉頭は PI だけまん中へ寄る"""
    x = np.abs(P[:, 0]); z = P[:, 2]
    band = ss((z-(EZ+0.004))/0.008)*ss((EZ+0.045-z)/0.012)*ss((0.065-x)/0.012)*(P[:, 1] < eye.y+0.01)
    inner = 1-ss((x-0.012)/0.03)
    d = np.zeros_like(P)
    d[:, 2] = band*(BI*inner+BO*(1-inner))
    d[:, 0] = -np.sign(P[:, 0])*band*PI*inner*ss(x/0.006)
    return d

br = bpy.data.objects["Girl_Brows"]; Mb = np.array(br.matrix_world); Mbi = np.linalg.inv(Mb)[:3, :3]
bbas = co(br.data.shape_keys.key_blocks["Basis"], br.data); Wb = bbas@Mb[:3, :3].T+Mb[:3, 3]
def bkey(name): k = br.data.shape_keys.key_blocks.get(name); return (co(k, br.data)-bbas) if k else 0.0

def add_driver(owner_key, obj_keys, name):
    path = 'key_blocks["%s"].value' % name
    ad = obj_keys.animation_data
    if ad and any(d.data_path == path for d in ad.drivers): return
    fc = owner_key.driver_add("value"); dr = fc.driver; dr.type = "AVERAGE"
    v = dr.variables.new(); v.name = "var"; v.type = "SINGLE_PROP"
    v.targets[0].id_type = "KEY"; v.targets[0].id = me.shape_keys; v.targets[0].data_path = path

for e, p in EXPR.items():
    name = "exp-"+e
    D = p["LID_BLINK"]*D_blink+p["LID_RELAX"]*D_relax-p["MOUTH_DOWN"]*D_mouth
    D += brow_delta(B, p["BROW_IN"], p["BROW_OUT"], p["BROW_PINCH"])*(~fix)[:, None]
    k = kb.get(name) or ob.shape_key_add(name=name, from_mix=False)
    k.data.foreach_set("co", (Bas+D).ravel()); k.value = 0.0
    # 眉：肌と同じ眉の動き＋まぶたの動きで眉の下の肌が動くぶん（眉のまばたき・やすらぎのキーと同じ割合）
    Db = p["LID_BLINK"]*bkey("exp-blink")+p["LID_RELAX"]*bkey("exp-relaxed")+brow_delta(Wb, p["BROW_IN"], p["BROW_OUT"], p["BROW_PINCH"])@Mbi.T
    kbw = br.data.shape_keys.key_blocks.get(name) or br.shape_key_add(name=name, from_mix=False)
    kbw.data.foreach_set("co", (bbas+Db).ravel()); kbw.value = 0.0
    add_driver(kbw, br.data.shape_keys, name)
    # まつ毛：まばたき・やすらぎのキーを同じ割合で
    for ln in ("Girl_LashStrands", "Girl_LashLowerStrands"):
        lo = bpy.data.objects[ln]; lk = lo.data.shape_keys.key_blocks; lb = co(lk["Basis"], lo.data)
        Dl = p["LID_BLINK"]*(co(lk["exp-blink"], lo.data)-lb)+p["LID_RELAX"]*(co(lk["exp-relaxed"], lo.data)-lb)
        kl = lk.get(name) or lo.shape_key_add(name=name, from_mix=False)
        kl.data.foreach_set("co", (lb+Dl).ravel()); kl.value = 0.0
        add_driver(kl, lo.data.shape_keys, name)
    br.data.update()
ob.data.update()
print("expressions added:", list(EXPR))

# 「お」（exp-oh）の作り直し：元の形は上唇が鼻の方へとがって前に出て、下唇が下へ伸び、縦に長すぎた（元は _orig-exp-oh に保管）。
#   丸くすぼめた口で、歯はほとんど見せない：
#   1. 「あ」（あごを開く。exp-aa）を OH_AA だけ。「う」（exp-ou）は使わない（OH_OU=0。「う」を混ぜると下唇が下へ大きく垂れて、変な顔になった）
#   2. 今の形（ほかのキーを混ぜた形）で、口のまわりを横へ OH_SQ だけ縮める（すぼめる）。OH_SZ は縦の倍率。2026-11-28 に「あ」を半分閉じただけ（OH_SQ=0）に決めた
#   3. OH_LIFT … 上唇のまん中（左右 OH_LX の幅）を持ち上げる量（今は使わない）
#   4. 歯（体のメッシュの歯と Girl_Teeth）を、上の歯は上へ・下の歯は下へ OH_TZ 逃がして唇の裏へ隠す（奥へ下げても、口の中の袋の手前で見えた）
#   位置の計算は、ほかのキーを混ぜた今の形でする（Basis は体の大きさを変える前の形で、口の位置がずれている）
OH_AA = globals().get("OH_AA", 0.5); OH_OU = globals().get("OH_OU", 0.0); OH_SQ = globals().get("OH_SQ", 0.0); OH_SZ = globals().get("OH_SZ", 1.0)
OH_LIFT = globals().get("OH_LIFT", 0.0); OH_LX = globals().get("OH_LX", 0.009); OH_TZ = globals().get("OH_TZ", 0.008)
_te = bpy.data.objects["Girl_Teeth"]; _tk = _te.data.shape_keys.key_blocks
for _obj, _keys in ((ob, kb), (_te, _tk)):
    if "_orig-exp-oh" not in _keys:
        _o = _obj.shape_key_add(name="_orig-exp-oh", from_mix=False); _o.data.foreach_set("co", co(_keys["exp-oh"], _obj.data).ravel()); _o.value = 0.0; _o.mute = True
_T0 = co(_tk["Basis"], _te.data); _Mti = np.linalg.inv(np.array(_te.matrix_world))[:3, :3]
_base = Bas+OH_AA*(co(kb["exp-aa"])-Bas)+OH_OU*(co(kb["exp-ou"])-Bas)
_tb = _T0+OH_AA*(co(_tk["exp-aa"], _te.data)-_T0)+OH_OU*(co(_tk["exp-ou"], _te.data)-_T0)
kb["exp-oh"].data.foreach_set("co", _base.ravel()); _tk["exp-oh"].data.foreach_set("co", _tb.ravel())
kb["exp-oh"].value = 1.0; ob.data.update(); _P = body_world()
_pp = rig.data.pose_position; rig.data.pose_position = "REST"; bpy.context.view_layer.update()
_e = _te.evaluated_get(bpy.context.evaluated_depsgraph_get()); _m = _e.to_mesh()
_PT = np.array([_te.matrix_world @ v.co for v in _m.vertices]); _e.to_mesh_clear()
rig.data.pose_position = _pp; kb["exp-oh"].value = 0.0; ob.data.update()
_mi = {mt.name: i for i, mt in enumerate(me.materials) if mt}
_lv = np.array(sorted({v for p in me.polygons if p.material_index == _mi["Lips"] for v in p.vertices}))
_ist = np.zeros(n, bool)
for p in me.polygons:
    if p.material_index == _mi["Teeth"]: _ist[list(p.vertices)] = True
_L = _P[_lv]; _c = _L[np.abs(_L[:, 0]) < 0.003]; _zs = np.sort(_c[:, 2]); _k = np.argmax(np.diff(_zs)); CZ = (_zs[_k]+_zs[_k+1])/2
_HW = np.abs(_L[:, 0]).max()
_x = np.abs(_P[:, 0]); _dz = _P[:, 2]-CZ
_reg = ss((0.022-np.abs(_dz))/0.012)*ss((_HW+0.012-_x)/0.010)*ss((0.06-np.abs(_P[:, 1]+0.185))/0.02)
_Q = _P.copy(); _Q[:, 0] *= (1-OH_SQ*_reg); _Q[:, 2] = CZ+_dz*(1+(OH_SZ-1)*_reg)
_Q[:, 2] += OH_LIFT*ss((OH_LX-_x)/OH_LX)*ss(_dz/0.002)*ss((0.02-_dz)/0.012)*ss((0.06-np.abs(_P[:, 1]+0.185))/0.02)*(~_ist)
_Q[_ist] = _P[_ist]; _Q[_ist, 2] += np.sign(_P[_ist, 2]-CZ)*OH_TZ
kb["exp-oh"].data.foreach_set("co", (_base+_Q-_P).ravel())
_DT = np.zeros_like(_PT); _DT[:, 2] = np.sign(_PT[:, 2]-CZ)*OH_TZ
_tk["exp-oh"].data.foreach_set("co", (_tb+_DT@_Mti.T).ravel())
ob.data.update(); _te.data.update()
print("exp-oh rebuilt")
