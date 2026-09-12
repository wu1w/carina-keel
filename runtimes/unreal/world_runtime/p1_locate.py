"""Locate spawned tavern with look-down + unlit stills. Not world-model."""
from __future__ import annotations

import shutil
import time
from pathlib import Path

from .ipc_ue import send_command

SHOT_DIR = Path(r"G:\carina-ue\CarinaPS\Packaged\Windows\CarinaPS\Saved\Screenshots\Windows")
OUT = Path(r"C:\Users\wuyw\carina-rtx-validation\logs\p1_locate")


def newest(after: float) -> Path | None:
    files = [p for p in SHOT_DIR.glob("HighresScreenshot*.png") if p.stat().st_mtime > after]
    return max(files, key=lambda p: p.stat().st_mtime) if files else None


def shot(name: str) -> str:
    before = time.time()
    send_command({"op": "highresshot", "exec": "HighResShot 1"})
    for _ in range(20):
        time.sleep(0.35)
        p = newest(before)
        if p:
            dest = OUT / f"{name}.png"
            shutil.copy2(p, dest)
            return str(dest)
    return ""


def pose(x: float, y: float, z: float, pitch: float, yaw: float) -> None:
    send_command(
        {
            "op": "player_pose",
            "ueLocationCm": {"x": x, "y": y, "z": z},
            "ueRotatorDeg": {"pitch": pitch, "yaw": yaw, "roll": 0},
        }
    )
    time.sleep(1.5)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for cmd in (
        "Cheat Ghost",
        "r.DefaultFeature.AutoExposure 1",
        "r.EyeAdaptationQuality 2",
        "viewmode Unlit",
        "r.SkylightIntensityMultiplier 4",
    ):
        send_command({"op": "highresshot", "exec": cmd})
    probes = [
        ("down_origin", 0, 0, 400, -80, 0),
        ("down_expected", 600, 500, 400, -80, 0),
        ("down_expected_high", 600, 500, 1200, -85, 0),
        ("down_double", 1200, 1000, 400, -80, 0),
        ("inside_unlit", 600, 500, 160, -12, 90),
        ("bar_unlit", 460, 500, 160, -10, 180),
    ]
    results = {}
    for name, x, y, z, pitch, yaw in probes:
        pose(x, y, z, pitch, yaw)
        results[name] = shot(name)
    send_command({"op": "highresshot", "exec": "viewmode Lit"})
    pose(600, 500, 160, -12, 90)
    results["inside_lit"] = shot("inside_lit")
    pose(460, 500, 160, -10, 180)
    results["bar_lit"] = shot("bar_lit")
    print(results)


if __name__ == "__main__":
    main()
