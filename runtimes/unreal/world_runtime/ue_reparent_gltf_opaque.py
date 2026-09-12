"""Reparent imported glTF MICs from Opaque_DS onto host-proven Opaque.

Packaged ShaderArchive already contains MI_Default_Opaque (helmet).
Double-sided DS parents cooked black in Unlit/Lit. Not world-model.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import unreal

OUT_DIR = Path(r"C:\Users\wuyw\carina-rtx-validation\logs")
PARENT_PATH = "/InterchangeAssets/gltf/MaterialInstances/MI_Default_Opaque"
WHITE_LINEAR = "/InterchangeAssets/gltf/Textures/T_White_Linear"


def _factors(name: str) -> tuple[float, float]:
    n = name.lower()
    if "metal" in n:
        return 1.0, 0.28
    if "glass" in n or "trans" in n:
        return 0.0, 0.08
    if "brick" in n:
        return 0.0, 0.72
    return 0.0, 0.6


def main() -> None:
    label = os.environ.get("CARINA_IMPORT_LABEL", "tavern_pbr")
    parent = unreal.EditorAssetLibrary.load_asset(PARENT_PATH)
    white = unreal.EditorAssetLibrary.load_asset(WHITE_LINEAR)
    if not parent:
        raise RuntimeError(f"missing {PARENT_PATH}")
    root = f"/Game/Imported/Dynamic/{label}"
    paths = [str(p) for p in unreal.EditorAssetLibrary.list_assets(root, recursive=True, include_folder=False)]
    rows = []
    for path in paths:
        asset = unreal.EditorAssetLibrary.load_asset(path)
        if not asset or asset.get_class().get_name() != "MaterialInstanceConstant":
            continue
        try:
            cur_parent = asset.get_editor_property("parent")
        except Exception:
            cur_parent = None
        parent_name = cur_parent.get_name() if cur_parent else ""
        if "Opaque_DS" not in parent_name and "Transmission" not in parent_name:
            rows.append({"path": path, "skipped": True, "parent": parent_name})
            continue
        name = asset.get_name()
        metallic, roughness = _factors(name)
        unreal.MaterialEditingLibrary.set_material_instance_parent(asset, parent)
        unreal.MaterialEditingLibrary.set_material_instance_scalar_parameter_value(asset, "MetallicFactor", metallic)
        unreal.MaterialEditingLibrary.set_material_instance_scalar_parameter_value(asset, "RoughnessFactor", roughness)
        if white and metallic < 0.5:
            unreal.MaterialEditingLibrary.set_material_instance_texture_parameter_value(
                asset, "MetallicRoughnessTexture", white
            )
        unreal.MaterialEditingLibrary.update_material_instance(asset)
        saved = unreal.EditorAssetLibrary.save_asset(path, only_if_is_dirty=False)
        rows.append(
            {
                "path": path,
                "ok": True,
                "saved": bool(saved),
                "fromParent": parent_name,
                "metallic": metallic,
                "roughness": roughness,
            }
        )
    out = OUT_DIR / f"p1_reparent_{label}.json"
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps({"ok": True, "label": label, "parent": PARENT_PATH, "rows": rows, "notWorldModel": True}, indent=2)
        + "\n",
        encoding="utf-8",
    )
    unreal.log("reparent wrote " + str(out))


if __name__ == "__main__":
    main()
