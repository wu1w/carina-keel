"""Tests for PBR texture filename classification. Not world-model."""
from __future__ import annotations
import unittest

from pbr_texture_roles import classify_texture_stem, opaque_mic_factors, texture_roles_from_paths


class TextureRoleTests(unittest.TestCase):
    def test_ambientcg_stems(self) -> None:
        self.assertEqual(classify_texture_stem("WoodFloor051_1K-JPG_Color"), "baseColor")
        self.assertEqual(classify_texture_stem("WoodFloor051_1K-JPG_NormalGL"), "normal")
        self.assertEqual(classify_texture_stem("WoodFloor051_1K-JPG_Roughness"), "roughness")
        self.assertEqual(classify_texture_stem("Metal032_1K-JPG_Metalness"), "metallic")

    def test_roles_skip_appledouble_and_keep_first(self) -> None:
        roles = texture_roles_from_paths(
            [
                "/t/Wood062_1K-JPG_Color.uasset",
                "/t/Wood062_1K-JPG_NormalGL.uasset",
                "/t/Wood062_1K-JPG_Roughness.uasset",
            ]
        )
        self.assertEqual(roles["baseColor"].endswith("Color.uasset"), True)
        self.assertEqual(set(roles), {"baseColor", "normal", "roughness"})

    def test_not_world_model_label(self) -> None:
        self.assertNotEqual(classify_texture_stem("Color"), "world-model")

    def test_opaque_mic_factors(self) -> None:
        self.assertEqual(opaque_mic_factors("WoodFloor"), (0.0, 0.6))
        self.assertEqual(opaque_mic_factors("MetalTrim"), (1.0, 0.28))
        self.assertEqual(opaque_mic_factors("GlassCup"), (0.0, 0.08))


if __name__ == "__main__":
    unittest.main()
