"""Run one hq_pbr job in a dedicated process (avoids GLFW+service-thread AV)."""
from __future__ import annotations
import json
import sys
import traceback
from pathlib import Path

ROOT = Path(r"C:\Users\wuyw\carina-rtx-validation")
sys.path.insert(0, str(ROOT))

def main():
    if len(sys.argv) < 2:
        print("usage: hq_pbr_worker.py <job_request.json>", file=sys.stderr)
        return 2
    req_path = Path(sys.argv[1])
    req = json.loads(req_path.read_text(encoding="utf-8"))
    job_id = req["id"]
    art_dir = ROOT / "artifacts" / job_id
    art_dir.mkdir(parents=True, exist_ok=True)
    status_path = ROOT / "queue" / f"{job_id}.hq_status.json"

    class FakeJob:
        def __init__(self, d):
            self.id = d["id"]
            self.mode = d.get("mode", "hq_pbr")
            self.resolution = d["resolution"]
            self.frames = int(d.get("frames", 60))
            self.warmup_frames = int(d.get("warmup_frames", 10))
            self.scene_glb = d.get("scene_glb")
            self.asset_id = d.get("asset_id")
            self.camera_path = d.get("camera_path")
            self.progress = 0.0
            self.timings = {}
            self.artifacts = []
            self.meta = d.get("meta") or ({"assetId": d["asset_id"]} if d.get("asset_id") else {})
            self.error = None

    job = FakeJob(req)
    status_path.write_text(json.dumps({"state": "running", "progress": 0.0}) + "\n", encoding="utf-8")
    try:
        from service.pbr_renderer import run_hq_pbr_job
        run_hq_pbr_job(job, art_dir)
        out = {
            "state": "completed",
            "progress": 1.0,
            "timings": job.timings,
            "artifacts": job.artifacts,
            "meta": job.meta,
            "error": None,
        }
        status_path.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
        print("HQ_WORKER_OK", job_id)
        return 0
    except Exception as e:
        tb = traceback.format_exc()
        (ROOT / "logs" / f"{job_id}.error.log").write_text(tb, encoding="utf-8")
        status_path.write_text(json.dumps({"state": "failed", "error": str(e), "progress": job.progress}) + "\n", encoding="utf-8")
        print("HQ_WORKER_FAIL", job_id, e, file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
