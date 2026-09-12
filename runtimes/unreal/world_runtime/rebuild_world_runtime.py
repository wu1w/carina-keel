"""Rebuild packaged CarinaPS.exe (C++ only). Never recook. Never replace global.utoc."""
from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

from . import config

UAT = config.UE_ENGINE / "Engine" / "Build" / "BatchFiles" / "RunUAT.bat"
HOST_NAMES = (
    "CarinaPS-Windows.pak",
    "CarinaPS-Windows.ucas",
    "CarinaPS-Windows.utoc",
    "global.ucas",
    "global.utoc",
)


def _sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest().upper()


def main() -> None:
    config.ensure_dirs()
    before = {name: _sha256(config.PACKAGED_PAKS / name) for name in HOST_NAMES if (config.PACKAGED_PAKS / name).is_file()}
    log = config.LOGS_DIR / "rebuild_world_runtime.log"
    cmd = [
        str(UAT),
        "BuildCookRun",
        f"-project={config.PROJECT}",
        "-platform=Win64",
        "-clientconfig=Development",
        "-build",
        "-skipcook",
        "-stage",
        "-pak",
        "-iostore",
        "-archive",
        f"-archivedirectory={config.PROJECT_DIR / 'Packaged'}",
        "-utf8output",
    ]
    with log.open("w", encoding="utf-8", errors="replace") as lf:
        lf.write("CMD: " + " ".join(cmd) + "\n\n")
        lf.flush()
        rc = subprocess.run(cmd, stdout=lf, stderr=subprocess.STDOUT, timeout=2400).returncode
    after = {name: _sha256(config.PACKAGED_PAKS / name) for name in HOST_NAMES if (config.PACKAGED_PAKS / name).is_file()}
    result = {
        "ok": rc == 0,
        "rc": rc,
        "log": str(log),
        "before": before,
        "after": after,
        "globalUtocUnchanged": before.get("global.utoc") == after.get("global.utoc"),
        "globalUcasUnchanged": before.get("global.ucas") == after.get("global.ucas"),
        "notWorldModel": True,
        "alwaysCookAvocado": False,
    }
    (config.LOGS_DIR / "rebuild_world_runtime.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    if rc != 0:
        raise SystemExit(rc)


if __name__ == "__main__":
    main()
