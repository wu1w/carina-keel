"""Paths and service constants. API key lives only on disk (.api_key)."""
from __future__ import annotations
import os
import secrets
from pathlib import Path

ROOT = Path(os.environ.get("CARINA_RTX_ROOT", r"C:\Users\wuyw\carina-rtx-validation"))
SERVICE_DIR = ROOT / "service"
SCENE_DIR = ROOT / "scene"
ARTIFACTS_DIR = ROOT / "artifacts"
LOGS_DIR = ROOT / "logs"
QUEUE_DIR = ROOT / "queue"
BIN_DIR = ROOT / "bin"
ASSETS_DIR = ROOT / "assets"
UPLOADED_ASSETS_DIR = ASSETS_DIR / "uploaded"
API_KEY_FILE = ROOT / ".api_key"
CAPABILITIES_FILE = ROOT / "capabilities.json"
HOST = "127.0.0.1"
PORT = 18793
# One heavy GPU job at a time (tavern pipeline requirement)
MAX_CONCURRENT = 1
MAX_QUEUED = 8
ARTIFACT_EXTS = {".png", ".jpg", ".jpeg", ".mp4", ".json", ".glb"}
# Upload limits
MAX_GLB_BYTES = 80 * 1024 * 1024  # 80 MiB
ASSET_ID_HEX_LEN = 16  # sha256 truncated hex id for public assetId

def ensure_dirs() -> None:
    for d in (SERVICE_DIR, SCENE_DIR, ARTIFACTS_DIR, LOGS_DIR, QUEUE_DIR, BIN_DIR, ASSETS_DIR, UPLOADED_ASSETS_DIR):
        d.mkdir(parents=True, exist_ok=True)

def load_or_create_api_key() -> str:
    ensure_dirs()
    if API_KEY_FILE.exists():
        return API_KEY_FILE.read_text(encoding="utf-8").strip()
    key = secrets.token_urlsafe(32)
    API_KEY_FILE.write_text(key + "\n", encoding="utf-8")
    try:
        os.chmod(API_KEY_FILE, 0o600)
    except OSError:
        pass
    return key
