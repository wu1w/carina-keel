"""Authenticated GLB asset store: content-hash dedup, safe validation, assetId refs."""
from __future__ import annotations
import hashlib
import json
import re
import struct
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import config

ASSET_ID_RE = re.compile(r"^[0-9a-f]{16}$")
SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,128}$")


class AssetError(ValueError):
    pass


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _asset_dir(asset_id: str) -> Path:
    return (config.UPLOADED_ASSETS_DIR / asset_id).resolve()


def _meta_path(asset_id: str) -> Path:
    return _asset_dir(asset_id) / "meta.json"


def _glb_path(asset_id: str) -> Path:
    return _asset_dir(asset_id) / "asset.glb"


def validate_asset_id(asset_id: str) -> str:
    if not ASSET_ID_RE.fullmatch(asset_id or ""):
        raise AssetError("assetId must be exactly 16 lowercase hex chars")
    return asset_id


def validate_glb_bytes(data: bytes) -> dict[str, Any]:
    if not isinstance(data, (bytes, bytearray)):
        raise AssetError("body must be raw bytes")
    n = len(data)
    if n < 12:
        raise AssetError("GLB too small for header")
    if n > config.MAX_GLB_BYTES:
        raise AssetError(f"GLB exceeds max size {config.MAX_GLB_BYTES} bytes")
    magic, version, length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:  # b'glTF'
        raise AssetError("invalid GLB magic (expected glTF)")
    if version != 2:
        raise AssetError(f"unsupported GLB version {version} (need 2)")
    if length != n:
        raise AssetError(f"GLB header length {length} != body size {n}")
    # Walk chunks for basic integrity (no path traversal in URIs of JSON chunk)
    offset = 12
    json_len = 0
    bin_len = 0
    while offset + 8 <= n:
        chunk_len, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        if offset + chunk_len > n:
            raise AssetError("GLB chunk overruns file")
        if chunk_type == 0x4E4F534A:  # JSON
            json_len = chunk_len
            try:
                text = data[offset : offset + chunk_len].decode("utf-8")
            except UnicodeDecodeError as e:
                raise AssetError("GLB JSON chunk not utf-8") from e
            # Reject obvious unsafe URI schemes in JSON text
            lowered = text.lower()
            for bad in ("file://", "\\\\", "../", "..\\"):
                if bad in lowered or bad in text:
                    raise AssetError(f"unsafe URI or path fragment in GLB JSON: {bad!r}")
            # Also reject absolute Windows paths in URI strings
            if re.search(r'"uri"\s*:\s*"[A-Za-z]:\\\\', text) or re.search(r'"uri"\s*:\s*"/', text):
                raise AssetError("absolute path URI not allowed in GLB JSON")
        elif chunk_type == 0x004E4942:  # BIN
            bin_len = chunk_len
        else:
            # unknown chunk — allow but skip
            pass
        # chunk padding to 4-byte boundary is included in chunk_len per spec for JSON/BIN
        offset += chunk_len
    if json_len <= 0:
        raise AssetError("GLB missing JSON chunk")
    return {"byte_length": n, "json_chunk_bytes": json_len, "bin_chunk_bytes": bin_len, "version": version}


def content_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def asset_id_from_hash(sha256_hex: str) -> str:
    return sha256_hex[: config.ASSET_ID_HEX_LEN]


def store_glb(data: bytes, *, original_filename: str | None = None, source_label: str = "upload") -> dict[str, Any]:
    config.ensure_dirs()
    info = validate_glb_bytes(data)
    sha = content_hash(data)
    asset_id = asset_id_from_hash(sha)
    d = _asset_dir(asset_id)
    d.mkdir(parents=True, exist_ok=True)
    glb = _glb_path(asset_id)
    meta_p = _meta_path(asset_id)
    deduped = False
    if glb.is_file() and meta_p.is_file():
        existing = json.loads(meta_p.read_text(encoding="utf-8"))
        if existing.get("contentHash") == sha and glb.stat().st_size == len(data):
            deduped = True
            existing["deduped"] = True
            existing["lastAccessAt"] = _now_iso()
            meta_p.write_text(json.dumps(existing, indent=2) + "\n", encoding="utf-8")
            return existing
    # write atomically
    tmp = d / "asset.glb.tmp"
    tmp.write_bytes(data)
    tmp.replace(glb)
    fname = None
    if original_filename:
        base = Path(original_filename).name
        if SAFE_NAME_RE.fullmatch(base):
            fname = base
    meta = {
        "assetId": asset_id,
        "contentHash": sha,
        "byteLength": len(data),
        "glbVersion": info["version"],
        "jsonChunkBytes": info["json_chunk_bytes"],
        "binChunkBytes": info["bin_chunk_bytes"],
        "originalFilename": fname,
        "sourceLabel": source_label,
        "createdAt": _now_iso(),
        "lastAccessAt": _now_iso(),
        "deduped": deduped,
        "relativePath": f"assets/uploaded/{asset_id}/asset.glb",
        "note": "render-validation / tavern pipeline asset; not world-model generated content unless provenance says so",
    }
    meta_p.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return meta


def get_meta(asset_id: str) -> dict[str, Any]:
    asset_id = validate_asset_id(asset_id)
    p = _meta_path(asset_id)
    if not p.is_file():
        raise AssetError("asset not found")
    return json.loads(p.read_text(encoding="utf-8"))


def resolve_glb_path(asset_id: str) -> Path:
    asset_id = validate_asset_id(asset_id)
    p = _glb_path(asset_id).resolve()
    root = config.UPLOADED_ASSETS_DIR.resolve()
    if not str(p).startswith(str(root)) or not p.is_file():
        raise AssetError("asset glb missing")
    return p


def resolve_job_scene(body_or_job_fields: dict[str, Any]) -> tuple[str | None, Path | None]:
    """Prefer assetId. Reject absolute Windows paths for new tavern flow.
    Returns (assetId, path). path may be None for baseline without scene.
    """
    asset_id = body_or_job_fields.get("assetId") or body_or_job_fields.get("asset_id")
    scene_glb = body_or_job_fields.get("scene_glb")
    if asset_id:
        aid = validate_asset_id(str(asset_id))
        return aid, resolve_glb_path(aid)
    if scene_glb:
        s = str(scene_glb)
        # allow only relative paths under assets/ for legacy; forbid absolute / drive letters / ..
        if ".." in s or s.startswith("/") or re.match(r"^[A-Za-z]:", s) or "\\\\" in s:
            raise AssetError("scene_glb absolute/traversal paths rejected; upload GLB and pass assetId")
        # normalize to under ROOT/assets
        rel = s.replace("\\", "/")
        if rel.startswith("assets/"):
            p = (config.ROOT / rel).resolve()
        else:
            p = (config.ASSETS_DIR / rel).resolve()
        assets_root = config.ASSETS_DIR.resolve()
        if not str(p).startswith(str(assets_root)) or not p.is_file():
            raise AssetError("scene_glb not found under assets/")
        if p.suffix.lower() != ".glb":
            raise AssetError("scene_glb must be .glb")
        return None, p
    return None, None
