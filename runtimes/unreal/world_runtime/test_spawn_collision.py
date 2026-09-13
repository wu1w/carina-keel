import unittest

from spawn_collision import wants_collision


class SpawnCollisionTest(unittest.TestCase):
    def test_space_shell_is_visual_only(self) -> None:
        self.assertFalse(wants_collision("interior-space-shell"))
        self.assertFalse(wants_collision("ng1-i23d-space-shell"))

    def test_scaffold_and_props_keep_collision(self) -> None:
        self.assertTrue(wants_collision("floor"))
        self.assertTrue(wants_collision("wall-west"))
        self.assertTrue(wants_collision("interior-garden-floor"))
        self.assertTrue(wants_collision("bar-front"))
        # Mesh may be hidden in UE; collision policy stays true.

    def test_explicit_override_wins(self) -> None:
        self.assertFalse(wants_collision("floor", False))
        self.assertTrue(wants_collision("interior-space-shell", True))

    def test_not_world_model_collision(self) -> None:
        # Collision policy is a runtime overlay rule, not a generation claim.
        self.assertFalse(wants_collision("interior-space-shell"))
