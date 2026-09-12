#!/usr/bin/env python3
"""HTTP native-mesh sidecar for Carina.

Image-to-3D with TripoSR. SDXL-Turbo makes an object still first.
Not LingBot pixels, not the mock tavern, not a CC0 fixture.
Bind loopback only.
"""

from __future__ import annotations

import base64
import json
import os
import sys
import threading
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
TRIPOSR_ROOT = Path(os.environ.get("TRIPOSR_ROOT", "/data/disk1/models/carina-native-mesh/TripoSR"))
T2I_DIR = Path(os.environ.get("CARINA_T2I", "/data/disk1/models/sdxl-turbo"))
_DEFAULT_WEIGHTS = ROOT / "weights"
TSR_ID = os.environ.get(
    "CARINA_TRIPOSR_ID",
    str(_DEFAULT_WEIGHTS) if (_DEFAULT_WEIGHTS / "model.ckpt").is_file() else "stabilityai/TripoSR",
)
HOST = os.environ.get("CARINA_MESH_HOST", "127.0.0.1")
PORT = int(os.environ.get("CARINA_MESH_PORT", "18795"))
MC_RESOLUTION = int(os.environ.get("CARINA_TRIPOSR_MC", "128"))
T2I_STEPS = int(os.environ.get("CARINA_MESH_T2I_STEPS", "4"))
T2I_SIZE = int(os.environ.get("CARINA_MESH_T2I_SIZE", "512"))

sys.path.insert(0, str(TRIPOSR_ROOT))
sys.path.insert(0, str(ROOT))

os.environ.setdefault("HF_HOME", "/data/disk1/models/.hf-home")
os.environ.setdefault("HUGGINGFACE_HUB_CACHE", "/data/disk1/models/.hf-cache")
os.environ.setdefault("HF_HUB_CACHE", os.environ["HUGGINGFACE_HUB_CACHE"])
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

if "rembg" not in sys.modules:
    import types

    rembg_stub = types.ModuleType("rembg")

    def _remove(image, session=None, **kwargs):
        return image

    def _new_session(*args, **kwargs):
        return None

    rembg_stub.remove = _remove
    rembg_stub.new_session = _new_session
    sys.modules["rembg"] = rembg_stub

LOCK = threading.Lock()
TSR_MODEL = None
T2I_PIPE = None
READY = False
LOAD_ERROR: str | None = None
LAST_TIMINGS: dict[str, Any] | None = None


def _english_object(name: str, role: str, prompt: str) -> str:
    bits = []
    lowered = f"{name} {role} {prompt}".lower()
    if any(token in f"{name}{role}{prompt}" for token in ("吧台", "bar")) or "bar" in lowered:
        bits.append("carved oak tavern bar front, wooden counter facade")
    if "fireplace" in lowered or "壁炉" in f"{name}{role}{prompt}":
        bits.append("stone fireplace")
    if name.strip():
        bits.append(name.strip())
    if role.strip():
        bits.append(role.strip())
    if prompt.strip():
        bits.append(prompt.strip()[:240])
    bits.append(
        "isolated 3d object, studio lighting, centered, plain gray background, "
        "product photo, no people, no text, no watermark"
    )
    return ", ".join(bits)


def _load_tsr():
    global TSR_MODEL, READY, LOAD_ERROR
    import torch
    from tsr.system import TSR

    print(f"[mesh] loading TripoSR {TSR_ID}", flush=True)
    model = TSR.from_pretrained(
        TSR_ID,
        config_name="config.yaml",
        weight_name="model.ckpt",
    )
    model.renderer.set_chunk_size(int(os.environ.get("CARINA_TRIPOSR_CHUNK", "16384")))
    model.to("cuda" if torch.cuda.is_available() else "cpu")
    model.eval()
    TSR_MODEL = model
    READY = True
    LOAD_ERROR = None
    print("[mesh] TripoSR ready", flush=True)
    return model


def _load_t2i():
    global T2I_PIPE
    if T2I_PIPE is not None:
        return T2I_PIPE
    import torch
    from diffusers import StableDiffusionXLPipeline

    if not T2I_DIR.is_dir() or not any(T2I_DIR.iterdir()):
        raise RuntimeError(f"T2I model missing at {T2I_DIR}")
    dtype = torch.float16 if torch.cuda.is_available() else torch.float32
    print(f"[mesh] loading T2I from {T2I_DIR}", flush=True)
    pipe = StableDiffusionXLPipeline.from_pretrained(
        str(T2I_DIR),
        torch_dtype=dtype,
        variant="fp16",
        local_files_only=True,
    )
    pipe.to("cuda" if torch.cuda.is_available() else "cpu")
    pipe.set_progress_bar_config(disable=True)
    T2I_PIPE = pipe
    print("[mesh] T2I ready", flush=True)
    return pipe


def _t2i(prompt: str):
    import torch
    from PIL import Image

    pipe = _load_t2i()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    seed = int(uuid.uuid4().int % 2_147_483_647)
    generator = torch.Generator(device=device)
    generator.manual_seed(seed)
    image = pipe(
        prompt,
        num_inference_steps=T2I_STEPS,
        guidance_scale=0.0,
        width=T2I_SIZE,
        height=T2I_SIZE,
        generator=generator,
    ).images[0]
    if not isinstance(image, Image.Image):
        raise RuntimeError("T2I returned no image")
    return image.convert("RGB")


def _fit_dimensions(mesh, dimensions: dict[str, Any] | None):
    import numpy as np

    if dimensions is None:
        mesh.apply_translation(-mesh.centroid)
        mesh.apply_translation([0.0, float(-mesh.bounds[0, 1]), 0.0])
        return mesh
    extents = mesh.bounding_box.extents
    target = np.array(
        [
            float(dimensions.get("x") or extents[0] or 1.0),
            float(dimensions.get("y") or extents[1] or 1.0),
            float(dimensions.get("z") or extents[2] or 1.0),
        ],
        dtype=np.float64,
    )
    scale = np.where(extents > 1e-6, target / extents, 1.0)
    mesh.apply_scale(scale)
    mesh.apply_translation(-mesh.centroid)
    mesh.apply_translation([0.0, float(-mesh.bounds[0, 1]), 0.0])
    return mesh


def _generate(body: dict[str, Any]) -> dict[str, Any]:
    global LAST_TIMINGS
    import torch

    if TSR_MODEL is None:
        raise RuntimeError(LOAD_ERROR or "TripoSR not loaded")
    name = str(body.get("name") or "generated-mesh")
    role = str(body.get("role") or "")
    prompt = str(body.get("prompt") or body.get("sceneDescription") or "")
    object_id = str(body.get("objectId") or f"native-mesh-{uuid.uuid4().hex[:12]}")
    visual = _english_object(name, role, prompt)
    started = time.perf_counter()
    print(f"[mesh] t2i {object_id} {visual[:220]}", flush=True)
    image = _t2i(visual)
    t2i_ms = int((time.perf_counter() - started) * 1000)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    mesh_started = time.perf_counter()
    with torch.inference_mode():
        scene_codes = TSR_MODEL([image], device=device)
        meshes = TSR_MODEL.extract_mesh(
            scene_codes,
            True,
            resolution=MC_RESOLUTION,
        )
    mesh_ms = int((time.perf_counter() - mesh_started) * 1000)
    if not meshes:
        raise RuntimeError("TripoSR returned no mesh")
    mesh = meshes[0]
    dimensions = body.get("dimensions") if isinstance(body.get("dimensions"), dict) else None
    mesh = _fit_dimensions(mesh, dimensions)
    glb = mesh.export(file_type="glb")
    if isinstance(glb, str):
        glb = glb.encode("utf-8")
    raw = bytes(glb)
    if len(raw) < 12 or raw[:4] != b"glTF":
        raise RuntimeError("exported mesh was not a GLB")
    job_id = uuid.uuid4().hex
    timings = {
        "t2iMs": t2i_ms,
        "meshMs": mesh_ms,
        "totalMs": int((time.perf_counter() - started) * 1000),
    }
    LAST_TIMINGS = timings
    print(
        f"[mesh] done {object_id} bytes={len(raw)} t2i_ms={t2i_ms} mesh_ms={mesh_ms}",
        flush=True,
    )
    return {
        "jobId": job_id,
        "objectId": object_id,
        "glbBase64": base64.b64encode(raw).decode("ascii"),
        "provider": "triposr-i23d",
        "nativeMesh": True,
        "claimsWorldModelGeneration": False,
        "byteLength": len(raw),
        "timings": timings,
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stdout.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))
        sys.stdout.flush()

    def _send(self, code: int, payload: dict[str, Any]) -> None:
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:
        if self.path in ("/health", "/health/"):
            self._send(
                200,
                {
                    "ok": READY and LOAD_ERROR is None,
                    "ready": READY,
                    "nativeMesh": READY,
                    "provider": "triposr-i23d",
                    "claimsWorldModelGeneration": False,
                    "t2i": str(T2I_DIR),
                    "t2iLoaded": T2I_PIPE is not None,
                    "mcResolution": MC_RESOLUTION,
                    "t2iSteps": T2I_STEPS,
                    "lastTimings": LAST_TIMINGS,
                    "error": LOAD_ERROR,
                },
            )
            return
        self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:
        if self.path not in ("/v1/generate", "/v1/generate/"):
            self._send(404, {"ok": False, "error": "not found"})
            return
        length = int(self.headers.get("content-length") or "0")
        if length <= 0 or length > 12_000_000:
            self._send(413, {"ok": False, "error": "invalid request size"})
            return
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            if not isinstance(body, dict):
                raise ValueError("body must be an object")
        except Exception as exc:
            self._send(400, {"ok": False, "error": str(exc)})
            return
        try:
            with LOCK:
                result = _generate(body)
            self._send(200, result)
        except Exception as exc:
            traceback.print_exc()
            self._send(500, {"ok": False, "error": str(exc)})


def main() -> None:
    global LOAD_ERROR
    try:
        _load_tsr()
        _load_t2i()
    except Exception as exc:
        LOAD_ERROR = str(exc)
        traceback.print_exc()
        print(f"[mesh] startup failed: {exc}", flush=True)
        raise
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[mesh] listening on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
