"""Drop the possessed pawn onto the interior scaffold floor.

Space-shell collision must already be off. Scaffold boxes only — not world-model.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

try:
    from .carina_light import isolate_then_lit, lit_interior_execs
    from .ipc_ue import send_command, ue_bridge_available
except ImportError:
    from carina_light import isolate_then_lit, lit_interior_execs
    from ipc_ue import send_command, ue_bridge_available


def carina_to_ue_loc(loc: list[float]) -> dict[str, float]:
    x, y, z = (float(v) for v in loc)
    return {"x": x * 100.0, "y": z * 100.0, "z": y * 100.0}


# Carina meters, Y-up. Floor AABB is x 0–12, y −0.15–0, z 0–10.
DROP = [6.0, 3.0, 5.0]
DOOR = [6.0, 2.5, 1.2]


def _drop(loc: list[float], settle_s: float = 2.8) -> dict:
    ue = carina_to_ue_loc(loc)
    pose = send_command({
        "op": "player_pose",
        "ueLocationCm": ue,
        "ueRotatorDeg": {"pitch": -20, "yaw": 0, "roll": 0},
        "springArmLength": 350,
        "hidePawn": False,
        "spawnStandPawn": True,
    })
    time.sleep(settle_s)
    dumped = send_command({"op": "dump_spawned"})
    pawn = dumped.get("pawn") if isinstance(dumped, dict) else None
    return {
        "dropFromCarina": loc,
        "expectedUeCm": ue,
        "pose": {
            "ok": pose.get("ok"),
            "groundHit": pose.get("groundHit"),
            "groundZ": pose.get("groundZ"),
            "groundActor": pose.get("groundActor"),
            "pawnX": pose.get("pawnX"),
            "pawnY": pose.get("pawnY"),
            "pawnZ": pose.get("pawnZ"),
        },
        "psPawnAfterSettle": pawn,
        "standPawnAfterSettle": dumped.get("standPawn") if isinstance(dumped, dict) else None,
    }


def _actor_row(dumped: dict, object_id: str) -> dict | None:
    for row in dumped.get("actors") or []:
        if isinstance(row, dict) and row.get("objectId") == object_id:
            return row
    return None


def main() -> None:
    if not ue_bridge_available():
        raise SystemExit("UE bridge down")
    lit = isolate_then_lit(send_command, execs=lit_interior_execs())
    isolated = lit["isolate"]
    dumped = send_command({"op": "dump_spawned"})
    shell = _actor_row(dumped, "interior-space-shell")
    floor = _actor_row(dumped, "floor")
    evidence = {
        "probe": "interior-floor-drop-after-shell-collision-off",
        "at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "notWorldModel": True,
        "scaffoldPrimitive": True,
        "claimsWorldModelGeneration": False,
        "claimsGeneratedLighting": False,
        "p1Pass": False,
        "interiorLitVerified": False,
        "litInteriorExecs": lit["litInteriorExecs"],
        "viewmodeLit": lit["viewmodeLit"],
        "note": (
            "Space shell is a visual overlay. Collision stays on SceneSpec scaffold "
            "boxes. isolate_carina hides the default Third Person map. Visibility "
            "cvars exec after isolate; not generated lighting. Not a reconstructed room."
        ),
        "isolate": isolated,
        "spaceShell": shell,
        "floor": floor,
        "interior_floor_drop": _drop(DROP),
        "door_inside_drop": _drop(DOOR),
    }
    pawn = (evidence["interior_floor_drop"] or {}).get("psPawnAfterSettle") or {}
    ground = (evidence["interior_floor_drop"] or {}).get("pose") or {}
    evidence["walkProof"] = (
        pawn.get("movementMode") == 1
        and pawn.get("possessed") is True
        and "space-shell" not in str(ground.get("groundActor") or "").lower()
        and (shell is None or shell.get("actorCollision") is False or shell.get("collisionEnabled") == 0)
    )
    out = Path(__file__).resolve().parents[1] / "logs" / "ng1_interior_shell" / "ps_pawn_landed.json"
    # Prefer the validation logs dir when running from C:\Users\wuyw\carina-rtx-validation.
    cand = Path(r"C:\Users\wuyw\carina-rtx-validation\logs\ng1_interior_shell\ps_pawn_landed.json")
    dest = cand if cand.parent.parent.is_dir() else out
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()
