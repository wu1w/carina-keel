"""Host streamer remount: stop / start the packaged CarinaPS streamer scheduled task.

A freshly installed MERGE side container is only mounted when the host restarts, so a cook
publish that adds *new* containers has to stop the streamer before install and start it after
(then wait for the WorldRuntime heartbeat) before activate can resolve the SoftObjectPath.
This is one host restart per publish, not per object. Never touches paks.
"""
from __future__ import annotations
import os
import subprocess
import time
from pathlib import Path
from typing import Any

try:
    from . import config
    from .ipc_ue import ue_bridge_available
except ImportError:  # script tests run from this directory
    import config  # type: ignore
    from ipc_ue import ue_bridge_available  # type: ignore

STREAMER_TASK = os.environ.get("CARINA_STREAMER_TASK", "CarinaPS2-Streamer-LAN")
# The task's .bat launches the host with `start ""` and exits, so the scheduled task is never
# "running": `/End` is a no-op and `/Run` would launch a second host. Stop = kill the packaged
# host image; start = `/Run` only when no host is running.
STREAMER_IMAGE = os.environ.get("CARINA_STREAMER_IMAGE", "CarinaPS.exe")
SYSTEM32 = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32"
SCHTASKS = SYSTEM32 / "schtasks.exe"
TASKKILL = SYSTEM32 / "taskkill.exe"
TASKLIST = SYSTEM32 / "tasklist.exe"
START_TIMEOUT_S = float(os.environ.get("CARINA_STREAMER_START_TIMEOUT_S", "120"))
STOP_TIMEOUT_S = float(os.environ.get("CARINA_STREAMER_STOP_TIMEOUT_S", "30"))
STOP_SETTLE_S = float(os.environ.get("CARINA_STREAMER_STOP_SETTLE_S", "3"))


def _run(cmd: list[str], timeout: float = 60) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, capture_output=True, text=True, errors="replace", check=False, timeout=timeout)


def _schtasks(*args: str) -> subprocess.CompletedProcess[str]:
    return _run([str(SCHTASKS), *args, "/TN", STREAMER_TASK])


def host_running() -> bool:
    proc = _run([str(TASKLIST), "/FI", f"IMAGENAME eq {STREAMER_IMAGE}", "/FO", "CSV", "/NH"], timeout=30)
    return STREAMER_IMAGE.lower() in proc.stdout.lower()


def _heartbeat_age() -> float | None:
    ages: list[float] = []
    for outbox in (config.IPC_OUTBOX, config.DEV_IPC_OUTBOX):
        hb = outbox / "_heartbeat.json"
        if hb.is_file():
            try:
                ages.append(time.time() - hb.stat().st_mtime)
            except OSError:
                pass
    return min(ages) if ages else None


def stop_streamer() -> dict[str, Any]:
    t0 = time.perf_counter()
    was_running = host_running()
    _schtasks("/End")  # harmless when the task already exited
    kill = None
    if was_running:
        kill = _run([str(TASKKILL), "/IM", STREAMER_IMAGE, "/F"], timeout=30)
        deadline = time.time() + STOP_TIMEOUT_S
        while time.time() < deadline and host_running():
            time.sleep(1)
        time.sleep(STOP_SETTLE_S)  # let file handles on paks close
    return {
        "ok": not host_running(),
        "task": STREAMER_TASK,
        "image": STREAMER_IMAGE,
        "action": "stop",
        "wasRunning": was_running,
        "killReturncode": None if kill is None else kill.returncode,
        "ms": (time.perf_counter() - t0) * 1000.0,
    }


def start_streamer(wait_for_bridge: bool = True) -> dict[str, Any]:
    t0 = time.perf_counter()
    launched = False
    returncode = 0
    if host_running():
        note = "host already running; not launching a second instance"
    else:
        proc = _schtasks("/Run")
        returncode = proc.returncode
        launched = returncode == 0
        note = proc.stderr.strip()[:300] if not launched else "launched via scheduled task"
        if not launched:
            return {
                "ok": False,
                "task": STREAMER_TASK,
                "action": "start",
                "returncode": returncode,
                "note": note,
                "ms": (time.perf_counter() - t0) * 1000.0,
            }
    bridge = False
    if wait_for_bridge:
        started_at = time.time()
        deadline = started_at + START_TIMEOUT_S
        while time.time() < deadline:
            age = _heartbeat_age()
            # the old heartbeat survives a stop; when we launched, require one written after /Run
            fresh = age is not None and age < 20 and ((not launched) or (time.time() - age) >= started_at - 1)
            if fresh and ue_bridge_available():
                bridge = True
                break
            time.sleep(2)
    return {
        "ok": (not wait_for_bridge) or bridge,
        "task": STREAMER_TASK,
        "image": STREAMER_IMAGE,
        "action": "start",
        "launched": launched,
        "returncode": returncode,
        "bridge": bridge,
        "heartbeatAgeS": _heartbeat_age(),
        "note": note,
        "ms": (time.perf_counter() - t0) * 1000.0,
    }
