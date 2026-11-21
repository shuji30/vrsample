# さるすべり（百日紅）の木を作る（Blender の中で exec する）。何度実行してもよい（作り直す）。夏の満開・濃いピンク。
#   先に make_textures.py でテクスチャ（textures/）を描いておく。
#   幹：根元から数本に分かれる株立ち。壺のように外へ開き、途中で身をよじる。樹皮はつるつるで、まだら（saru_bark.jpg）
#   枝：幹 → 枝 → 小枝。樹冠は高さより幅がある
#   葉：小枝に沿って「葉の付いた小枝」の絵の板（saru_leaf.png。4 種）を外向きに並べる。板の法線は樹冠の外向きに丸め、やわらかく光らせる
#   花：小枝の先に、花穂の絵の板（saru_flower.png。2 種）を 2 枚、十字に組んで立てる（どこから見ても房に見える）
# 向き：Z が上、原点は根元。高さ 約 4m。書き出しは export_sarusuberi.py（GLB）。
import bpy, bmesh, math, random
import numpy as np
from mathutils import Vector, Matrix

H = globals().get("H", 4.0); TRUNKS = globals().get("TRUNKS", 4); SEED = globals().get("SEED", 19)
TEXDIR = globals().get("TEXDIR", "C:/Users/shuji/vrsample/blender/sarusuberi/textures/")
LEAF_CARD = globals().get("LEAF_CARD", 0.36)       # 葉の板の大きさ（m）。絵の小枝は板の高さいっぱい
FLOWER_H = globals().get("FLOWER_H", 0.34)         # 花穂の板の高さ（m）。幅はその半分
rnd = random.Random(SEED); R = rnd.random
for o in list(bpy.data.objects):
    if o.name.startswith("Saru"): bpy.data.objects.remove(o, do_unlink=True)
for d in list(bpy.data.meshes):
    if d.name.startswith("Saru") and d.users == 0: bpy.data.meshes.remove(d)
col = bpy.data.collections.get("Sarusuberi") or bpy.data.collections.new("Sarusuberi")
if col.name not in bpy.context.scene.collection.children: bpy.context.scene.collection.children.link(col)

def curve(ctrl, n):
    """制御点を通る、なめらかな線（Catmull-Rom）。n 個に分けた点を返す"""
    P = [Vector(p) for p in ctrl]; P = [P[0]+(P[0]-P[1])]+P+[P[-1]+(P[-1]-P[-2])]; segs = len(P)-3; out = []
    for i in range(n+1):
        u = i/n*segs; k = min(int(u), segs-1); t = u-k; p0, p1, p2, p3 = P[k:k+4]
        out.append(0.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t))
    return out
def at(pts, t):
    u = max(0.0, min(1.0, t))*(len(pts)-1); k = min(int(u), len(pts)-2); return pts[k].lerp(pts[k+1], u-k)
def direction(pts, t):
    u = max(0.0, min(0.999, t))*(len(pts)-1); k = min(int(u), len(pts)-2); return (pts[k+1]-pts[k]).normalized()

# ── 幹と枝（管。UV は、まわり方向 u・長さ方向 v。樹皮の絵 1 枚 = まわり 0.45m × 長さ 0.9m） ──
bark_v = []; bark_uv = []; bark_f = []
def tube(pts, radius, sides, cap=True):
    base = len(bark_v); prev = None; n = len(pts); vlen = 0.0; uoff = R()
    for i, p in enumerate(pts):
        if i: vlen += (p-pts[i-1]).length
        t = (pts[min(i+1, n-1)]-pts[max(i-1, 0)]).normalized()
        u = (prev-t*prev.dot(t)) if prev is not None else t.orthogonal(); u.normalize(); prev = u; w = t.cross(u); r = radius(i/(n-1))
        ucirc = max(0.10, 2*math.pi*radius(0.0)/0.45)                     # 太さが変わっても、まわりの模様の数は同じ（つなぎ目で模様が切れないように）
        for k in range(sides+1):                                           # 継ぎ目に UV の切れ目を作るため、1 つ余分に
            a = 2*math.pi*k/sides; bark_v.append(p+(u*math.cos(a)+w*math.sin(a))*r); bark_uv.append((uoff+k/sides*ucirc, vlen/0.9))
    S = sides+1
    for i in range(n-1):
        for k in range(sides):
            a = base+i*S+k; bark_f.append((a, a+1, a+1+S, a+S))
    if cap:
        bark_v.append(pts[-1]+(pts[-1]-pts[-2]).normalized()*radius(1.0)); bark_uv.append((uoff, vlen/0.9)); tip = len(bark_v)-1; last = base+(n-1)*S
        for k in range(sides): bark_f.append((last+k, last+k+1, tip))
leaf_sites = []      # (位置, 小枝の向き)
flower_sites = []    # (位置, 軸の向き, 大きさ)
scale = H/4.0
for i in range(TRUNKS):
    ang = i/TRUNKS*2*math.pi+R()*0.5; lean = (0.50+R()*0.30)*scale; top = H*(0.47+R()*0.12); base_r = (0.060+R()*0.022)*scale
    dx, dy = math.cos(ang), math.sin(ang)
    trunk = curve([(dx*0.05, dy*0.05, -0.03), (dx*lean*0.30, dy*lean*0.30, top*0.32),
                   (dx*lean*0.66+(R()-0.5)*0.20, dy*lean*0.66+(R()-0.5)*0.20, top*0.66), (dx*lean, dy*lean, top),
                   (dx*lean*1.12+(R()-0.5)*0.15, dy*lean*1.12+(R()-0.5)*0.15, top+(H-top)*0.55)], 28)      # 幹の先は、細い枝になって上へ伸びる
    # 幹は根元が少し太く、ところどころ縦にうねる（さるすべりの幹は、こぶとくぼみのある筋肉のような形）
    tube(trunk, lambda t, b=base_r: max(0.006, b*(1.12-0.60*min(1.0, t/0.78))*(1+0.05*math.sin(t*23)+0.18*max(0.0, 0.10-t)/0.10)*(1.0 if t < 0.78 else 1-0.9*(t-0.78)/0.22)), 12)
    for k in range(4): leaf_sites.append((at(trunk, 0.84+0.16*k/3), direction(trunk, 0.95)))
    flower_sites.append((trunk[-1], Vector((0, 0, 1)), 1.15))
    for b in range(3+int(R()*2)):
        t0 = min(0.80, (0.52+b*0.15)*0.78); frm = at(trunk, t0); bang = ang+(R()-0.5)*1.9
        reach = (0.60+R()*0.60)*scale; rise = (H-frm.z)*(0.42+R()*0.30)
        tip = Vector((frm.x+math.cos(bang)*reach, frm.y+math.sin(bang)*reach, frm.z+rise))
        mid = (frm+tip)/2+Vector(((R()-0.5)*0.18, (R()-0.5)*0.18, rise*0.40))
        branch = curve([frm, mid, tip], 12); br = base_r*0.46
        tube(branch, lambda t, r=br: r*(1-0.80*t), 8)
        twigs = 7+int(R()*3)
        for w in range(twigs+1):
            last = w == twigs                                       # 最後の 1 本は、枝の先そのもの
            a0 = 1.0 if last else 0.30+(w/twigs)*0.66; org = at(branch, a0)
            tang = bang+(R()-0.5)*2.6; length = (0.30+R()*0.34)*scale; lift = 0.30+R()*0.60
            d = direction(branch, 0.98).lerp(Vector((0, 0, 1)), 0.35).normalized() if last else Vector((math.cos(tang)*math.sqrt(1-lift*lift), math.sin(tang)*math.sqrt(1-lift*lift), lift))
            ttip = org+d*length
            twig = curve([org, (org+ttip)/2+Vector((0, 0, length*0.08)), ttip], 6); tr = br*0.36
            tube(twig, lambda t, r=tr: max(0.0035, r*(1-0.6*t)), 5)
            for k in range(max(2, int(length/0.085))):              # 葉の板は小枝に沿って
                leaf_sites.append((at(twig, 0.20+0.80*k/max(1, int(length/0.085)-1)), d))
            if R() < 0.92: flower_sites.append((ttip, d.lerp(Vector((0, 0, 1)), 0.45).normalized(), 0.85+R()*0.45))
            for s in range(2):                                      # 短い脇枝のある所にも、葉と花（脇枝そのものは、葉の板の絵に描いてある）
                so = at(twig, 0.35+R()*0.5); sa = R()*2*math.pi; sl = (0.14+R()*0.14)*scale
                sd = (d+Vector((math.cos(sa), math.sin(sa), 0.35+R()*0.4))*0.9).normalized(); st = so+sd*sl
                leaf_sites.append((so+sd*sl*0.3, sd))
                if R() < 0.55: flower_sites.append((st, sd.lerp(Vector((0, 0, 1)), 0.5).normalized(), 0.60+R()*0.35))

def mesh_obj(name, verts, faces, uvs=None):
    me = bpy.data.meshes.new(name); me.from_pydata([tuple(v) for v in verts], [], faces)
    if uvs is not None:
        uv = me.uv_layers.new(name="UVMap"); lv = np.zeros(len(me.loops), dtype=int); me.loops.foreach_get("vertex_index", lv)
        uv.data.foreach_set("uv", np.asarray(uvs, dtype=float)[lv].ravel())
    me.validate(); me.update()
    o = bpy.data.objects.new(name, me); col.objects.link(o); return o
def image(name):
    im = bpy.data.images.get(name)
    if im: im.reload(); return im
    return bpy.data.images.load(TEXDIR+name)
def material(name, tex, rough, cutout=False, normal=None, normal_strength=0.5):
    mt = bpy.data.materials.get(name)
    if mt: bpy.data.materials.remove(mt)
    mt = bpy.data.materials.new(name); mt.use_nodes = True; nt = mt.node_tree
    b = next(x for x in nt.nodes if x.type == "BSDF_PRINCIPLED"); b.inputs["Roughness"].default_value = rough
    if "Specular IOR Level" in b.inputs: b.inputs["Specular IOR Level"].default_value = 0.35
    t = nt.nodes.new("ShaderNodeTexImage"); t.image = image(tex); nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    if cutout:
        nt.links.new(t.outputs["Alpha"], b.inputs["Alpha"])
        mt.blend_method = 'CLIP' if hasattr(mt, "blend_method") else None
        if hasattr(mt, "surface_render_method"): mt.surface_render_method = 'DITHERED'
        mt.use_backface_culling = False
    if normal:
        n = nt.nodes.new("ShaderNodeTexImage"); n.image = image(normal); n.image.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new("ShaderNodeNormalMap"); nm.inputs["Strength"].default_value = normal_strength
        nt.links.new(n.outputs["Color"], nm.inputs["Color"]); nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    return mt

# 樹皮
bark = mesh_obj("SaruBark", bark_v, bark_f, bark_uv)
for p in bark.data.polygons: p.use_smooth = True
bark.data.materials.append(material("SaruBarkMat", "saru_bark.jpg", 0.48, normal="saru_bark_n.png", normal_strength=0.6))

# ── 葉の板（葉の付いた小枝の絵。根元を小枝に付け、外・上へ向ける） ──
crown = Vector((0, 0, H*0.62))
lv = []; luv = []; lf = []; ln = []
CELLS = [(0, 0), (0.5, 0), (0, 0.5), (0.5, 0.5)]
for pos, axis in leaf_sites:
    outdir = (pos-crown); outdir.z *= 0.6; outdir = outdir.normalized()
    for rep in range(2 if R() < 0.85 else 1):
        # 板の向き：小枝の向きと樹冠の外向きのあいだへ、少しばらつかせて
        up = (axis*0.55+outdir*0.75+Vector(((R()-0.5)*0.7, (R()-0.5)*0.7, (R()-0.3)*0.5))).normalized()
        side = up.cross(Vector((0, 0, 1)) if abs(up.z) < 0.95 else Vector((1, 0, 0))).normalized()
        roll = (R()-0.5)*1.2; side = (side*math.cos(roll)+up.cross(side)*math.sin(roll)).normalized()
        S = LEAF_CARD*scale*(0.80+R()*0.40); half = side*S*0.5
        b0 = pos-up*S*0.04+Vector(((R()-0.5)*0.03, (R()-0.5)*0.03, (R()-0.5)*0.03))
        fold = up.cross(side).normalized()*S*0.06*(1 if R() < 0.5 else -1)          # 板のまん中を少し折る（真横から見ても線にならない）
        i0 = len(lv)
        lv += [b0-half, b0, b0+half, b0+up*S+half, b0+up*S+fold, b0+up*S-half]
        cu, cv = CELLS[int(R()*4)]
        luv += [(cu, cv), (cu+0.25, cv), (cu+0.5, cv), (cu+0.5, cv+0.5), (cu+0.25, cv+0.5), (cu, cv+0.5)]
        lv[i0+1] = lv[i0+1]+fold*0.5
        lf += [(i0, i0+1, i0+4, i0+5), (i0+1, i0+2, i0+3, i0+4)]
        nrm = ((b0+up*S*0.5-crown).normalized()*0.8+Vector((0, 0, 0.45))).normalized(); ln += [nrm]*6
leaves = mesh_obj("SaruLeaves", lv, lf, luv)
leaves.data.materials.append(material("SaruLeafMat", "saru_leaf.png", 0.78, cutout=True))
leaves.data.normals_split_custom_set_from_vertices([tuple(v) for v in ln])

# ── 花穂の板（十字に 2 枚。根元を小枝の先に） ──
fv = []; fuv = []; ff = []; fn = []
for pos, axis, size in flower_sites:
    Hc = FLOWER_H*scale*size*(0.85+R()*0.3); Wc = Hc*0.5
    a0 = R()*math.pi; cu = 0.0 if R() < 0.5 else 0.5
    tilt = (axis*0.7+Vector((0, 0, 1))*0.3).normalized()
    for k in range(2):
        a = a0+k*math.pi/2
        s = Vector((math.cos(a), math.sin(a), 0)); s = (s-tilt*s.dot(tilt)).normalized()*Wc*0.5
        b0 = pos-tilt*Hc*0.06; i0 = len(fv)
        fv += [b0-s, b0+s, b0+s+tilt*Hc, b0-s+tilt*Hc]
        fuv += [(cu, 0), (cu+0.5, 0), (cu+0.5, 1), (cu, 1)]
        ff.append((i0, i0+1, i0+2, i0+3))
        nrm = ((pos-crown).normalized()*0.6+Vector((0, 0, 0.8))).normalized(); fn += [nrm]*4
flowers = mesh_obj("SaruFlowers", fv, ff, fuv)
flowers.data.materials.append(material("SaruFlowerMat", "saru_flower.png", 0.85, cutout=True))
flowers.data.normals_split_custom_set_from_vertices([tuple(v) for v in fn])
allv = np.array([tuple(v) for v in lv+fv])
print("sarusuberi built. bark verts", len(bark_v), "leaf cards", len(lf)//2, "panicles", len(flower_sites),
      "tris", len(bark_f)*2+len(lf)*2+len(ff)*2, "size", [round(float(allv[:, i].max()-allv[:, i].min()), 2) for i in range(3)], "top", round(float(allv[:, 2].max()), 2))
