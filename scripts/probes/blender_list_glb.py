"""Import a GLB in Blender --background and list selectable objects.

Usage:
  blender --background --python blender_list_glb.py -- tavern.glb out.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def argv_after_dd() -> list[str]:
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return sys.argv[1:]


def main() -> int:
    args = argv_after_dd()
    if len(args) < 2:
        print("need: glb_path out_json", file=sys.stderr)
        return 2
    glb_path = Path(args[0])
    out_path = Path(args[1])
    import bpy

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(glb_path))

    objects = []
    for obj in bpy.data.objects:
        mesh_verts = 0
        if obj.type == "MESH" and obj.data is not None:
            mesh_verts = len(obj.data.vertices)
        materials = [
            slot.material.name
            for slot in obj.material_slots
            if slot.material is not None
        ]
        objects.append(
            {
                "name": obj.name,
                "type": obj.type,
                "hide_select": bool(obj.hide_select),
                "verts": mesh_verts,
                "materials": materials,
            }
        )

    images = []
    for image in bpy.data.images:
        size = list(image.size) if image.size else [0, 0]
        images.append(
            {
                "name": image.name,
                "size": size,
                "packed": bool(image.packed_file),
            }
        )

    payload = {
        "glb": str(glb_path),
        "objectCount": len(objects),
        "meshCount": sum(1 for item in objects if item["type"] == "MESH"),
        "selectableMeshNames": [
            item["name"]
            for item in objects
            if item["type"] == "MESH" and not item["hide_select"]
        ],
        "objects": objects,
        "materials": [mat.name for mat in bpy.data.materials],
        "images": images,
        "claimsWorldModelGeneration": False,
        "note": "Blender import of Carina export; object names come from GLB nodes.",
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "out": str(out_path), "meshes": payload["meshCount"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
