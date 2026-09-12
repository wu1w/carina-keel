"""CARINA-RTX FastAPI service — localhost only."""
from __future__ import annotations
import json
import re
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from . import assets_store, config
from .auth import make_auth_dependency
from .gpu_info import get_gpu_snapshot, load_capabilities
from .jobs import JobManager
from .mesh_renderer import run_baseline_job
from .pbr_renderer import run_hq_pbr_job
from .lightmap_bake import blender_available, run_lightmap_job

config.ensure_dirs()
API_KEY = config.load_or_create_api_key()
require_key = make_auth_dependency(API_KEY)

JOB_ID_RE = re.compile(r"^[0-9a-f]{12}$")


def _require_job_id(job_id: str) -> str:
    if not JOB_ID_RE.fullmatch(job_id or ""):
        raise HTTPException(400, "invalid job_id; expected exactly 12 lowercase hex chars")
    return job_id


manager = JobManager(run_baseline=run_baseline_job, run_hq_pbr=run_hq_pbr_job, run_lightmap=run_lightmap_job)

app = FastAPI(title="CARINA-RTX Validation", version="20260910")


def _backend_string(caps: dict) -> str:
    parts = []
    if caps.get("pbrRasterIBL"):
        parts.append("ModernGL PBR+shadows+IBL (not Lumen)")
    if caps.get("meshRender"):
        parts.append("ModernGL mesh baseline")
    if caps.get("pathTraceDXR"):
        parts.append("DXR path tracer (not Lumen)")
    if caps.get("falcorPathTrace"):
        parts.append("Falcor path tracer (not Lumen)")
    return " | ".join(parts) if parts else "service-up; no verified GPU path yet"


@app.get("/health")
async def health(_: None = Depends(require_key)):
    gpu = get_gpu_snapshot()
    caps = load_capabilities(config.CAPABILITIES_FILE)
    ready = bool(caps.get("meshRender") or caps.get("pbrRasterIBL") or caps.get("pathTraceDXR"))
    return {
        "service": "CARINA-RTX-20260910",
        "bind": f"{config.HOST}:{config.PORT}",
        "gpu_name": gpu.get("gpu_name"),
        "vram_mib": gpu.get("vram_mib"),
        "vram_used_mib": gpu.get("vram_used_mib"),
        "driver": gpu.get("driver"),
        "backend": _backend_string(caps),
        "ready": ready,
        "capabilities": caps,
        "blender_lightmap": blender_available(),
        "assets": {
            "upload": "POST /assets/glb (multipart file field 'file')",
            "max_bytes": config.MAX_GLB_BYTES,
            "dedup": "sha256 content-hash; assetId = first 16 hex chars",
            "jobs": "prefer body.assetId; absolute Windows paths rejected",
        },
        "timing_notes": {
            "render_ms": "GPU work + glFinish sync; NOT claimed as game FPS",
            "readback_encode_ms": "FBO readback + PNG encode (CPU)",
            "network_ms": "measured at client only; not server-side",
        },
    }


@app.post("/assets/glb")
async def upload_glb(
    file: UploadFile = File(...),
    source_label: str = Form("upload"),
    _: None = Depends(require_key),
):
    raw = await file.read()
    try:
        meta = assets_store.store_glb(
            raw,
            original_filename=file.filename,
            source_label=(source_label or "upload")[:64],
        )
    except assets_store.AssetError as e:
        raise HTTPException(400, str(e)) from e
    return {
        "assetId": meta["assetId"],
        "contentHash": meta["contentHash"],
        "byteLength": meta["byteLength"],
        "deduped": meta.get("deduped", False),
        "originalFilename": meta.get("originalFilename"),
        "createdAt": meta.get("createdAt"),
    }


@app.get("/assets/{asset_id}")
async def get_asset(asset_id: str, _: None = Depends(require_key)):
    try:
        meta = assets_store.get_meta(asset_id)
    except assets_store.AssetError as e:
        code = 404 if "not found" in str(e) else 400
        raise HTTPException(code, str(e)) from e
    # never return absolute Windows path
    public = {
        "assetId": meta["assetId"],
        "contentHash": meta["contentHash"],
        "byteLength": meta["byteLength"],
        "glbVersion": meta.get("glbVersion"),
        "originalFilename": meta.get("originalFilename"),
        "sourceLabel": meta.get("sourceLabel"),
        "createdAt": meta.get("createdAt"),
        "relativePath": meta.get("relativePath"),
        "note": meta.get("note"),
    }
    return public


@app.post("/jobs")
async def submit_job(request: Request, _: None = Depends(require_key)):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "invalid JSON body")
    try:
        job = manager.submit(body if isinstance(body, dict) else {})
    except RuntimeError as e:
        msg = str(e)
        if any(k in msg.lower() for k in ("asset", "glb", "scene_glb", "path")):
            raise HTTPException(400, msg) from e
        raise HTTPException(429, msg) from e
    return job.to_public()


@app.get("/jobs/{job_id}")
async def get_job(job_id: str, _: None = Depends(require_key)):
    job_id = _require_job_id(job_id)
    job = manager.get(job_id)
    if not job:
        p = config.LOGS_DIR / f"{job_id}.json"
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
        raise HTTPException(404, "job not found")
    return job.to_public()


@app.get("/artifacts/{job_id}/{filename}")
async def get_artifact(job_id: str, filename: str, _: None = Depends(require_key)):
    job_id = _require_job_id(job_id)
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(400, "invalid filename")
    ext = Path(filename).suffix.lower()
    if ext not in config.ARTIFACT_EXTS:
        raise HTTPException(403, "extension not allowlisted")
    path = (config.ARTIFACTS_DIR / job_id / filename).resolve()
    root = (config.ARTIFACTS_DIR / job_id).resolve()
    if not str(path).startswith(str(root)) or not path.is_file():
        raise HTTPException(404, "artifact not found")
    media = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".mp4": "video/mp4",
        ".json": "application/json",
        ".glb": "model/gltf-binary",
    }.get(ext, "application/octet-stream")
    return FileResponse(path, media_type=media, filename=filename)


@app.get("/")
async def root():
    return {"service": "CARINA-RTX-20260910", "hint": "authenticated endpoints under /health /jobs /artifacts /assets"}


def main():
    import uvicorn
    uvicorn.run(
        "service.app:app",
        host=config.HOST,
        port=config.PORT,
        log_level="info",
        reload=False,
    )


if __name__ == "__main__":
    main()
