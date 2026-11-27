# 3 人目（ニットコーデ）をゲーム用に VRM 1.0 で書き出す（Blender の中で exec する）。出力は blender/girl-knit/export/girl-knit.vrm。
# vrgame2/blender/girl/scripts/export_vrm.py の写し。ちがいは、出力先・名前と、柄（ジャカード）のスカートを焼く画像の大きさ（2048）だけ。
#   1) 見えている物（体・服・髪・眉・口の中）の写しを X_* という名前で作る。サングラスは入れない
#      体：隠してある頂点を消し、いまの顔・体の形を基本の形にして、表情（exp-*）だけを残す
#   2) 色を画像に焼く：肌・瞳・まつ毛・髪・服の柄は Blender 専用の計算で描いているので、そのままでは書き出せない
#   3) 人型の骨の割り当て・表情・作者などを VRM の設定に入れ、T ポーズにして書き出す
# 書き出したあと、写しは消して、姿勢を元に戻す。
import bpy, bmesh, os, re, math
import numpy as np
from mathutils import Vector, Matrix

OUT = "C:\\Users\\shuji\\vrsample\\blender\\girl-knit\\export\\"; os.makedirs(OUT, exist_ok=True)
NAME = globals().get("NAME", "girl-knit"); TITLE = globals().get("TITLE", "Girl (knit)")      # 出力ファイル名（NAME.vrm）と、モデルの名前
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
# スカートの骨（揺れもの）：前・横・後ろの左右 6 本のチェーン。ゲームは名前で探す（skirt、根もとの前は front・横は side）。
#   それぞれ腰の骨の子で、スカートの外側の面に沿って、上（すその長さの 1 割下）からすそまで 3 本＋先の骨
SKIRT_OBJ = "Knit_Skirt"
CHAINS = (("Front_L", 30), ("Front_R", -30), ("Side_L", 90), ("Side_R", -90), ("Back_L", 150), ("Back_R", -150))
SKIRT_T = (0.1, 0.4, 0.7, 1.0)
_sk = bpy.data.objects.get(SKIRT_OBJ)
if _sk:
    _SP = np.array([tuple(_sk.matrix_world @ v.co) for v in _sk.data.vertices])
    _cx, _cy = arm.bones["hips"].head_local.x, arm.bones["hips"].head_local.y
    _ztop, _zhem = float(_SP[:, 2].max()), float(_SP[:, 2].min())
    _ang = np.degrees(np.arctan2(_SP[:, 0]-_cx, -(_SP[:, 1]-_cy))); _rad = np.hypot(_SP[:, 0]-_cx, _SP[:, 1]-_cy)
    def _ring(a, t):
        z = _ztop+(_zhem-_ztop)*t
        m = (np.abs((_ang-a+180) % 360-180) < 20) & (np.abs(_SP[:, 2]-z) < 0.03)
        r = float(np.percentile(_rad[m], 80)) if m.any() else float(_rad.mean())
        return Vector((_cx+r*math.sin(math.radians(a)), _cy-r*math.cos(math.radians(a)), z))
    if "Skirt_Front_L_01" not in arm.bones:
        for o in bpy.context.view_layer.objects: o.select_set(False)
        _hid = (rig.hide_viewport, rig.hide_get()); rig.hide_viewport = False; rig.hide_set(False)
        rig.select_set(True); bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode='EDIT')
        for nm, a in CHAINS:
            pts = [_ring(a, t) for t in SKIRT_T]; pts.append(pts[-1]+(pts[-1]-pts[-2]).normalized()*0.04)
            par = arm.edit_bones["hips"]
            for k in range(len(pts)-1):
                eb = arm.edit_bones.new("Skirt_%s_%02d" % (nm, k+1)); eb.head = pts[k]; eb.tail = pts[k+1]
                eb.parent = par; eb.use_connect = k > 0; par = eb
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
others = {}
for o in list(bpy.data.objects):
    if o.type != 'MESH' or o is src_body or o.name.startswith("X_") or o.hide_viewport or o.parent is not rig or o.parent_type == 'BONE': continue
    x = copy_obj(o, "X_"+o.name.split("_", 1)[-1]); others[o.name] = x
    for g in [g for g in x.vertex_groups if g.name not in arm.bones]: x.vertex_groups.remove(g)
print("copies:", ["X_Body"]+[x.name for x in others.values()], "body verts", n)
# 軽くする（LIGHT）：VR は描画命令の数（メッシュ×材質）が重さに効く。服・靴を 1 つのメッシュ・1 枚の画像にまとめる。
#   体の目・まつ毛と、歯・口の中は 1 枚の画像（切りぬき）に、髪と眉も 1 枚の画像にまとめる（下の 2 と 2b）。材質は 4 つになる
LIGHT = globals().get("LIGHT", True)
# スカートの重み：腰と左右の腿で分け合い（すそ側ほど腿。すそで 0.96）、そこへスカートの骨（揺れもの）を混ぜる（すそで SKIRT_SPRING）。
#   腿の重みは、ゲームが座るときに腰へ移す（relaxSkirtWeights。スカートの骨に付いた頂点が対象）。歩くと腿がすそを押し、揺れものが揺らす
SKIRT_SPRING = globals().get("SKIRT_SPRING", 0.3)
_xs = others.get(SKIRT_OBJ)
if _xs and "Skirt_Front_L_01" in arm.bones:
    def _ss(x): x = min(max(x, 0.0), 1.0); return x*x*(3-2*x)
    for g in list(_xs.vertex_groups): _xs.vertex_groups.remove(g)
    G = {}
    def grp(nm): return G.setdefault(nm, _xs.vertex_groups.new(name=nm))
    _ca = [a for _, a in CHAINS]
    for v in _xs.data.vertices:
        p = _xs.matrix_world @ v.co
        t = min(max((_ztop-p.z)/(_ztop-_zhem), 0.0), 1.0)
        a = math.degrees(math.atan2(p.x-_cx, -(p.y-_cy)))
        d = sorted(((abs((a-ca+180) % 360-180), i) for i, ca in enumerate(_ca)))[:2]
        wa = d[1][0]/(d[0][0]+d[1][0]+1e-9)                   # 近いほうのチェーンの割合
        seg = min(len(SKIRT_T)-2, max(0, int((t-SKIRT_T[0])/(SKIRT_T[-1]-SKIRT_T[0])*(len(SKIRT_T)-1))))
        s = SKIRT_SPRING*_ss((t-SKIRT_T[0])/0.5)
        L = 0.96*_ss(t); u = _ss((p.x-_cx+0.05)/0.10)
        W = {"hips": (1-s)*(1-L), "leftUpperLeg": (1-s)*L*u, "rightUpperLeg": (1-s)*L*(1-u),
             "Skirt_%s_%02d" % (CHAINS[d[0][1]][0], seg+1): s*wa, "Skirt_%s_%02d" % (CHAINS[d[1][1]][0], seg+1): s*(1-wa)}
        top = sorted(W.items(), key=lambda kv: -kv[1])[:4]; tot = sum(w for _, w in top)
        for nm, w in top:
            if w > 1e-4: grp(nm).add([v.index], w/tot, 'REPLACE')
    print("skirt reweighted:", len(_xs.data.vertices), "verts")
def join(objs, name):
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join(); j = bpy.context.view_layer.objects.active; j.name = name; j.data.name = name
    return j
if LIGHT:
    _wear = [k for k, x in others.items() if not x.name.startswith(("X_Hair", "X_Brows", "X_Teeth", "X_MouthBag"))]
    _xo = join([others[k] for k in _wear], "X_Outfit")
    for k in _wear: others.pop(k)
    others["X_Outfit"] = _xo
    print("outfit joined:", _wear)

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

# 体：肌・唇 / 目 / まつ毛を、べつの画像へ（UV が重なっているかもしれないので分ける）
names = [s.name for s in xb.material_slots]
skin_i = image("bake_skin", 2048); eye_i = image("bake_eye", 512); lash_i = image("bake_lash", 1024); lash_a = image("bake_lash_a", 1024, True)
SKIN = ("Skin", "Lips", "MouthInner", "Teeth", "Tongue"); LASH = ("Lash", "LashLower")
tg = {nm: skin_i for nm in SKIN}; tg["Eye"] = eye_i; tg.update({nm: lash_i for nm in LASH})
def _spread_uv(group):
    """その材質の面の UV を、画像いっぱいに広げる（元の UV では目が 27×13 ピクセルほどしかなく、瞳がつぶれて白くなる。まつ毛も粗くなる）"""
    idx = [k for k, nm in enumerate(names) if nm in group]
    uvd = xb.data.uv_layers.active.data
    ls = [l for p in xb.data.polygons if p.material_index in idx for l in p.loop_indices]
    if not ls: return
    us = [uvd[l].uv.x for l in ls]; vs = [uvd[l].uv.y for l in ls]; u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
    for l in ls: uvd[l].uv = (0.04+0.92*(uvd[l].uv.x-u0)/max(u1-u0, 1e-6), 0.04+0.92*(uvd[l].uv.y-v0)/max(v1-v0, 1e-6))
_spread_uv(("Eye",)); _spread_uv(LASH)
bake(xb, tg); bake(xb, {nm: lash_a for nm in LASH}, alpha=True)
merge(skin_i, None, OUT+"skin.png"); merge(eye_i, None, OUT+"eye.png"); merge(lash_i, lash_a, OUT+"lash.png")
M = [texmat("X_Skin", skin_i), texmat("X_Eye", eye_i), texmat("X_Lash", lash_i, True)]
grp = [0 if nm in SKIN else (1 if nm == "Eye" else (2 if nm in LASH else 0)) for nm in names]
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
    if o.name == "X_Outfit":                                      # まとめた服・靴：材質を全部 1 枚の画像に焼く
        unwrap(o); ci = image("bake_"+o.name, 2048)
        bake(o, {nm: ci for nm in mats}); merge(ci, None, OUT+o.name+".png"); one_material(o, texmat(o.name+"_M", ci))
    elif o.name.startswith(("X_Hair", "X_Brows")):                # 眉も毛の筋を透けで描いているので、髪と同じく色と透けを焼く
        ci = image("bake_"+o.name, 1024); ai = image("bake_"+o.name+"_a", 1024, True)
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
# ── 2b) 軽くする：画像をまとめる ──
def px(im):
    w, h = im.size; a = np.empty(w*h*4, dtype=np.float32); im.pixels.foreach_get(a); return a.reshape(h, w, 4)
def put(dst, src, x0, y0):
    h, w = src.shape[:2]; dst[y0:y0+h, x0:x0+w] = src
def atlas(name, arr):
    h, w = arr.shape[:2]; im = bpy.data.images.get(name)
    if im: bpy.data.images.remove(im)
    im = bpy.data.images.new(name, w, h, alpha=True); im.pixels.foreach_set(arr.ravel())
    im.filepath_raw = OUT+name+".png"; im.file_format = 'PNG'; im.save(); return im
def remap_uv(obj, faces, su, sv, ou, ov):
    uvd = obj.data.uv_layers.active.data
    for p in faces:
        for l in p.loop_indices: uvd[l].uv = (ou+su*uvd[l].uv.x, ov+sv*uvd[l].uv.y)
def tex_of(o):
    return next(n.image for n in o.material_slots[0].material.node_tree.nodes if n.type == "TEX_IMAGE")
if LIGHT:
    # 体：2048×1024。左下 512 に目、左の上の段に歯（白）と口の中（赤）の色、右半分にまつ毛。切りぬき（目と歯・口は不透明）
    A = np.zeros((1024, 2048, 4), dtype=np.float32)
    put(A, px(eye_i), 0, 0); A[0:512, 0:512, 3] = 1.0
    A[512:768, 0:512] = (0.93, 0.92, 0.88, 1.0); A[768:1024, 0:512] = (0.16, 0.035, 0.045, 1.0)
    put(A, px(lash_i), 1024, 0)
    el = atlas("X_EyeLash", A)
    remap_uv(xb, [p for p in xb.data.polygons if p.material_index == 1], 0.25, 0.5, 0.0, 0.0)
    remap_uv(xb, [p for p in xb.data.polygons if p.material_index == 2], 0.5, 1.0, 0.5, 0.0)
    for p in xb.data.polygons:
        if p.material_index == 2: p.material_index = 1
    xb.data.materials.pop(index=2); xb.data.materials[1] = texmat("X_EyeLash_M", el, True)
    # 歯・口の中を体にまとめる（表情のシェイプキーは名前でそろう）。色は上の色の段の 1 点を指す
    mouth = [others.pop(k) for k in list(others) if others[k].name.startswith(("X_Teeth", "X_MouthBag"))]
    for o in mouth:
        uvd = (o.data.uv_layers.active or o.data.uv_layers.new(name="UVMap")).data
        col_v = 0.625 if o.name.startswith("X_Teeth") else 0.875
        for l in range(len(uvd)): uvd[l].uv = (0.06, col_v)
    nb = len(xb.data.polygons)
    xb = join([xb]+mouth, "X_Body")
    for p in xb.data.polygons[nb:]: p.material_index = 1
    while len(xb.data.materials) > 2: xb.data.materials.pop(index=2)
    # 髪と眉：2048×1024 の左に髪、右に眉
    hair = next(o for o in others.values() if o.name.startswith("X_Hair")); brow = next(o for o in others.values() if o.name.startswith("X_Brows"))
    hi, bi_ = px(tex_of(hair)), px(tex_of(brow))
    A = np.zeros((1024, 2048, 4), dtype=np.float32); put(A, hi, 0, 0); put(A, bi_, 1024, 0)
    hb_im = atlas("X_HairBrows", A)
    remap_uv(hair, list(hair.data.polygons), 0.5, 1.0, 0.0, 0.0); remap_uv(brow, list(brow.data.polygons), 0.5, 1.0, 0.5, 0.0)
    for k in [k for k in list(others) if others[k] in (hair, brow)]: others.pop(k)
    hbj = join([brow, hair], "X_HairBrows")                       # 眉（シェイプキーあり）を先にして、キーを残す
    one_material(hbj, texmat("X_HairBrows_M", hb_im, True)); others["X_HairBrows"] = hbj
    print("light: materials", sum(len(o.data.materials) for o in [xb]+list(others.values())), "meshes", 1+len(others))

# ── 3) VRM の設定 ──
ext = arm.vrm_addon_extension; ext.spec_version = ext.SPEC_VERSION_VRM1; v1 = ext.vrm1
def snake(s): return re.sub(r"(?<!^)(?=[A-Z])", "_", s).lower()
hb = v1.humanoid.human_bones
for b in arm.bones:
    if b.name.startswith(("hairSwing", "Skirt_")): continue
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
while len(_sb.collider_groups): bpy.ops.vrm.remove_spring_bone1_collider_group(armature_object_name=rig.name, collider_group_index=0)
while len(_sb.colliders): bpy.ops.vrm.remove_spring_bone1_collider(armature_object_name=rig.name, collider_index=0)
# コライダー（位置は骨の向きで：骨の根もとが原点、骨の向きが +Y）。脚：腰の球と腿のカプセル。体：胸の球と肩のカプセル（髪が肩と胸に入らないように）
def collider(bone, r, tail=None, off=(0, 0, 0)):
    bpy.ops.vrm.add_spring_bone1_collider(armature_object_name=rig.name); c = _sb.colliders[-1]; c.node.bone_name = bone
    _ids = [it.identifier for it in c.bl_rna.properties["shape_type"].enum_items]
    _pick = lambda w: next(i for i in _ids if i.lower() == w)
    if tail is None: c.shape_type = _pick("sphere"); c.shape.sphere.offset = off; c.shape.sphere.radius = r
    else: c.shape_type = _pick("capsule"); c.shape.capsule.offset = off; c.shape.capsule.tail = tail; c.shape.capsule.radius = r
    return c
def cgroup(name, cols):
    bpy.ops.vrm.add_spring_bone1_collider_group(armature_object_name=rig.name); g = _sb.collider_groups[-1]; g.vrm_name = name
    for c in cols: g.colliders.add().collider_uuid = c.uuid
    return g
_leg = lambda s: arm.bones[s+"UpperLeg"].length
g_legs = cgroup("legs", [collider("hips", 0.09)]+[collider(s+"UpperLeg", 0.065, tail=(0, _leg(s)*0.95, 0)) for s in ("left", "right")])
g_body = cgroup("body", [collider("upperChest" if "upperChest" in arm.bones else "chest", 0.10, off=(0, 0.04, 0))]
                + [collider(s+"Shoulder", 0.045, tail=(0, arm.bones[s+"Shoulder"].length, 0)) for s in ("left", "right")])
def spring(name, bones, groups, stiff, grav, drag, radius):
    bpy.ops.vrm.add_spring_bone1_spring(armature_object_name=rig.name); i = len(_sb.springs)-1; sp = _sb.springs[i]; sp.vrm_name = name
    for bn in bones:
        bpy.ops.vrm.add_spring_bone1_spring_joint(armature_object_name=rig.name, spring_index=i, guess_properties=False)
        j = sp.joints[-1]; j.node.bone_name = bn; j.hit_radius = radius; j.stiffness = stiff; j.gravity_power = grav; j.gravity_dir = (0, 0, -1); j.drag_force = drag
    for g in groups: sp.collider_groups.add().collider_group_uuid = g.uuid
spring("hair", ("hairSwing", "hairSwingEnd"), (g_body,), 0.8, 0.35, 0.45, 0.02)
for _nm, _ in CHAINS:
    _bs = [b.name for b in arm.bones if b.name.startswith("Skirt_%s_" % _nm)]
    if _bs: spring("skirt_"+_nm, sorted(_bs), (g_legs,), 1.2, 0.05, 0.5, 0.03)
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
