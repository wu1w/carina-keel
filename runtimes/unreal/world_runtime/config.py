from __future__ import annotations
import os
from pathlib import Path

ROOT = Path(os.environ.get("CARINA_RTX_ROOT", r"C:\Users\wuyw\carina-rtx-validation"))
WR_ROOT = ROOT / "world_runtime"
STATE_DIR = WR_ROOT / "state"
PIPELINE_DIR = WR_ROOT / "pipeline"
ARTIFACTS_DIR = ROOT / "artifacts" / "ue02"
LOGS_DIR = ROOT / "logs"
UPLOADED_ASSETS_DIR = ROOT / "assets" / "uploaded"

UE_ENGINE = Path(os.environ.get("CARINA_UE_ENGINE", r"G:\UE_5.8"))
UE_EDITOR = UE_ENGINE / "Engine" / "Binaries" / "Win64" / "UnrealEditor-Cmd.exe"
UE_PAK = UE_ENGINE / "Engine" / "Binaries" / "Win64" / "UnrealPak.exe"
PROJECT = Path(os.environ.get("CARINA_UE_PROJECT", r"G:\carina-ue\CarinaPS\CarinaPS.uproject"))
PROJECT_DIR = PROJECT.parent
COOKED_ROOT = PROJECT_DIR / "Saved" / "Cooked" / "Windows" / "CarinaPS" / "Content" / "Imported"
PACKAGED_PAKS = PROJECT_DIR / "Packaged" / "Windows" / "CarinaPS" / "Content" / "Paks"
PACKAGED_SAVED = PROJECT_DIR / "Packaged" / "Windows" / "CarinaPS" / "Saved"
IPC_INBOX = PACKAGED_SAVED / "CarinaWorldRuntime" / "inbox"
IPC_OUTBOX = PACKAGED_SAVED / "CarinaWorldRuntime" / "outbox"
# Also mirror IPC under project Saved for editor/dev runs
DEV_IPC_INBOX = PROJECT_DIR / "Saved" / "CarinaWorldRuntime" / "inbox"
DEV_IPC_OUTBOX = PROJECT_DIR / "Saved" / "CarinaWorldRuntime" / "outbox"

PORT = int(os.environ.get("CARINA_WORLD_RUNTIME_PORT", "18794"))
HOST = "127.0.0.1"
# live=False until smoke-proven; do not advertise LIVE to CLI
LIVE = True

ASSET_REGISTRY_MAP = STATE_DIR / "asset_registry.json"  # assetHash -> soft paths / cook meta
WORLDS_DIR = STATE_DIR / "worlds"
COMMANDS_DIR = STATE_DIR / "commands"

# Host IoStore after UE-05 MERGE (Avocado Material_MR). global.* unchanged — never replace.
ORIG_PAK_SHA = {
    "CarinaPS-Windows.pak": "5097E45FB3C942D688DB66D5CC16CFAF4215CF062683B5E69158D35DB02C6F58",
    "CarinaPS-Windows.ucas": "8D79DE45B49CDD6C5E1F7351C85295C471E22305FB0226B919E8E0ED9FFDA0A0",
    "CarinaPS-Windows.utoc": "7776117CBC9001DB91E2824E6CAE34BD875042FC3726081ED9995A83F0E2A698",
    "global.ucas": "EBE85CA62F59482C968C2A6FA940B120A6C43CD3079E2739A3F692A688758AB3",
    "global.utoc": "B03476E09B74D77DD9A2ACD1C91739619B09D311E6FF3A1E1EC435D143DA4CC9",
}


def ensure_dirs() -> None:
    for d in (STATE_DIR, PIPELINE_DIR, ARTIFACTS_DIR, LOGS_DIR, WORLDS_DIR, COMMANDS_DIR, IPC_INBOX, IPC_OUTBOX, DEV_IPC_INBOX, DEV_IPC_OUTBOX):
        d.mkdir(parents=True, exist_ok=True)
