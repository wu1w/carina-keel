"""MERGE side-container install/uninstall. Stdlib only. Never replace global.utoc."""
from __future__ import annotations
import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import config
from asset_registry import safe_label_from_meta
from pipeline_install import (
    SIDE_CONTAINER_RE,
    _assert_side_container,
    install_asset,
    uninstall_asset,
)

HOST_NAMES = (
    "CarinaPS-Windows.pak",
    "CarinaPS-Windows.ucas",
    "CarinaPS-Windows.utoc",
    "global.ucas",
    "global.utoc",
)
PINNED_GLOBAL_UTOC = "B03476E09B74D77DD9A2ACD1C91739619B09D311E6FF3A1E1EC435D143DA4CC9"


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest().upper()


class SideContainerTests(unittest.TestCase):
    def test_side_container_pattern_rejects_host_names(self) -> None:
        self.assertTrue(SIDE_CONTAINER_RE.fullmatch("CarinaPS-Windows_courtyard_feature"))
        self.assertTrue(SIDE_CONTAINER_RE.fullmatch("CarinaPS-Windows_bar_front"))
        self.assertIsNone(SIDE_CONTAINER_RE.fullmatch("CarinaPS-Windows"))
        self.assertIsNone(SIDE_CONTAINER_RE.fullmatch("global.utoc"))
        self.assertIsNone(SIDE_CONTAINER_RE.fullmatch("global"))
        with self.assertRaises(RuntimeError):
            _assert_side_container("global.utoc")
        with self.assertRaises(RuntimeError):
            _assert_side_container("CarinaPS-Windows")

    def test_uninstall_removes_side_container_and_keeps_global_utoc(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            paks = Path(tmp) / "Paks"
            paks.mkdir()
            host: dict[str, str] = {}
            for name in HOST_NAMES:
                body = name.encode("utf-8")
                (paks / name).write_bytes(body)
                host[name] = _sha(body)
            self.assertEqual(host["global.utoc"], _sha(b"global.utoc"))
            side = "CarinaPS-Windows_courtyard_feature"
            for suffix in (".pak", ".utoc", ".ucas"):
                (paks / f"{side}{suffix}").write_bytes(b"side")
            asset_hash = "ab" * 32
            registry = {
                "byHash": {
                    asset_hash: {
                        "prepareOk": True,
                        "label": "courtyard_feature",
                        "containerName": side,
                    }
                }
            }
            with (
                patch.object(config, "PACKAGED_PAKS", paks),
                patch.object(config, "ORIG_PAK_SHA", host),
                patch("pipeline_install.load_registry", return_value=registry),
            ):
                result = uninstall_asset(asset_hash)
            self.assertTrue(result["ok"])
            self.assertEqual(
                sorted(result["removed"]),
                sorted([f"{side}.pak", f"{side}.utoc", f"{side}.ucas"]),
            )
            for suffix in (".pak", ".utoc", ".ucas"):
                self.assertFalse((paks / f"{side}{suffix}").exists())
            for name in HOST_NAMES:
                self.assertTrue((paks / name).is_file())
            self.assertEqual(_sha((paks / "global.utoc").read_bytes()), host["global.utoc"])
            self.assertNotEqual(host["global.utoc"], PINNED_GLOBAL_UTOC)

    def test_uninstall_refuses_host_container_name(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            paks = Path(tmp) / "Paks"
            paks.mkdir()
            host: dict[str, str] = {}
            for name in HOST_NAMES:
                body = name.encode("utf-8")
                (paks / name).write_bytes(body)
                host[name] = _sha(body)
            registry = {
                "byHash": {
                    "cd" * 32: {
                        "prepareOk": True,
                        "label": "global",
                        "containerName": "global.utoc",
                    }
                }
            }
            with (
                patch.object(config, "PACKAGED_PAKS", paks),
                patch.object(config, "ORIG_PAK_SHA", host),
                patch("pipeline_install.load_registry", return_value=registry),
            ):
                with self.assertRaises(RuntimeError) as ctx:
                    uninstall_asset("cd" * 32)
            self.assertIn("side container", str(ctx.exception).lower())
            self.assertTrue((paks / "global.utoc").is_file())

    def test_uninstall_is_idempotent_when_files_already_gone(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            paks = Path(tmp) / "Paks"
            paks.mkdir()
            host: dict[str, str] = {}
            for name in HOST_NAMES:
                body = name.encode("utf-8")
                (paks / name).write_bytes(body)
                host[name] = _sha(body)
            side = "CarinaPS-Windows_fireplace"
            asset_hash = "ef" * 32
            registry = {
                "byHash": {
                    asset_hash: {
                        "prepareOk": True,
                        "label": "fireplace",
                        "containerName": side,
                    }
                }
            }
            with (
                patch.object(config, "PACKAGED_PAKS", paks),
                patch.object(config, "ORIG_PAK_SHA", host),
                patch("pipeline_install.load_registry", return_value=registry),
            ):
                result = uninstall_asset(asset_hash)
            self.assertTrue(result["ok"])
            self.assertEqual(result["removed"], [])
            self.assertEqual(len(result["missing"]), 3)


def _install_fixture(tmp: str, side: str, src_body: bytes) -> tuple[Path, dict[str, str], dict[str, object]]:
    paks = Path(tmp) / "Paks"
    paks.mkdir()
    host: dict[str, str] = {}
    for name in HOST_NAMES:
        body = name.encode("utf-8")
        (paks / name).write_bytes(body)
        host[name] = _sha(body)
    art = Path(tmp) / "artifacts"
    art.mkdir()
    for suffix in (".pak", ".utoc", ".ucas"):
        (art / f"{side}{suffix}").write_bytes(src_body + suffix.encode("utf-8"))
    entry = {
        "prepareOk": True,
        "label": side.removeprefix("CarinaPS-Windows_"),
        "containerName": side,
        "iostoreDir": str(art),
        "classicPak": str(art / f"{side}.pak"),
        "utoc": str(art / f"{side}.utoc"),
        "ucas": str(art / f"{side}.ucas"),
        "softObjectPath": "/Game/Imported/Dynamic/x",
    }
    return paks, host, entry


class InstallCollisionTests(unittest.TestCase):
    """install must never overwrite a live container that another hash owns."""

    def test_install_copies_three_files_when_absent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            side = "CarinaPS-Windows_bar_front_f0dde9d3"
            paks, host, entry = _install_fixture(tmp, side, b"new")
            asset_hash = "f0" * 32
            with (
                patch.object(config, "PACKAGED_PAKS", paks),
                patch.object(config, "ORIG_PAK_SHA", host),
                patch.object(config, "ensure_dirs", lambda: None),
                patch("pipeline_install.load_registry", return_value={"byHash": {asset_hash: entry}}),
            ):
                result = install_asset(asset_hash)
            self.assertEqual(sorted(result["mountedPackages"]), sorted([f"{side}.pak", f"{side}.utoc", f"{side}.ucas"]))
            self.assertNotIn("alreadyInstalled", result)
            for suffix in (".pak", ".utoc", ".ucas"):
                self.assertEqual((paks / f"{side}{suffix}").read_bytes(), b"new" + suffix.encode("utf-8"))

    def test_install_refuses_to_overwrite_different_content(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            side = "CarinaPS-Windows_bar_front"
            paks, host, entry = _install_fixture(tmp, side, b"new")
            for suffix in (".pak", ".utoc", ".ucas"):
                (paks / f"{side}{suffix}").write_bytes(b"live" + suffix.encode("utf-8"))
            asset_hash = "f0" * 32
            with (
                patch.object(config, "PACKAGED_PAKS", paks),
                patch.object(config, "ORIG_PAK_SHA", host),
                patch.object(config, "ensure_dirs", lambda: None),
                patch("pipeline_install.load_registry", return_value={"byHash": {asset_hash: entry}}),
            ):
                with self.assertRaises(RuntimeError) as ctx:
                    install_asset(asset_hash)
            self.assertIn("different content", str(ctx.exception))
            # Nothing touched: the live container's three files are intact.
            for suffix in (".pak", ".utoc", ".ucas"):
                self.assertEqual((paks / f"{side}{suffix}").read_bytes(), b"live" + suffix.encode("utf-8"))

    def test_install_is_idempotent_for_identical_content(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            side = "CarinaPS-Windows_fireplace_6efb7beb"
            paks, host, entry = _install_fixture(tmp, side, b"same")
            for suffix in (".pak", ".utoc", ".ucas"):
                (paks / f"{side}{suffix}").write_bytes(b"same" + suffix.encode("utf-8"))
            asset_hash = "6e" * 32
            with (
                patch.object(config, "PACKAGED_PAKS", paks),
                patch.object(config, "ORIG_PAK_SHA", host),
                patch.object(config, "ensure_dirs", lambda: None),
                patch("pipeline_install.load_registry", return_value={"byHash": {asset_hash: entry}}),
            ):
                result = install_asset(asset_hash)
            self.assertTrue(result["alreadyInstalled"])

    def test_install_refuses_partial_container(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            side = "CarinaPS-Windows_bar_front"
            paks, host, entry = _install_fixture(tmp, side, b"new")
            (paks / f"{side}.utoc").write_bytes(b"live.utoc")
            asset_hash = "f0" * 32
            with (
                patch.object(config, "PACKAGED_PAKS", paks),
                patch.object(config, "ORIG_PAK_SHA", host),
                patch.object(config, "ensure_dirs", lambda: None),
                patch("pipeline_install.load_registry", return_value={"byHash": {asset_hash: entry}}),
            ):
                with self.assertRaises(RuntimeError) as ctx:
                    install_asset(asset_hash)
            self.assertIn("partially present", str(ctx.exception))
            self.assertFalse((paks / f"{side}.pak").exists())


class LabelTests(unittest.TestCase):
    def test_label_is_unique_per_content_not_per_filename(self) -> None:
        a = safe_label_from_meta({"originalFilename": "bar-front.glb"}, "f0dde9d3178904c9")
        b = safe_label_from_meta({"originalFilename": "bar-front.glb"}, "8e9e52a7d38ef05b")
        self.assertEqual(a, "bar_front_f0dde9d3")
        self.assertEqual(b, "bar_front_8e9e52a7")
        self.assertNotEqual(a, b)
        self.assertTrue(SIDE_CONTAINER_RE.fullmatch(f"CarinaPS-Windows_{a}"))
        self.assertEqual(safe_label_from_meta({}, "abcdef0123456789"), "abcdef0123456789_abcdef01")


if __name__ == "__main__":
    unittest.main()
