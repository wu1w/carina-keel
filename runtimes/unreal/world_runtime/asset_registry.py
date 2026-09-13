"""assetHash / assetId mapping for UE cook cache (derived only)."""
from __future__ import annotations
import hashlib
import json
import re
from pathlib import Path
from typing import Any

try:
    from . import config
except ImportError:  # script tests run from this directory
    import config  # type: ignore

ASSET_ID_RE = re.compile(r"^[0-9a-f]{16}$")
HASH_RE = re.compile(r"^[0-9a-f]{64}$")
GLB_MAGIC = b"glTF"
MAX_UPLOAD_BYTES = 80 * 1024 * 1024
FORBIDDEN_WORLD_MODEL_LABELS = {
    "asset-library",
    "fixture",
    "mock",
    "test-double",
    "primitive",
    "cc0-sample",
}
FORBIDDEN_PATH_KEYS = ("glbPath", "glbUrl", "url", "path")


def load_registry() -> dict[str, Any]:
    config.ensure_dirs()
    p = config.ASSET_REGISTRY_MAP
    if not p.is_file():
        return {"byHash": {}, "byAssetId": {}}
    return json.loads(p.read_text(encoding="utf-8"))


def save_registry(reg: dict[str, Any]) -> None:
    config.ensure_dirs()
    p = config.ASSET_REGISTRY_MAP
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(reg, indent=2) + "\n", encoding="utf-8")
    tmp.replace(p)


def register_upload(
    *,
    data: bytes,
    original_filename: str,
    source_label: str,
    claims_world_model_generation: bool = False,
    baked_world_space: bool = False,
    dest_root: Path | None = None,
) -> dict[str, Any]:
    """Write GLB bytes into the upload registry. Not world-model generation."""
    if not isinstance(data, (bytes, bytearray)) or len(data) < 4:
        raise ValueError("glb bytes required")
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError("glb exceeds max upload size")
    if bytes(data[:4]) != GLB_MAGIC:
        raise ValueError("bytes must be a GLB (glTF magic)")
    if not isinstance(original_filename, str) or not original_filename.strip():
        raise ValueError("originalFilename required")
    if not isinstance(source_label, str) or not source_label.strip():
        raise ValueError("sourceLabel required")
    label = source_label.strip()
    if claims_world_model_generation and label in FORBIDDEN_WORLD_MODEL_LABELS:
        raise ValueError("cannot claim world-model generation for this sourceLabel")
    digest = hashlib.sha256(bytes(data)).hexdigest()
    asset_id = digest[:16]
    root = dest_root if dest_root is not None else config.UPLOADED_ASSETS_DIR
    dest = root / asset_id
    dest.mkdir(parents=True, exist_ok=True)
    glb_path = dest / "asset.glb"
    meta_path = dest / "meta.json"
    glb_path.write_bytes(bytes(data))
    meta = {
        "contentHash": digest,
        "originalFilename": original_filename.strip(),
        "sourceLabel": label,
        "claimsWorldModelGeneration": bool(claims_world_model_generation),
        "bakedWorldSpace": bool(baked_world_space),
        "byteLength": len(data),
        "notWorldModel": not bool(claims_world_model_generation),
    }
    meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return {
        "ok": True,
        "assetId": asset_id,
        "assetHash": digest,
        "byteLength": len(data),
        "sourceLabel": label,
        "claimsWorldModelGeneration": bool(claims_world_model_generation),
        "bakedWorldSpace": bool(baked_world_space),
        "notWorldModel": not bool(claims_world_model_generation),
    }


def verify_upload(asset_id: str, asset_hash: str) -> dict[str, Any]:
    """Resolve uploaded GLB; verify full content hash. No path/URL fetch."""
    if not ASSET_ID_RE.fullmatch(asset_id or ""):
        raise ValueError("assetId must be 16 lowercase hex chars")
    if not HASH_RE.fullmatch(asset_hash or ""):
        raise ValueError("assetHash must be full 64-char sha256 hex")
    meta_p = config.UPLOADED_ASSETS_DIR / asset_id / "meta.json"
    glb_p = config.UPLOADED_ASSETS_DIR / asset_id / "asset.glb"
    if not meta_p.is_file() or not glb_p.is_file():
        raise FileNotFoundError(f"assetId {asset_id} not in upload registry")
    meta = json.loads(meta_p.read_text(encoding="utf-8"))
    if meta.get("contentHash") != asset_hash:
        raise ValueError("assetHash does not match registry contentHash for assetId")
    # Verify bytes
    data = glb_p.read_bytes()
    dig = hashlib.sha256(data).hexdigest()
    if dig != asset_hash:
        raise ValueError("assetHash does not match on-disk GLB bytes")
    if asset_id != dig[:16]:
        raise ValueError("assetId does not match content hash prefix")
    return {"meta": meta, "glbPath": glb_p, "bytes": len(data)}


def safe_label_from_meta(meta: dict[str, Any], asset_id: str) -> str:
    """Label drives /Game/Imported/Dynamic/{label} and the CarinaPS-Windows_{label} side container.

    It must be unique per *content*, not per filename: two bar-front GLBs with different hashes
    used to share `bar_front`, so the second prepare overwrote the first's cooked packages and
    install overwrote a live container's .pak while its .utoc/.ucas stayed locked by the streamer
    (observed 2026-09-13, a7_live_rollback.json). Suffix the stem with the assetId prefix.
    """
    name = meta.get("originalFilename") or asset_id
    stem = Path(str(name)).stem
    stem = re.sub(r"[^A-Za-z0-9_]", "_", stem)[:40]
    suffix = re.sub(r"[^A-Za-z0-9_]", "_", str(asset_id))[:8]
    if not stem:
        return str(asset_id)
    if not suffix:
        return stem
    return f"{stem}_{suffix}"
