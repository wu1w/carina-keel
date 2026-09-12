
"""install: copy additive IoStore side container into packaged Content/Paks."""
from __future__ import annotations
import hashlib
import shutil
import time
from pathlib import Path
from typing import Any

from . import config
from .asset_registry import load_registry


def _sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest().upper()


def assert_originals_intact() -> None:
    for name, expected in config.ORIG_PAK_SHA.items():
        p = config.PACKAGED_PAKS / name
        if not p.is_file():
            raise RuntimeError(f"missing original pak {name}")
        got = _sha256(p)
        if got != expected:
            raise RuntimeError(f"SHA mismatch on {name}: expected {expected} got {got}")


def install_asset(asset_hash: str) -> dict[str, Any]:
    config.ensure_dirs()
    reg = load_registry()
    entry = reg.get("byHash", {}).get(asset_hash)
    if not entry or not entry.get("prepareOk"):
        raise FileNotFoundError(f"assetHash {asset_hash} not prepared")
    label = entry["label"]
    container = entry["containerName"]
    src_dir = Path(entry["iostoreDir"])
    classic_src = Path(entry["classicPak"])
    utoc_src = Path(entry["utoc"])
    ucas_src = Path(entry["ucas"])
    for p in (classic_src, utoc_src, ucas_src):
        if not p.is_file():
            raise FileNotFoundError(f"missing prepare artifact {p}")

    assert_originals_intact()
    t0 = time.perf_counter()
    dest_pak = config.PACKAGED_PAKS / f"{container}.pak"
    dest_utoc = config.PACKAGED_PAKS / f"{container}.utoc"
    dest_ucas = config.PACKAGED_PAKS / f"{container}.ucas"
    shutil.copy2(classic_src, dest_pak)
    shutil.copy2(utoc_src, dest_utoc)
    shutil.copy2(ucas_src, dest_ucas)
    # NEVER copy global_* into live paks
    assert_originals_intact()
    ms = (time.perf_counter() - t0) * 1000.0
    mounted = [dest_pak.name, dest_utoc.name, dest_ucas.name]
    return {
        "assetHash": asset_hash,
        "label": label,
        "mountedPackages": mounted,
        "mountOrder": container,
        "installMs": ms,
        "softObjectPath": entry.get("softObjectPath"),
        "note": "Side container installed; host must remount (one streamer restart) before SoftObjectPath resolve if not already mounted",
    }
