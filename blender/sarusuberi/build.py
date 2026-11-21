# さるすべりを、画面を出さない Blender でまとめて作る（テクスチャ → 木 → 保存 → GLB → 確認用の絵）。
#   "D:/Program Files/Blender Foundation/Blender 5.3/blender.exe" -b --factory-startup --python blender/sarusuberi/build.py
#   ほかの .blend を開いている Blender には触れない。出力：sarusuberi.blend・models/sarusuberi.glb・textures/preview_*.png
import bpy, os, math
D = os.path.dirname(os.path.abspath(__file__)).replace("\\", "/")+"/"
def run(f, g=None): exec(compile(open(D+f, encoding="utf-8").read(), D+f, "exec"), dict(g or {}, __name__="__main__"))
bpy.ops.wm.read_homefile(use_empty=True)
sc = bpy.context.scene
run("make_textures.py")
run("make_sarusuberi.py")
# 確認用の明かり・空・カメラ
sc.world = bpy.data.worlds.new("World"); sc.world.use_nodes = True
bg = next(n for n in sc.world.node_tree.nodes if n.type == 'BACKGROUND'); bg.inputs[0].default_value = (0.55, 0.70, 0.90, 1); bg.inputs[1].default_value = 1.0
sun = bpy.data.lights.new("Sun", 'SUN'); sun.energy = 3.0; sun.angle = 0.05
so = bpy.data.objects.new("Sun", sun); sc.collection.objects.link(so); so.rotation_euler = (0.85, 0.15, 0.7)
ground = bpy.data.meshes.new("Ground"); ground.from_pydata([(-6, -6, 0), (6, -6, 0), (6, 6, 0), (-6, 6, 0)], [], [(0, 1, 2, 3)])
g = bpy.data.objects.new("Ground", ground); sc.collection.objects.link(g)
gm = bpy.data.materials.new("GroundMat"); gm.use_nodes = True
next(n for n in gm.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = (0.13, 0.22, 0.07, 1); ground.materials.append(gm)
sc.view_settings.view_transform = 'Standard'
try: sc.render.engine = 'BLENDER_EEVEE_NEXT'
except TypeError:
    try: sc.render.engine = 'BLENDER_EEVEE'
    except TypeError as e: print("engine:", e)
sc.render.resolution_x = 900; sc.render.resolution_y = 900
if hasattr(sc, "eevee"): sc.eevee.taa_render_samples = 32
cd = bpy.data.cameras.new("Cam"); cam = bpy.data.objects.new("Cam", cd); sc.collection.objects.link(cam); sc.camera = cam
def shot(name, loc, look, lens=35):
    cam.location = loc; d = __import__("mathutils").Vector(look)-cam.location; cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler(); cd.lens = lens
    sc.render.filepath = D+"textures/preview_"+name+".png"; bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=D+"sarusuberi.blend")
shot("wide", (6.0, -7.5, 1.7), (0, 0, 2.0), 35)
shot("crown", (1.6, -2.4, 2.4), (0.2, -0.2, 3.0), 35)
shot("trunk", (0.9, -1.5, 0.8), (0, 0, 0.9), 35)
for o in (g, so, cam): o.hide_render = True
run("export_sarusuberi.py")
print("BUILD DONE")
