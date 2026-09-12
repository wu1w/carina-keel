"""Prepare-request contract. No UE, no FastAPI. Rejects path/URL fetch."""
from __future__ import annotations
import re
from typing import Any

ASSET_ID_RE = re.compile(r"^[0-9a-f]{16}$")
HASH_RE = re.compile(r"^[0-9a-f]{64}$")
FORBIDDEN_PATH_KEYS = ("glbPath", "glbUrl", "url", "path")


class PrepareContractError(ValueError):
    def __init__(self, message: str) -> None:
        super().__init__(message)


def validate_prepare_request(body: dict[str, Any]) -> tuple[str, str]:
    """Return (assetId, assetHash). Never accepts filesystem or HTTP fetch fields."""
    for key in FORBIDDEN_PATH_KEYS:
        if key in body:
            raise PrepareContractError(
                "glbPath/glbUrl/path/url not accepted; use assetId+assetHash",
            )
    asset_id = body.get("assetId")
    asset_hash = body.get("assetHash")
    if not isinstance(asset_id, str) or not isinstance(asset_hash, str):
        raise PrepareContractError(
            "assetId and assetHash (full hex) required; no glbPath/glbUrl",
        )
    if not ASSET_ID_RE.fullmatch(asset_id):
        raise PrepareContractError("assetId must be 16 lowercase hex chars")
    if not HASH_RE.fullmatch(asset_hash):
        raise PrepareContractError("assetHash must be full 64-char sha256 hex")
    if asset_id != asset_hash[:16]:
        raise PrepareContractError("assetId must equal assetHash[:16]")
    return asset_id, asset_hash
