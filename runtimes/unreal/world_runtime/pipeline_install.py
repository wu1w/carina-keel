
"""install: copy additive IoStore side container into packaged Content/Paks.

uninstall removes only this publish's MERGE side container. Never host paks / global.utoc.
"""
from __future__ import annotations
import hashlib
import re
import shutil
import time
from pathlib import Path
from typing import Any

try:
    from . import config
    from .asset_registry import load_registry
except ImportError:  # script tests run from this directory
    import config  # type: ignore
    from asset_registry import load_registry  # type: ignore

SIDE_CONTAINER_RE = re.compile(r"^CarinaPS-Windows_[A-Za-z0-9_]+$")


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


def _assert_side_container(container: str) -> None:
    """Refuse host IoStore names. Rollback may only unlink MERGE side containers."""
    if not isinstance(container, str) or not SIDE_CONTAINER_RE.fullmatch(container):
        raise RuntimeError(f"not a MERGE side container: {container!r}")
    for suffix in (".pak", ".utoc", ".ucas"):
        name = f"{container}{suffix}"
        if name in config.ORIG_PAK_SHA:
            raise RuntimeError(f"refusing host pak {name}")


def _side_paths(container: str) -> tuple[Path, Path, Path]:
    _assert_side_container(container)
    dest_pak = config.PACKAGED_PAKS / f"{container}.pak"
    dest_utoc = config.PACKAGED_PAKS / f"{container}.utoc"
    dest_ucas = config.PACKAGED_PAKS / f"{container}.ucas"
    for path in (dest_pak, dest_utoc, dest_ucas):
        if path.name in config.ORIG_PAK_SHA:
            raise RuntimeError(f"refusing host pak {path.name}")
    return dest_pak, dest_utoc, dest_ucas


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
    dest_pak, dest_utoc, dest_ucas = _side_paths(container)
    # Never overwrite a live container with different content. A name collision means another
    # hash already owns this container (possibly mounted by the streamer); touching any of the
    # three files would leave pak/utoc/ucas inconsistent. Idempotent when the content matches.
    pairs = ((classic_src, dest_pak), (utoc_src, dest_utoc), (ucas_src, dest_ucas))
    present = [dest for _, dest in pairs if dest.is_file()]
    if present:
        if len(present) != len(pairs):
            raise RuntimeError(
                f"side container {container} is partially present ({[p.name for p in present]}); "
                "refusing to overwrite; uninstall it first"
            )
        for src, dest in pairs:
            if _sha256(src) != _sha256(dest):
                raise RuntimeError(
                    f"side container {container} already installed with different content "
                    f"({dest.name}); refusing to overwrite a live container"
                )
        return {
            "assetHash": asset_hash,
            "label": label,
            "mountedPackages": [dest.name for _, dest in pairs],
            "mountOrder": container,
            "installMs": 0.0,
            "softObjectPath": entry.get("softObjectPath"),
            "alreadyInstalled": True,
            "note": "Side container already present with identical content; nothing copied",
        }
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


def uninstall_asset(asset_hash: str) -> dict[str, Any]:
    """Remove a MERGE side container from live Paks. Idempotent. Never host/global."""
    config.ensure_dirs()
    reg = load_registry()
    entry = reg.get("byHash", {}).get(asset_hash)
    if not entry:
        raise FileNotFoundError(f"assetHash {asset_hash} not in registry")
    label = entry.get("label")
    container = entry.get("containerName")
    if not isinstance(container, str):
        raise RuntimeError(f"registry missing containerName for {asset_hash}")
    dest_pak, dest_utoc, dest_ucas = _side_paths(container)
    removed: list[str] = []
    missing: list[str] = []
    for path in (dest_pak, dest_utoc, dest_ucas):
        if path.is_file():
            path.unlink()
            removed.append(path.name)
        else:
            missing.append(path.name)
    assert_originals_intact()
    return {
        "ok": True,
        "assetHash": asset_hash,
        "label": label,
        "containerName": container,
        "removed": removed,
        "missing": missing,
        "note": "Side container uninstalled; host paks including global.utoc unchanged",
    }
