"""Query real GPU info via nvidia-smi / OpenGL vendor."""
from __future__ import annotations
import json
import shutil
import subprocess
from pathlib import Path
from typing import Any


def _nvidia_smi_query() -> dict[str, Any]:
    smi = shutil.which("nvidia-smi")
    if not smi:
        return {}
    try:
        out = subprocess.check_output(
            [
                smi,
                "--query-gpu=name,memory.total,memory.used,driver_version,utilization.gpu",
                "--format=csv,noheader,nounits",
            ],
            text=True,
            timeout=10,
        ).strip()
        line = out.splitlines()[0]
        parts = [p.strip() for p in line.split(",")]
        if len(parts) >= 4:
            return {
                "gpu_name": parts[0],
                "vram_mib": int(float(parts[1])),
                "vram_used_mib": int(float(parts[2])),
                "driver": parts[3],
                "util_gpu": float(parts[4]) if len(parts) > 4 and parts[4] else None,
            }
    except Exception as e:
        return {"error": str(e)}
    return {}


def sample_vram_mib() -> int | None:
    info = _nvidia_smi_query()
    return info.get("vram_used_mib")


def get_gpu_snapshot() -> dict[str, Any]:
    info = _nvidia_smi_query()
    return {
        "gpu_name": info.get("gpu_name", "unknown"),
        "vram_mib": info.get("vram_mib"),
        "vram_used_mib": info.get("vram_used_mib"),
        "driver": info.get("driver", "unknown"),
    }


CAPABILITY_DEFAULTS = {
    "meshRender": False,
    "pbrRasterIBL": False,
    "pathTraceDXR": False,
    "falcorPathTrace": False,
    "lumenSW": False,
    "lumenHW": False,
    "dlssSuperResolution": False,
    "dlssNeuralRendering": False,
}


def load_capabilities(path: Path) -> dict[str, bool]:
    defaults = dict(CAPABILITY_DEFAULTS)
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            for k in defaults:
                if k in data:
                    defaults[k] = bool(data[k])
            # never invent NR / Lumen from stale files
            defaults["lumenSW"] = False if "lumenSW" not in data else bool(data["lumenSW"]) and False
            # Force honest false for Lumen/NR until UE/Streamline wired — keep file values only if True AND proven elsewhere.
            # Policy: these stay false without UE / Streamline NR SDK.
            defaults["lumenSW"] = False
            defaults["lumenHW"] = False
            defaults["dlssNeuralRendering"] = False
            if "dlssSuperResolution" in data:
                defaults["dlssSuperResolution"] = bool(data["dlssSuperResolution"])
            else:
                defaults["dlssSuperResolution"] = False
        except Exception:
            pass
    return defaults


def save_capabilities(path: Path, caps: dict[str, bool]) -> None:
    # merge with defaults; hard-false Lumen/NR
    out = dict(CAPABILITY_DEFAULTS)
    out.update({k: bool(v) for k, v in caps.items() if k in out})
    out["lumenSW"] = False
    out["lumenHW"] = False
    out["dlssNeuralRendering"] = False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
