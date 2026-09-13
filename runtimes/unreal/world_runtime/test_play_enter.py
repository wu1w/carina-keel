"""Play-enter spawn after isolate. Scaffold floor, not world-model."""
from __future__ import annotations

import unittest

from carina_light import lit_interior_execs
from play_enter import (
    PLAY_STAND,
    PLAY_YAW,
    carina_yaw_rad_to_ue_deg,
    enter_play_spawn,
    isolate_then_enter,
    look_play,
)


class PlayEnterTests(unittest.TestCase):
    def test_enter_play_spawn_poses_visible_pawn_on_scaffold(self) -> None:
        calls: list[dict] = []

        def send_command(cmd: dict) -> dict:
            calls.append(dict(cmd))
            op = cmd.get("op")
            if op == "player_pose":
                return {
                    "ok": True,
                    "pawnX": 600,
                    "pawnY": 500,
                    "pawnZ": 170,
                    "pawnName": "BP_ThirdPersonCharacter_C_1",
                }
            if op == "dump_spawned":
                return {
                    "pawn": {
                        "x": 600,
                        "y": 500,
                        "z": 170,
                        "possessed": True,
                        "movementMode": 3,
                    }
                }
            return {"ok": True, "op": op}

        out = enter_play_spawn(send_command)
        self.assertEqual(calls[0]["op"], "highresshot")
        self.assertEqual(calls[0]["exec"], "slomo 1")
        self.assertEqual(calls[1]["op"], "player_pose")
        self.assertIs(calls[1]["hidePawn"], False)
        self.assertNotIn("spawnStandPawn", calls[1])
        self.assertEqual(calls[1]["springArmLength"], 350)
        self.assertEqual(calls[1]["ueLocationCm"]["x"], PLAY_STAND[0] * 100)
        self.assertEqual(calls[1]["ueLocationCm"]["y"], PLAY_STAND[2] * 100)
        self.assertEqual(calls[1]["ueLocationCm"]["z"], PLAY_STAND[1] * 100)
        self.assertEqual(calls[1]["ueRotatorDeg"]["yaw"], PLAY_YAW)
        self.assertEqual(PLAY_YAW, -90)
        self.assertTrue(out["ok"])
        self.assertTrue(out["scaffoldFloor"])
        self.assertIs(out["p1Pass"], False)
        self.assertIs(out["claimsGeneratedLighting"], False)
        self.assertIs(out["claimsWorldModelGeneration"], False)
        self.assertIs(out["hidePawn"], False)

    def test_isolate_then_enter_order(self) -> None:
        calls: list[dict] = []

        def send_command(cmd: dict) -> dict:
            calls.append(dict(cmd))
            return {"ok": True, "op": cmd.get("op"), "pawn": {"possessed": True}}

        out = isolate_then_enter(send_command, execs=lit_interior_execs())
        ops = [c["op"] for c in calls]
        self.assertEqual(ops[0], "isolate_carina")
        self.assertEqual(ops[1 : 1 + len(lit_interior_execs())], ["highresshot"] * len(lit_interior_execs()))
        self.assertEqual(ops[1 + len(lit_interior_execs())], "highresshot")
        self.assertEqual(calls[1 + len(lit_interior_execs())]["exec"], "slomo 1")
        self.assertEqual(ops[2 + len(lit_interior_execs())], "player_pose")
        self.assertIs(calls[2 + len(lit_interior_execs())]["hidePawn"], False)
        self.assertIs(out["p1Pass"], False)
        self.assertIs(out["claimsGeneratedLighting"], False)
        self.assertIs(out["claimsWorldModelGeneration"], False)
        self.assertIs(out["interiorLitVerified"], False)
        self.assertIn("playEnter", out)

    def test_look_play_rotates_without_teleport(self) -> None:
        calls: list[dict] = []

        def send_command(cmd: dict) -> dict:
            calls.append(dict(cmd))
            if cmd.get("op") == "player_pose":
                return {"ok": True, "pawnX": 600, "pawnY": 500, "pawnZ": 100, "pawnName": "BP"}
            if cmd.get("op") == "dump_spawned":
                return {"pawn": {"x": 600, "y": 500, "z": 100, "yaw": -90, "possessed": True, "movementMode": 1}}
            return {"ok": True}

        out = look_play(send_command, yaw_ue_deg=-90)
        self.assertEqual(calls[0]["op"], "player_pose")
        self.assertNotIn("ueLocationCm", calls[0])
        self.assertEqual(calls[0]["ueRotatorDeg"]["yaw"], -90)
        self.assertIs(calls[0]["hidePawn"], False)
        self.assertTrue(out["ok"])
        self.assertIs(out["p1Pass"], False)
        self.assertAlmostEqual(carina_yaw_rad_to_ue_deg(3.141592653589793), -90, places=4)


if __name__ == "__main__":
    unittest.main()
