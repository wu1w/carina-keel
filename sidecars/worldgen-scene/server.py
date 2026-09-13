#!/usr/bin/env python3
"""
zh: WorldGen 空间生成 sidecar（Windows RTX 5070 Ti）。自然语言 → FLUX.1-dev 全景（WorldGen LoRA）
    → DA-2 360° 深度 → 球面网格 → 带贴图 GLB。这是「整空间」世界模型候选，不是 TripoSR 单件。
en: WorldGen scene sidecar (Windows RTX 5070 Ti). Text → FLUX.1-dev panorama (WorldGen LoRA)
    → DA-2 360° depth → spherical mesh → textured GLB. A whole-space world-model candidate,
    not a per-object TripoSR mesh.

合同 / Contract (same shape as sidecars/native-mesh):
  GET  /health
  POST /v1/generate  {prompt|sceneDescription, objectId?, seed?, steps?, cameraHeightM?}
       -> {jobId, objectId, glbBase64, provider, nativeMesh, claimsWorldModelGeneration: true,
           source, scale, bounds, timings, licenses}
  GET  /v1/jobs/{jobId}/glb            (model/gltf-binary)
  GET  /v1/jobs/{jobId}/panorama.jpg   (image/jpeg)
  POST /v1/jobs/{jobId}/cancel         (best-effort; a running diffusion step is not interrupted)

诚实边界 / Honesty:
  - 尺度来自单目 360° 深度 + 相机高度先验，`scale.confidence = "low"`。米制承诺要靠 Carina 校准。
  - 单视点球面网格：背面与遮挡区域没有几何。`coverage = "single-viewpoint"`。
  - FLUX.1-dev 权重是非商业许可；WorldGen LoRA Apache-2.0；DA-2 见其仓库。
"""
from __future__ import annotations

import base64
import io
import json
import os
import sys
import threading
import time
import traceback
import types
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

HOST = os.environ.get("CARINA_WORLDGEN_HOST", "127.0.0.1")
PORT = int(os.environ.get("CARINA_WORLDGEN_PORT", "18796"))
OUT_DIR = Path(os.environ.get("CARINA_WORLDGEN_OUT", str(Path.cwd() / "jobs")))
FLUX_BASE = os.environ.get("CARINA_WORLDGEN_FLUX_BASE", "camenduru/FLUX.1-dev-diffusers")
NUNCHAKU_REPO = os.environ.get("CARINA_WORLDGEN_NUNCHAKU", "nunchaku-tech/nunchaku-flux.1-dev")
NUNCHAKU_T5 = os.environ.get(
    "CARINA_WORLDGEN_T5", "nunchaku-tech/nunchaku-t5/awq-int4-flux.1-t5xxl.safetensors"
)
LORA_REPO = os.environ.get("CARINA_WORLDGEN_LORA_REPO", "LeoXie/WorldGen")
LORA_FILE = os.environ.get(
    "CARINA_WORLDGEN_LORA_FILE", "models--WorldGen-Flux-Lora/worldgen_text2scene.safetensors"
)
PANO_W = int(os.environ.get("CARINA_WORLDGEN_PANO_W", "1600"))
PANO_H = PANO_W // 2
STEPS = int(os.environ.get("CARINA_WORLDGEN_STEPS", "28"))
GUIDANCE = float(os.environ.get("CARINA_WORLDGEN_GUIDANCE", "7.0"))
MESH_W = int(os.environ.get("CARINA_WORLDGEN_MESH_W", "800"))
CAMERA_HEIGHT_M = float(os.environ.get("CARINA_WORLDGEN_CAMERA_HEIGHT_M", "1.6"))
EDGE_RATIO = float(os.environ.get("CARINA_WORLDGEN_EDGE_RATIO", "1.6"))
SKIP_FLUX = os.environ.get("CARINA_WORLDGEN_SKIP_FLUX", "") == "1"  # depth+mesh only, needs panorama input

LOCK = threading.Lock()
READY = False
LOAD_ERROR: str | None = None
PIPE: Any = None
DEPTH_MODEL: Any = None
PRECISION = "unknown"
LAST_TIMINGS: dict[str, int] | None = None
JOBS: dict[str, dict[str, Any]] = {}


def _disable_xformers() -> None:
    """zh: xformers 0.0.35 没有 sm_120（Blackwell）内核；DA-2 的 DINOv2 在 import 失败时自动回退到
    纯 torch 注意力。这里让 `import xformers` 直接抛 ImportError。可用 WORLDGEN_XFORMERS=1 关闭。
    en: xformers 0.0.35 ships no sm_120 kernels; DA-2's DINOv2 falls back to plain torch attention
    when the import fails, so make `import xformers` raise. Set WORLDGEN_XFORMERS=1 to keep it."""
    if os.environ.get("WORLDGEN_XFORMERS") == "1":
        return
    for name in list(sys.modules):
        if name == "xformers" or name.startswith("xformers."):
            del sys.modules[name]
    sys.modules["xformers"] = None  # type: ignore[assignment]
    sys.modules["xformers.ops"] = None  # type: ignore[assignment]
    print("[worldgen] xformers disabled (no sm_120 kernels); DA-2 uses torch attention", flush=True)


def _stub_pytorch3d() -> None:
    """zh: worldgen 包顶层会 import pytorch3d（splat 路径）。网格路径不用它，装个最小替身。
    en: worldgen's package init imports pytorch3d for the splat path. Mesh path does not need it."""
    try:
        import pytorch3d  # noqa: F401

        return
    except Exception:
        pass
    import torch

    def quaternion_to_matrix(q: "torch.Tensor") -> "torch.Tensor":
        r, i, j, k = torch.unbind(q, -1)
        two_s = 2.0 / (q * q).sum(-1)
        o = torch.stack(
            (
                1 - two_s * (j * j + k * k), two_s * (i * j - k * r), two_s * (i * k + j * r),
                two_s * (i * j + k * r), 1 - two_s * (i * i + k * k), two_s * (j * k - i * r),
                two_s * (i * k - j * r), two_s * (j * k + i * r), 1 - two_s * (i * i + j * j),
            ),
            -1,
        )
        return o.reshape(q.shape[:-1] + (3, 3))

    def matrix_to_quaternion(m: "torch.Tensor") -> "torch.Tensor":
        raise NotImplementedError("pytorch3d stub: splat path not supported in this sidecar")

    pkg = types.ModuleType("pytorch3d")
    tr = types.ModuleType("pytorch3d.transforms")
    tr.quaternion_to_matrix = quaternion_to_matrix  # type: ignore[attr-defined]
    tr.matrix_to_quaternion = matrix_to_quaternion  # type: ignore[attr-defined]
    pkg.transforms = tr  # type: ignore[attr-defined]
    sys.modules["pytorch3d"] = pkg
    sys.modules["pytorch3d.transforms"] = tr


def _load_models() -> None:
    global PIPE, DEPTH_MODEL, PRECISION, READY
    import torch
    from huggingface_hub import hf_hub_download, snapshot_download

    _disable_xformers()
    _stub_pytorch3d()
    from worldgen.pano_depth import build_depth_model

    t0 = time.perf_counter()
    print("[worldgen] loading DA-2 depth", flush=True)
    # DA-2's SphereViT stores whatever is passed to `.to()` as `model.device`; WorldGen's
    # pano_depth then reads `model.device.type`, so it must be a torch.device, not "cuda".
    DEPTH_MODEL = build_depth_model(torch.device("cuda"))
    if isinstance(getattr(DEPTH_MODEL, "device", None), str):
        DEPTH_MODEL.device = torch.device(DEPTH_MODEL.device)
    print(f"[worldgen] DA-2 ready in {time.perf_counter() - t0:.1f}s", flush=True)

    if SKIP_FLUX:
        READY = True
        return

    from nunchaku import NunchakuFluxTransformer2dModel
    from nunchaku.utils import get_precision
    from worldgen.models.flux_pano_gen_pipeline import FluxPipeline
    from worldgen.utils.lora_utils import load_and_fix_lora

    PRECISION = get_precision()  # "fp4" on Blackwell, "int4" otherwise
    print(f"[worldgen] nunchaku precision {PRECISION}", flush=True)
    t1 = time.perf_counter()
    transformer = NunchakuFluxTransformer2dModel.from_pretrained(
        f"{NUNCHAKU_REPO}/svdq-{PRECISION}_r32-flux.1-dev.safetensors",
        offload=True,
    )
    print(f"[worldgen] transformer ready in {time.perf_counter() - t1:.1f}s", flush=True)

    # zh: 基座只拿 VAE / 文本编码器 / 分词器 / 调度器，不下载 24GB bf16 transformer。
    # en: Base repo only for VAE / text encoders / tokenizers / scheduler; skip the 24GB transformer.
    base_dir = snapshot_download(
        FLUX_BASE,
        allow_patterns=[
            "model_index.json",
            "scheduler/*",
            "text_encoder/*",
            "text_encoder_2/*",
            "tokenizer/*",
            "tokenizer_2/*",
            "vae/*",
        ],
    )
    text_encoder_2 = None
    try:
        from nunchaku import NunchakuT5EncoderModel

        text_encoder_2 = NunchakuT5EncoderModel.from_pretrained(NUNCHAKU_T5)
        print("[worldgen] T5 = nunchaku awq-int4", flush=True)
    except Exception as exc:  # fall back to bf16 T5 from base repo
        print(f"[worldgen] nunchaku T5 unavailable ({exc}); using bf16 T5", flush=True)
    kwargs: dict[str, Any] = {"transformer": transformer, "torch_dtype": torch.bfloat16}
    if text_encoder_2 is not None:
        kwargs["text_encoder_2"] = text_encoder_2
    PIPE = FluxPipeline.from_pretrained(base_dir, **kwargs)

    lora_path = hf_hub_download(repo_id=LORA_REPO, filename=LORA_FILE)
    state_dict, _ = load_and_fix_lora(lora_path)
    transformer.update_lora_params(state_dict)
    PIPE.enable_model_cpu_offload()
    PIPE.enable_vae_tiling()
    READY = True
    print(f"[worldgen] pipeline ready in {time.perf_counter() - t0:.1f}s", flush=True)


def _gen_panorama(prompt: str, seed: int, steps: int):
    import torch

    full = f"A high quality 360 panorama photo of, {prompt}, HDR, RAW, 360 consistent, omnidirectional"
    generator = torch.Generator("cpu").manual_seed(seed)
    out = PIPE(
        full,
        height=PANO_H,
        width=PANO_W,
        generator=generator,
        num_inference_steps=steps,
        blend_extend=6,
        guidance_scale=GUIDANCE,
    )
    return out.images[0]


def _depth(image):
    from worldgen.pano_depth import pred_pano_depth

    pred = pred_pano_depth(DEPTH_MODEL, image)
    return pred["distance"].detach().float().cpu().numpy()  # (H, W), max normalised to 20


def _rays(h: int, w: int):
    import numpy as np

    u = (np.arange(w, dtype=np.float32) + 0.5) / w
    v = (np.arange(h, dtype=np.float32) + 0.5) / h
    vv, uu = np.meshgrid(v, u, indexing="ij")
    phi = uu * 2 * np.pi - np.pi
    theta = vv * np.pi - np.pi / 2
    # zh: WorldGen 原约定 y 向下（上边 theta=-pi/2 → y=-1）。这里直接改成 glTF 的 Y-up，
    #     并翻转 x 保持右手系（等价于绕 z 轴转 180°）。
    # en: WorldGen's convention is y-down. Emit glTF Y-up and flip x to keep handedness
    #     (a 180° rotation about z).
    x = -np.cos(theta) * np.sin(phi)
    y = -np.sin(theta)
    z = np.cos(theta) * np.cos(phi)
    return np.stack((x, y, z), axis=-1).astype(np.float32), uu, vv


ROOM_HEIGHT_M = float(os.environ.get("WORLDGEN_ROOM_HEIGHT_M", "3.0"))
PLAUSIBLE_ROOM_HEIGHT = (2.2, 6.0)


def _pole_vertical(distance, top: bool):
    """Median vertical (up/down) component over the top or bottom ~2% rows."""
    import numpy as np

    h = distance.shape[0]
    rows = max(2, h // 50)
    if top:
        v = (np.arange(0, rows, dtype=np.float32) + 0.5) / h
        band = distance[:rows, :]
    else:
        v = (np.arange(h - rows, h, dtype=np.float32) + 0.5) / h
        band = distance[h - rows :, :]
    theta = v * np.pi - np.pi / 2  # -pi/2 at zenith, +pi/2 at nadir
    vertical = np.abs(band * np.sin(theta)[:, None])
    return float(np.median(vertical))


def _scale_from_camera_height(distance, camera_height_m: float):
    """zh: 尺度先验。主估计：脚下地面竖直距离 = 相机高度（1.6 m）。交叉检查：地面+天花板竖直距离
    应对应 2.2–6 m 层高；DA-2 在两极的相对深度不稳（2026-09-13 同一 prompt 两次跑出 4 m / 22 m
    房宽），主估计不合理时退回层高先验（3.0 m）。两条估计都记录，置信度始终 low。
    en: Scale prior. Primary: nadir vertical = camera height. Cross-check: nadir + zenith vertical
    should be a plausible room height; if not, fall back to the room-height prior. Both recorded."""
    import numpy as np

    nadir = _pole_vertical(distance, top=False)
    zenith = _pole_vertical(distance, top=True)
    info = {"nadirDistanceRaw": nadir, "zenithDistanceRaw": zenith}
    if not np.isfinite(nadir) or nadir <= 1e-3:
        return 1.0, {**info, "method": "unit", "impliedRoomHeightM": None}
    by_camera = camera_height_m / nadir
    implied_height = (nadir + zenith) * by_camera if np.isfinite(zenith) else None
    info["impliedRoomHeightM"] = implied_height
    if (
        implied_height is not None
        and PLAUSIBLE_ROOM_HEIGHT[0] <= implied_height <= PLAUSIBLE_ROOM_HEIGHT[1]
    ):
        return by_camera, {**info, "method": "camera-height-prior"}
    if np.isfinite(zenith) and (nadir + zenith) > 1e-3:
        by_room = ROOM_HEIGHT_M / (nadir + zenith)
        return by_room, {**info, "method": "room-height-prior", "roomHeightM": ROOM_HEIGHT_M}
    return by_camera, {**info, "method": "camera-height-prior"}


def _build_mesh(pano_image, distance, camera_height_m: float, mesh_w: int, edge_ratio: float):
    import numpy as np
    import trimesh
    from PIL import Image

    h_src, w_src = distance.shape
    mesh_h = mesh_w // 2
    # zh: 距离图重采样到网格分辨率（最近邻，避免在深度边缘插值出假中间值）。
    # en: Resample distance to mesh grid with nearest neighbour (no fake mid-depths at edges).
    ys = (np.linspace(0, h_src - 1, mesh_h)).round().astype(np.int64)
    xs = (np.linspace(0, w_src - 1, mesh_w)).round().astype(np.int64)
    d = distance[ys][:, xs].astype(np.float32)

    scale, scale_info = _scale_from_camera_height(distance, camera_height_m)
    d = d * scale

    rays, uu, vv = _rays(mesh_h, mesh_w)
    verts = (d[..., None] * rays).reshape(-1, 3)
    # put the floor (scaled nadir distance below the camera) at y = 0
    nadir = float(scale_info.get("nadirDistanceRaw") or 0.0)
    eye_height = nadir * scale if nadir > 1e-3 else camera_height_m
    verts[:, 1] += eye_height
    uv = np.stack((uu.reshape(-1), 1.0 - vv.reshape(-1)), axis=-1).astype(np.float32)

    # faces with wrap-around in the column direction so the sphere closes
    row = np.repeat(np.arange(mesh_h - 1), mesh_w)
    col = np.tile(np.arange(mesh_w), mesh_h - 1)
    col_next = (col + 1) % mesh_w
    tl = row * mesh_w + col
    tr = row * mesh_w + col_next
    bl = (row + 1) * mesh_w + col
    br = (row + 1) * mesh_w + col_next
    quads = np.stack((tl, tr, bl, br), axis=1)

    # drop stretched quads across depth discontinuities
    dq = d.reshape(-1)[quads]
    keep = (dq.max(axis=1) / np.maximum(dq.min(axis=1), 1e-6)) <= edge_ratio
    # the seam column's UV would jump from ~1 to ~0; give those quads their own duplicate vertices
    seam = col == mesh_w - 1
    quads_keep = quads[keep & ~seam]
    faces = np.concatenate(
        (quads_keep[:, [0, 2, 1]], quads_keep[:, [1, 2, 3]]), axis=0
    )  # wound so normals face the origin (inside view)
    seam_quads = quads[keep & seam]
    if len(seam_quads) > 0:
        # duplicate the wrap vertices with u = 1.0
        dup_idx = np.unique(seam_quads[:, [1, 3]].reshape(-1))
        dup_map = {int(i): len(verts) + n for n, i in enumerate(dup_idx)}
        verts = np.concatenate((verts, verts[dup_idx]), axis=0)
        uv_dup = uv[dup_idx].copy()
        uv_dup[:, 0] = 1.0
        uv = np.concatenate((uv, uv_dup), axis=0)
        sq = seam_quads.copy()
        sq[:, 1] = [dup_map[int(i)] for i in sq[:, 1]]
        sq[:, 3] = [dup_map[int(i)] for i in sq[:, 3]]
        faces = np.concatenate((faces, sq[:, [0, 2, 1]], sq[:, [1, 2, 3]]), axis=0)

    # zh: 统一让法线朝向相机（室内视角）。 en: Wind every face so its normal faces the camera.
    tri = verts[faces]
    fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    centre = tri.mean(axis=1) - np.array([0.0, camera_height_m, 0.0], dtype=np.float32)
    outward = (fn * centre).sum(axis=1) > 0
    faces[outward] = faces[outward][:, ::-1]

    tex = pano_image.convert("RGB")
    if tex.width > 2048:
        tex = tex.resize((2048, 1024), Image.LANCZOS)
    material = trimesh.visual.material.PBRMaterial(
        name="worldgen-panorama",
        baseColorTexture=tex,
        metallicFactor=0.0,
        roughnessFactor=1.0,
        doubleSided=True,
    )
    mesh = trimesh.Trimesh(
        vertices=verts.astype(np.float32),
        faces=faces.astype(np.int64),
        visual=trimesh.visual.TextureVisuals(uv=uv, material=material),
        process=False,
    )
    bounds = mesh.bounds
    dropped = int((~keep).sum())
    return mesh, {
        "factor": float(scale),
        **{k: (float(v) if isinstance(v, (int, float)) else v) for k, v in scale_info.items()},
        "cameraHeightM": camera_height_m,
        "eyeHeightM": float(eye_height),
        "confidence": "low",
        "note": "DA-2 output is scale-invariant (normalised to max 20). Metric claims require Carina calibration.",
    }, {
        "min": {"x": float(bounds[0][0]), "y": float(bounds[0][1]), "z": float(bounds[0][2])},
        "max": {"x": float(bounds[1][0]), "y": float(bounds[1][1]), "z": float(bounds[1][2])},
    }, {"vertices": int(len(verts)), "faces": int(len(faces)), "quadsDroppedAtEdges": dropped}


def _generate(body: dict[str, Any]) -> dict[str, Any]:
    global LAST_TIMINGS
    from PIL import Image

    if not READY:
        raise RuntimeError(LOAD_ERROR or "models not loaded")
    prompt = str(body.get("prompt") or body.get("sceneDescription") or "").strip()
    if not prompt:
        raise ValueError("prompt required")
    # `prompt` is the English visual prompt (the LoRA is English-only; Chinese text yields the FLUX
    # default aerial city). `sceneDescription` is the user's original text, kept for provenance.
    scene_description = str(body.get("sceneDescription") or prompt).strip()
    object_id = str(body.get("objectId") or f"space-{uuid.uuid4().hex[:12]}")
    seed = int(body.get("seed") or 42)
    steps = int(body.get("steps") or STEPS)
    camera_height = float(body.get("cameraHeightM") or CAMERA_HEIGHT_M)
    job_id = uuid.uuid4().hex
    job_dir = OUT_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    JOBS[job_id] = {"status": "running", "dir": str(job_dir)}

    started = time.perf_counter()
    pano_b64 = body.get("panoramaBase64")
    if isinstance(pano_b64, str) and pano_b64:
        pano = Image.open(io.BytesIO(base64.b64decode(pano_b64))).convert("RGB")
        pano_ms = 0
        pano_source = "client-supplied"
    else:
        if PIPE is None:
            raise RuntimeError("FLUX pipeline not loaded (CARINA_WORLDGEN_SKIP_FLUX=1)")
        print(f"[worldgen] pano {object_id} seed={seed} steps={steps} :: {prompt[:200]}", flush=True)
        pano = _gen_panorama(prompt, seed, steps)
        pano_ms = int((time.perf_counter() - started) * 1000)
        pano_source = f"FLUX.1-dev ({NUNCHAKU_REPO} svdq-{PRECISION}) + {LORA_REPO}/{LORA_FILE}"
    pano.save(job_dir / "panorama.jpg", quality=92)

    t_depth = time.perf_counter()
    distance = _depth(pano)
    depth_ms = int((time.perf_counter() - t_depth) * 1000)
    try:
        import numpy as np

        np.save(job_dir / "distance.npy", distance.astype("float16"))
    except Exception:
        pass

    t_mesh = time.perf_counter()
    mesh, scale, bounds, stats = _build_mesh(pano, distance, camera_height, MESH_W, EDGE_RATIO)
    glb = mesh.export(file_type="glb")
    raw = bytes(glb) if not isinstance(glb, str) else glb.encode("utf-8")
    if len(raw) < 12 or raw[:4] != b"glTF":
        raise RuntimeError("exported mesh was not a GLB")
    (job_dir / "scene.glb").write_bytes(raw)
    mesh_ms = int((time.perf_counter() - t_mesh) * 1000)

    timings = {
        "panoramaMs": pano_ms,
        "depthMs": depth_ms,
        "meshMs": mesh_ms,
        "totalMs": int((time.perf_counter() - started) * 1000),
    }
    LAST_TIMINGS = timings
    result = {
        "jobId": job_id,
        "objectId": object_id,
        "glbBase64": base64.b64encode(raw).decode("ascii"),
        "glbUrl": f"/v1/jobs/{job_id}/glb",
        "panoramaUrl": f"/v1/jobs/{job_id}/panorama.jpg",
        "provider": "worldgen-flux-pano-da2",
        "nativeMesh": True,
        "claimsWorldModelGeneration": True,
        "coverage": "single-viewpoint",
        "source": {
            "panorama": pano_source,
            "depth": "haodongli/DA-2 (SphereViT, 360 depth)",
            "meshing": "spherical grid, wrap-closed, edge quads dropped at ratio > %.2f" % EDGE_RATIO,
            "prompt": prompt,
            "sceneDescription": scene_description,
            "seed": seed,
            "steps": steps,
            "panoramaSize": [pano.width, pano.height],
        },
        "scale": scale,
        "bounds": bounds,
        "mesh": stats,
        "byteLength": len(raw),
        "timings": timings,
        "licenses": {
            "FLUX.1-dev": "FLUX.1 [dev] Non-Commercial License",
            "WorldGen": "Apache-2.0",
            "DA-2": "see https://github.com/EnVision-Research/DA-2",
        },
    }
    (job_dir / "result.json").write_text(
        json.dumps({k: v for k, v in result.items() if k != "glbBase64"}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    JOBS[job_id]["status"] = "done"
    print(f"[worldgen] done {object_id} bytes={len(raw)} {timings}", flush=True)
    return result


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

    def _send_bytes(self, code: int, raw: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:
        if self.path in ("/health", "/health/"):
            import torch

            free, total = (0, 0)
            try:
                free, total = torch.cuda.mem_get_info()
            except Exception:
                pass
            self._send(
                200,
                {
                    "ok": READY and LOAD_ERROR is None,
                    "ready": READY,
                    "nativeMesh": READY,
                    "provider": "worldgen-flux-pano-da2",
                    "claimsWorldModelGeneration": True,
                    "coverage": "single-viewpoint",
                    "precision": PRECISION,
                    "fluxBase": FLUX_BASE,
                    "nunchaku": NUNCHAKU_REPO,
                    "lora": f"{LORA_REPO}/{LORA_FILE}",
                    "panorama": [PANO_W, PANO_H],
                    "steps": STEPS,
                    "meshW": MESH_W,
                    "gpuFreeMiB": int(free / 1048576),
                    "gpuTotalMiB": int(total / 1048576),
                    "lastTimings": LAST_TIMINGS,
                    "error": LOAD_ERROR,
                },
            )
            return
        parts = self.path.strip("/").split("/")
        if len(parts) == 4 and parts[0] == "v1" and parts[1] == "jobs":
            job = JOBS.get(parts[2])
            if job is None:
                self._send(404, {"ok": False, "error": "job not found"})
                return
            job_dir = Path(job["dir"])
            if parts[3] == "glb":
                p = job_dir / "scene.glb"
                if p.exists():
                    self._send_bytes(200, p.read_bytes(), "model/gltf-binary")
                    return
            if parts[3] == "panorama.jpg":
                p = job_dir / "panorama.jpg"
                if p.exists():
                    self._send_bytes(200, p.read_bytes(), "image/jpeg")
                    return
            if parts[3] == "result.json":
                p = job_dir / "result.json"
                if p.exists():
                    self._send_bytes(200, p.read_bytes(), "application/json")
                    return
        self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:
        parts = self.path.strip("/").split("/")
        if len(parts) == 4 and parts[0] == "v1" and parts[1] == "jobs" and parts[3] == "cancel":
            self._send(200, {"ok": True, "cancelCapability": "stop_commit"})
            return
        if self.path not in ("/v1/generate", "/v1/generate/"):
            self._send(404, {"ok": False, "error": "not found"})
            return
        length = int(self.headers.get("content-length") or "0")
        if length <= 0 or length > 40_000_000:
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
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[worldgen] listening on http://{HOST}:{PORT} (loading models in background)", flush=True)

    def load() -> None:
        global LOAD_ERROR
        try:
            _load_models()
        except Exception as exc:
            LOAD_ERROR = str(exc)
            traceback.print_exc()
            print(f"[worldgen] startup failed: {exc}", flush=True)

    threading.Thread(target=load, daemon=True).start()
    server.serve_forever()


if __name__ == "__main__":
    main()
