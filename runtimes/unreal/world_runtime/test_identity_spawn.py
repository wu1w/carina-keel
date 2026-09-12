"""Spawn transform helpers. Not world-model generation."""
from __future__ import annotations
import unittest

from transforms import carina_to_ue, identity_wire_transform


class IdentitySpawnTests(unittest.TestCase):
    def test_identity_stays_at_ue_origin(self) -> None:
        ue = carina_to_ue(identity_wire_transform())
        self.assertEqual(ue["ueLocationCm"], {"x": 0.0, "y": 0.0, "z": 0.0})
        self.assertEqual(ue["ueScale"], {"x": 1.0, "y": 1.0, "z": 1.0})

    def test_not_world_model(self) -> None:
        self.assertNotIn("world-model", identity_wire_transform())


if __name__ == "__main__":
    unittest.main()
