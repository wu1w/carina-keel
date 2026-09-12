"""ModernGL / GLFW textured interior room renderer on NVIDIA GPU."""
from __future__ import annotations
import json
import math
import os
import struct
import subprocess
import time
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw

# Force NVIDIA if Optimus present
os.environ.setdefault("CUDA_VISIBLE_DEVICES", "0")

VERT = """
#version 330
in vec3 in_position;
in vec2 in_uv;
in vec3 in_normal;
uniform mat4 u_mvp;
uniform mat4 u_model;
out vec2 v_uv;
out vec3 v_normal;
out vec3 v_world;
void main() {
    vec4 world = u_model * vec4(in_position, 1.0);
    v_world = world.xyz;
    v_uv = in_uv;
    v_normal = mat3(u_model) * in_normal;
    gl_Position = u_mvp * vec4(in_position, 1.0);
}
"""

FRAG = """
#version 330
in vec2 v_uv;
in vec3 v_normal;
in vec3 v_world;
uniform sampler2D u_tex;
uniform vec3 u_light_dir;
uniform vec3 u_cam_pos;
out vec4 f_color;
void main() {
    vec3 n = normalize(v_normal);
    vec3 albedo = texture(u_tex, v_uv).rgb;
    float ndl = max(dot(n, normalize(-u_light_dir)), 0.0);
    float ambient = 0.25;
    vec3 view = normalize(u_cam_pos - v_world);
    vec3 halfv = normalize(normalize(-u_light_dir) + view);
    float spec = pow(max(dot(n, halfv), 0.0), 32.0) * 0.35;
    vec3 color = albedo * (ambient + 0.75 * ndl) + vec3(spec);
    f_color = vec4(color, 1.0);
}
"""


def _mat4_identity():
    return np.eye(4, dtype=np.float32)


def _mat4_perspective(fovy_deg, aspect, znear, zfar):
    f = 1.0 / math.tan(math.radians(fovy_deg) / 2.0)
    m = np.zeros((4, 4), dtype=np.float32)
    m[0, 0] = f / aspect
    m[1, 1] = f
    m[2, 2] = (zfar + znear) / (znear - zfar)
    m[2, 3] = (2 * zfar * znear) / (znear - zfar)
    m[3, 2] = -1.0
    return m


def _mat4_look_at(eye, target, up):
    eye = np.asarray(eye, dtype=np.float32)
    target = np.asarray(target, dtype=np.float32)
    up = np.asarray(up, dtype=np.float32)
    f = target - eye
    f = f / (np.linalg.norm(f) + 1e-8)
    s = np.cross(f, up)
    s = s / (np.linalg.norm(s) + 1e-8)
    u = np.cross(s, f)
    m = _mat4_identity()
    m[0, 0:3] = s
    m[1, 0:3] = u
    m[2, 0:3] = -f
    m[0, 3] = -np.dot(s, eye)
    m[1, 3] = -np.dot(u, eye)
    m[2, 3] = np.dot(f, eye)
    return m


def _mat4_mul(a, b):
    return a @ b


def generate_scene_textures(scene_dir: Path) -> dict[str, Path]:
    scene_dir.mkdir(parents=True, exist_ok=True)
    paths = {}

    def checker(path, c1, c2, size=512, cells=8):
        img = Image.new("RGB", (size, size))
        px = img.load()
        cs = size // cells
        for y in range(size):
            for x in range(size):
                px[x, y] = c1 if ((x // cs) + (y // cs)) % 2 == 0 else c2
        img.save(path)
        return path

    def wood(path, size=512):
        img = Image.new("RGB", (size, size), (120, 72, 40))
        d = ImageDraw.Draw(img)
        for i in range(0, size, 8):
            shade = 100 + (i * 7) % 40
            d.line([(0, i), (size, i + 20)], fill=(shade, shade // 2, shade // 3), width=3)
        noise = np.random.randint(-15, 16, (size, size, 3), dtype=np.int16)
        arr = np.clip(np.array(img, dtype=np.int16) + noise, 0, 255).astype(np.uint8)
        Image.fromarray(arr).save(path)
        return path

    def plaster(path, size=512, base=(210, 205, 195)):
        arr = np.full((size, size, 3), base, dtype=np.int16)
        arr += np.random.randint(-12, 13, arr.shape, dtype=np.int16)
        Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(path)
        return path

    def ceiling(path, size=512):
        return plaster(path, size=size, base=(235, 235, 240))

    paths["floor"] = wood(scene_dir / "tex_floor.png")
    paths["wall"] = plaster(scene_dir / "tex_wall.png")
    paths["ceiling"] = ceiling(scene_dir / "tex_ceiling.png")
    paths["accent"] = checker(scene_dir / "tex_accent.png", (40, 90, 140), (30, 60, 100))
    # camera path description
    cam = {
        "path": "orbit_interior",
        "center": [0.0, 1.2, 0.0],
        "radius": 1.85,
        "height": 1.45,
        "room_extents": {"x": [-2.5, 2.5], "y": [0.0, 2.8], "z": [-2.5, 2.5]},
        "note": "Camera stays inside clear space (radius<=2.0, eye y in (0.3, room_h-0.3))",
        "fov_deg": 60.0,
        "frames_hint": 60,
    }
    (scene_dir / "camera_path.json").write_text(json.dumps(cam, indent=2) + "\n", encoding="utf-8")
    (scene_dir / "README.txt").write_text(
        "Procedural textured interior room for CARINA-RTX meshRender baseline.\n"
        "Floor wood, walls plaster, ceiling, accent panel. Fixed orbit camera path.\n",
        encoding="utf-8",
    )
    return paths


def _build_room_mesh():
    """Interior room: floor, ceiling, 4 walls, accent panel.

    OpenGL default CCW front faces + CULL_FACE kept enabled.
    Each quad is ordered so triangle cross((p1-p0),(p2-p0)) aligns with the
    declared *inward* normal (toward room center).
    """
    quads = []

    def add_quad(p0, p1, p2, p3, n, uv_scale=1.0, tex=0):
        a = np.asarray(p0, dtype=np.float64)
        b = np.asarray(p1, dtype=np.float64)
        c = np.asarray(p2, dtype=np.float64)
        d = np.asarray(p3, dtype=np.float64)
        n = np.asarray(n, dtype=np.float64)
        cross = np.cross(b - a, c - a)
        if np.dot(cross, n) < 0.0:
            # reverse winding: a,b,c,d -> a,d,c,b
            b, d = d, b
            cross = np.cross(b - a, c - a)
        if np.dot(cross, n) <= 0.0:
            raise RuntimeError(f"quad winding cannot match normal {n.tolist()} cross={cross.tolist()}")
        # also verify second triangle a,c,d
        cross2 = np.cross(c - a, d - a)
        if np.dot(cross2, n) < 0.0:
            raise RuntimeError(f"second tri winding mismatch normal={n.tolist()}")
        quads.append((tuple(a), tuple(b), tuple(c), tuple(d), tuple(n), uv_scale, tex))

    # room extents
    x0, x1 = -2.5, 2.5
    z0, z1 = -2.5, 2.5
    y0, y1 = 0.0, 2.8

    # Floor: inward normal +Y. Viewed from above, CCW in XZ with +Y up.
    add_quad((x0, y0, z0), (x0, y0, z1), (x1, y0, z1), (x1, y0, z0), (0, 1, 0), 2.0, 0)
    # Ceiling: inward normal -Y.
    add_quad((x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1), (0, -1, 0), 2.0, 2)
    # +Z wall (z=z1): inward normal -Z
    add_quad((x0, y0, z1), (x0, y1, z1), (x1, y1, z1), (x1, y0, z1), (0, 0, -1), 1.5, 1)
    # -Z wall (z=z0): inward normal +Z
    add_quad((x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z0), (0, 0, 1), 1.5, 1)
    # +X wall (x=x1): inward normal -X
    add_quad((x1, y0, z1), (x1, y1, z1), (x1, y1, z0), (x1, y0, z0), (-1, 0, 0), 1.5, 1)
    # -X wall (x=x0): inward normal +X
    add_quad((x0, y0, z0), (x0, y1, z0), (x0, y1, z1), (x0, y0, z1), (1, 0, 0), 1.5, 1)
    # accent panel on +Z wall inner face: normal -Z
    add_quad((-0.8, 0.6, z1 - 0.02), (-0.8, 2.0, z1 - 0.02), (0.8, 2.0, z1 - 0.02), (0.8, 0.6, z1 - 0.02), (0, 0, -1), 1.0, 3)

    batches = {0: [], 1: [], 2: [], 3: []}
    for p0, p1, p2, p3, n, uvs, tex in quads:
        verts = []
        for p, uv in (
            (p0, (0, 0)),
            (p1, (uvs, 0)),
            (p2, (uvs, uvs)),
            (p0, (0, 0)),
            (p2, (uvs, uvs)),
            (p3, (0, uvs)),
        ):
            verts.extend([*p, *uv, *n])
        batches[tex].extend(verts)
    return {k: np.array(v, dtype=np.float32).reshape(-1, 8) for k, v in batches.items() if v}


def _qpc_ms():
    # high-res timer via time.perf_counter (QueryPerformanceCounter on Windows)
    return time.perf_counter() * 1000.0


def verify_and_render(
    scene_dir: Path,
    out_dir: Path,
    width: int = 1280,
    height: int = 720,
    frames: int = 60,
    warmup: int = 10,
    progress_cb=None,
) -> dict[str, Any]:
    import glfw
    import moderngl

    out_dir.mkdir(parents=True, exist_ok=True)
    tex_paths = generate_scene_textures(scene_dir)

    if not glfw.init():
        raise RuntimeError("glfw.init failed")
    glfw.window_hint(glfw.VISIBLE, glfw.FALSE)
    glfw.window_hint(glfw.CONTEXT_VERSION_MAJOR, 3)
    glfw.window_hint(glfw.CONTEXT_VERSION_MINOR, 3)
    glfw.window_hint(glfw.OPENGL_PROFILE, glfw.OPENGL_CORE_PROFILE)
    # Request NVIDIA GPU on Optimus systems
    try:
        glfw.window_hint(glfw.OPENGL_FORWARD_COMPAT, glfw.TRUE)
    except Exception:
        pass
    window = glfw.create_window(width, height, "carina-rtx-mesh", None, None)
    if not window:
        glfw.terminate()
        raise RuntimeError("glfw.create_window failed")
    glfw.make_context_current(window)
    ctx = moderngl.create_context()

    vendor = ctx.info.get("GL_VENDOR", "")
    renderer = ctx.info.get("GL_RENDERER", "")
    version = ctx.info.get("GL_VERSION", "")
    if "NVIDIA" not in vendor.upper() and "NVIDIA" not in renderer.upper():
        glfw.destroy_window(window)
        glfw.terminate()
        raise RuntimeError(f"Not on NVIDIA GPU: vendor={vendor!r} renderer={renderer!r}")

    prog = ctx.program(vertex_shader=VERT, fragment_shader=FRAG)
    batches = _build_room_mesh()
    tex_files = [tex_paths["floor"], tex_paths["wall"], tex_paths["ceiling"], tex_paths["accent"]]
    textures = []
    for tp in tex_files:
        img = Image.open(tp).convert("RGB")
        data = img.tobytes()
        tex = ctx.texture(img.size, 3, data)
        tex.build_mipmaps()
        tex.filter = (moderngl.LINEAR_MIPMAP_LINEAR, moderngl.LINEAR)
        textures.append(tex)

    vaos = []
    for tex_id, arr in batches.items():
        vbo = ctx.buffer(arr.tobytes())
        vao = ctx.simple_vertex_array(prog, vbo, "in_position", "in_uv", "in_normal")
        vaos.append((vao, textures[tex_id]))

    fbo = ctx.simple_framebuffer((width, height))
    fbo.use()
    ctx.enable(moderngl.DEPTH_TEST)
    ctx.enable(moderngl.CULL_FACE)

    proj = _mat4_perspective(60.0, width / float(height), 0.05, 100.0)
    model = _mat4_identity()
    light_dir = np.array([0.4, -1.0, 0.3], dtype=np.float32)

    frame_timings = []
    peak_vram = 0
    strip_frames = []

    def camera_for(i, total):
        # Room clear space: x/z in (-2.5,2.5), y in (0,2.8). Keep eye inside.
        t = i / max(total - 1, 1)
        ang = t * math.pi * 1.25  # sweep
        radius = 1.85  # <= 2.0, clear of walls at +/-2.5
        room_h = 2.8
        height = 1.15 + 0.35 * math.sin(t * math.pi)
        height = float(min(max(height, 0.35), room_h - 0.35))
        eye = np.array([math.cos(ang) * radius, height, math.sin(ang) * radius], dtype=np.float32)
        target = np.array([0.0, 1.15, 0.0], dtype=np.float32)
        view = _mat4_look_at(eye, target, np.array([0, 1, 0], dtype=np.float32))
        mvp = _mat4_mul(proj, _mat4_mul(view, model))
        return mvp, eye

    # warmup
    for i in range(warmup):
        mvp, eye = camera_for(i, frames)
        fbo.clear(0.05, 0.06, 0.08, 1.0)
        prog["u_mvp"].write(mvp.T.tobytes())
        prog["u_model"].write(model.T.tobytes())
        prog["u_light_dir"].value = tuple(light_dir.tolist())
        prog["u_cam_pos"].value = tuple(eye.tolist())
        for vao, tex in vaos:
            tex.use(0)
            prog["u_tex"] = 0
            vao.render(moderngl.TRIANGLES)
        ctx.finish()
        if progress_cb:
            progress_cb(0.05 * (i + 1) / warmup)

    before_path = out_dir / "before.png"
    after_path = out_dir / "after.png"

    for i in range(frames):
        t0 = _qpc_ms()
        mvp, eye = camera_for(i, frames)
        fbo.clear(0.05, 0.06, 0.08, 1.0)
        prog["u_mvp"].write(mvp.T.tobytes())
        prog["u_model"].write(model.T.tobytes())
        prog["u_light_dir"].value = tuple(light_dir.tolist())
        prog["u_cam_pos"].value = tuple(eye.tolist())
        for vao, tex in vaos:
            tex.use(0)
            prog["u_tex"] = 0
            vao.render(moderngl.TRIANGLES)
        ctx.finish()
        t1 = _qpc_ms()
        render_ms = t1 - t0  # submit + glFinish; NOT game FPS

        t2 = _qpc_ms()
        data = fbo.read(components=3, alignment=1)
        img = Image.frombytes("RGB", (width, height), data).transpose(Image.FLIP_TOP_BOTTOM)

        if i == 0:
            img.save(before_path)
        if i == frames - 1:
            img.save(after_path)
        if i % max(frames // 8, 1) == 0 or i == frames - 1:
            strip_frames.append(img.copy())
            fp = out_dir / f"frame_{i:04d}.png"
            img.save(fp)
        readback_encode_ms = _qpc_ms() - t2

        # sample VRAM occasionally
        if i % 10 == 0:
            try:
                from .gpu_info import sample_vram_mib
                v = sample_vram_mib()
                if v is not None:
                    peak_vram = max(peak_vram, v)
            except Exception:
                pass

        frame_timings.append({
            "frame": i,
            "render_ms": round(render_ms, 3),
            "readback_encode_ms": round(readback_encode_ms, 3),
            # legacy aliases (deprecated):
            "cpu_ms": round(render_ms, 3),
            "gpu_ms": round(render_ms, 3),
            "note": "render_ms = submit+glFinish; not game FPS",
        })
        if progress_cb:
            progress_cb(0.05 + 0.9 * (i + 1) / frames)

    # strip
    if strip_frames:
        tw = sum(im.width for im in strip_frames) // len(strip_frames)
        th = strip_frames[0].height // 4
        strip = Image.new("RGB", (tw * len(strip_frames), th))
        for idx, im in enumerate(strip_frames):
            strip.paste(im.resize((tw, th), Image.BILINEAR), (idx * tw, 0))
        strip_path = out_dir / "frame_strip.png"
        strip.save(strip_path)
    else:
        strip_path = None

    # try mp4 via ffmpeg if available
    mp4_path = None
    try:
        import shutil
        ffmpeg = shutil.which("ffmpeg")
        if ffmpeg and (out_dir / "frame_0000.png").exists():
            mp4_path = out_dir / "preview.mp4"
            # use existing numbered frames that were saved sparsely — write dense for mp4
            # regenerate quick dense is heavy; skip if sparse only
            pass
    except Exception:
        pass

    rms = [f["render_ms"] for f in frame_timings]
    ems = [f["readback_encode_ms"] for f in frame_timings]
    avg_render = sum(rms) / max(len(rms), 1)
    avg_rb = sum(ems) / max(len(ems), 1)
    def _pct(xs, p):
        import numpy as _np
        return float(_np.percentile(_np.asarray(xs, dtype=float), p)) if xs else 0.0

    result = {
        "backend": f"ModernGL/GLFW OpenGL {version}",
        "gl_vendor": vendor,
        "gl_renderer": renderer,
        "gl_version": version,
        "resolution": [width, height],
        "frames": frames,
        "warmup_frames": warmup,
        "avg_render_ms": round(avg_render, 3),
        "avg_readback_encode_ms": round(avg_rb, 3),
        "render_ms_p50": round(_pct(rms, 50), 3),
        "render_ms_p95": round(_pct(rms, 95), 3),
        "readback_encode_ms_p50": round(_pct(ems, 50), 3),
        "readback_encode_ms_p95": round(_pct(ems, 95), 3),
        # deprecated aliases:
        "avg_cpu_ms": round(avg_render, 3),
        "avg_gpu_ms": round(avg_render, 3),
        "peak_vram_mib": peak_vram or None,
        "before": str(before_path.name),
        "after": str(after_path.name),
        "frame_strip": strip_path.name if strip_path else None,
        "nvidia_verified": True,
        "meshRender": True,
    }
    (out_dir / "frame_timings.json").write_text(json.dumps(frame_timings, indent=2) + "\n", encoding="utf-8")

    glfw.destroy_window(window)
    glfw.terminate()
    if progress_cb:
        progress_cb(1.0)
    return result


def run_baseline_job(job, art_dir: Path) -> None:
    from . import config
    from .gpu_info import get_gpu_snapshot, load_capabilities, save_capabilities, sample_vram_mib

    t_queue = time.perf_counter()
    w, h = job.resolution
    frames = max(1, min(int(job.frames), 300))

    def prog(p):
        job.progress = float(p)

    t_load0 = time.perf_counter()
    # ensure scene
    generate_scene_textures(config.SCENE_DIR)
    load_ms = (time.perf_counter() - t_load0) * 1000.0

    vram_samples = []
    v0 = sample_vram_mib()
    if v0 is not None:
        vram_samples.append(v0)

    t_render0 = time.perf_counter()
    result = verify_and_render(
        config.SCENE_DIR,
        art_dir,
        width=w,
        height=h,
        frames=frames,
        warmup=10,
        progress_cb=prog,
    )
    render_ms = (time.perf_counter() - t_render0) * 1000.0

    v1 = sample_vram_mib()
    if v1 is not None:
        vram_samples.append(v1)
    peak = max(vram_samples) if vram_samples else result.get("peak_vram_mib")

    gpu = get_gpu_snapshot()
    bench = {
        "job_id": job.id,
        "mode": "baseline",
        "resolution": [w, h],
        "frames": frames,
        "warmup_frames": 10,
        "gpu": gpu,
        "backend": result["backend"],
        "gl_vendor": result["gl_vendor"],
        "gl_renderer": result["gl_renderer"],
        "timings": {
            "render_ms_p50": result.get("render_ms_p50"),
            "render_ms_p95": result.get("render_ms_p95"),
            "readback_encode_ms_p50": result.get("readback_encode_ms_p50"),
            "readback_encode_ms_p95": result.get("readback_encode_ms_p95"),
            "avg_render_ms": result.get("avg_render_ms"),
            "avg_readback_encode_ms": result.get("avg_readback_encode_ms"),
            "scene_load_ms": round(load_ms, 3),
            "queue_wait_ms": round((t_render0 - t_queue) * 1000.0, 3),
            "wall_ms": round(render_ms, 3),
            "network_ms": None,
            "honesty": "render_ms is glFinish-synced; not game FPS",
        },
        "avg_cpu_ms": result["avg_cpu_ms"],
        "avg_gpu_ms": result["avg_gpu_ms"],
        "peak_vram_mib": peak,
        "queue_wait_ms": round((t_render0 - t_queue) * 1000.0, 3),
        "scene_load_ms": round(load_ms, 3),
        "total_render_ms": round(render_ms, 3),
        "artifacts": {
            "before": "before.png",
            "after": "after.png",
            "frame_strip": result.get("frame_strip"),
            "frame_timings": "frame_timings.json",
        },
        "meshRender_verified": True,
    }
    bench_path = art_dir / "benchmark.json"
    bench_path.write_text(json.dumps(bench, indent=2) + "\n", encoding="utf-8")

    job.timings = {
        "render_ms_p50": result.get("render_ms_p50"),
        "render_ms_p95": result.get("render_ms_p95"),
        "readback_encode_ms_p50": result.get("readback_encode_ms_p50"),
        "readback_encode_ms_p95": result.get("readback_encode_ms_p95"),
        "avg_render_ms": result.get("avg_render_ms"),
        "avg_readback_encode_ms": result.get("avg_readback_encode_ms"),
        "scene_load_ms": round(load_ms, 3),
        "wall_ms": round(render_ms, 3),
        "peak_vram_mib": peak,
        "honesty": "render_ms is glFinish-synced; not game FPS",
    }
    arts = ["benchmark.json", "before.png", "after.png", "frame_timings.json"]
    if result.get("frame_strip"):
        arts.append(result["frame_strip"])
    for p in art_dir.glob("frame_*.png"):
        arts.append(p.name)
    job.artifacts = sorted(set(arts))
    job.meta = {
        "backend": result["backend"],
        "gl_renderer": result["gl_renderer"],
        "nvidia_verified": True,
    }

    # flip meshRender capability
    caps = load_capabilities(config.CAPABILITIES_FILE)
    caps["meshRender"] = True
    save_capabilities(config.CAPABILITIES_FILE, caps)
