# こむぎを GLB で書き出す（Blender の中で exec する）。出力は vrsample の models/corgi.glb。
#   骨・ウェイト・頂点カラーを入れる。動きは入れない（ゲームの corgi.js が骨を回して動かす）。
#   three.js では +Z が前・+X が犬の左・+Y が上になる。
import bpy, os
OUT = globals().get("OUT", "C:/Users/shuji/vrsample/models/corgi.glb")
rig = bpy.data.objects["CorgiRig"]
for b in rig.pose.bones: b.rotation_mode = 'XYZ'; b.rotation_euler = (0, 0, 0); b.location = (0, 0, 0); b.scale = (1, 1, 1)
for o in bpy.data.objects:
    try: o.select_set(o.name.startswith("Corgi"))
    except Exception: pass
bpy.context.view_layer.objects.active = rig
kw = dict(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_animations=False,
          export_skins=True, export_morph=False, export_cameras=False, export_lights=False, export_extras=False,
          export_vertex_color='MATERIAL', export_all_vertex_colors=False)
props = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
res = bpy.ops.export_scene.gltf(**{k: v for k, v in kw.items() if k in props})
print("export:", res, os.path.getsize(OUT), "skipped options:", [k for k in kw if k not in props])
