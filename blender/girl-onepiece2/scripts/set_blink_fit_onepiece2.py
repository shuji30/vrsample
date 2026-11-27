# 5 人目（ワンピース 2）のまばたき（exp-blink・exp-blinkLeft・exp-blinkRight）を、今の目の形に合わせ直す（Blender の中で exec する。何度流してもよい）。
#   まばたきのキーは「開いた目からの動き」なので、目の形（まぶたの高さ・目じり）を変えると、閉じたまぶたが行き過ぎて、くしゃっと乱れた。
#   閉じた位置が、目を直す前の閉じた位置と同じになるように、目を直したぶんの動き（B1-B0）を、まばたきが動かす頂点から差し引く。
#   元のキーは一度だけ "_orig-<名前>" として写して残す（値 0・ミュート。何度流しても元から計算する）
#   まつ毛のまばたきのキーは set_lash_fit_onepiece2.py が、閉じた位置を保管した元のまつ毛のままにしている
import bpy
import numpy as np

KEYS = ("exp-blink", "exp-blinkLeft", "exp-blinkRight")
ORIG = globals().get("ORIG", {"eye-height2-decr": 0.3, "custom-eye-slant": 1.0, "custom-eye-almond": 1.0, "eye-scale-incr": 0.5,
                              "custom-idol-eye": 0.0, "custom-lowlid-clean": 0.0, "custom-smooth-wrinkle": 0.0})
ob = bpy.data.objects["Girl_Body"]; kb = ob.data.shape_keys.key_blocks; rig = bpy.data.objects["Girl_Rig"]; n = len(ob.data.vertices)
def body_world():
    mods = [m for m in ob.modifiers if m.type in ("SUBSURF", "MASK")]; st = [m.show_viewport for m in mods]
    for m in mods: m.show_viewport = False
    pp = rig.data.pose_position; rig.data.pose_position = "REST"; bpy.context.view_layer.update()
    e = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = e.to_mesh()
    a = np.zeros(len(m.vertices)*3); m.vertices.foreach_get("co", a); e.to_mesh_clear()
    for m_, s in zip(mods, st): m_.show_viewport = s
    rig.data.pose_position = pp; bpy.context.view_layer.update()
    M = np.array(ob.matrix_world); return a.reshape(-1, 3)@M[:3, :3].T+M[:3, 3]
def names(k): return [k] if k in kb else ["l-"+k, "r-"+k]
def co(k): a = np.zeros(n*3); k.data.foreach_get("co", a); return a.reshape(-1, 3)

# まばたきの値を 0 にして測る（ドライバーで動くことがあるので、いったん値を控える）
saved = {k: kb[k].value for k in KEYS}
for k in KEYS: kb[k].value = 0.0
B1 = body_world()
now = {nm: kb[nm].value for k in ORIG for nm in names(k) if nm in kb}
for k, v in ORIG.items():
    for nm in names(k):
        if nm in kb: kb[nm].value = v
ob.data.update(); B0 = body_world()
for nm, v in now.items(): kb[nm].value = v
ob.data.update()
Bas = co(kb["Basis"])
for k in KEYS:
    o = kb.get("_orig-"+k)
    if o is None:
        o = ob.shape_key_add(name="_orig-"+k, from_mix=False); o.data.foreach_set("co", co(kb[k]).ravel())
        o.value = 0.0; o.mute = True
    D = co(o)-Bas
    w = np.clip((np.linalg.norm(D, axis=1)-0.0005)/0.0015, 0, 1)   # まばたきで 0.5mm 以上動くまぶたの頂点だけ（少しでも動く所に入れたら、眉頭の肌がふくらんだ）
    kb[k].data.foreach_set("co", (Bas+D-(B1-B0)*w[:, None]).ravel())
for k in KEYS: kb[k].value = saved[k]
ob.data.update()
print("blink refit")
