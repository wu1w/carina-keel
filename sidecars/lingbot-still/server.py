#!/usr/bin/env python3
"""LingBot-World clip sidecar for Carina look.

Bake a seed still from the player's request (T2I), then I2V that seed into
a short clip. I2V stays on AIGA. Not graph truth.
"""

from __future__ import annotations

import base64
import json
import os
import re
import sys
import threading
import time
import traceback
import tempfile
import urllib.request
import urllib.error
from camera_path import write_camera_path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from typing import Any

os.environ.setdefault("HIP_VISIBLE_DEVICES", "0")
os.environ.setdefault("CUDA_VISIBLE_DEVICES", "0")
os.environ.setdefault("PYTORCH_HIP_ALLOC_CONF", "expandable_segments:True")

ROOT = Path(__file__).resolve().parent
REPO = Path(os.environ.get("LINGBOT_REPO", str(ROOT)))
CKPT = Path(
    os.environ.get(
        "LINGBOT_CKPT",
        "/data/disk1/models/lingbot-world-v2-1.3b-bundle",
    )
)
SEED = Path(
    os.environ.get(
        "LINGBOT_SEED",
        str(REPO / "examples/03/image.jpg"),
    )
)
ACTION = Path(os.environ.get("LINGBOT_ACTION", str(REPO / "examples/03")))
STILL_DIR = Path(
    os.environ.get("LINGBOT_STILL_DIR", "/data/disk1/models/lingbot-stills")
)
T2I_DIR = Path(os.environ.get("LINGBOT_T2I", "/data/disk1/models/sdxl-turbo"))
T2I_STEPS = int(os.environ.get("LINGBOT_T2I_STEPS", "4"))
T2I_WIDTH = int(os.environ.get("LINGBOT_T2I_WIDTH", "832"))
T2I_HEIGHT = int(os.environ.get("LINGBOT_T2I_HEIGHT", "480"))
HOST = os.environ.get("LINGBOT_STILL_HOST", "127.0.0.1")
PORT = int(os.environ.get("LINGBOT_STILL_PORT", "18791"))
FRAME_NUM = int(os.environ.get("LINGBOT_FRAME_NUM", "13"))
SIZE = os.environ.get("LINGBOT_SIZE", "480*832")
CLIP_FPS = float(os.environ.get("LINGBOT_CLIP_FPS", "8"))
JPEG_QUALITY = int(os.environ.get("LINGBOT_JPEG_QUALITY", "75"))

sys.path.insert(0, str(REPO))

LOCK = threading.Lock()
PIPE = None
T2I_PIPE = None


def _safe_place_id(place_id: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_-]", "_", place_id)
    return cleaned[:80] or "place"


def _entity_names(body: dict[str, Any]) -> list[str]:
    names: list[str] = []
    for entity in body.get("entities") or []:
        if not isinstance(entity, dict):
            continue
        name = entity.get("name") or entity.get("id")
        if not isinstance(name, str) or not name:
            continue
        if re.fullmatch(r"[\u4e00-\u9fff]{1,6}", name):
            continue
        names.append(name)
    return names


def _scene_english(place_name: str) -> str:
    text = place_name.strip()
    lower = text.lower()
    tavern = any(token in text for token in ("酒馆", "客栈")) or any(
        token in lower for token in ("tavern", "inn", "pub")
    )
    lake = "湖" in text or "lake" in lower
    if tavern and lake:
        return (
            "first-person view inside a wooden lakeside tavern at dusk, "
            "oak bar and tables, warm lanterns and a fireplace, mugs and barrels, "
            "lake and mountains visible through the windows"
        )
    if tavern:
        return (
            "first-person view inside a wooden tavern, warm lanterns, "
            "oak bar, people at tables"
        )
    if text:
        return f"first-person view of {text}"
    return "first-person view of this place"


def _shot_key(body: dict[str, Any]) -> str:
    style = body.get("style")
    if isinstance(style, str) and style.strip():
        return style.strip()
    if body.get("fresh") is True:
        intent = body.get("intent")
        if isinstance(intent, str) and intent.strip():
            return intent.strip()
    return ""


PHOTOREAL = (
    "Photorealistic first-person game view, coherent geometry, "
    "natural idle motion, flickering light, no text overlay, "
    "no watermark, no subtitles, no logo."
)


def _visual_prompt(body: dict[str, Any], *, for_seed: bool) -> str:
    style = body.get("style") if isinstance(body.get("style"), str) else ""
    intent = body.get("intent") if isinstance(body.get("intent"), str) else ""
    camera = body.get("camera") if isinstance(body.get("camera"), str) else ""
    style = style.strip()
    intent = intent.strip()
    camera = camera.strip()
    if style:
        bits = [style]
        if camera:
            bits.append("Camera: " + camera + ".")
        bits.append(PHOTOREAL)
        return " ".join(bits)
    place = str(body.get("placeName") or "").strip()
    brief = (intent if for_seed else "") or place
    bits = [_scene_english(brief or place)]
    if brief and brief not in bits[0]:
        bits.append(brief)
    if camera:
        bits.append("Camera: " + camera + ".")
    bits.append(PHOTOREAL)
    return " ".join(bits)


def _still_path(place_id: str) -> Path:
    return STILL_DIR / f"{_safe_place_id(place_id)}.jpg"


def _brief_path(place_id: str) -> Path:
    return STILL_DIR / f"{_safe_place_id(place_id)}.brief"


def _need_new_seed(place_id: str, body: dict[str, Any]) -> bool:
    if body.get("fresh") is True:
        return True
    return not _still_path(place_id).is_file()


def _jpeg_b64(image: Any) -> str:
    buf = BytesIO()
    image.save(buf, format="JPEG", quality=JPEG_QUALITY)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _tensor_to_image(frame: Any) -> Any:
    import numpy as np
    import torch
    from PIL import Image

    arr = (
        ((frame.clamp(-1, 1) + 1.0) / 2.0 * 255.0)
        .to(torch.uint8)
        .permute(1, 2, 0)
        .cpu()
        .numpy()
    )
    return Image.fromarray(np.ascontiguousarray(arr))


def _load_t2i():
    global T2I_PIPE
    if T2I_PIPE is not None:
        return T2I_PIPE
    if not T2I_DIR.is_dir() or not any(T2I_DIR.iterdir()):
        raise RuntimeError(f"T2I model missing at {T2I_DIR}")
    import torch
    from diffusers import StableDiffusionXLPipeline

    dtype = torch.float16 if torch.cuda.is_available() else torch.float32
    print(f"[still] loading T2I from {T2I_DIR}", flush=True)
    pipe = StableDiffusionXLPipeline.from_pretrained(
        str(T2I_DIR),
        torch_dtype=dtype,
        variant="fp16",
        local_files_only=True,
    )
    pipe.to("cuda")
    pipe.set_progress_bar_config(disable=True)
    T2I_PIPE = pipe
    print("[still] T2I ready", flush=True)
    return pipe


def _bake_seed(prompt: str) -> Any:
    from PIL import Image

    pipe = _load_t2i()
    seed = int(time.time() * 1000) % 2_147_483_647
    print(f"[still] t2i rng={seed} prompt={prompt[:220]}", flush=True)
    image = pipe(
        prompt,
        num_inference_steps=T2I_STEPS,
        guidance_scale=0.0,
        width=T2I_WIDTH,
        height=T2I_HEIGHT,
        generator=torch_generator(seed),
    ).images[0]
    if not isinstance(image, Image.Image):
        raise RuntimeError("T2I returned no image")
    return image.convert("RGB")


def torch_generator(seed: int) -> Any:
    import torch

    generator = torch.Generator(device="cuda")
    generator.manual_seed(seed)
    return generator


def _load_pipe():
    global PIPE
    import torch
    from PIL import Image

    import wan
    from wan.configs import WAN_CONFIGS

    cfg = WAN_CONFIGS["i2v-A14B"]
    print(f"[still] loading WanI2VCausal from {CKPT}", flush=True)
    pipe = wan.WanI2VCausal(
        config=cfg,
        checkpoint_dir=str(CKPT),
        device_id=0,
        rank=0,
        t5_fsdp=False,
        dit_fsdp=False,
        use_sp=False,
        t5_cpu=True,
        convert_model_dtype=False,
        local_attn_size=18,
        sink_size=6,
        infer_mode="causal_fast",
    )
    img = Image.open(SEED).convert("RGB")
    w, h = img.size
    max_area = 480 * 832
    try:
        pipe.prewarm(img, max_area=max_area, frame_num=FRAME_NUM)
        print("[still] prewarm done", flush=True)
    except Exception as exc:
        print(f"[still] prewarm skipped: {exc}", flush=True)
    PIPE = pipe
    print(f"[still] ready gpu={torch.cuda.get_device_name(0)} seed={w}x{h}", flush=True)
    return pipe


def _generate_still(body: dict[str, Any]) -> dict[str, Any]:
    from wan.configs import MAX_AREA_CONFIGS
    from PIL import Image

    place_id = str(body.get("placeId") or "place")
    bake = _need_new_seed(place_id, body)
    prompt = _visual_prompt(body, for_seed=bake)
    still_path = _still_path(place_id)
    if bake:
        img = _bake_seed(prompt)
        STILL_DIR.mkdir(parents=True, exist_ok=True)
        img.save(still_path, format="JPEG", quality=90)
        _brief_path(place_id).write_text(_shot_key(body) or prompt, encoding="utf-8")
        seed_note = "t2i"
    else:
        img = Image.open(still_path).convert("RGB")
        seed_note = str(still_path)
    pipe = PIPE
    if pipe is None:
        raise RuntimeError("pipeline not loaded")

    seed = int(time.time() * 1000) % 2_147_483_647
    print(
        f"[still] generate place={place_id} bake={bake} seed_img={seed_note} rng={seed} prompt={prompt[:180]}",
        flush=True,
    )
    video = pipe.generate(
        prompt,
        img,
        action_path=str(ACTION),
        chunk_size=4,
        max_area=MAX_AREA_CONFIGS[SIZE],
        frame_num=FRAME_NUM,
        shift=10.0,
        seed=seed,
        offload_model=False,
    )
    if video is None:
        raise RuntimeError("generate returned empty video")

    frames: list[str] = []
    last = None
    for index in range(int(video.shape[1])):
        last = _tensor_to_image(video[:, index].detach())
        frames.append(_jpeg_b64(last))
    if last is None:
        raise RuntimeError("generate produced no frames")

    STILL_DIR.mkdir(parents=True, exist_ok=True)
    last.save(still_path, format="JPEG", quality=90)
    return {
        "ok": True,
        "okSeed": bake,
        "mime": "image/jpeg",
        "base64": frames[-1],
        "width": last.size[0],
        "height": last.size[1],
        "path": str(still_path),
        "prompt": prompt,
        "clip": {
            "mime": "image/jpeg",
            "fps": CLIP_FPS,
            "frames": frames,
            "width": last.size[0],
            "height": last.size[1],
        },
    }


def _generate_exploration(body):
    """Branch from immutable caller seed. Never overwrite the live world's still."""
    from PIL import Image
    from wan.configs import MAX_AREA_CONFIGS
    raw = base64.b64decode(body['base64'], validate=True)
    img = Image.open(BytesIO(raw)).convert('RGB')
    direction = body['direction']
    fov = float(body.get('fovY', 1.05))
    with tempfile.TemporaryDirectory(prefix='carina-camera-') as directory:
        delta = write_camera_path(Path(directory), direction, fov, FRAME_NUM)
        prompt = ('Continuous first person exploration of the exact same scene in the input image. '
                  'Preserve architecture, materials, lighting, objects and spatial layout. '
                  'Smooth camera motion, no cuts, no new style, no text.')
        video = PIPE.generate(prompt, img, action_path=directory, chunk_size=4,
                              max_area=MAX_AREA_CONFIGS[SIZE], frame_num=FRAME_NUM,
                              shift=10.0, seed=int(body.get('seed', 1234)), offload_model=False)
        if video is None:
            raise RuntimeError('no generated view')
        last = _tensor_to_image(video[:, -1].detach())
        return dict(ok=True, mime='image/jpeg', base64=_jpeg_b64(last),
                    width=last.width, height=last.height, cameraDelta=delta,
                    cameraConditioning='numeric-opencv', frameCount=int(video.shape[1]))


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

    def _proxy_depth(self, body=None):
        # Both public services use the existing world-model tunnel; CPU work stays independent.
        target = os.environ.get("LINGBOT_DEPTH_URL", "http://127.0.0.1:18792").rstrip("/") + self.path
        try:
            request = urllib.request.Request(target, data=body, headers={"content-type":"application/json"})
            with urllib.request.urlopen(request, timeout=90) as response:
                self._send(response.status, json.load(response))
        except Exception:
            self._send(503, {"ok":False, "error":"depth service unavailable"})

    def do_GET(self) -> None:
        if self.path.startswith("/world/"):
            self._proxy_depth()
            return
        if self.path in ("/health", "/health/"):
            t2i_ready = T2I_DIR.is_dir() and any(T2I_DIR.iterdir())
            self._send(
                200,
                {
                    "ok": True,
                    "ready": PIPE is not None,
                    "exploration": "numeric-camera-v1",
                    "ckpt": str(CKPT),
                    "t2i": str(T2I_DIR),
                    "t2iReady": t2i_ready,
                    "t2iLoaded": T2I_PIPE is not None,
                },
            )
            return
        if self.path.startswith("/stills/"):
            name = _safe_place_id(self.path.rsplit("/", 1)[-1].split("?")[0].removesuffix(".jpg"))
            path = STILL_DIR / f"{name}.jpg"
            if not path.is_file():
                self._send(404, {"ok": False, "error": "not found"})
                return
            self.send_response(200)
            self.send_header("content-type", "image/jpeg")
            data = path.read_bytes()
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:
        if self.path == "/reconstruct":
            length=int(self.headers.get("content-length") or "0")
            if not 0 < length <= 12_000_000:
                self._send(413, {"ok":False, "error":"invalid request size"})
                return
            self._proxy_depth(self.rfile.read(length))
            return
        if self.path not in ("/v1/still", "/v1/still/", "/v1/explore"):
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
        if self.path == "/v1/explore":
            # Speculative work yields immediately to an already-running generation.
            if not LOCK.acquire(blocking=False):
                self._send(429, {"ok": False, "error": "generation busy"})
                return
            try:
                self._send(200, _generate_exploration(body))
            except Exception as exc:
                traceback.print_exc()
                self._send(500, {"ok": False, "error": str(exc)})
            finally:
                LOCK.release()
            return
        try:
            with LOCK:
                result = _generate_still(body)
            self._send(200, result)
        except Exception as exc:
            traceback.print_exc()
            self._send(500, {"ok": False, "error": str(exc)})


def main() -> None:
    STILL_DIR.mkdir(parents=True, exist_ok=True)
    _load_pipe()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[still] listening on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
