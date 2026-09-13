"""Interior visibility cvars. Not world-model generation."""
from __future__ import annotations

import json
import unittest
from pathlib import Path

from carina_light import (
    apply_lit_interior,
    isolate_then_lit,
    lit_interior_evidence,
    lit_interior_execs,
)

WR_DIR = Path(__file__).resolve().parent


class CarinaLightTests(unittest.TestCase):
    def test_execs_nonempty_and_lit(self) -> None:
        execs = lit_interior_execs()
        self.assertGreater(len(execs), 0)
        self.assertIn("viewmode Lit", execs)

    def test_never_claims_world_model_generation(self) -> None:
        execs = lit_interior_execs()
        evidence = lit_interior_evidence()
        self.assertTrue(evidence["notWorldModel"])
        self.assertIs(evidence["claimsWorldModelGeneration"], False)
        self.assertIs(evidence["claimsGeneratedLighting"], False)
        self.assertIs(evidence["p1Pass"], False)
        self.assertIs(evidence["interiorLitVerified"], False)
        blob = json.dumps(evidence)
        self.assertNotRegex(blob, r'"claimsWorldModelGeneration":\s*true')
        self.assertNotRegex(blob, r'"claimsGeneratedLighting":\s*true')
        self.assertNotRegex(blob, r'"p1Pass":\s*true')
        for cmd in execs:
            lower = cmd.lower()
            self.assertNotIn("world-model", lower)
            self.assertNotIn("world model", lower)
            self.assertNotIn("generated lighting", lower)

    def test_apply_lit_interior_issues_highresshot_execs(self) -> None:
        calls: list[dict] = []

        def send_command(cmd: dict) -> dict:
            calls.append(dict(cmd))
            return {"ok": True, "op": cmd.get("op")}

        out = apply_lit_interior(send_command, lit_interior_execs())
        self.assertEqual([c["op"] for c in calls], ["highresshot"] * len(calls))
        self.assertEqual([c["exec"] for c in calls], lit_interior_execs())
        self.assertEqual(out["litInteriorExecs"], lit_interior_execs())
        self.assertTrue(out["viewmodeLit"])
        self.assertIs(out["p1Pass"], False)
        self.assertIs(out["claimsGeneratedLighting"], False)
        self.assertIs(out["claimsWorldModelGeneration"], False)
        self.assertIs(out["interiorLitVerified"], False)

    def test_isolate_then_lit_issues_execs_after_isolate(self) -> None:
        calls: list[dict] = []

        def send_command(cmd: dict) -> dict:
            calls.append(dict(cmd))
            return {"ok": True, "op": cmd.get("op")}

        out = isolate_then_lit(send_command, execs=lit_interior_execs())
        self.assertGreater(len(calls), 1)
        self.assertEqual(calls[0]["op"], "isolate_carina")
        self.assertTrue(calls[0]["hidden"])
        self.assertEqual([c["op"] for c in calls[1:]], ["highresshot"] * (len(calls) - 1))
        self.assertEqual([c["exec"] for c in calls[1:]], lit_interior_execs())
        self.assertEqual(out["litInteriorExecs"], lit_interior_execs())
        self.assertTrue(out["viewmodeLit"])
        self.assertIs(out["p1Pass"], False)
        self.assertIs(out["claimsGeneratedLighting"], False)
        self.assertIs(out["claimsWorldModelGeneration"], False)
        self.assertIs(out["interiorLitVerified"], False)

    def test_isolate_callers_import_lit_interior_execs(self) -> None:
        shoot = (WR_DIR / "shoot_views.py").read_text(encoding="utf-8")
        stand = (WR_DIR / "interior_stand.py").read_text(encoding="utf-8")
        app = (WR_DIR / "app.py").read_text(encoding="utf-8")
        self.assertIn("isolate_then_lit", shoot)
        self.assertIn("isolate_then_lit", stand)
        self.assertIn("isolate_then_enter", app)
        self.assertIn("lit_interior_execs", app)


if __name__ == "__main__":
    unittest.main()
