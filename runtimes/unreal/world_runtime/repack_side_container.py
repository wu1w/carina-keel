"""Rebuild tavern_pbr side IoStore from the latest cooked files and install.

Streamer must be stopped. Does not replace global.utoc. Not world-model.
"""
from __future__ import annotations

import json
from pathlib import Path

from . import config
from .pipeline_install import install_asset
from .pipeline_prepare import _run
from .asset_registry import load_registry, save_registry

LABEL = "tavern_pbr"
ASSET_HASH = "629373db5bc61c4c3beaaa0bf73e2f7baf93921e7a86e9675d2fca1ff4262673"


def main() -> None:
    config.ensure_dirs()
    cooked_dir = config.PROJECT_DIR / "Saved" / "Cooked" / "Windows" / "CarinaPS" / "Content" / "Imported" / "Dynamic" / LABEL
    if not cooked_dir.is_dir():
        raise SystemExit(f"missing cooked {cooked_dir}")
    art = config.ARTIFACTS_DIR / ASSET_HASH
    resp_dir = art / "response"
    out_paks = art / "iostore"
    resp_dir.mkdir(parents=True, exist_ok=True)
    out_paks.mkdir(parents=True, exist_ok=True)
    container_name = f"CarinaPS-Windows_{LABEL}"
    pak_list = resp_dir / f"PakListIoStore_{LABEL}.txt"
    lines = []
    cooked_content = config.PROJECT_DIR / "Saved" / "Cooked" / "Windows" / "CarinaPS" / "Content"
    for f in sorted(cooked_dir.rglob("*")):
        if f.suffix.lower() in {".uasset", ".uexp", ".ubulk", ".uptnl"}:
            mount = "../../../CarinaPS/Content/" + f.relative_to(cooked_content).as_posix()
            lines.append(f'"{f}" "{mount}" -compress')
    pak_list.write_text("\n".join(lines) + "\n", encoding="utf-8")
    utoc_out = out_paks / f"{container_name}.utoc"
    cmds_file = resp_dir / f"IoStoreCommands_{LABEL}.txt"
    cmds_file.write_text(
        f'-Output="{utoc_out}" -ContainerName={container_name} -ResponseFile="{pak_list}"\n',
        encoding="utf-8",
    )
    classic_list = resp_dir / f"PakList_{LABEL}.txt"
    classic_list.write_text("\n".join(lines) + "\n", encoding="utf-8")
    classic_pak = out_paks / f"z_{container_name}.pak"
    for stale in (
        classic_pak,
        utoc_out,
        out_paks / f"{container_name}.ucas",
        out_paks / f"global_{LABEL}.utoc",
        out_paks / f"global_{LABEL}.ucas",
    ):
        if stale.is_file():
            stale.unlink()
    pak_log = config.LOGS_DIR / f"ue02_repack_pak_{LABEL}.log"
    rc, _ = _run([str(config.UE_PAK), str(classic_pak), f"-Create={classic_list}"], pak_log, timeout=120)
    if rc != 0:
        raise SystemExit(f"classic pak failed rc={rc}")
    meta = config.PROJECT_DIR / "Saved" / "Cooked" / "Windows" / "CarinaPS" / "Metadata"
    cooked_windows = config.PROJECT_DIR / "Saved" / "Cooked" / "Windows"
    iostore_log = config.LOGS_DIR / f"ue02_repack_iostore_{LABEL}.log"
    io_cmd = [
        str(config.UE_PAK),
        f"-CreateGlobalContainer={out_paks / ('global_' + LABEL + '.utoc')}",
        f"-CookedDirectory={cooked_windows}",
        f"-Commands={cmds_file}",
        f"-PackageStoreManifest={meta / 'packagestore.manifest'}",
        f"-AssetRegistry={meta / 'DevelopmentAssetRegistry.bin'}",
        f"-ScriptObjects={meta / 'scriptobjects.bin'}",
        "-compressionformats=Oodle",
        "-compresslevel=4",
        "-nopak",
    ]
    rc, _ = _run(io_cmd, iostore_log, timeout=120)
    if rc != 0 or not utoc_out.is_file():
        raise SystemExit(f"iostore failed rc={rc}; see {iostore_log}")
    reg = load_registry()
    entry = (reg.get("byHash") or {}).get(ASSET_HASH) or {}
    entry.update(
        {
            "label": LABEL,
            "containerName": container_name,
            "iostoreDir": str(out_paks),
            "classicPak": str(classic_pak),
            "utoc": str(utoc_out),
            "ucas": str(out_paks / f"{container_name}.ucas"),
            "prepareOk": True,
            "reparentedOpaque": True,
            "notWorldModel": True,
        }
    )
    reg.setdefault("byHash", {})[ASSET_HASH] = entry
    save_registry(reg)
    inst = install_asset(ASSET_HASH)
    result = {"ok": True, "install": inst, "notWorldModel": True}
    (config.LOGS_DIR / "p1_repack_side.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
