"""File-queue IPC to packaged CarinaPS WorldRuntime subsystem."""
from __future__ import annotations
import json
import time
import uuid
from pathlib import Path
from typing import Any

from . import config


def _inboxes() -> list[Path]:
    return [config.IPC_INBOX, config.DEV_IPC_INBOX]


def _outboxes() -> list[Path]:
    return [config.IPC_OUTBOX, config.DEV_IPC_OUTBOX]


def ue_bridge_available() -> bool:
    """True if host has written a heartbeat or outbox exists and streamer likely up."""
    for ob in _outboxes():
        hb = ob / "_heartbeat.json"
        if hb.is_file():
            try:
                age = time.time() - hb.stat().st_mtime
                if age < 30:
                    return True
            except OSError:
                pass
    return False


def send_command(cmd: dict[str, Any], timeout_s: float = 15.0) -> dict[str, Any]:
    config.ensure_dirs()
    command_id = cmd.get("ipcId") or str(uuid.uuid4())
    cmd = dict(cmd)
    cmd["ipcId"] = command_id
    payload = json.dumps(cmd, indent=2) + "\n"
    for inbox in _inboxes():
        inbox.mkdir(parents=True, exist_ok=True)
        (inbox / f"{command_id}.json").write_text(payload, encoding="utf-8")
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        for outbox in _outboxes():
            p = outbox / f"{command_id}.json"
            if p.is_file():
                try:
                    data = json.loads(p.read_text(encoding="utf-8"))
                    try:
                        p.unlink()
                    except OSError:
                        pass
                    return data
                except json.JSONDecodeError:
                    pass
        time.sleep(0.05)
    return {"ok": False, "error": "UE IPC timeout — host spawn bridge not responding", "status": 501, "ipcId": command_id}
