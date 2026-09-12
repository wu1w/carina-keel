"""Walk-mode locked views (no Fly/Ghost). Tavern already spawned. Not world-model."""
from __future__ import annotations

import json
import shutil
import time
from pathlib import Path

from .ipc_ue import send_command

SHOT_DIR = Path(r"G:\carina-ue\CarinaPS\Packaged\Windows\CarinaPS\Saved\Screenshots\Windows")
OUT = Path(r"C:\Users\wuyw\carina-rtx-validation\logs\p1_views")
EVIDENCE = Path(r"C:\Users\wuyw\carina-rtx-validation\logs\p1_views_walk.json")


def newest(after: float) -> Path | None:
    files = [p for p in SHOT_DIR.glob("HighresScreenshot*.png") if p.stat().st_mtime > after]
    return max(files, key=lambda p: p.stat().st_mtime) if files else None


def grab(name: str) -> str:
    before = time.time()
    send_command({"op": "highresshot", "exec": "HighResShot 1"})
    for _ in range(24):
        time.sleep(0.4)
        p = newest(before)
        if p:
            dest = OUT / f"{name}.png"
            shutil.copy2(p, dest)
            return str(dest)
    return ""


def pose(x: float, y: float, z: float, pitch: float, yaw: float) -> dict:
    return send_command(
        {
            "op": "player_pose",
            "ueLocationCm": {"x": x, "y": y, "z": z},
            "ueRotatorDeg": {"pitch": pitch, "yaw": yaw, "roll": 0},
        }
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for cmd in (
        "Cheat Walk",
        "r.DefaultFeature.AutoExposure 1",
        "r.EyeAdaptationQuality 2",
        "r.EyeAdaptation.PreExposureOverride 1",
        "ShowFlag.SkeletalMeshes 0",
        "viewmode Unlit",
    ):
        send_command({"op": "highresshot", "exec": cmd})
        time.sleep(0.2)

    # UE cm. Room floor center ~(600,500,0); door north Y~1000; bar at X~140 Y~500.
    views = [
        ("bar_near", 420, 500, 110, -8, 180),
        ("fireplace", 820, 280, 110, -8, -60),
        ("door_inside", 600, 780, 110, -6, 90),
        ("door_outside", 600, 1080, 140, -8, -90),
        ("cup", 250, 460, 120, -20, 180),
        ("bar_behind", 160, 500, 115, -8, 0),
    ]
    shots = {}
    for name, x, y, z, pitch, yaw in views:
        pose(x, y, z, pitch, yaw)
        time.sleep(2.2)
        shots[name + "_unlit"] = grab(name + "_unlit")

    send_command({"op": "highresshot", "exec": "viewmode Lit"})
    time.sleep(0.4)
    for name, x, y, z, pitch, yaw in views:
        pose(x, y, z, pitch, yaw)
        time.sleep(2.2)
        shots[name] = grab(name)

    pose(600, 220, 110, 0, 90)
    time.sleep(2.0)
    shots["spawn_floor"] = grab("spawn_floor")

    send_command({"op": "highresshot", "exec": "ShowFlag.SkeletalMeshes 1"})
    evidence = {
        "gate": "P1-3-walk-views",
        "notWorldModel": True,
        "noFly": True,
        "noToggleDebugCamera": True,
        "shots": shots,
    }
    EVIDENCE.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(shots, indent=2))


if __name__ == "__main__":
    main()
