"""Indoor floor + door stills after identity spawn. Not world-model."""
from __future__ import annotations

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
    for _ in range(24):
        time.sleep(0.25)
        shot = newest(before)
        if shot:
            dest = OUT / f"{name}.png"
            shutil.copy2(shot, dest)
            return str(dest)
    return ""


def pose(x: float, y: float, z: float, pitch: float, yaw: float) -> None:
    send_command(
        {
            "op": "player_pose",
            "ueLocationCm": {"x": x, "y": y, "z": z},
            "ueRotatorDeg": {"pitch": pitch, "yaw": yaw, "roll": 0},
            "springArmLength": 0,
            "hidePawn": True,
        }
    )
    time.sleep(0.4)


def main() -> None:
    for cmd in (
        "Cheat Ghost",
        "Cheat Fly",
        "slomo 0.0",
        "ShowFlag.SkeletalMeshes 0",
        "viewmode Unlit",
        "r.DefaultFeature.AutoExposure 0",
    ):
        send_command({"op": "highresshot", "exec": cmd})
    pose(600, 500, 250, -89, 0)
    print("floor_down_unlit", grab("floor_down_unlit"))
    pose(600, 700, 155, -8, 90)
    print("door_inside_unlit", grab("door_inside_unlit2"))
    send_command({"op": "highresshot", "exec": "viewmode Lit"})
    send_command({"op": "highresshot", "exec": "r.SkylightIntensityMultiplier 8"})
    pose(600, 500, 250, -89, 0)
    print("floor_down_lit", grab("floor_down_lit"))
    pose(600, 700, 155, -8, 90)
    print("door_inside_lit2", grab("door_inside_lit2"))
    send_command({"op": "highresshot", "exec": "slomo 1"})


if __name__ == "__main__":
    main()
