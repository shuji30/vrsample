# さるすべりを GLB で書き出す（Blender の中で exec する）。出力は vrsample の models/sarusuberi.glb。
#   テクスチャ（樹皮・葉・花穂）を中に入れる。葉と花は「切りぬき」（アルファが半分より薄い所は描かない）。
#   丸めた法線も入れる。three.js では +Y が上、原点は根元。
import bpy, os
OUT = globals().get("OUT", "C:/Users/shuji/vrsample/models/sarusuberi.glb")
for o in bpy.data.objects:
    try: o.select_set(o.name.startswith("Saru"))
    except Exception: pass
bpy.context.view_layer.objects.active = bpy.data.objects["SaruBark"]
kw = dict(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_animations=False,
          export_skins=False, export_morph=False, export_cameras=False, export_lights=False, export_extras=False,
          export_normals=True, export_texcoords=True, export_tangents=False, export_vertex_color='NONE',
          export_image_format='AUTO', export_jpeg_quality=85)
props = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
res = bpy.ops.export_scene.gltf(**{k: v for k, v in kw.items() if k in props})
print("export:", res, os.path.getsize(OUT), "skipped options:", [k for k in kw if k not in props])
