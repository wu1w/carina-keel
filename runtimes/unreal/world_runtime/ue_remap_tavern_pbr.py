"""Reparent tavern Interchange MICs onto the host-proven opaque glTF parent.

WoodFloor/WoodBar used MI_Default_Opaque_DS; packaged ShaderArchive has
MI_Default_Opaque (helmet Material_MR) GREEN. DS permutations rendered black
even in Unlit. Also stop feeding a grayscale roughness JPEG as the packed
metallic-roughness texture (B=metallic).

Not world-model generation.
"""
from __future__ import annotations

import json
from pathlib import Path

import unreal

OUT = Path(r"C:\Users\wuyw\carina-rtx-validation\logs\p1_mat_remap.json")
PARENT_PATH = "/InterchangeAssets/gltf/MaterialInstances/MI_Default_Opaque"
WHITE_LINEAR = "/InterchangeAssets/gltf/Textures/T_White_Linear"
MATERIALS = {
    "WoodFloor": {"metallic": 0.0, "roughness": 0.62},
    "WoodBar": {"metallic": 0.0, "roughness": 0.55},
    "BrickHearth": {"metallic": 0.0, "roughness": 0.72},
    "MetalTrim": {"metallic": 1.0, "roughness": 0.28},
    "GlassCup": {"metallic": 0.0, "roughness": 0.08},
}
MAT_DIR = "/Game/Imported/Dynamic/tavern_pbr/asset/Materials"


def main() -> None:
    parent = unreal.EditorAssetLibrary.load_asset(PARENT_PATH)
    white = unreal.EditorAssetLibrary.load_asset(WHITE_LINEAR)
    if not parent:
        raise RuntimeError(f"missing parent {PARENT_PATH}")
    rows = []
    for name, factors in MATERIALS.items():
        path = f"{MAT_DIR}/{name}"
        mic = unreal.EditorAssetLibrary.load_asset(path)
        if not mic:
            rows.append({"path": path, "ok": False, "error": "load failed"})
            continue
        unreal.MaterialEditingLibrary.set_material_instance_parent(mic, parent)
        unreal.MaterialEditingLibrary.set_material_instance_scalar_parameter_value(
            mic, "MetallicFactor", float(factors["metallic"])
        )
        unreal.MaterialEditingLibrary.set_material_instance_scalar_parameter_value(
            mic, "RoughnessFactor", float(factors["roughness"])
        )
        if white and name != "MetalTrim":
            unreal.MaterialEditingLibrary.set_material_instance_texture_parameter_value(
                mic, "MetallicRoughnessTexture", white
            )
        unreal.MaterialEditingLibrary.update_material_instance(mic)
        saved = unreal.EditorAssetLibrary.save_asset(path, only_if_is_dirty=False)
        rows.append(
            {
                "path": path,
                "ok": True,
                "saved": bool(saved),
                "parent": PARENT_PATH,
                "metallic": factors["metallic"],
                "roughness": factors["roughness"],
                "notWorldModel": True,
            }
        )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"ok": True, "rows": rows, "notWorldModel": True}, indent=2) + "\n", encoding="utf-8")
    unreal.log("remap wrote " + str(OUT))


if __name__ == "__main__":
    main()
