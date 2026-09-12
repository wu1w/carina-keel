"""Static indirect lightmap bake via Blender Cycles (UV2 + PNG + binding manifest).

Does NOT replace original PBR materials for the local game viewport — bake is additive.
Falcor screenshots are NOT lightmaps.
"""
from __future__ import annotations
import json
import os
import shutil
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import assets_store, config

BLENDER_CANDIDATES = [
    Path(os.environ.get("CARINA_BLENDER", "")),
    Path(r"C:\Users\wuyw\carina-rtx-validation\bin\blender-4.5.13-windows-x64\blender.exe"),
    Path(r"C:\Users\wuyw\carina-rtx-validation\bin\blender\blender.exe"),
    Path(r"C:\Program Files\Blender Foundation\Blender 4.2\blender.exe"),
    Path(r"C:\Program Files\Blender Foundation\Blender 4.3\blender.exe"),
    Path(r"C:\Program Files\Blender Foundation\Blender 4.4\blender.exe"),
    Path(r"C:\Program Files\Blender Foundation\Blender 4.5\blender.exe"),
    Path(r"C:\Program Files\Blender Foundation\Blender 5.0\blender.exe"),
]


class BakeError(RuntimeError):
    pass


def find_blender() -> Path | None:
    pointer = config.BIN_DIR / "blender_path.txt"
    if pointer.is_file():
        try:
            cand = Path(pointer.read_text(encoding="utf-8").strip())
            if cand.is_file():
                return cand
        except OSError:
            pass
    for p in BLENDER_CANDIDATES:
        if p and p.is_file():
            return p
    # portable installs under service bin/
    for p in sorted((config.BIN_DIR).glob("blender*/blender.exe"), reverse=True):
        if p.is_file():
            return p
    # shallow search under Program Files\Blender Foundation
    root = Path(r"C:\Program Files\Blender Foundation")
    if root.is_dir():
        for p in sorted(root.glob("*/blender.exe"), reverse=True):
            return p
    return None


def blender_available() -> dict[str, Any]:
    exe = find_blender()
    if not exe:
        return {"available": False, "reason": "Blender not installed; Cycles lightmap bake blocked"}
    try:
        r = subprocess.run(
            [str(exe), "--version"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        first = (r.stdout or r.stderr or "").splitlines()[:2]
        return {"available": True, "path": str(exe), "version_lines": first}
    except Exception as e:
        return {"available": False, "reason": str(e), "path": str(exe)}


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def run_lightmap_bake(
    *,
    asset_id: str,
    out_dir: Path,
    resolution: int = 1024,
    samples: int = 64,
    progress_cb=None,
) -> dict[str, Any]:
    """Bake combined diffuse indirect lightmap; write UV2-bearing GLB + lightmap PNG + manifest."""
    info = blender_available()
    if not info.get("available"):
        raise BakeError(info.get("reason") or "Blender unavailable")

    glb_path = assets_store.resolve_glb_path(asset_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    script = Path(__file__).with_name("blender_lightmap_bake.py")
    if not script.is_file():
        raise BakeError(f"missing bake script {script}")

    baked_glb = out_dir / "baked_uv2.glb"
    lightmap_png = out_dir / "lightmap.png"
    manifest_path = out_dir / "lightmap_manifest.json"
    log_path = out_dir / "bake_log.txt"

    # Peak VRAM via nvidia-smi before/after (best-effort)
    def vram_used() -> int | None:
        try:
            r = subprocess.run(
                ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
            return int(r.stdout.strip().splitlines()[0])
        except Exception:
            return None

    v0 = vram_used()
    t0 = time.perf_counter()
    if progress_cb:
        progress_cb(0.05)

    cmd = [
        str(info["path"]),
        "--background",
        "--python",
        str(script),
        "--",
        "--input",
        str(glb_path),
        "--out-glb",
        str(baked_glb),
        "--out-lightmap",
        str(lightmap_png),
        "--resolution",
        str(int(resolution)),
        "--samples",
        str(int(samples)),
    ]
    env = os.environ.copy()
    # Prefer GPU Cycles when available; script also sets device
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=3600, check=False, env=env)
    log_path.write_text((proc.stdout or "") + "\n--- STDERR ---\n" + (proc.stderr or ""), encoding="utf-8")
    if proc.returncode != 0:
        raise BakeError(f"Blender bake failed rc={proc.returncode}; see {log_path.name}")

    v1 = vram_used()
    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    if progress_cb:
        progress_cb(0.95)

    if not baked_glb.is_file() or not lightmap_png.is_file():
        raise BakeError("bake outputs missing after Blender exit 0")

    manifest = {
        "schemaVersion": 1,
        "kind": "static_indirect_lightmap",
        "assetId": asset_id,
        "sourceRelativePath": f"assets/uploaded/{asset_id}/asset.glb",
        "bakedGlb": baked_glb.name,
        "lightmap": {
            "file": lightmap_png.name,
            "uvSet": "TEXCOORD_1",
            "colorspace": "linear",
            "resolution": resolution,
            "samples": samples,
            "engine": "Blender Cycles",
            "note": "static indirect only; keep original PBR for local viewport direct lighting",
        },
        "bindings": [
            {
                "objectGlob": "*",
                "lightmapFile": lightmap_png.name,
                "uvSet": "TEXCOORD_1",
                "intensity": 1.0,
            }
        ],
        "vram_used_mib_before": v0,
        "vram_used_mib_after": v1,
        "vram_peak_delta_mib": (None if v0 is None or v1 is None else max(0, v1 - v0)),
        "elapsed_ms": elapsed_ms,
        "createdAt": _now_iso(),
        "notFalcorScreenshot": True,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    if progress_cb:
        progress_cb(1.0)
    return manifest


def run_lightmap_job(job, art_dir: Path) -> None:
    """JobManager entry: bake from job.asset_id into art_dir."""
    from pathlib import Path as _P
    aid = getattr(job, "asset_id", None) or (job.meta or {}).get("assetId")
    if not aid:
        raise BakeError("lightmap_bake job missing assetId")
    res = 1024
    if getattr(job, "resolution", None):
        # reuse width as lightmap resolution when square-ish request
        try:
            res = int(job.resolution[0])
        except Exception:
            res = 1024
    res = max(256, min(res, 2048))
    samples = int((job.meta or {}).get("bake_samples", 64))

    def progress_cb(p: float) -> None:
        job.progress = float(p)
        # best-effort persist without importing manager
        try:
            from . import config as _c
            import json as _j
            (_c.LOGS_DIR / f"{job.id}.json").write_text(_j.dumps(job.to_public(), indent=2) + "\n", encoding="utf-8")
        except Exception:
            pass

    manifest = run_lightmap_bake(
        asset_id=str(aid),
        out_dir=_P(art_dir),
        resolution=res,
        samples=samples,
        progress_cb=progress_cb,
    )
    job.meta["lightmap_manifest"] = manifest
    job.artifacts = sorted(
        [p.name for p in _P(art_dir).iterdir() if p.is_file() and p.suffix.lower() in {".png", ".glb", ".json", ".txt"}]
    )
    job.timings["bake_elapsed_ms"] = manifest.get("elapsed_ms")
    job.timings["vram_peak_delta_mib"] = manifest.get("vram_peak_delta_mib")
