"""Freeze pawn with slomo, pose, HighResShot. Not world-model."""
from __future__ import annotations

import json
import shutil
import time
from pathlib import Path

from .ipc_ue import send_command

SHOT_DIR = Path(r"G:\carina-ue\CarinaPS\Packaged\Windows\CarinaPS\Saved\Screenshots\Windows")
OUT = Path(r"C:\Users\wuyw\carina-rtx-validation\logs\p1_views")


def newest(after: float) -> Path | None:
    files = [p for p in SHOT_DIR.glob("HighresScreenshot*.png") if p.stat().st_mtime > after]
    return max(files, key=lambda p: p.stat().st_mtime) if files else None


def grab(name: str) -> str:
    before = time.time()
    send_command({"op": "highresshot", "exec": "HighResShot 1"})
    for _ in range(30):
        time.sleep(0.25)
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


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for cmd in (
        "Cheat Fly",
        "slomo 0.0",
        "r.DefaultFeature.AutoExposure 1",
        "r.EyeAdaptationQuality 2",
        "ShowFlag.SkeletalMeshes 0",
        "viewmode Unlit",
    ):
        send_command({"op": "highresshot", "exec": cmd})

    views = [
        ("bar_near", 420.0, 500.0, 160.0, -12.0, 180.0),
        ("fireplace", 780.0, 280.0, 160.0, -12.0, -50.0),
        ("door_inside", 600.0, 760.0, 160.0, -8.0, 90.0),
        ("door_outside", 600.0, 1120.0, 180.0, -10.0, -90.0),
        ("cup", 220.0, 460.0, 140.0, -25.0, 180.0),
        ("bar_behind", 200.0, 500.0, 150.0, -10.0, 0.0),
        ("spawn_floor", 600.0, 220.0, 140.0, -20.0, 90.0),
        ("down_room", 600.0, 500.0, 600.0, -85.0, 0.0),
    ]
    shots = {}
    for name, x, y, z, pitch, yaw in views:
        pose(x, y, z, pitch, yaw)
        time.sleep(0.35)
        shots[name + "_unlit"] = grab(name + "_unlit")

    send_command({"op": "highresshot", "exec": "viewmode Lit"})
    for name, x, y, z, pitch, yaw in views:
        pose(x, y, z, pitch, yaw)
        time.sleep(0.35)
        shots[name] = grab(name)

    send_command({"op": "highresshot", "exec": "slomo 1"})
    send_command({"op": "highresshot", "exec": "Cheat Walk"})
    send_command({"op": "highresshot", "exec": "ShowFlag.SkeletalMeshes 1"})
    (OUT.parent / "p1_views_slomo.json").write_text(json.dumps(shots, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(shots, indent=2))


if __name__ == "__main__":
    main()
