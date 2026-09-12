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
    "CarinaPS-Windows.pak": "BF8945B89421B6E4E627A47AA2035DA6CC471DEF5C4E4A0F143F497908623F2D",
    "CarinaPS-Windows.ucas": "1E3B63A3283581C8BBF0CE6DDC99F332883E2FE773091F91A8514FD99EB2497A",
    "CarinaPS-Windows.utoc": "7781D84A98A0D979AF692BD78D913DB0699F407FA648C5327B392FC3A6D0026A",
    "global.ucas": "EBE85CA62F59482C968C2A6FA940B120A6C43CD3079E2739A3F692A688758AB3",
    "global.utoc": "B03476E09B74D77DD9A2ACD1C91739619B09D311E6FF3A1E1EC435D143DA4CC9",
}


def ensure_dirs() -> None:
    for d in (STATE_DIR, PIPELINE_DIR, ARTIFACTS_DIR, LOGS_DIR, WORLDS_DIR, COMMANDS_DIR, IPC_INBOX, IPC_OUTBOX, DEV_IPC_INBOX, DEV_IPC_OUTBOX):
        d.mkdir(parents=True, exist_ok=True)
