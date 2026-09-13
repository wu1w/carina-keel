"""Reparent imported glTF MICs onto host-proven Opaque (Lit).

Packaged ShaderArchive already contains MI_Default_Opaque (helmet).
Double-sided DS / Unlit / emissive parents cook black or ignore fill lights.
Not world-model. Not a P1 pass by itself.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import unreal

try:
    from .gltf_reparent_policy import parent_needs_reparent
except ImportError:
    from gltf_reparent_policy import parent_needs_reparent

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
        if not parent_needs_reparent(parent_name):
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
    collision_rows = _ensure_complex_as_simple(label)
    out = OUT_DIR / f"p1_reparent_{label}.json"
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "ok": True,
                "label": label,
                "parent": PARENT_PATH,
                "rows": rows,
                "collision": collision_rows,
                "notWorldModel": True,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    unreal.log("reparent wrote " + str(out))


def _ensure_complex_as_simple(label: str) -> list[dict]:
    """Interchange GLBs often ship with empty simple collision. Walkable shells need complex-as-simple.

    Does not claim world-model generation. Scaffold and featured meshes both need a body that BlockAll can hit.
    """
    root = f"/Game/Imported/Dynamic/{label}"
    rows: list[dict] = []
    for path in [str(p) for p in unreal.EditorAssetLibrary.list_assets(root, recursive=True, include_folder=False)]:
        asset = unreal.EditorAssetLibrary.load_asset(path)
        if not asset or asset.get_class().get_name() != "StaticMesh":
            continue
        body = None
        try:
            body = asset.get_editor_property("body_setup")
        except Exception:
            body = None
        if body is None:
            rows.append({"path": path, "ok": False, "reason": "no-body-setup"})
            continue
        try:
            body.set_editor_property(
                "collision_trace_flag",
                unreal.CollisionTraceFlag.CTF_USE_COMPLEX_AS_SIMPLE,
            )
        except Exception:
            body.set_editor_property(
                "collision_trace_flag",
                unreal.CollisionTraceFlag.USE_COMPLEX_AS_SIMPLE,
            )
        saved = unreal.EditorAssetLibrary.save_asset(path, only_if_is_dirty=False)
        rows.append({"path": path, "ok": True, "saved": bool(saved), "collision": "use_complex_as_simple"})
    return rows


if __name__ == "__main__":
    main()
