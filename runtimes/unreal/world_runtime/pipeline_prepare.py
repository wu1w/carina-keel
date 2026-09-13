"""prepare: assetId+assetHash -> Interchange import + cook + IoStore side container."""
from __future__ import annotations
import hashlib
import json
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

try:
    from . import config
    from .asset_registry import load_registry, save_registry, safe_label_from_meta, verify_upload
except ImportError:  # script tests run from this directory
    import config  # type: ignore
    from asset_registry import (  # type: ignore
        load_registry,
        save_registry,
        safe_label_from_meta,
        verify_upload,
    )


def _run(cmd: list[str], log_path: Path, timeout: int = 600) -> tuple[int, float]:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()
    with log_path.open("w", encoding="utf-8", errors="replace") as lf:
        lf.write("CMD: " + " ".join(cmd) + "\n\n")
        lf.flush()
        p = subprocess.run(cmd, stdout=lf, stderr=subprocess.STDOUT, timeout=timeout)
    return p.returncode, (time.perf_counter() - t0) * 1000.0


def _sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _preferred_mesh(label: str, meshes: list[dict[str, str]]) -> dict[str, str]:
    """Prefer the uniquely named StaticMesh; leftover Interchange `asset` collides in IoStore."""
    labeled = next((m for m in meshes if m.get("name") == label), None)
    if labeled is not None:
        return labeled
    unique = next(
        (
            m
            for m in meshes
            if m.get("name") != "asset" and "StaticMeshes" in m["softObjectPath"]
        ),
        None,
    )
    if unique is not None:
        return unique
    return next((m for m in meshes if "StaticMeshes" in m["softObjectPath"]), meshes[0])


def prepare_asset(asset_id: str, asset_hash: str, *, force: bool = False) -> dict[str, Any]:
    config.ensure_dirs()
    verified = verify_upload(asset_id, asset_hash)
    meta = verified["meta"]
    glb_path: Path = verified["glbPath"]
    label = safe_label_from_meta(meta, asset_id)
    dest_content = f"/Game/Imported/Dynamic/{label}"
    soft_mesh = f"/Game/Imported/Dynamic/{label}/{label}/StaticMeshes/{label}"
    # Interchange names the mesh from the source filename. Keep asset.glb on disk;
    # import a uniquely named copy so two featured GLBs do not both become `asset`.
    import_glb = glb_path.with_name(f"{label}.glb")
    if import_glb.resolve() != glb_path.resolve():
        shutil.copy2(glb_path, import_glb)
        glb_path = import_glb
    # Interchange often nests as Dest/Stem/...
    art = config.ARTIFACTS_DIR / asset_hash
    art.mkdir(parents=True, exist_ok=True)
    timings: dict[str, float] = {}

    # Skip re-import if registry already has successful prepare for this hash.
    # force=True re-runs Interchange + Unlit→Opaque reparent (same GLB, not a new generate).
    reg = load_registry()
    existing = reg.get("byHash", {}).get(asset_hash)
    if (
        not force
        and existing
        and existing.get("prepareOk")
        and (art / "iostore" / f"CarinaPS-Windows_{label}.utoc").is_file()
    ):
        return {
            "assetId": asset_id,
            "assetHash": asset_hash,
            "cookMs": existing.get("cookMs", 0),
            "packageIds": existing.get("packageIds", []),
            "shaderMergeOk": existing.get("shaderMergeOk", False),
            "softObjectPath": existing.get("softObjectPath"),
            "label": label,
            "cached": True,
            "timingsMs": existing.get("timingsMs", {}),
            "meshes": existing.get("meshes", []),
        }

    import_log = config.LOGS_DIR / f"ue02_prepare_import_{label}.log"
    # ImportAssets commandlet
    import_cmd = [
        str(config.UE_EDITOR),
        str(config.PROJECT),
        "-run=ImportAssets",
        f"-source={glb_path}",
        f"-dest={dest_content}",
        "-replaceexisting",
        "-importsettings=",  # auto
        "-nosourcecontrol",
        "-unattended",
        "-NullRHI",
        "-nop4",
    ]
    # Prefer parameterized import via python helper if ImportAssets flags flaky — try standard first
    rc, ms = _run(import_cmd, import_log, timeout=300)
    timings["importMs"] = ms
    if rc != 0:
        raise RuntimeError(f"Interchange import failed rc={rc}; see {import_log}")

    remap_script = Path(__file__).with_name("ue_reparent_gltf_opaque.py")
    if remap_script.is_file():
        remap_log = config.LOGS_DIR / f"ue02_prepare_reparent_{label}.log"
        remap_cmd = [
            str(config.UE_EDITOR),
            str(config.PROJECT),
            f"-ExecutePythonScript={remap_script}",
            "-unattended",
            "-nop4",
            "-NullRHI",
        ]
        env = os.environ.copy()
        env["CARINA_IMPORT_LABEL"] = label
        t0 = time.perf_counter()
        remap_log.parent.mkdir(parents=True, exist_ok=True)
        with remap_log.open("w", encoding="utf-8", errors="replace") as lf:
            lf.write("CMD: " + " ".join(remap_cmd) + "\n\n")
            p = subprocess.run(
                remap_cmd,
                stdout=lf,
                stderr=subprocess.STDOUT,
                timeout=240,
                env=env,
            )
        timings["reparentMs"] = (time.perf_counter() - t0) * 1000.0
        if p.returncode != 0:
            raise RuntimeError(f"glTF opaque reparent failed rc={p.returncode}; see {remap_log}")

    # Discover imported static mesh path under Content/Imported/Dynamic/{label}
    content_fs = config.PROJECT_DIR / "Content" / "Imported" / "Dynamic" / label
    mesh_candidates = list(content_fs.rglob("*.uasset")) if content_fs.is_dir() else []
    meshes: list[dict[str, str]] = []
    skip_bits = ("Material", "Texture", "Thumbnail", "MI_", "M_", "T_")
    for c in mesh_candidates:
        if any(bit in c.name for bit in skip_bits):
            continue
        if "Materials" in c.parts or "Textures" in c.parts:
            continue
        rel = c.relative_to(config.PROJECT_DIR / "Content")
        soft = "/Game/" + rel.with_suffix("").as_posix()
        meshes.append({"name": c.stem, "softObjectPath": soft})
    if not meshes and mesh_candidates:
        c = max(mesh_candidates, key=lambda p: p.stat().st_size)
        rel = c.relative_to(config.PROJECT_DIR / "Content")
        meshes.append({"name": c.stem, "softObjectPath": "/Game/" + rel.with_suffix("").as_posix()})
    if not meshes:
        raise RuntimeError(f"No imported uasset under {content_fs}; import log {import_log}")

    preferred = _preferred_mesh(label, meshes)
    soft_mesh = preferred["softObjectPath"]

    cook_log = config.LOGS_DIR / f"ue02_prepare_cook_{label}.log"
    package_args: list[str] = []
    for mesh in meshes:
        package_args.append(f"-package={mesh['softObjectPath']}")
    cook_cmd = [
        str(config.UE_EDITOR),
        str(config.PROJECT),
        "-run=Cook",
        "-TargetPlatform=Windows",
        *package_args,
        "-unattended",
        "-NullRHI",
        "-nop4",
        "-iterate",
    ]
    rc, ms = _run(cook_cmd, cook_log, timeout=600)
    timings["cookMs"] = ms
    if rc != 0:
        raise RuntimeError(f"Cook failed rc={rc}; see {cook_log}")

    # Build IoStore response from cooked files under Saved/Cooked/.../Imported/Dynamic/{label}
    cooked_dir = config.COOKED_ROOT / "Dynamic" / label
    if not cooked_dir.is_dir():
        # try alternate nesting
        cooked_dir = config.PROJECT_DIR / "Saved" / "Cooked" / "Windows" / "CarinaPS" / "Content" / "Imported" / "Dynamic" / label
    if not cooked_dir.is_dir():
        raise RuntimeError(f"Cooked dir missing: {cooked_dir}")

    resp_dir = art / "response"
    out_paks = art / "iostore"
    resp_dir.mkdir(parents=True, exist_ok=True)
    out_paks.mkdir(parents=True, exist_ok=True)
    pak_list = resp_dir / f"PakListIoStore_{label}.txt"
    lines = []
    for f in sorted(cooked_dir.rglob("*")):
        if f.suffix.lower() in {".uasset", ".uexp", ".ubulk", ".uptnl"}:
            mount = "../../../CarinaPS/Content/" + f.relative_to(config.PROJECT_DIR / "Saved" / "Cooked" / "Windows" / "CarinaPS" / "Content").as_posix()
            lines.append(f'\"{f}\" \"{mount}\" -compress')
    pak_list.write_text("\n".join(lines) + "\n", encoding="utf-8")
    container_name = f"CarinaPS-Windows_{label}"
    utoc_out = out_paks / f"{container_name}.utoc"
    cmds_file = resp_dir / f"IoStoreCommands_{label}.txt"
    cmds_file.write_text(
        f'-Output=\"{utoc_out}\" -ContainerName={container_name} -ResponseFile=\"{pak_list}\"\n',
        encoding="utf-8",
    )

    # Classic pak (basename match required for mount)
    classic_list = resp_dir / f"PakList_{label}.txt"
    classic_list.write_text("\n".join(lines) + "\n", encoding="utf-8")
    classic_pak = out_paks / f"z_{container_name}.pak"
    ucas_out = out_paks / f"{container_name}.ucas"
    for stale in (classic_pak, utoc_out, ucas_out):
        if stale.is_file():
            stale.unlink()
    pak_log = config.LOGS_DIR / f"ue02_prepare_pak_{label}.log"
    pak_cmd = [
        str(config.UE_PAK),
        str(classic_pak),
        f"-Create={classic_list}",
    ]
    rc, ms = _run(pak_cmd, pak_log, timeout=120)
    timings["classicPakMs"] = ms
    if rc != 0:
        raise RuntimeError(f"Classic pak failed rc={rc}")

    iostore_log = config.LOGS_DIR / f"ue02_prepare_iostore_{label}.log"
    meta = config.PROJECT_DIR / "Saved" / "Cooked" / "Windows" / "CarinaPS" / "Metadata"
    cooked_windows = config.PROJECT_DIR / "Saved" / "Cooked" / "Windows"
    io_cmd = [
        str(config.UE_PAK),
        f"-CreateGlobalContainer={out_paks / ('global_' + label + '.utoc')}",
        f"-CookedDirectory={cooked_windows}",
        f"-Commands={cmds_file}",
        f"-PackageStoreManifest={meta / 'packagestore.manifest'}",
        f"-AssetRegistry={meta / 'DevelopmentAssetRegistry.bin'}",
        f"-ScriptObjects={meta / 'scriptobjects.bin'}",
        "-compressionformats=Oodle",
        "-compresslevel=4",
        "-nopak",
    ]
    rc, ms = _run(io_cmd, iostore_log, timeout=120)
    timings["iostoreMs"] = ms
    if rc != 0 or not utoc_out.is_file():
        raise RuntimeError(f"IoStore container failed rc={rc}; see {iostore_log}")

    package_ids = [m["softObjectPath"] for m in meshes]
    entry = {
        "assetId": asset_id,
        "assetHash": asset_hash,
        "label": label,
        "softObjectPath": soft_mesh,
        "meshes": meshes,
        "packageIds": package_ids,
        "containerName": container_name,
        "iostoreDir": str(out_paks),
        "classicPak": str(classic_pak),
        "utoc": str(utoc_out),
        "ucas": str(out_paks / f"{container_name}.ucas"),
        "prepareOk": True,
        "shaderMergeOk": False,  # merge is optional; host already has Material_MR shaders GREEN
        "cookMs": timings.get("cookMs", 0),
        "timingsMs": timings,
        "importDest": dest_content,
    }
    reg.setdefault("byHash", {})[asset_hash] = entry
    reg.setdefault("byAssetId", {})[asset_id] = asset_hash
    save_registry(reg)

    return {
        "assetId": asset_id,
        "assetHash": asset_hash,
        "cookMs": timings.get("cookMs", 0),
        "packageIds": package_ids,
        "shaderMergeOk": False,
        "softObjectPath": soft_mesh,
        "label": label,
        "cached": False,
        "timingsMs": timings,
        "containerName": container_name,
        "meshes": meshes,
    }
