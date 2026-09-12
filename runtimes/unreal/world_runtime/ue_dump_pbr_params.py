"""Dump Interchange material params (UE 5.8). Not world-model generation."""
from __future__ import annotations

import json
from pathlib import Path

import unreal

OUT = Path(r"C:\Users\wuyw\carina-rtx-validation\logs\p1_mat_dump.json")
PATHS = [
    "/Game/Imported/DamagedHelmet/DamagedHelmet/Materials/Material_MR",
    "/Game/Imported/Dynamic/tavern_pbr/asset/Materials/WoodFloor",
    "/Game/Imported/Dynamic/tavern_pbr/asset/Materials/WoodBar",
    "/Game/Imported/Dynamic/tavern_pbr/asset/Materials/MetalTrim",
    "/Game/Imported/Dynamic/tavern_pbr/asset/Materials/BrickHearth",
    "/Game/Imported/Dynamic/tavern_pbr/asset/Materials/GlassCup",
]


def _names(fn, asset) -> list[str] | str:
    try:
        return [str(n) for n in fn(asset)]
    except Exception as exc:
        return f"err:{exc}"


def describe(path: str) -> dict:
    asset = unreal.EditorAssetLibrary.load_asset(path)
    if not asset:
        return {"path": path, "ok": False, "error": "load failed"}
    info: dict = {
        "path": path,
        "ok": True,
        "class": asset.get_class().get_name(),
        "name": asset.get_name(),
    }
    info["textureParams"] = _names(unreal.MaterialEditingLibrary.get_texture_parameter_names, asset)
    info["scalarParams"] = _names(unreal.MaterialEditingLibrary.get_scalar_parameter_names, asset)
    info["vectorParams"] = _names(unreal.MaterialEditingLibrary.get_vector_parameter_names, asset)
    parent = None
    try:
        parent = asset.get_editor_property("parent")
    except Exception:
        parent = None
    info["parent"] = parent.get_path_name() if parent else None
    tex_names = info["textureParams"] if isinstance(info["textureParams"], list) else []
    values = {}
    for pname in tex_names:
        try:
            tex = unreal.MaterialEditingLibrary.get_material_instance_texture_parameter_value(asset, pname)
            values[pname] = tex.get_path_name() if tex else None
        except Exception as exc:
            values[pname] = f"err:{exc}"
    info["textureValues"] = values
    return info


def main() -> None:
    rows = [describe(p) for p in PATHS]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
    unreal.log("wrote " + str(OUT))


if __name__ == "__main__":
    main()
