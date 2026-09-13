"""Drop the possessed pawn onto the interior scaffold floor for live play.

Called after isolate. Scaffold boxes only — not the space-shell mesh, not a
P1 pass, not world-model collision.
"""
from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

try:
    from .carina_light import isolate_then_lit, lit_interior_execs
except ImportError:
    from carina_light import isolate_then_lit, lit_interior_execs

# Carina meters, Y-up. Room center, standing eye height on the floor box
# (floor top is y≈0; landed probes sat at z≈100 cm). Yaw -90 looks at the
# south door / garden seam (UE -Y), not the east wall.
PLAY_STAND = [6.0, 1.7, 5.0]
PLAY_YAW = -90.0


def carina_to_ue_loc(loc: list[float]) -> dict[str, float]:
    x, y, z = (float(v) for v in loc)
    return {"x": x * 100.0, "y": z * 100.0, "z": y * 100.0}


def carina_yaw_rad_to_ue_deg(yaw_rad: float) -> float:
    """Carina yaw 0 looks +Z; UE yaw 0 looks +X. Door-from-center is Carina π → UE -90."""
    return 90.0 - (float(yaw_rad) * 180.0 / math.pi)


def look_play(send_command: Callable[[dict[str, Any]], Any], *, yaw_ue_deg: float) -> dict[str, Any]:
    """Rotate the possessed pawn in place. No teleport — do not Cheat Walk."""
    pose = send_command(
        {
            "op": "player_pose",
            "ueRotatorDeg": {"pitch": -8, "yaw": float(yaw_ue_deg), "roll": 0},
            "springArmLength": 350,
            "hidePawn": False,
        }
    )
    dumped = send_command({"op": "dump_spawned"})
    pawn = dumped.get("pawn") if isinstance(dumped, dict) else None
    return {
        "ok": pose.get("ok") is True,
        "hidePawn": False,
        "yawUeDeg": float(yaw_ue_deg),
        "pose": {
            "ok": pose.get("ok"),
            "pawnX": pose.get("pawnX"),
            "pawnY": pose.get("pawnY"),
            "pawnZ": pose.get("pawnZ"),
            "pawnName": pose.get("pawnName"),
        },
        "pawn": pawn,
        "p1Pass": False,
        "claimsWorldModelGeneration": False,
        "note": "In-place yaw on the scaffold floor. Not a reconstructed room.",
    }


def enter_play_spawn(send_command: Callable[[dict[str, Any]], Any]) -> dict[str, Any]:
    """Pose the Third Person pawn inside the room, visible, not a screenshot camera.

    Teleport uses MOVE_Falling (PlayerPose). Do not Cheat Walk — that navmesh-warps
    back to the default Third Person start. No settle sleep: HTTP remount must stay
    short; gravity finishes after the response.
    """
    send_command({"op": "highresshot", "exec": "slomo 1"})
    ue = carina_to_ue_loc(PLAY_STAND)
    pose = send_command(
        {
            "op": "player_pose",
            "ueLocationCm": ue,
            "ueRotatorDeg": {"pitch": -8, "yaw": PLAY_YAW, "roll": 0},
            "springArmLength": 350,
            "hidePawn": False,
        }
    )
    dumped = send_command({"op": "dump_spawned"})
    pawn = dumped.get("pawn") if isinstance(dumped, dict) else None
    return {
        "ok": pose.get("ok") is True,
        "hidePawn": False,
        "dropFromCarina": list(PLAY_STAND),
        "expectedUeCm": ue,
        "pose": {
            "ok": pose.get("ok"),
            "pawnX": pose.get("pawnX"),
            "pawnY": pose.get("pawnY"),
            "pawnZ": pose.get("pawnZ"),
            "pawnName": pose.get("pawnName"),
            "groundHit": pose.get("groundHit"),
            "groundActor": pose.get("groundActor"),
        },
        "pawn": pawn,
        "scaffoldFloor": True,
        "p1Pass": False,
        "claimsGeneratedLighting": False,
        "claimsWorldModelGeneration": False,
        "note": (
            "Standing eye-height on the SceneSpec floor box, not the space-shell "
            "mesh. Not a reconstructed room."
        ),
    }


def isolate_then_enter(
    send_command: Callable[[dict[str, Any]], Any],
    *,
    hidden: bool = True,
    execs: list[str] | None = None,
) -> dict[str, Any]:
    """isolate_carina → Lit cvars → play spawn. Failures in spawn are returned, not raised."""
    cmds = list(execs) if execs is not None else lit_interior_execs()
    lit = isolate_then_lit(send_command, hidden=hidden, execs=cmds)
    spawn = enter_play_spawn(send_command)
    return {
        "isolate": lit["isolate"],
        "litInteriorExecs": lit["litInteriorExecs"],
        "viewmodeLit": lit["viewmodeLit"],
        "playEnter": spawn,
        "p1Pass": False,
        "claimsGeneratedLighting": False,
        "claimsWorldModelGeneration": False,
        "interiorLitVerified": False,
        "litInteriorReplies": lit["litInteriorReplies"],
    }
