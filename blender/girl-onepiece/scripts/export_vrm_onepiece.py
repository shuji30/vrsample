# 4 人目（ワンピース）をゲーム用に VRM 1.0 で書き出す（Blender の中で exec する）。出力は blender/girl-onepiece/export/girl-onepiece.vrm。
# vrgame2/blender/girl/scripts/export_vrm.py の写し。ちがいは、出力先・名前と、柄（ジャカード）のスカートを焼く画像の大きさ（2048）だけ。
#   1) 見えている物（体・服・髪・眉・口の中）の写しを X_* という名前で作る。サングラスは入れない
#      体：隠してある頂点を消し、いまの顔・体の形を基本の形にして、表情（exp-*）だけを残す
#   2) 色を画像に焼く：肌・瞳・まつ毛・髪・服の柄は Blender 専用の計算で描いているので、そのままでは書き出せない
#   3) 人型の骨の割り当て・表情・作者などを VRM の設定に入れ、T ポーズにして書き出す
# 書き出したあと、写しは消して、姿勢を元に戻す。
import bpy, bmesh, os, re, math
import numpy as np
from mathutils import Vector, Matrix

OUT = "C:\\Users\\shuji\\vrsample\\blender\\girl-onepiece\\export\\"; os.makedirs(OUT, exist_ok=True)
NAME = globals().get("NAME", "girl-onepiece"); TITLE = globals().get("TITLE", "Girl (one-piece)")      # 出力ファイル名（NAME.vrm）と、モデルの名前
sc = bpy.context.scene; rig = bpy.data.objects["Girl_Rig"]; arm = rig.data
EXPS = ("aa", "ih", "ou", "ee", "oh", "happy", "surprised", "blink", "relaxed", "blinkLeft", "blinkRight")
for o in [o for o in bpy.data.objects if o.name.startswith("X_")]: bpy.data.objects.remove(o, do_unlink=True)
col = bpy.data.collections.get("Export") or bpy.data.collections.new("Export")
if col.name not in sc.collection.children: sc.collection.children.link(col)
rig.data.pose_position = 'REST'; bpy.context.view_layer.update()
if "hairSwingEnd" not in arm.bones:                     # 髪の揺れ骨の先（揺れものは、骨が 2 つつながっていないと動かない）
    for o in bpy.context.view_layer.objects: o.select_set(False)
    _hid = (rig.hide_viewport, rig.hide_get()); rig.hide_viewport = False; rig.hide_set(False)      # 隠してあると編集に入れない
    rig.select_set(True); bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode='EDIT')
    _p = arm.edit_bones["hairSwing"]; _e = arm.edit_bones.new("hairSwingEnd"); _e.head = _p.tail; _e.tail = _p.tail+(_p.tail-_p.head).normalized()*0.05; _e.parent = _p; _e.use_connect = True
    bpy.ops.object.mode_set(mode='OBJECT')
    rig.hide_viewport = _hid[0]; rig.hide_set(_hid[1])

# ── 1) 写しを作る ──
def copy_obj(src, name):
    o = src.copy(); o.data = src.data.copy(); o.name = name; o.data.name = name
    if src.name.startswith("Girl_Hair") and any(m.type == 'SOLIDIFY' for m in src.modifiers):
        # 髪は厚み（Solidify）を固めてから書き出す。外すと片面だけになり、裏向きの面がゲームで抜ける（横分けの髪で、額を横切る毛が消えた）
        _st = {m.name: (m.show_viewport, m.show_render) for m in src.modifiers}
        for m in src.modifiers:
            if m.type != 'SOLIDIFY': m.show_viewport = False; m.show_render = False
        bpy.context.view_layer.update()
        _me = bpy.data.meshes.new_from_object(src.evaluated_get(bpy.context.evaluated_depsgraph_get()), preserve_all_data_layers=True, depsgraph=bpy.context.evaluated_depsgraph_get())
        for m in src.modifiers: m.show_viewport, m.show_render = _st[m.name]
        _me.name = name; o.data = _me
        for p in o.data.polygons: p.use_smooth = True
    for c in list(o.users_collection): c.objects.unlink(o)
    col.objects.link(o); o.hide_viewport = False; o.hide_render = False
    for md in [m for m in o.modifiers if m.type != 'ARMATURE']: o.modifiers.remove(md)
    return o
src_body = bpy.data.objects["Girl_Body"]
xb = copy_obj(src_body, "X_Body")
bidx = xb.vertex_groups["body"].index
bm = bmesh.new(); bm.from_mesh(xb.data); dl = bm.verts.layers.deform.verify()
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v[dl].get(bidx, 0.0) <= 0.5], context='VERTS')
bm.to_mesh(xb.data); bm.free(); xb.data.update()
kb = xb.data.shape_keys.key_blocks; n = len(xb.data.vertices)
def kco(k): a = np.zeros(n*3); k.data.foreach_get("co", a); return a.reshape(n, 3)
for e in EXPS: kb["exp-"+e].value = 0
bpy.context.view_layer.update()
ev = xb.evaluated_get(bpy.context.evaluated_depsgraph_get()); m = ev.to_mesh()
mix = np.zeros(n*3); m.vertices.foreach_get("co", mix); mix = mix.reshape(n, 3); ev.to_mesh_clear()
B = kco(kb["Basis"]); deltas = {e: kco(kb["exp-"+e])-B for e in EXPS}
xb.shape_key_clear(); xb.data.vertices.foreach_set("co", mix.ravel()); xb.data.update()
xb.shape_key_add(name="Basis", from_mix=False)
for e in EXPS: xb.shape_key_add(name="exp-"+e, from_mix=False).data.foreach_set("co", (mix+deltas[e]).ravel())
for g in [g for g in xb.vertex_groups if g.name not in arm.bones]: xb.vertex_groups.remove(g)
# 体を細分化（Subdivision）してから書き出す：Blender では細分化して見ているが、書き出しでは外れていて、ゲームでは粗いポリゴンの
# 折れ目が影になり、目の下・口元にしわ、ほおがこけたように見えて、年上に見えた。
# シェイプキーは細分化を通せないので、基本の形と表情ごとに、その形で細分化した頂点の位置を取り、細分化した体に付け直す
SUBDIV = globals().get("SUBDIV", next((m.levels for m in src_body.modifiers if m.type == 'SUBSURF'), 0))
if SUBDIV > 0:
    def _subdiv_co(co):
        t = bpy.data.objects.new("_subdiv_tmp", xb.data.copy()); col.objects.link(t)
        t.shape_key_clear(); t.data.vertices.foreach_set("co", co.ravel()); t.data.update()
        md = t.modifiers.new("Subdivision", 'SUBSURF'); md.levels = SUBDIV; md.render_levels = SUBDIV
        bpy.context.view_layer.update(); dg_ = bpy.context.evaluated_depsgraph_get()
        me_ = bpy.data.meshes.new_from_object(t.evaluated_get(dg_), preserve_all_data_layers=True, depsgraph=dg_)
        tmp_me = t.data; bpy.data.objects.remove(t, do_unlink=True); bpy.data.meshes.remove(tmp_me)
        return me_
    base_me = _subdiv_co(mix)
    sub_keys = {}
    for e in EXPS:
        me_ = _subdiv_co(mix+deltas[e]); a = np.zeros(len(me_.vertices)*3); me_.vertices.foreach_get("co", a); sub_keys[e] = a
        bpy.data.meshes.remove(me_)
    old_me = xb.data; xb.data = base_me; base_me.name = "X_Body"; bpy.data.meshes.remove(old_me)
    xb.shape_key_add(name="Basis", from_mix=False)
    for e in EXPS: xb.shape_key_add(name="exp-"+e, from_mix=False).data.foreach_set("co", sub_keys[e])
    for p in xb.data.polygons: p.use_smooth = True
    for g in [g for g in xb.vertex_groups if g.name not in arm.bones]: xb.vertex_groups.remove(g)
    print("body subdivided:", n, "->", len(xb.data.vertices), "verts")
others = {}
for o in list(bpy.data.objects):
    if o.type != 'MESH' or o is src_body or o.name.startswith("X_") or o.hide_viewport or o.parent is not rig or o.parent_type == 'BONE': continue
    x = copy_obj(o, "X_"+o.name.split("_", 1)[-1]); others[o.name] = x
    for g in [g for g in x.vertex_groups if g.name not in arm.bones]: x.vertex_groups.remove(g)
print("copies:", ["X_Body"]+[x.name for x in others.values()], "body verts", n)

# ── 2) 色を焼く ──
old_engine = sc.render.engine; sc.render.engine = 'CYCLES'; sc.cycles.samples = 1; sc.cycles.device = 'CPU'
def image(name, size, noncolor=False):
    im = bpy.data.images.get(name)
    if im: bpy.data.images.remove(im)
    im = bpy.data.images.new(name, size, size, alpha=True)
    if noncolor: im.colorspace_settings.name = 'Non-Color'
    return im
dummy = image("bake_dummy", 16)
def bake(obj, targets, alpha=False):
    """targets: {マテリアル名: 画像}。alpha=True のときは、透明度（Alpha につながっている値）を色として焼く"""
    temp = []; undo = []
    for slot in obj.material_slots:
        mt = slot.material; nt = mt.node_tree
        nd = nt.nodes.new("ShaderNodeTexImage"); nd.image = targets.get(mt.name, dummy); nt.nodes.active = nd; temp.append((nt, nd))
        if alpha and mt.name in targets:
            b = next(x for x in nt.nodes if x.type == "BSDF_PRINCIPLED"); bc = b.inputs["Base Color"]
            prev = bc.links[0].from_socket if bc.is_linked else None
            if b.inputs["Alpha"].is_linked: nt.links.new(b.inputs["Alpha"].links[0].from_socket, bc)
            else:
                for l in list(bc.links): nt.links.remove(l)
                undo.append((bc, tuple(bc.default_value))); bc.default_value = (1, 1, 1, 1)
            undo.append((nt, bc, prev))
    for o in bpy.context.view_layer.objects: o.select_set(False)
    obj.select_set(True); bpy.context.view_layer.objects.active = obj
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, margin=8, use_clear=True)
    for u in undo:
        if len(u) == 3:
            nt, bc, prev = u
            for l in list(bc.links): nt.links.remove(l)
            if prev: nt.links.new(prev, bc)
    for u in undo:
        if len(u) == 2: u[0].default_value = u[1]
    for nt, nd in temp: nt.nodes.remove(nd)
def merge(color, alpha_im, path):
    w, h = color.size; a = np.empty(w*h*4, dtype=np.float32); color.pixels.foreach_get(a); a = a.reshape(-1, 4)
    if alpha_im is not None:
        b = np.empty(w*h*4, dtype=np.float32); alpha_im.pixels.foreach_get(b); a[:, 3] = b.reshape(-1, 4)[:, 0]
    else: a[:, 3] = 1.0
    color.pixels.foreach_set(a.ravel()); color.filepath_raw = path; color.file_format = 'PNG'; color.save()
def texmat(name, img, cutout=False):
    mt = bpy.data.materials.get(name)
    if mt: bpy.data.materials.remove(mt)
    mt = bpy.data.materials.new(name); mt.use_nodes = True; nt = mt.node_tree
    b = next(x for x in nt.nodes if x.type == "BSDF_PRINCIPLED"); b.inputs["Roughness"].default_value = 0.7
    t = nt.nodes.new("ShaderNodeTexImage"); t.image = img; nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    if cutout:                                           # 透明度を 0 か 1 に丸める（書き出しで「切りぬき」になる）
        r = nt.nodes.new("ShaderNodeMath"); r.operation = 'ROUND'; nt.links.new(t.outputs["Alpha"], r.inputs[0]); nt.links.new(r.outputs[0], b.inputs["Alpha"])
    mt.use_backface_culling = False
    return mt
def one_material(obj, mt):
    obj.data.materials.clear(); obj.data.materials.append(mt)
    for p in obj.data.polygons: p.material_index = 0
def unwrap(obj):
    for o in bpy.context.view_layer.objects: o.select_set(False)
    obj.select_set(True); bpy.context.view_layer.objects.active = obj
    if not obj.data.uv_layers: obj.data.uv_layers.new(name="UVMap")
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(island_margin=0.02); bpy.ops.object.mode_set(mode='OBJECT')

# 頭（首の中ほどより上）の肌は、体とべつの画像に焼く（SkinFace）。体と同じ 1 枚では顔が画像の小さな一部にしかならず
# （口の幅が 40 ピクセルほど）、唇のふちや目じりのメイクが粗いピクセルになって、ゲームで口の端・目じりのしわや点に見えた
_sk = next((k for k, s in enumerate(xb.material_slots) if s.name == "Skin"), None)
if _sk is not None:
    _zcut = arm.bones["neck"].head_local.z+0.03
    # 前に書き出したときの SkinFace が残っていると、写しが SkinFace.001 になって顔の画像に焼かれず、顔が真っ黒になる
    for _old in [m for m in bpy.data.materials if m.name.startswith("SkinFace")]: bpy.data.materials.remove(_old)
    _fm = bpy.data.materials["Skin"].copy(); _fm.name = "SkinFace"; xb.data.materials.append(_fm); _fk = len(xb.data.materials)-1
    for p in xb.data.polygons:
        # 顔の前半分だけ（耳・後頭部・首のかけらは入れない。入れると UV の範囲が広がって、顔が小さくなる）
        if p.material_index == _sk and p.center.z > _zcut and p.center.y < -0.06 and abs(p.center.x) < 0.075: p.material_index = _fk
    # 唇の面のうち、UV が顔の島の外にあるもの（唇の内側など、離れた所に置かれた島）は、体の画像のままにする
    _uvd = xb.data.uv_layers.active.data
    # 顔の面のうち、UV が顔の大きな島から離れた所にあるもの（目のまわりの内側・鼻や口の中など）は体の画像へ戻す
    _cs = [(p, sum((_uvd[l].uv for l in p.loop_indices), Vector((0, 0)))/len(p.loop_indices)) for p in xb.data.polygons if p.material_index == _fk]
    _su = sorted(c.x for _, c in _cs); _sv = sorted(c.y for _, c in _cs); _q = lambda a, f: a[int(f*(len(a)-1))]
    _u0, _u1, _v0, _v1 = _q(_su, 0.03), _q(_su, 0.97), _q(_sv, 0.03), _q(_sv, 0.97); _mu = (_u1-_u0)*0.15; _mv = (_v1-_v0)*0.15
    for p, c in _cs:
        if not (_u0-_mu <= c.x <= _u1+_mu and _v0-_mv <= c.y <= _v1+_mv): p.material_index = _sk
    _fl = [l for p in xb.data.polygons if p.material_index == _fk for l in p.loop_indices]
    _fu = [_uvd[l].uv.x for l in _fl]; _fv = [_uvd[l].uv.y for l in _fl]
    _bb = (min(_fu), max(_fu), min(_fv), max(_fv))
    _lk = next((k for k, s in enumerate(xb.material_slots) if s.name == "Lips"), None)
    for p in xb.data.polygons:
        if p.material_index == _lk and any(not (_bb[0] <= _uvd[l].uv.x <= _bb[1] and _bb[2] <= _uvd[l].uv.y <= _bb[3]) for l in p.loop_indices):
            p.material_index = _sk
# 体：肌・唇 / 目 / まつ毛を、べつの画像へ（UV が重なっているかもしれないので分ける）
names = [s.name for s in xb.material_slots]
skin_i = image("bake_skin", 2048); eye_i = image("bake_eye", 2048)       # 目は 512 では黒目が 25 ピクセルほどしかなく粗かった
lash_i = image("bake_lash", 1024); lash_a = image("bake_lash_a", 1024, True)
face_i = image("bake_face", 2048)
SKIN = ("Skin", "Lips", "MouthInner", "Teeth", "Tongue"); LASH = ("Lash", "LashLower"); FACE = ("SkinFace", "Lips")
tg = {nm: skin_i for nm in SKIN}; tg["Eye"] = eye_i; tg.update({nm: lash_i for nm in LASH}); tg.update({nm: face_i for nm in FACE})
def _spread_uv(group, same_scale=False):
    """その材質の面の UV を、画像いっぱいに広げる（元の UV では目が 27×13 ピクセルほどしかなく、瞳がつぶれて白くなる。まつ毛も粗くなる）"""
    idx = [k for k, nm in enumerate(names) if nm in group]
    uvd = xb.data.uv_layers.active.data
    ls = [l for p in xb.data.polygons if p.material_index in idx for l in p.loop_indices]
    if not ls: return
    us = [uvd[l].uv.x for l in ls]; vs = [uvd[l].uv.y for l in ls]; u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
    if same_scale:                                       # 縦横を同じ倍率で（顔の形がゆがまないように）。離れた島ごとに置き直す
        # 面を、UV の横方向のすき間で島に分ける（顔の大きな島と、まぶたのまわりの小さな島）
        ps = [p for p in xb.data.polygons if p.material_index in idx]
        cu = {p.index: sum(uvd[l].uv.x for l in p.loop_indices)/len(p.loop_indices) for p in ps}
        order = sorted(ps, key=lambda p: cu[p.index]); groups = [[order[0]]]
        for a, b in zip(order, order[1:]):
            if cu[b.index]-cu[a.index] > 0.03: groups.append([])
            groups[-1].append(b)
        groups.sort(key=len, reverse=True)
        # いちばん大きい島は左 72%、残りは右の列に縦に並べる
        rects = [(0.02, 0.02, 0.72, 0.98)]
        rest = groups[1:]
        for i in range(len(rest)): h = 0.96/max(1, len(rest)); rects.append((0.74, 0.02+h*i, 0.98, 0.02+h*(i+1)))
        for g, (x0, y0, x1, y1) in zip(groups, rects):
            gl = [l for p in g for l in p.loop_indices]
            gu = [uvd[l].uv.x for l in gl]; gv = [uvd[l].uv.y for l in gl]
            a0, a1, b0, b1 = min(gu), max(gu), min(gv), max(gv)
            k = min((x1-x0)/max(a1-a0, 1e-6), (y1-y0)/max(b1-b0, 1e-6))
            for l in gl: uvd[l].uv = (x0+k*(uvd[l].uv.x-a0), y0+k*(uvd[l].uv.y-b0))
        return
    for l in ls: uvd[l].uv = (0.04+0.92*(uvd[l].uv.x-u0)/max(u1-u0, 1e-6), 0.04+0.92*(uvd[l].uv.y-v0)/max(v1-v0, 1e-6))
_spread_uv(("Eye",)); _spread_uv(LASH); _spread_uv(FACE, True)
bake(xb, tg); bake(xb, {nm: lash_a for nm in LASH}, alpha=True)
def fill_holes(img, iters=10):
    """焼いた画像で、どの面も塗らなかった小さなすき間（真っ黒の画素）を、まわりの色で埋める。
    顔の画像では、唇の端や上唇のふちに黒い点として出ていた"""
    w, h = img.size; a = np.empty(w*h*4, dtype=np.float32); img.pixels.foreach_get(a); a = a.reshape(h, w, 4)
    rgb = a[:, :, :3]; hole = rgb.sum(2) < 0.03
    for _ in range(iters):
        if not hole.any(): break
        acc = np.zeros_like(rgb); cnt = np.zeros(hole.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            src = np.roll(np.roll(rgb, dy, 0), dx, 1); ok = ~np.roll(np.roll(hole, dy, 0), dx, 1)
            acc += src*ok[:, :, None]; cnt += ok
        fill = hole & (cnt > 0)
        rgb[fill] = acc[fill]/cnt[fill][:, None]; hole = hole & ~fill
    a[:, :, :3] = rgb; img.pixels.foreach_set(a.ravel())
def despeckle(img, ratio=0.8, R=4, frac=0.25):
    """まわりより目立って暗い、小さな点（唇の端の暗い赤茶の点など）を、まわりの平均色で埋める。
    口の切れ目のように暗い所が広く続く所は、点ではないので残す"""
    w, h = img.size; a = np.empty(w*h*4, dtype=np.float32); img.pixels.foreach_get(a); a = a.reshape(h, w, 4)
    rgb = a[:, :, :3]; lum = rgb.sum(2)
    acc = np.zeros_like(lum); n = 0
    for dy in range(-R, R+1):
        for dx in range(-R, R+1):
            acc += np.roll(np.roll(lum, dy, 0), dx, 1); n += 1
    dark = lum < acc/n*ratio
    dk = np.zeros_like(lum)
    for dy in range(-R, R+1):
        for dx in range(-R, R+1):
            dk += np.roll(np.roll(dark, dy, 0), dx, 1)
    spot = dark & (dk/n < frac)
    # 目のまわりの細いアイラインまで消さないよう、唇（赤みの強い所）のまわりだけにする
    lip = (rgb[:, :, 0]-rgb[:, :, 1] > 0.23) & (lum > 1.0)
    if lip.any():
        ys, xs = np.nonzero(lip); m = np.zeros_like(spot)
        m[max(ys.min()-60, 0):ys.max()+60, max(xs.min()-60, 0):xs.max()+60] = True
        # 唇のふち（くっきりした境目）はさわらない。唇から離れた肌の上の、うすい灰色の点（上唇の上の点線）は拾う
        near = lip.copy()
        for _ in range(5): near = near | np.roll(near, 1, 0) | np.roll(near, -1, 0) | np.roll(near, 1, 1) | np.roll(near, -1, 1)
        faint = (lum < acc/n*0.95) & (dk/n < frac)
        spot = (spot | (faint & ~near)) & m
    else:
        spot[:] = False
    good = ~spot; sm = np.zeros_like(rgb); cnt = np.zeros_like(lum)
    for dy in range(-R, R+1):
        for dx in range(-R, R+1):
            ok = np.roll(np.roll(good, dy, 0), dx, 1)
            sm += np.roll(np.roll(rgb, dy, 0), dx, 1)*ok[:, :, None]; cnt += ok
    f = spot & (cnt > 0); rgb[f] = sm[f]/cnt[f][:, None]
    print("despeckle", int(f.sum()))
    a[:, :, :3] = rgb; img.pixels.foreach_set(a.ravel())
fill_holes(face_i); despeckle(face_i)
merge(skin_i, None, OUT+"skin.png"); merge(eye_i, None, OUT+"eye.png"); merge(lash_i, lash_a, OUT+"lash.png"); merge(face_i, None, OUT+"face.png")
M = [texmat("X_Skin", skin_i), texmat("X_Eye", eye_i), texmat("X_Lash", lash_i, True), texmat("X_Face", face_i)]
# 唇は顔と同じ画像のまま、つやのある別の材質にする（つやのあるルージュ。肌と同じ材質だと、ゲームでつやが出ない）
_lips = texmat("X_Lips", face_i); _lb = next(x for x in _lips.node_tree.nodes if x.type == "BSDF_PRINCIPLED")
_lb.inputs["Roughness"].default_value = 0.22; _lb.inputs["Specular IOR Level"].default_value = 0.7
M.append(_lips)
grp = [4 if nm == "Lips" else (3 if nm == "SkinFace" else (0 if nm in SKIN else (1 if nm == "Eye" else (2 if nm in LASH else 0)))) for nm in names]
pm = [grp[p.material_index] for p in xb.data.polygons]
xb.data.materials.clear()
for mt in M: xb.data.materials.append(mt)
for p, g in zip(xb.data.polygons, pm): p.material_index = g
print("baked body")
# 髪・柄のある服
def _linked(mt):
    b = next((x for x in mt.node_tree.nodes if x.type == "BSDF_PRINCIPLED"), None) if mt and mt.node_tree else None
    return bool(b and b.inputs["Base Color"].is_linked)
for o in others.values():
    mats = [s.name for s in o.material_slots]
    if o.name.startswith(("X_Hair", "X_Brows")):                  # 眉も毛の筋を透けで描いているので、髪と同じく色と透けを焼く
        _sz = 2048 if o.name.startswith("X_Hair") else 1024           # 髪は前髪の細い毛束を透けで描いているので、粗いと毛束がつぶれる
        ci = image("bake_"+o.name, _sz); ai = image("bake_"+o.name+"_a", _sz, True)
        bake(o, {mats[0]: ci}); bake(o, {mats[0]: ai}, alpha=True); merge(ci, ai, OUT+o.name+".png")
        one_material(o, texmat(o.name+"_M", ci, True))
    elif "S_Pattern" in mats or "J_Pattern" in mats:
        unwrap(o); ci = image("bake_"+o.name, 1024)
        bake(o, {nm: ci for nm in mats}); merge(ci, None, OUT+o.name+".png"); one_material(o, texmat(o.name+"_M", ci))
    elif any(_linked(s.material) for s in o.material_slots):      # 計算で描いた柄（デニムなど）の材質だけを画像に焼く。金具などはそのまま
        lk = [s.name for s in o.material_slots if _linked(s.material)]
        unwrap(o); ci = image("bake_"+o.name, 2048 if "Skirt" in o.name else 1024)
        bake(o, {nm: ci for nm in lk}); merge(ci, None, OUT+o.name+".png"); tm = texmat(o.name+"_M", ci)
        for s in o.material_slots:
            if s.name in lk: s.material = tm
            else: s.material.use_backface_culling = False
    else:
        for s in o.material_slots: s.material.use_backface_culling = False
    print("baked", o.name)
sc.render.engine = old_engine

# ── 3) VRM の設定 ──
ext = arm.vrm_addon_extension; ext.spec_version = ext.SPEC_VERSION_VRM1; v1 = ext.vrm1
def snake(s): return re.sub(r"(?<!^)(?=[A-Z])", "_", s).lower()
hb = v1.humanoid.human_bones
for b in arm.bones:
    if b.name.startswith("hairSwing"): continue
    getattr(hb, snake(b.name)).node.bone_name = b.name
for e in EXPS:
    ex = getattr(v1.expressions.preset, snake(e)); ex.morph_target_binds.clear()
    for obj in [xb]+[o for o in others.values() if o.data.shape_keys and "exp-"+e in o.data.shape_keys.key_blocks]:
        bd = ex.morph_target_binds.add(); bd.node.mesh_object_name = obj.name; bd.index = "exp-"+e; bd.weight = 1.0
# 視線：目の骨を回して、見る相手を追う。目の位置（頭の骨から見た、両目のまん中）を入れる
_hb = arm.bones["head"].head_local; _em = (arm.bones["leftEye"].head_local+arm.bones["rightEye"].head_local)/2
v1.look_at.type = 'bone'; v1.look_at.offset_from_head_bone = tuple(_em-_hb)
for _n, _out in (("range_map_horizontal_inner", 8.0), ("range_map_horizontal_outer", 10.0), ("range_map_vertical_down", 8.0), ("range_map_vertical_up", 8.0)):
    _r = getattr(v1.look_at, _n); _r.input_max_value = 90.0; _r.output_scale = _out
# 揺れもの：髪（耳の高さから下）を、頭の動きに遅れて揺らす
_sb = ext.spring_bone1
while len(_sb.springs): bpy.ops.vrm.remove_spring_bone1_spring(armature_object_name=rig.name, spring_index=0)
bpy.ops.vrm.add_spring_bone1_spring(armature_object_name=rig.name); _sp = _sb.springs[0]; _sp.vrm_name = "hair"
for _bn in ("hairSwing", "hairSwingEnd"):
    bpy.ops.vrm.add_spring_bone1_spring_joint(armature_object_name=rig.name, spring_index=0, guess_properties=False)
    _j = _sp.joints[-1]; _j.node.bone_name = _bn; _j.hit_radius = 0.0; _j.stiffness = 0.8; _j.gravity_power = 0.35; _j.gravity_dir = (0, 0, -1); _j.drag_force = 0.45
v1.meta.vrm_name = TITLE; v1.meta.version = "1"
v1.meta.authors.clear(); v1.meta.authors.add().value = "shuji30"
v1.meta.commercial_usage = "corporation"                 # 売り物のゲームに使えるように、商用利用を許可（再配布・改変は「不可」のまま）
# T ポーズ：腕を真横、脚を真下へ
rig.data.pose_position = 'POSE'; P = rig.pose.bones
sw = [(c, c.mute) for c in P["hairSwing"].constraints]
for c, _ in sw: c.mute = True
saved = {pb.name: (pb.rotation_mode, pb.rotation_quaternion.copy(), pb.location.copy()) for pb in P}
for pb in P: pb.rotation_mode = 'QUATERNION'; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
bpy.context.view_layer.update()
def aim(name, d):
    pb = P[name]; q = (pb.tail-pb.head).normalized().rotation_difference(Vector(d).normalized())
    pb.matrix = Matrix.Translation(pb.head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-pb.head) @ pb.matrix; bpy.context.view_layer.update()
for side, s in (("left", 1), ("right", -1)):
    for b in ("Shoulder", "UpperArm", "LowerArm", "Hand"): aim(side+b, (s, 0, 0))
    for b in ("UpperLeg", "LowerLeg"): aim(side+b, (0, 0, -1))
try: v1.humanoid.pose = 'currentPose'
except Exception as err: print("pose enum:", [i.identifier for i in v1.humanoid.bl_rna.properties["pose"].enum_items], err)
for o in bpy.context.view_layer.objects: o.select_set(False)
for o in [rig, xb]+list(others.values()): o.select_set(True)
bpy.context.view_layer.objects.active = rig
res = bpy.ops.export_scene.vrm(filepath=OUT+NAME+".vrm", export_only_selections=True, export_invisibles=False, armature_object_name=rig.name, ignore_warning=True)
print("export:", res, os.path.getsize(OUT+NAME+".vrm") if os.path.exists(OUT+NAME+".vrm") else "no file")
# 片づけ
for pb in P:
    md, q, l = saved[pb.name]; pb.rotation_mode = md; pb.rotation_quaternion = q; pb.location = l
for c, mu in sw: c.mute = mu
for o in [xb]+list(others.values()): bpy.data.objects.remove(o, do_unlink=True)
bpy.context.view_layer.update()
