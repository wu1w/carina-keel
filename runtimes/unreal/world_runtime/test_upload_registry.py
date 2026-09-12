"""Upload registry contract. Stdlib only. Not world-model generation."""
from __future__ import annotations
import tempfile
import unittest
from pathlib import Path

from asset_registry import register_upload


MIN_GLB = b"glTF" + b"\x02\x00\x00\x00" + (12).to_bytes(4, "little")


class UploadRegistryTests(unittest.TestCase):
    def test_hashes_glb_and_rejects_world_model_claim_for_fixture(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = register_upload(
                data=MIN_GLB,
                original_filename="bar-counter.glb",
                source_label="test-double",
                claims_world_model_generation=False,
                dest_root=Path(tmp),
            )
            self.assertTrue(result["ok"])
            self.assertEqual(result["assetId"], result["assetHash"][:16])
            self.assertEqual(result["byteLength"], len(MIN_GLB))
            self.assertTrue(result["notWorldModel"])
            stored = Path(tmp) / result["assetId"] / "asset.glb"
            self.assertEqual(stored.read_bytes(), MIN_GLB)
            with self.assertRaises(ValueError) as ctx:
                register_upload(
                    data=MIN_GLB,
                    original_filename="tavern.glb",
                    source_label="fixture",
                    claims_world_model_generation=True,
                    dest_root=Path(tmp),
                )
            self.assertIn("world-model", str(ctx.exception))

    def test_rejects_non_glb(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                register_upload(
                    data=b"not-a-glb",
                    original_filename="x.glb",
                    source_label="http-native-mesh",
                    dest_root=Path(tmp),
                )


if __name__ == "__main__":
    unittest.main()
