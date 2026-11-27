# 5 人目（ワンピース 2）の二重の線を、今のまぶたの形に合わせて描き直し、高さを決める（Blender の中で exec する。何度流してもよい）。
#   二重の線は肌の材質（Skin の Cr_* ノード）が、頂点の属性 mk_lid_dz（上まぶたのふちからの高さ）が CR_BASE+CR_SLOPE*（目頭→目じり）の
#   所に細い線を描く。mk_lid_dz は目の形を変える前に作ったままで、まぶたのまん中を下げたら線が途中で折れ曲がった。
#   元の値は「上まぶたのふち（まつ毛用の補助メッシュ helper-?-eyelashes-2 の下の端）からの縦の高さ × 0.822 + 0.00084」とぴったり合う
#   （相関 0.99）ので、同じ式で今の形から取り直す
#   CR_BASE・CR_SLOPE … 線の高さ（属性の単位。0.0052・0.0014 では、まつ毛から 5〜6mm 上で離れすぎていた。0.0035 では正面からまつ毛に隠れた）
import bpy
import numpy as np

CR_BASE = globals().get("CR_BASE", 0.0033); CR_SLOPE = globals().get("CR_SLOPE", 0.0004)   # 0.0040・0.0008 では斜めから見て線にこぶが出た（まぶたのふくらみで曲がる）
K, C0 = 0.822, 0.00084
ob = bpy.data.objects["Girl_Body"]; me = ob.data; rig = bpy.data.objects["Girl_Rig"]

def body_world():
    mods = [m for m in ob.modifiers if m.type in ("SUBSURF", "MASK")]; st = [m.show_viewport for m in mods]
    for m in mods: m.show_viewport = False
    pp = rig.data.pose_position; rig.data.pose_position = "REST"; bpy.context.view_layer.update()
    e = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = e.to_mesh()
    a = np.zeros(len(m.vertices)*3); m.vertices.foreach_get("co", a); e.to_mesh_clear()
    for m_, s in zip(mods, st): m_.show_viewport = s
    rig.data.pose_position = pp; bpy.context.view_layer.update()
    M = np.array(ob.matrix_world); return a.reshape(-1, 3)@M[:3, :3].T+M[:3, 3]

B = body_world(); n = len(B)
amp = np.zeros(n); me.attributes["mk_lid_amp"].data.foreach_get("value", amp)
dz = np.zeros(n); me.attributes["mk_lid_dz"].data.foreach_get("value", dz)
for side, g in ((1, "helper-l-eyelashes-2"), (-1, "helper-r-eyelashes-2")):
    gi = ob.vertex_groups[g].index
    P = B[[v.index for v in me.vertices if any(x.group == gi and x.weight > 0.5 for x in v.groups)]]
    xs = np.linspace(P[:, 0].min(), P[:, 0].max(), 60); zs = []
    for xx in xs:
        s = P[np.abs(P[:, 0]-xx) < 0.0015]; zs.append(s[:, 2].min() if len(s) else np.nan)
    zs = np.array(zs); ok = ~np.isnan(zs)
    pf = np.polyfit(xs[ok], zs[ok], 4)                     # ふちの高さを曲線で当てはめる（細かく拾うと段がつき、線にこぶができた）
    sel = np.where((amp > 0) & (np.sign(B[:, 0]) == side))[0]
    xc = np.clip(B[sel, 0], xs[ok].min(), xs[ok].max())
    dz[sel] = K*(B[sel, 2]-np.polyval(pf, xc))+C0
me.attributes["mk_lid_dz"].data.foreach_set("value", dz); me.update()
N = bpy.data.materials["Skin"].node_tree.nodes
N["Cr_ADD"].inputs[1].default_value = CR_BASE; N["Cr_MULTIPLY"].inputs[1].default_value = CR_SLOPE
print("crease redrawn", (amp > 0).sum(), "verts")
