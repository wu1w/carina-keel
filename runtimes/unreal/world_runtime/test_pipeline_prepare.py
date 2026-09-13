"""Cached prepare vs force re-import. Stdlib only. Never claims world-model or P1."""
from __future__ import annotations
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import config
from pipeline_prepare import prepare_asset


class PrepareCacheTests(unittest.TestCase):
    def test_cached_prepare_skips_ue_unless_force(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            glb = root / "asset.glb"
            glb.write_bytes(b"glTF" + b"\x00" * 12)
            asset_id = "aaaaaaaaaaaaaaaa"
            asset_hash = "ab" * 32
            label = "bar_front_aaaaaaaa"
            art = root / "artifacts" / asset_hash
            (art / "iostore").mkdir(parents=True)
            (art / "iostore" / f"CarinaPS-Windows_{label}.utoc").write_bytes(b"utoc")
            registry = {
                "byHash": {
                    asset_hash: {
                        "prepareOk": True,
                        "label": label,
                        "cookMs": 12,
                        "packageIds": ["pkg"],
                        "shaderMergeOk": False,
                        "softObjectPath": f"/Game/Imported/Dynamic/{label}",
                        "timingsMs": {"importMs": 1},
                        "meshes": [{"name": label, "softObjectPath": f"/Game/Imported/Dynamic/{label}"}],
                    }
                }
            }
            verified = {
                "meta": {"originalFilename": "bar-front.glb"},
                "glbPath": glb,
            }
            with (
                patch.object(config, "ARTIFACTS_DIR", root / "artifacts"),
                patch.object(config, "ensure_dirs", lambda: None),
                patch("pipeline_prepare.verify_upload", return_value=verified),
                patch("pipeline_prepare.load_registry", return_value=registry),
                patch("pipeline_prepare._run") as run,
            ):
                cached = prepare_asset(asset_id, asset_hash)
                self.assertTrue(cached["cached"])
                self.assertEqual(cached["cookMs"], 12)
                run.assert_not_called()

                run.side_effect = RuntimeError("ue import would run")
                with self.assertRaisesRegex(RuntimeError, "ue import would run"):
                    prepare_asset(asset_id, asset_hash, force=True)
                run.assert_called()
