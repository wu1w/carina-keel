"""Build a sourced 12x10m PBR tavern GLB. Not world-model generation.

Run with Blender 4.5:
  blender --background --python assets/sourced-pbr-tavern/build_tavern.py
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parent
TEX = ROOT / "textures"
OUT = ROOT / "tavern_pbr.glb"

ROOM_X = 12.0
ROOM_Y = 10.0
ROOM_Z = 4.0
WALL_T = 0.25
DOOR_W = 1.0
DOOR_H = 2.2


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.meshes):
        bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)
    for block in list(bpy.data.images):
        bpy.data.images.remove(block)


def load_image(path: Path) -> bpy.types.Image:
    img = bpy.data.images.load(str(path), check_existing=True)
    img.colorspace_settings.name = "sRGB" if "Color" in path.name else "Non-Color"
    return img


def make_pbr(name: str, folder: Path, metallic: float = 0.0, scale: float = 2.0) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    assert nt is not None
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (0, 0)
    out.location = (300, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    mapping = nt.nodes.new("ShaderNodeMapping")
    texcoord = nt.nodes.new("ShaderNodeTexCoord")
    mapping.inputs["Scale"].default_value = (scale, scale, scale)
    nt.links.new(texcoord.outputs["UV"], mapping.inputs["Vector"])

    def tex(suffix: str, colorspace: str) -> bpy.types.ShaderNodeTexImage | None:
        matches = [p for p in folder.glob(f"*{suffix}") if not p.name.startswith("._")]
        if not matches:
            return None
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = bpy.data.images.load(str(matches[0]), check_existing=True)
        node.image.colorspace_settings.name = colorspace
        nt.links.new(mapping.outputs["Vector"], node.inputs["Vector"])
        return node

    color = tex("_Color.jpg", "sRGB")
    rough = tex("_Roughness.jpg", "Non-Color")
    normal = tex("_NormalGL.jpg", "Non-Color")
    metal_tex = tex("_Metalness.jpg", "Non-Color")
    if color:
        nt.links.new(color.outputs["Color"], bsdf.inputs["Base Color"])
    if rough:
        nt.links.new(rough.outputs["Color"], bsdf.inputs["Roughness"])
    if metal_tex:
        nt.links.new(metal_tex.outputs["Color"], bsdf.inputs["Metallic"])
    else:
        bsdf.inputs["Metallic"].default_value = metallic
    if normal:
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(normal.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def make_glass() -> bpy.types.Material:
    mat = bpy.data.materials.new("GlassCup")
    mat.use_nodes = True
    nt = mat.node_tree
    assert nt is not None
    bsdf = nt.nodes.get("Principled BSDF")
    assert bsdf is not None
    bsdf.inputs["Base Color"].default_value = (0.82, 0.9, 0.92, 1)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.06
    if "Transmission Weight" in bsdf.inputs:
        bsdf.inputs["Transmission Weight"].default_value = 0.92
    elif "Transmission" in bsdf.inputs:
        bsdf.inputs["Transmission"].default_value = 0.92
    bsdf.inputs["IOR"].default_value = 1.45
    return mat


def add_box(name: str, size: tuple[float, float, float], location: tuple[float, float, float], mat: bpy.types.Material) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.active_object
    assert obj is not None
    obj.name = name
    obj.data.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.cube_project(cube_size=1.0, correct_aspect=True, clip_to_bounds=False, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


def add_cylinder(name: str, radius: float, depth: float, location: tuple[float, float, float], mat: bpy.types.Material) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, location=location, vertices=24)
    obj = bpy.context.active_object
    assert obj is not None
    obj.name = name
    obj.data.name = name
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.cylinder_project()
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


def main() -> None:
    clear_scene()
    wood_floor = make_pbr("WoodFloor", TEX / "wood_floor", scale=4.0)
    wood_bar = make_pbr("WoodBar", TEX / "wood_bar", scale=2.2)
    metal = make_pbr("MetalTrim", TEX / "metal", metallic=1.0, scale=1.5)
    brick = make_pbr("BrickHearth", TEX / "brick", scale=1.8)
    glass = make_glass()

    hx, hy, hz = ROOM_X / 2, -ROOM_Y / 2, ROOM_Z / 2
    add_box("Floor", (ROOM_X, ROOM_Y, 0.16), (hx, hy, -0.08), wood_floor)
    add_box("Ceiling", (ROOM_X, ROOM_Y, 0.12), (hx, hy, ROOM_Z + 0.06), wood_bar)
    add_box("WallWest", (WALL_T, ROOM_Y, ROOM_Z), (-WALL_T / 2, hy, hz), wood_bar)
    add_box("WallEast", (WALL_T, ROOM_Y, ROOM_Z), (ROOM_X + WALL_T / 2, hy, hz), wood_bar)
    add_box("WallSouth", (ROOM_X, WALL_T, ROOM_Z), (hx, WALL_T / 2, hz), wood_bar)
    door_cx = 6.0
    leaf = (ROOM_X - DOOR_W) / 2
    north_y = -ROOM_Y - WALL_T / 2
    add_box("WallNorthL", (leaf, WALL_T, ROOM_Z), (leaf / 2, north_y, hz), wood_bar)
    add_box("WallNorthR", (leaf, WALL_T, ROOM_Z), (ROOM_X - leaf / 2, north_y, hz), wood_bar)
    lintel_h = ROOM_Z - DOOR_H
    add_box(
        "WallNorthLintel",
        (DOOR_W, WALL_T, lintel_h),
        (door_cx, north_y, DOOR_H + lintel_h / 2),
        wood_bar,
    )
    add_box("Bar", (0.7, 4.2, 1.1), (1.4, -5.0, 0.55), wood_bar)
    add_box("BarFootRest", (0.12, 4.0, 0.08), (1.85, -5.0, 0.18), metal)
    add_box("Door", (DOOR_W, 0.08, DOOR_H), (door_cx, -ROOM_Y + 0.02, DOOR_H / 2), wood_bar)
    add_cylinder("Cup", 0.045, 0.12, (1.55, -4.6, 1.16), glass)
    add_box("Fireplace", (1.6, 0.45, 1.4), (9.2, -0.35, 0.7), brick)
    add_box("HearthMetal", (1.5, 0.08, 0.05), (9.2, -0.62, 0.08), metal)

    spawns = []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        # export_apply bakes Blender world location into the GLB. Interchange keeps that
        # vertex offset, so UE spawn must be identity or the room double-translates.
        spawns.append(
            {
                "meshName": obj.name,
                "transform": {
                    "position": {"x": 0.0, "y": 0.0, "z": 0.0},
                    "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
                    "scale": {"x": 1.0, "y": 1.0, "z": 1.0},
                },
            }
        )
    (ROOT / "spawns.json").write_text(
        __import__("json").dumps(
            {
                "source": "asset-library",
                "claimsWorldModelGeneration": False,
                "bakedWorldSpace": True,
                "spawnPlayer": {"x": 6.0, "y": 1.55, "z": 5.0},
                "objects": spawns,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(OUT),
        export_format="GLB",
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_apply=True,
        export_yup=True,
    )
    print(f"exported {OUT} bytes={OUT.stat().st_size}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("build_tavern failed:", exc, file=sys.stderr)
        raise
