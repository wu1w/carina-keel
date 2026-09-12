"""Bounded async job queue for CARINA-RTX validation."""
from __future__ import annotations
import json
import subprocess
import threading
import traceback
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from . import config
from . import assets_store

# GLFW/ModernGL is not safely concurrent across threads on Windows.
GL_RENDER_LOCK = threading.Lock()

BLOCKED_MODES = {
    "lumen_sw": "Lumen software path requires Unreal Engine with Lumen; UE not installed.",
    "lumen_hw": "Lumen hardware (RT) path requires Unreal Engine + DXR Lumen; UE not installed.",
    "lumen_dlss_nr": "DLSS Neural Rendering requires Streamline + DLSS NR SDK and engine integration; not present.",
    "falcor_pt": "Falcor path tracer not yet built/verified on this host (see BLOCKERS.md).",
    "dxr_pt": "DXR path tracer binary not yet built/verified on this host (see BLOCKERS.md).",
}

SUPPORTED_RUN_MODES = {"baseline", "hq_pbr", "lightmap_bake"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


@dataclass
class Job:
    id: str
    mode: str
    resolution: list[int]
    frames: int
    state: str = "queued"
    progress: float = 0.0
    error: str | None = None
    reason: str | None = None
    created_at: str = field(default_factory=_now_iso)
    started_at: str | None = None
    finished_at: str | None = None
    timings: dict[str, Any] = field(default_factory=dict)
    artifacts: list[str] = field(default_factory=list)
    meta: dict[str, Any] = field(default_factory=dict)
    # Optional request fields (persisted in meta + used by workers)
    scene_glb: str | None = None
    asset_id: str | None = None
    camera_path: list | dict | None = None
    warmup_frames: int = 10

    def to_public(self) -> dict[str, Any]:
        d = asdict(self)
        # Never expose absolute Windows paths to clients when assetId is used.
        if d.get("asset_id"):
            d["scene_glb"] = None
            meta = d.get("meta") or {}
            if "scene_glb" in meta:
                meta = dict(meta)
                meta["scene_glb"] = meta.get("relativePath") or f"assets/uploaded/{d['asset_id']}/asset.glb"
                meta["assetId"] = d["asset_id"]
                d["meta"] = meta
        return d


class JobManager:
    def __init__(
        self,
        run_baseline: Callable[[Job, Path], None],
        run_hq_pbr: Callable[[Job, Path], None] | None = None,
        run_lightmap: Callable[[Job, Path], None] | None = None,
        max_concurrent: int = config.MAX_CONCURRENT,
        max_queued: int = config.MAX_QUEUED,
    ):
        self.run_baseline = run_baseline
        self.run_hq_pbr = run_hq_pbr
        self.run_lightmap = run_lightmap
        self.max_concurrent = max_concurrent
        self.max_queued = max_queued
        self._lock = threading.Lock()
        self._jobs: dict[str, Job] = {}
        self._cv = threading.Condition(self._lock)
        self._workers: list[threading.Thread] = []
        self._stop = False
        for i in range(max_concurrent):
            t = threading.Thread(target=self._worker, name=f"carina-worker-{i}", daemon=True)
            t.start()
            self._workers.append(t)

    def submit(self, body: dict[str, Any]) -> Job:
        mode = str(body.get("mode", "baseline")).lower()
        res = body.get("resolution", [1280, 720])
        if isinstance(res, dict):
            w, h = int(res.get("width", 1280)), int(res.get("height", 720))
        else:
            w, h = int(res[0]), int(res[1])
        frames = max(1, min(int(body.get("frames", 60)), 300))
        warmup = int(body.get("warmup_frames", 10))
        camera_path = body.get("camera_path")
        try:
            asset_id, scene_path = assets_store.resolve_job_scene(body)
        except assets_store.AssetError as e:
            raise RuntimeError(str(e)) from e
        scene_glb = str(scene_path) if scene_path else None
        job_id = uuid.uuid4().hex[:12]
        job = Job(
            id=job_id,
            mode=mode,
            resolution=[w, h],
            frames=frames,
            scene_glb=scene_glb,
            asset_id=asset_id,
            camera_path=camera_path,
            warmup_frames=max(0, min(warmup, 120)),
        )
        if asset_id:
            job.meta["assetId"] = asset_id
        if scene_glb:
            job.meta["scene_glb"] = scene_glb
            job.meta["scene_resolved_via"] = "assetId" if asset_id else "relative_assets_path"
        if camera_path is not None:
            job.meta["camera_path_provided"] = True
        if body.get("bake_samples") is not None:
            try:
                job.meta["bake_samples"] = int(body.get("bake_samples"))
            except (TypeError, ValueError):
                pass
        if isinstance(body.get("meta"), dict):
            for k in ("bake_samples", "bake_resolution"):
                if k in body["meta"]:
                    job.meta[k] = body["meta"][k]

        if mode in BLOCKED_MODES:
            # falcor_pt / dxr_pt may flip to runnable later when binaries verified
            job.state = "blocked"
            job.reason = BLOCKED_MODES[mode]
            job.error = BLOCKED_MODES[mode]
            job.finished_at = _now_iso()
            self._persist(job)
            with self._lock:
                self._jobs[job_id] = job
            return job

        if mode not in SUPPORTED_RUN_MODES:
            job.state = "blocked"
            job.reason = (
                f"Unknown mode '{mode}'. Supported: baseline, hq_pbr, lightmap_bake; "
                "placeholders: lumen_sw, lumen_hw, lumen_dlss_nr, falcor_pt, dxr_pt."
            )
            job.error = job.reason
            job.finished_at = _now_iso()
            self._persist(job)
            with self._lock:
                self._jobs[job_id] = job
            return job

        if mode == "hq_pbr" and self.run_hq_pbr is None:
            job.state = "blocked"
            job.reason = "hq_pbr runner not loaded"
            job.error = job.reason
            job.finished_at = _now_iso()
            self._persist(job)
            with self._lock:
                self._jobs[job_id] = job
            return job

        if mode == "lightmap_bake":
            if not asset_id:
                job.state = "blocked"
                job.reason = "lightmap_bake requires assetId (upload GLB first)"
                job.error = job.reason
                job.finished_at = _now_iso()
                self._persist(job)
                with self._lock:
                    self._jobs[job_id] = job
                return job
            try:
                from .lightmap_bake import blender_available
                binfo = blender_available()
                if not binfo.get("available"):
                    job.state = "blocked"
                    job.reason = binfo.get("reason") or "Blender not available for Cycles lightmap bake"
                    job.error = job.reason
                    job.meta["blender"] = binfo
                    job.finished_at = _now_iso()
                    self._persist(job)
                    with self._lock:
                        self._jobs[job_id] = job
                    return job
            except Exception as e:
                job.state = "blocked"
                job.reason = f"Blender check failed: {e}"
                job.error = job.reason
                job.finished_at = _now_iso()
                self._persist(job)
                with self._lock:
                    self._jobs[job_id] = job
                return job
            if self.run_lightmap is None:
                job.state = "blocked"
                job.reason = "lightmap_bake runner not loaded"
                job.error = job.reason
                job.finished_at = _now_iso()
                self._persist(job)
                with self._lock:
                    self._jobs[job_id] = job
                return job

        with self._cv:
            queued = sum(1 for j in self._jobs.values() if j.state == "queued")
            running = sum(1 for j in self._jobs.values() if j.state == "running")
            if queued >= self.max_queued:
                raise RuntimeError(f"queue full (max {self.max_queued})")
            if queued + running >= self.max_queued + self.max_concurrent:
                raise RuntimeError("system at capacity")
            self._jobs[job_id] = job
            self._persist(job)
            self._cv.notify()
        return job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def _worker(self) -> None:
        while True:
            job = None
            with self._cv:
                while not self._stop:
                    for j in self._jobs.values():
                        if j.state == "queued":
                            job = j
                            j.state = "running"
                            j.started_at = _now_iso()
                            self._persist(j)
                            break
                    if job:
                        break
                    self._cv.wait(timeout=0.5)
                if self._stop:
                    return
            assert job is not None
            art_dir = config.ARTIFACTS_DIR / job.id
            art_dir.mkdir(parents=True, exist_ok=True)
            try:
                if job.mode == "hq_pbr":
                    self._run_hq_pbr_subprocess(job, art_dir)
                elif job.mode == "lightmap_bake":
                    self.run_lightmap(job, art_dir)
                else:
                    with GL_RENDER_LOCK:
                        self.run_baseline(job, art_dir)
                job.state = "completed"
                job.progress = 1.0
            except FileNotFoundError as e:
                job.state = "failed"
                job.error = f"asset missing: {e}"
                (config.LOGS_DIR / f"{job.id}.error.log").write_text(traceback.format_exc(), encoding="utf-8")
            except Exception as e:
                job.state = "failed"
                job.error = str(e)
                (config.LOGS_DIR / f"{job.id}.error.log").write_text(traceback.format_exc(), encoding="utf-8")
            finally:
                job.finished_at = _now_iso()
                self._persist(job)


    def _run_hq_pbr_subprocess(self, job: Job, art_dir: Path) -> None:
        """Dedicated process: GLFW/ModernGL must not share uvicorn worker threads."""
        import sys
        req = {
            "id": job.id,
            "mode": job.mode,
            "resolution": job.resolution,
            "frames": job.frames,
            "warmup_frames": job.warmup_frames,
            "scene_glb": job.scene_glb,
            "asset_id": job.asset_id,
            "camera_path": job.camera_path,
            "meta": {"assetId": job.asset_id} if job.asset_id else {},
        }
        config.QUEUE_DIR.mkdir(parents=True, exist_ok=True)
        req_path = config.QUEUE_DIR / f"{job.id}.hq_req.json"
        status_path = config.QUEUE_DIR / f"{job.id}.hq_status.json"
        req_path.write_text(json.dumps(req) + "\n", encoding="utf-8")
        worker = config.ROOT / "scripts" / "hq_pbr_worker.py"
        py = sys.executable
        with GL_RENDER_LOCK:
            proc = subprocess.run(
                [py, str(worker), str(req_path)],
                cwd=str(config.ROOT),
                capture_output=True,
                text=True,
                timeout=1800,
            )
        if status_path.exists():
            st = json.loads(status_path.read_text(encoding="utf-8"))
            job.progress = float(st.get("progress") or 0.0)
            if st.get("timings"):
                job.timings = st["timings"]
            if st.get("artifacts"):
                job.artifacts = st["artifacts"]
            if st.get("meta"):
                job.meta = st["meta"]
            if st.get("state") == "completed":
                return
            raise RuntimeError(st.get("error") or f"hq worker state={st.get('state')}")
        err = ((proc.stderr or "") + "\n" + (proc.stdout or ""))[-3000:]
        raise RuntimeError(f"hq worker exit={proc.returncode}: {err}")

    def _persist(self, job: Job) -> None:
        config.LOGS_DIR.mkdir(parents=True, exist_ok=True)
        path = config.LOGS_DIR / f"{job.id}.json"
        path.write_text(json.dumps(job.to_public(), indent=2) + "\n", encoding="utf-8")
