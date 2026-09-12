"""MERGE tavern materials into host CarinaPS ShaderArchive. Never replace global utoc/ucas.

Forbidden: AlwaysCook Avocado, full ShaderArchive Order=204 replace.
Allowed: cook /Game/Imported/Dynamic/<label> then BuildCookRun -skipcook -stage -pak -iostore.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

UE_EDITOR = Path(r"G:\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe")
UAT = Path(r"G:\UE_5.8\Engine\Build\BatchFiles\RunUAT.bat")
PROJECT = Path(r"G:\carina-ue\CarinaPS\CarinaPS.uproject")
LOGS = Path(r"C:\Users\wuyw\carina-rtx-validation\logs")


def _packages_for_label(label: str) -> list[str]:
    content = PROJECT.parent / "Content" / "Imported" / "Dynamic" / label
    packages: list[str] = []
    if content.is_dir():
        for uasset in sorted(content.rglob("*.uasset")):
            rel = uasset.relative_to(PROJECT.parent / "Content")
            packages.append("/Game/" + rel.with_suffix("").as_posix())
    return packages


def main() -> None:
    label = sys.argv[1] if len(sys.argv) > 1 else "tavern_pbr"
    dest = f"/Game/Imported/Dynamic/{label}"
    packages = _packages_for_label(label)
    LOGS.mkdir(parents=True, exist_ok=True)
    cook_log = LOGS / f"p1_merge_cook_{label}.log"
    cmd = [
        str(UE_EDITOR),
        str(PROJECT),
        "-run=Cook",
        "-TargetPlatform=Windows",
        f"-cookdir={dest}",
        *[f"-package={p}" for p in packages],
        "-unattended",
        "-nop4",
    ]
    cook_log.write_text("CMD: " + " ".join(cmd) + "\n", encoding="utf-8")
    with cook_log.open("a", encoding="utf-8", errors="replace") as lf:
        rc = subprocess.run(cmd, stdout=lf, stderr=subprocess.STDOUT, timeout=2400).returncode
    if rc != 0:
        raise SystemExit(f"host cook failed rc={rc}; see {cook_log}")
    stage_log = LOGS / f"p1_merge_stage_{label}.log"
    uat = [
        str(UAT),
        "BuildCookRun",
        f"-project={PROJECT}",
        "-platform=Win64",
        "-clientconfig=Development",
        "-skipcook",
        "-skipbuild",
        "-stage",
        "-pak",
        "-iostore",
        "-archive",
        f"-archivedirectory={PROJECT.parent / 'Packaged'}",
        "-utf8output",
    ]
    with stage_log.open("w", encoding="utf-8", errors="replace") as lf:
        lf.write("CMD: " + " ".join(uat) + "\n")
        rc = subprocess.run(uat, stdout=lf, stderr=subprocess.STDOUT, timeout=2400).returncode
    result = {
        "ok": rc == 0,
        "label": label,
        "cookDir": dest,
        "packageCount": len(packages),
        "packages": packages,
        "alwaysCookAvocado": False,
        "fullShaderArchiveReplace": False,
        "notWorldModel": True,
        "cookLog": str(cook_log),
        "stageLog": str(stage_log),
        "stageRc": rc,
    }
    (LOGS / f"p1_merge_{label}.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    if rc != 0:
        raise SystemExit(f"stage/pak MERGE failed rc={rc}; see {stage_log}")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
