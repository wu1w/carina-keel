"""Blender --background script: import GLB, ensure UV2, Cycles bake COMBINED/DIFFUSE indirect, export.

CLI after -- :
  --input PATH --out-glb PATH --out-lightmap PATH --resolution N --samples N
"""
from __future__ import annotations
import argparse
import sys


def parse_args(argv):
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = argv[1:]
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--out-glb", required=True)
    p.add_argument("--out-lightmap", required=True)
    p.add_argument("--resolution", type=int, default=1024)
    p.add_argument("--samples", type=int, default=64)
    return p.parse_args(argv)


def main():
    args = parse_args(sys.argv)
    try:
        _run(args)
    except Exception:
        import traceback
        traceback.print_exc()
        raise SystemExit(1) from None


def _run(args):
    import bpy

    # Reset
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Prefer Cycles GPU
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    cycles = scene.cycles
    cycles.samples = args.samples
    cycles.use_denoising = True
    prefs = bpy.context.preferences.addons.get("cycles")
    if prefs:
        cprefs = prefs.preferences
        try:
            cprefs.compute_device_type = "CUDA"
            for device in cprefs.devices:
                device.use = True
            cycles.device = "GPU"
        except Exception:
            cycles.device = "CPU"

    # Import GLB
    bpy.ops.import_scene.gltf(filepath=args.input)

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise SystemExit("no mesh objects after import")

    res = int(args.resolution)
    # Create shared lightmap image
    img = bpy.data.images.new("CarinaLightmap", width=res, height=res, alpha=False, float_buffer=True)
    img.colorspace_settings.name = "Linear Rec.709"

    for obj in meshes:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        # Ensure UV0 exists
        if not obj.data.uv_layers:
            obj.data.uv_layers.new(name="UVMap")
        # UV2 for lightmap
        if "UVMap_Lightmap" not in obj.data.uv_layers:
            obj.data.uv_layers.new(name="UVMap_Lightmap")
        obj.data.uv_layers["UVMap_Lightmap"].active = True
        # Smart project if UV2 looks empty (all zeros) — always smart-project UV2 for bake packing
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=66.0, island_margin=0.02)
        bpy.ops.object.mode_set(mode="OBJECT")

        # Wire image into material for bake target (keep original PBR nodes; add Image Texture as active)
        if not obj.data.materials:
            mat = bpy.data.materials.new(name=f"LM_{obj.name}")
            mat.use_nodes = True
            obj.data.materials.append(mat)
        for slot in obj.material_slots:
            mat = slot.material
            if not mat:
                continue
            mat.use_nodes = True
            nt = mat.node_tree
            nodes = nt.nodes
            # Find or create Image Texture node named CarinaBakeTarget
            tex = None
            for n in nodes:
                if n.type == "TEX_IMAGE" and n.name == "CarinaBakeTarget":
                    tex = n
                    break
            if tex is None:
                tex = nodes.new("ShaderNodeTexImage")
                tex.name = "CarinaBakeTarget"
            tex.image = img
            nodes.active = tex
            tex.select = True

    # Minimal world lighting if none
    if not scene.world:
        scene.world = bpy.data.worlds.new("World")
    scene.world.use_nodes = True
    wn = scene.world.node_tree.nodes
    bg = next((n for n in wn if n.type == "BACKGROUND"), None)
    if bg:
        bg.inputs[0].default_value = (0.8, 0.75, 0.65, 1.0)
        bg.inputs[1].default_value = 1.0

    # Add a soft area light for tavern-like fill if no lights
    lights = [o for o in scene.objects if o.type == "LIGHT"]
    if not lights:
        bpy.ops.object.light_add(type="AREA", location=(0, 0, 3))
        light = bpy.context.active_object
        light.data.energy = 200
        light.data.size = 4

    # Bake COMBINED (includes indirect). Note: for pure indirect, Blender 4 has DIFFUSE with indirect only via bake types.
    scene.render.bake.use_pass_direct = False
    scene.render.bake.use_pass_indirect = True
    scene.render.bake.use_pass_color = True
    scene.cycles.bake_type = "DIFFUSE"
    scene.render.bake.margin = 4

    # Select all meshes
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]

    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"INDIRECT", "COLOR"}, use_clear=True)

    img.filepath_raw = args.out_lightmap
    img.file_format = "PNG"
    img.save()

    # Export GLB with UV2 retained; materials stay as imported PBR (bake target node may remain)
    bpy.ops.export_scene.gltf(
        filepath=args.out_glb,
        export_format="GLB",
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
    )
    print("CARINA_BAKE_OK", args.out_glb, args.out_lightmap)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        import traceback
        traceback.print_exc()
        raise SystemExit(1) from None
