"""Capture locked viewport stills from the live CarinaPS host via the WorldRuntime IPC.

Generic successor to p1_reshoot.py: views come from a JSON spec instead of being hard-coded.

    python -m world_runtime.shoot_views spec.json out_dir

spec.json:
    {
      "views": [{"name": "door_outside", "loc": [6, 1.7, -2], "rot": {"pitch": -8, "yaw": 90, "roll": 0}}],
      "standTests": [{"name": "garden_floor", "drop": [6, 3.0, -4], "rot": {...}, "springArmLength": 350}],
      "wireOverhead": {"loc": [6, 14, -1], "pitch": -89}
    }

`loc` is Carina meters (x, y-up, z); converted with the same X,Z,Y basis as transforms.carina_to_ue.
Views are shot with Cheat Fly / hidden pawn (camera only). Stand tests re-enable Cheat Walk, drop the
visible pawn from `drop` and shoot after gravity settles, so a floor without collision shows the pawn
falling through. Does not touch WorldRuntime state and never claims world-model generation.
"""
from __future__ import annotations

import json
import shutil
import sys
import time
from pathlib import Path

from .carina_light import isolate_then_lit, lit_interior_execs
from .ipc_ue import send_command, ue_bridge_available

SHOT_DIR = Path(r"G:\carina-ue\CarinaPS\Packaged\Windows\CarinaPS\Saved\Screenshots\Windows")


def carina_to_ue_loc(loc: list[float]) -> dict[str, float]:
    x, y, z = (float(v) for v in loc)
    return {"x": x * 100.0, "y": z * 100.0, "z": y * 100.0}


def newest_shot(after_mtime: float) -> Path | None:
    files = [p for p in SHOT_DIR.glob("HighresScreenshot*.png") if p.stat().st_mtime > after_mtime]
    return max(files, key=lambda p: p.stat().st_mtime) if files else None


def exec_cmd(cmd: str) -> dict:
    return send_command({"op": "highresshot", "exec": cmd})


def pose(loc: list[float], rot: dict, *, hide: bool, arm: float = 0.0, stand_pawn: bool = False) -> dict:
    cmd = {
        "op": "player_pose",
        "ueLocationCm": carina_to_ue_loc(loc),
        "ueRotatorDeg": rot,
        "springArmLength": arm,
        "hidePawn": hide,
    }
    if stand_pawn:
        cmd["spawnStandPawn"] = True
    return send_command(cmd)


def grab(out_dir: Path, name: str) -> str:
    before = time.time()
    exec_cmd("HighResShot 1")
    for _ in range(32):
        time.sleep(0.25)
        shot = newest_shot(before)
        if shot:
            dest = out_dir / f"{name}.png"
            shutil.copy2(shot, dest)
            return str(dest)
    return ""


def main() -> None:
    spec = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    out_dir = Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    if not ue_bridge_available():
        raise SystemExit("UE bridge down")
    evidence: dict = {"at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "shots": {}, "poses": {}, "standTests": {}}
    evidence["spawned"] = send_command({"op": "dump_spawned"}).get("actors")
    lit = isolate_then_lit(send_command, execs=lit_interior_execs())
    evidence["isolate"] = lit["isolate"]
    evidence["litInteriorExecs"] = lit["litInteriorExecs"]
    evidence["viewmodeLit"] = lit["viewmodeLit"]
    evidence["p1Pass"] = False
    evidence["claimsGeneratedLighting"] = False
    evidence["claimsWorldModelGeneration"] = False
    evidence["interiorLitVerified"] = False

    for cmd in ("Cheat Fly", "Cheat Ghost", "slomo 0.0", "ShowFlag.SkeletalMeshes 0", "viewmode Lit"):
        exec_cmd(cmd)
    for view in spec.get("views", []):
        p = pose(view["loc"], view["rot"], hide=True)
        wanted = carina_to_ue_loc(view["loc"])
        pawn_ok = (
            p.get("pawnX") is not None
            and abs(float(p["pawnX"]) - wanted["x"]) < 250
            and abs(float(p["pawnY"]) - wanted["y"]) < 250
            and abs(float(p["pawnZ"]) - wanted["z"]) < 250
        )
        cam_ok = True
        if p.get("usingStillCamera"):
            cam_ok = (
                abs(float(p.get("stillCamX") or 0) - wanted["x"]) < 50
                and abs(float(p.get("stillCamY") or 0) - wanted["y"]) < 50
                and abs(float(p.get("stillCamZ") or 0) - wanted["z"]) < 50
            )
        evidence["poses"][view["name"]] = {
            "ok": p.get("ok"),
            "error": p.get("error"),
            "pawnX": p.get("pawnX"),
            "pawnY": p.get("pawnY"),
            "pawnZ": p.get("pawnZ"),
            "usingStillCamera": p.get("usingStillCamera"),
            "stillCamX": p.get("stillCamX"),
            "stillCamY": p.get("stillCamY"),
            "stillCamZ": p.get("stillCamZ"),
            "stillCamYaw": p.get("stillCamYaw"),
            "cameraPoseValid": bool(pawn_ok and cam_ok),
        }
        time.sleep(0.4)
        evidence["shots"][view["name"]] = grab(out_dir, view["name"])

    evidence["cameraPoseValid"] = all(
        bool(row.get("cameraPoseValid")) for row in evidence["poses"].values()
    ) if evidence["poses"] else False

    wire = spec.get("wireOverhead")
    if wire:
        exec_cmd("viewmode Wireframe")
        pose(wire["loc"], {"pitch": wire.get("pitch", -89), "yaw": 0, "roll": 0}, hide=True)
        time.sleep(1.0)
        evidence["shots"]["overhead_wire"] = grab(out_dir, "overhead_wire")
        exec_cmd("viewmode Lit")
        time.sleep(0.4)
        evidence["shots"]["overhead_lit"] = grab(out_dir, "overhead_lit")

    stand = spec.get("standTests", [])
    if stand:
        # Ghost is a toggle. The view pass turned it on; toggle it off, then Walk
        # so gravity and pawn collision are on for the drop.
        # Do not Cheat Walk: walking navmesh-projects to the default map start.
        for cmd in ("Cheat Ghost", "slomo 1", "ShowFlag.SkeletalMeshes 1"):
            exec_cmd(cmd)
        for test in stand:
            p = pose(
                test["drop"],
                test["rot"],
                hide=True,
                arm=float(test.get("springArmLength", 350)),
                stand_pawn=True,
            )
            time.sleep(float(test.get("settleS", 2.5)))
            pose(test["drop"], test["rot"], hide=True, arm=float(test.get("springArmLength", 350)))
            time.sleep(0.25)
            after = send_command({"op": "dump_spawned"})
            pawn = after.get("standPawn") if isinstance(after, dict) else None
            if not isinstance(pawn, dict):
                pawn = after.get("pawn") if isinstance(after, dict) else None
            evidence["standTests"][test["name"]] = {
                "pose": {
                    "ok": p.get("ok"),
                    "error": p.get("error"),
                    "pawnX": p.get("pawnX"),
                    "pawnY": p.get("pawnY"),
                    "pawnZ": p.get("pawnZ"),
                    "pawnName": p.get("pawnName"),
                    "groundHit": p.get("groundHit"),
                    "groundZ": p.get("groundZ"),
                    "groundActor": p.get("groundActor"),
                },
                "dropFromCarina": test["drop"],
                "expectedUeCm": carina_to_ue_loc(test["drop"]),
                "standPawnAfterSettle": pawn,
                "psPawnAfterSettle": after.get("pawn") if isinstance(after, dict) else None,
                "shot": grab(out_dir, f"stand_{test['name']}"),
            }
    else:
        for cmd in ("slomo 1", "Cheat Walk", "ShowFlag.SkeletalMeshes 1"):
            exec_cmd(cmd)

    (out_dir / "shoot_views.json").write_text(json.dumps(evidence, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
