"""HQ PBR raster + shadow maps + IBL (NOT Lumen). Render-validation path only."""
from __future__ import annotations
import json
import math
import os
import struct
import time
from pathlib import Path
from typing import Any, Callable

import numpy as np
from PIL import Image

os.environ.setdefault("CUDA_VISIBLE_DEVICES", "0")

# --- math helpers ---

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

def _mat4_ortho(l, r, b, t, n, f):
    m = np.zeros((4, 4), dtype=np.float32)
    m[0, 0] = 2 / (r - l)
    m[1, 1] = 2 / (t - b)
    m[2, 2] = -2 / (f - n)
    m[0, 3] = -(r + l) / (r - l)
    m[1, 3] = -(t + b) / (t - b)
    m[2, 3] = -(f + n) / (f - n)
    m[3, 3] = 1.0
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

def _percentile(xs, p):
    if not xs:
        return 0.0
    a = np.asarray(xs, dtype=np.float64)
    return float(np.percentile(a, p))


def load_hdr_rgbe(path: Path) -> tuple[np.ndarray, int, int]:
    """Minimal Radiance RGBE (.hdr) reader -> float32 HxWx3 linear RGB."""
    data = Path(path).read_bytes()
    if not data.startswith(b"#?RADIANCE") and not data.startswith(b"#?RGBE"):
        raise ValueError(f"not RGBE hdr: {path}")
    header_end = data.find(b"\n\n")
    if header_end < 0:
        raise ValueError("bad hdr header")
    header = data[:header_end].decode("ascii", errors="replace")
    rest = data[header_end + 2 :]
    # resolution line
    nl = rest.find(b"\n")
    res = rest[:nl].decode("ascii").strip()
    body = rest[nl + 1 :]
    # -Y height +X width
    parts = res.split()
    height = int(parts[1])
    width = int(parts[3])
    # RLE scanlines
    out = np.zeros((height, width, 3), dtype=np.float32)
    ptr = 0
    for y in range(height):
        if ptr + 4 > len(body):
            break
        if body[ptr] == 2 and body[ptr + 1] == 2:
            scan_w = (body[ptr + 2] << 8) | body[ptr + 3]
            ptr += 4
            channels = [bytearray() for _ in range(4)]
            for ch in range(4):
                while len(channels[ch]) < scan_w:
                    if ptr >= len(body):
                        break
                    code = body[ptr]
                    ptr += 1
                    if code > 128:
                        count = code - 128
                        val = body[ptr]
                        ptr += 1
                        channels[ch].extend([val] * count)
                    else:
                        count = code
                        channels[ch].extend(body[ptr : ptr + count])
                        ptr += count
            rgbe = np.stack([np.frombuffer(bytes(c), dtype=np.uint8) for c in channels], axis=1)
        else:
            rgbe = np.frombuffer(body[ptr : ptr + width * 4], dtype=np.uint8).reshape(width, 4)
            ptr += width * 4
        e = rgbe[:, 3].astype(np.float32)
        mask = e > 0
        f = np.zeros((width, 3), dtype=np.float32)
        # ldexp(c+0.5, e-128-8) approx (c / 256) * 2^(e-128)
        scale = np.ldexp(1.0, e[mask].astype(np.int32) - 128 - 8)
        f[mask] = rgbe[mask, :3].astype(np.float32) * scale[:, None]
        out[y] = f
    return out, width, height


def hdr_to_irradiance_lut(hdr: np.ndarray, samples: int = 32) -> np.ndarray:
    """Very small SH-ish irradiance: blur equirect to 32x16 RGB float -> uint8 LDR for sampler."""
    h, w, _ = hdr.shape
    # downsample + tonemap for diffuse IBL approx
    small_w, small_h = 64, 32
    ys = (np.linspace(0, h - 1, small_h)).astype(np.int32)
    xs = (np.linspace(0, w - 1, small_w)).astype(np.int32)
    grid = hdr[ys][:, xs]
    # simple box blur
    k = 5
    pad = np.pad(grid, ((k, k), (k, k), (0, 0)), mode="wrap")
    acc = np.zeros_like(grid)
    for dy in range(2 * k + 1):
        for dx in range(2 * k + 1):
            acc += pad[dy : dy + small_h, dx : dx + small_w]
    acc /= float((2 * k + 1) ** 2)
    # Reinhard tonemap to 8-bit
    ldr = acc / (1.0 + acc)
    ldr = np.clip(ldr * 255.0, 0, 255).astype(np.uint8)
    return ldr


SHADOW_VERT = """
#version 330
in vec3 in_position;
uniform mat4 u_light_mvp;
void main() {
    gl_Position = u_light_mvp * vec4(in_position, 1.0);
}
"""

SHADOW_FRAG = """
#version 330
void main() {}
"""

PBR_VERT = """
#version 330
in vec3 in_position;
in vec2 in_uv;
in vec3 in_normal;
uniform mat4 u_mvp;
uniform mat4 u_model;
uniform mat4 u_light_mvp;
out vec2 v_uv;
out vec3 v_normal;
out vec3 v_world;
out vec4 v_shadow_coord;
void main() {
    vec4 world = u_model * vec4(in_position, 1.0);
    v_world = world.xyz;
    v_uv = in_uv;
    v_normal = mat3(u_model) * in_normal;
    v_shadow_coord = u_light_mvp * vec4(in_position, 1.0);
    gl_Position = u_mvp * vec4(in_position, 1.0);
}
"""

PBR_FRAG = """
#version 330
in vec2 v_uv;
in vec3 v_normal;
in vec3 v_world;
in vec4 v_shadow_coord;
uniform sampler2D u_albedo;
uniform sampler2D u_normal_map;
uniform sampler2D u_arm;      // R=AO G=Rough B=Metal (Polyhaven ARM) or approx
uniform sampler2D u_shadow;
uniform sampler2D u_ibl;      // equirect irradiance LDR
uniform vec3 u_light_dir;
uniform vec3 u_light_color;
uniform vec3 u_cam_pos;
uniform float u_metallic_override;
uniform float u_has_metal_channel;
out vec4 f_color;

const float PI = 3.14159265;

vec3 fresnel_schlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

float distrib_ggx(vec3 N, vec3 H, float roughness) {
    float a = roughness * roughness;
    float a2 = a * a;
    float NdotH = max(dot(N, H), 0.0);
    float NdotH2 = NdotH * NdotH;
    float denom = (NdotH2 * (a2 - 1.0) + 1.0);
    return a2 / (PI * denom * denom);
}

float geom_schlick_ggx(float NdotV, float roughness) {
    float r = roughness + 1.0;
    float k = (r * r) / 8.0;
    return NdotV / (NdotV * (1.0 - k) + k);
}

float geom_smith(vec3 N, vec3 V, vec3 L, float roughness) {
    float NdotV = max(dot(N, V), 0.0);
    float NdotL = max(dot(N, L), 0.0);
    return geom_schlick_ggx(NdotV, roughness) * geom_schlick_ggx(NdotL, roughness);
}

vec3 sample_ibl(vec3 n) {
    float u = atan(n.z, n.x) / (2.0 * PI) + 0.5;
    float v = asin(clamp(n.y, -1.0, 1.0)) / PI + 0.5;
    return texture(u_ibl, vec2(u, 1.0 - v)).rgb;
}

float shadow_factor(vec4 sc) {
    vec3 proj = sc.xyz / max(sc.w, 1e-5);
    proj = proj * 0.5 + 0.5;
    if (proj.z > 1.0 || proj.x < 0.0 || proj.x > 1.0 || proj.y < 0.0 || proj.y > 1.0)
        return 1.0;
    float bias = 0.0025;
    float shadow = 0.0;
    vec2 texel = 1.0 / textureSize(u_shadow, 0);
    for (int x = -1; x <= 1; ++x) {
        for (int y = -1; y <= 1; ++y) {
            float closest = texture(u_shadow, proj.xy + vec2(x, y) * texel).r;
            shadow += (proj.z - bias > closest) ? 0.12 : 1.0;
        }
    }
    return shadow / 9.0;
}

void main() {
    vec3 albedo = pow(texture(u_albedo, v_uv).rgb, vec3(2.2));
    vec3 arm = texture(u_arm, v_uv).rgb;
    float ao = arm.r;
    float roughness = clamp(arm.g, 0.04, 1.0);
    float metallic = (u_has_metal_channel > 0.5) ? arm.b : u_metallic_override;

    // tangent-ish normal mapping using derivatives
    vec3 N = normalize(v_normal);
    vec3 mapN = texture(u_normal_map, v_uv).rgb * 2.0 - 1.0;
    // construct TBN from derivatives
    vec3 dp1 = dFdx(v_world);
    vec3 dp2 = dFdy(v_world);
    vec2 duv1 = dFdx(v_uv);
    vec2 duv2 = dFdy(v_uv);
    vec3 dp2perp = cross(dp2, N);
    vec3 dp1perp = cross(N, dp1);
    vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
    vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
    float invmax = inversesqrt(max(dot(T, T), dot(B, B)));
    mat3 TBN = mat3(T * invmax, B * invmax, N);
    N = normalize(TBN * mapN);

    vec3 V = normalize(u_cam_pos - v_world);
    vec3 L = normalize(-u_light_dir);
    vec3 H = normalize(V + L);
    vec3 F0 = mix(vec3(0.04), albedo, metallic);

    float NDF = distrib_ggx(N, H, roughness);
    float G = geom_smith(N, V, L, roughness);
    vec3 F = fresnel_schlick(max(dot(H, V), 0.0), F0);
    vec3 numer = NDF * G * F;
    float denom = 4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0) + 1e-4;
    vec3 spec = numer / denom;
    vec3 kS = F;
    vec3 kD = (vec3(1.0) - kS) * (1.0 - metallic);
    float NdotL = max(dot(N, L), 0.0);
    float sh = shadow_factor(v_shadow_coord);
    vec3 Lo = (kD * albedo / PI + spec) * u_light_color * NdotL * sh;

    // IBL diffuse (indirect) — not Lumen
    vec3 irradiance = sample_ibl(N);
    vec3 ambient = (kD * irradiance * albedo) * ao * 0.85;
    // cheap specular ambient from IBL reflection
    vec3 R = reflect(-V, N);
    vec3 prefiltered = sample_ibl(R);
    vec3 Fenv = fresnel_schlick(max(dot(N, V), 0.0), F0);
    ambient += Fenv * prefiltered * (1.0 - roughness) * ao * 0.35;

    vec3 color = ambient + Lo;
    // tonemap + gamma
    color = color / (color + vec3(1.0));
    color = pow(color, vec3(1.0 / 2.2));
    f_color = vec4(color, 1.0);
}
"""


def _build_room_mesh():
    """Interior room with furniture; windings match inward normals (CULL kept)."""
    quads = []

    def add_quad(p0, p1, p2, p3, n, uv_scale=1.0, mat=0):
        a = np.asarray(p0, dtype=np.float64)
        b = np.asarray(p1, dtype=np.float64)
        c = np.asarray(p2, dtype=np.float64)
        d = np.asarray(p3, dtype=np.float64)
        n = np.asarray(n, dtype=np.float64)
        cross = np.cross(b - a, c - a)
        if np.dot(cross, n) < 0.0:
            b, d = d, b
            cross = np.cross(b - a, c - a)
        if np.dot(cross, n) <= 0.0:
            raise RuntimeError(f"quad winding cannot match normal {n.tolist()}")
        cross2 = np.cross(c - a, d - a)
        if np.dot(cross2, n) < 0.0:
            raise RuntimeError(f"second tri winding mismatch normal={n.tolist()}")
        quads.append((tuple(a), tuple(b), tuple(c), tuple(d), tuple(n), uv_scale, mat))

    x0, x1 = -2.5, 2.5
    z0, z1 = -2.5, 2.5
    y0, y1 = 0.0, 2.8
    add_quad((x0, y0, z0), (x0, y0, z1), (x1, y0, z1), (x1, y0, z0), (0, 1, 0), 2.0, 0)
    add_quad((x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1), (0, -1, 0), 2.0, 2)
    add_quad((x0, y0, z1), (x0, y1, z1), (x1, y1, z1), (x1, y0, z1), (0, 0, -1), 1.5, 1)
    add_quad((x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z0), (0, 0, 1), 1.5, 1)
    add_quad((x1, y0, z1), (x1, y1, z1), (x1, y1, z0), (x1, y0, z0), (-1, 0, 0), 1.5, 1)
    add_quad((x0, y0, z0), (x0, y1, z0), (x0, y1, z1), (x0, y0, z1), (1, 0, 0), 1.5, 1)
    # table top + sides (outward/up normals as appropriate for solid)
    add_quad((-0.9, 0.75, -0.5), (-0.9, 0.75, 0.5), (0.9, 0.75, 0.5), (0.9, 0.75, -0.5), (0, 1, 0), 1.0, 3)
    add_quad((-0.9, 0.0, -0.5), (-0.9, 0.75, -0.5), (-0.9, 0.75, 0.5), (-0.9, 0.0, 0.5), (-1, 0, 0), 1.0, 3)
    add_quad((0.9, 0.0, 0.5), (0.9, 0.75, 0.5), (0.9, 0.75, -0.5), (0.9, 0.0, -0.5), (1, 0, 0), 1.0, 3)
    add_quad((-0.9, 0.0, 0.5), (-0.9, 0.75, 0.5), (0.9, 0.75, 0.5), (0.9, 0.0, 0.5), (0, 0, 1), 1.0, 3)
    add_quad((0.9, 0.0, -0.5), (0.9, 0.75, -0.5), (-0.9, 0.75, -0.5), (-0.9, 0.0, -0.5), (0, 0, -1), 1.0, 3)
    add_quad((-0.8, 0.6, z1 - 0.02), (-0.8, 2.0, z1 - 0.02), (0.8, 2.0, z1 - 0.02), (0.8, 0.6, z1 - 0.02), (0, 0, -1), 1.0, 3)
    cx, cz, s, h = -1.4, 1.2, 0.35, 0.7
    add_quad((cx - s, h, cz - s), (cx - s, h, cz + s), (cx + s, h, cz + s), (cx + s, h, cz - s), (0, 1, 0), 1.0, 3)
    add_quad((cx - s, 0, cz + s), (cx - s, h, cz + s), (cx + s, h, cz + s), (cx + s, 0, cz + s), (0, 0, 1), 1.0, 3)
    add_quad((cx + s, 0, cz - s), (cx + s, h, cz - s), (cx - s, h, cz - s), (cx - s, 0, cz - s), (0, 0, -1), 1.0, 3)
    add_quad((cx + s, 0, cz + s), (cx + s, h, cz + s), (cx + s, h, cz - s), (cx + s, 0, cz - s), (1, 0, 0), 1.0, 3)
    add_quad((cx - s, 0, cz - s), (cx - s, h, cz - s), (cx - s, h, cz + s), (cx - s, 0, cz + s), (-1, 0, 0), 1.0, 3)

    batches = {0: [], 1: [], 2: [], 3: []}
    for p0, p1, p2, p3, n, uvs, mat in quads:
        verts = []
        for pt, uv in (
            (p0, (0, 0)),
            (p1, (uvs, 0)),
            (p2, (uvs, uvs)),
            (p0, (0, 0)),
            (p2, (uvs, uvs)),
            (p3, (0, uvs)),
        ):
            verts.extend([*pt, *uv, *n])
        batches[mat].extend(verts)
    return {k: np.array(v, dtype=np.float32).reshape(-1, 8) for k, v in batches.items() if v}



def _load_tex(ctx, path: Path, components=3):
    img = Image.open(path).convert("RGB" if components == 3 else "RGBA")
    data = img.tobytes()
    tex = ctx.texture(img.size, components, data)
    tex.build_mipmaps()
    tex.filter = (__import__("moderngl").LINEAR_MIPMAP_LINEAR, __import__("moderngl").LINEAR)
    tex.repeat_x = True
    tex.repeat_y = True
    return tex


def _ensure_pbr_maps(scene_dir: Path) -> dict[str, Path]:
    """Locate Polyhaven PBR maps under scene/pbr; clear error if missing."""
    root = scene_dir / "pbr"
    need = {
        "floor": root / "floor",
        "wall": root / "wall",
        "ceiling": root / "ceiling",
        "accent": root / "accent",
    }
    for name, d in need.items():
        if not (d / "albedo.jpg").exists():
            raise FileNotFoundError(
                f"PBR maps missing for '{name}' at {d}. "
                "Expected render-validation assets (Polyhaven CC0) under scene/pbr/."
            )
    hdri = root / "hdri" / "studio_small_03_1k.hdr"
    if not hdri.exists():
        raise FileNotFoundError(f"HDRI missing: {hdri}")
    return {
        "floor": need["floor"],
        "wall": need["wall"],
        "ceiling": need["ceiling"],
        "accent": need["accent"],
        "hdri": hdri,
        "manifest": root / "MANIFEST.json",
    }


def _default_camera(i: int, total: int):
    t = i / max(total - 1, 1)
    ang = t * math.pi * 1.25
    radius = 1.85  # inside room clear space (walls at +/-2.5)
    room_h = 2.8
    height = 1.15 + 0.35 * math.sin(t * math.pi)
    height = float(min(max(height, 0.35), room_h - 0.35))
    eye = np.array([math.cos(ang) * radius, height, math.sin(ang) * radius], dtype=np.float32)
    target = np.array([0.0, 1.15, 0.0], dtype=np.float32)
    up = np.array([0.0, 1.0, 0.0], dtype=np.float32)
    return eye, target, up


def _parse_camera_path(camera_path, frames: int):
    """Accept list of {eye,target,up} or dict with orbit params; else default."""
    if camera_path is None:
        return [_default_camera(i, frames) for i in range(frames)]
    if isinstance(camera_path, dict) and "poses" in camera_path:
        camera_path = camera_path["poses"]
    if isinstance(camera_path, dict) and camera_path.get("path") == "orbit_interior":
        return [_default_camera(i, frames) for i in range(frames)]
    if isinstance(camera_path, list) and camera_path:
        poses = []
        for i in range(frames):
            src = camera_path[min(i, len(camera_path) - 1)]
            if isinstance(src, dict):
                eye = np.array(src.get("eye", src.get("position")), dtype=np.float32)
                target = np.array(src.get("target", src.get("look_at", [0, 1, 0])), dtype=np.float32)
                up = np.array(src.get("up", [0, 1, 0]), dtype=np.float32)
            else:
                eye, target, up = _default_camera(i, frames)
            poses.append((eye, target, up))
        return poses
    return [_default_camera(i, frames) for i in range(frames)]


def render_hq_pbr(
    scene_dir: Path,
    out_dir: Path,
    width: int = 1280,
    height: int = 720,
    frames: int = 60,
    warmup: int = 10,
    scene_glb: str | None = None,
    camera_path=None,
    progress_cb: Callable[[float], None] | None = None,
) -> dict[str, Any]:
    import moderngl
    import glfw
    from .glb_loader import load_glb, GlbLoadError

    out_dir.mkdir(parents=True, exist_ok=True)
    maps = _ensure_pbr_maps(scene_dir)

    if not glfw.init():
        raise RuntimeError("glfw.init failed")
    glfw.window_hint(glfw.VISIBLE, glfw.FALSE)
    glfw.window_hint(glfw.CONTEXT_VERSION_MAJOR, 3)
    glfw.window_hint(glfw.CONTEXT_VERSION_MINOR, 3)
    glfw.window_hint(glfw.OPENGL_PROFILE, glfw.OPENGL_CORE_PROFILE)
    try:
        glfw.window_hint(glfw.OPENGL_FORWARD_COMPAT, glfw.TRUE)
    except Exception:
        pass
    window = glfw.create_window(width, height, "carina-rtx-hq-pbr", None, None)
    if not window:
        glfw.terminate()
        raise RuntimeError("glfw.create_window failed")
    glfw.make_context_current(window)
    result = None
    try:
        ctx = moderngl.create_context()
        vendor = ctx.info.get("GL_VENDOR", "")
        renderer = ctx.info.get("GL_RENDERER", "")
        version = ctx.info.get("GL_VERSION", "")
        if "NVIDIA" not in vendor.upper() and "NVIDIA" not in renderer.upper():
            glfw.destroy_window(window)
            glfw.terminate()
            raise RuntimeError(f"Not on NVIDIA GPU: vendor={vendor!r} renderer={renderer!r}")

        # materials
        mat_dirs = [maps["floor"], maps["wall"], maps["ceiling"], maps["accent"]]
        albedo_tex, normal_tex, arm_tex, metal_flags = [], [], [], []
        for d in mat_dirs:
            albedo_tex.append(_load_tex(ctx, d / "albedo.jpg"))
            normal_tex.append(_load_tex(ctx, d / "normal.jpg"))
            # Prefer ARM pack; else synthesize from rough+ao (+metal)
            arm_path = d / "arm.jpg"
            if arm_path.exists():
                arm_tex.append(_load_tex(ctx, arm_path))
                metal_flags.append(1.0 if (d / "metal.jpg").exists() or d.name == "accent" else 0.0)
            else:
                rough = np.array(Image.open(d / "rough.jpg").convert("L"))
                ao = np.array(Image.open(d / "ao.jpg").convert("L")) if (d / "ao.jpg").exists() else np.full_like(rough, 255)
                metal = np.array(Image.open(d / "metal.jpg").convert("L")) if (d / "metal.jpg").exists() else np.zeros_like(rough)
                arm = np.dstack([ao, rough, metal]).astype(np.uint8)
                tex = ctx.texture((arm.shape[1], arm.shape[0]), 3, arm.tobytes())
                tex.build_mipmaps()
                tex.filter = (moderngl.LINEAR_MIPMAP_LINEAR, moderngl.LINEAR)
                arm_tex.append(tex)
                metal_flags.append(1.0 if (d / "metal.jpg").exists() else 0.0)

        # IBL
        hdr, _, _ = load_hdr_rgbe(maps["hdri"])
        ibl_ldr = hdr_to_irradiance_lut(hdr)
        ibl_tex = ctx.texture((ibl_ldr.shape[1], ibl_ldr.shape[0]), 3, ibl_ldr.tobytes())
        ibl_tex.filter = (moderngl.LINEAR, moderngl.LINEAR)
        Image.fromarray(ibl_ldr).save(out_dir / "ibl_irradiance_preview.png")

        # geometry
        use_glb = False
        glb_meta = None
        glb_albedos = []
        batches = _build_room_mesh()
        if scene_glb:
            gp = Path(scene_glb)
            if not gp.is_file():
                raise FileNotFoundError(f"scene_glb not found: {scene_glb}")
            try:
                glb_meta = load_glb(gp)
                use_glb = True
                batches = {}
                for mi, mesh in enumerate(glb_meta["meshes"]):
                    batches[mi] = mesh["interleaved"]
                glb_albedos = []
                for mesh in glb_meta["meshes"]:
                    ap = mesh.get("albedo_path")
                    if ap and Path(ap).is_file():
                        glb_albedos.append(_load_tex(ctx, Path(ap)))
                    else:
                        glb_albedos.append(None)
            except GlbLoadError as e:
                raise RuntimeError(f"GLB load failed: {e}") from e

        shadow_prog = ctx.program(vertex_shader=SHADOW_VERT, fragment_shader=SHADOW_FRAG)
        pbr_prog = ctx.program(vertex_shader=PBR_VERT, fragment_shader=PBR_FRAG)

        shadow_size = 2048
        shadow_depth = ctx.depth_texture((shadow_size, shadow_size))
        shadow_fbo = ctx.framebuffer(depth_attachment=shadow_depth)
        # keep default depth sampling (no compare_func; avoids driver AV)
        shadow_depth.filter = (moderngl.NEAREST, moderngl.NEAREST)

        color_fbo = ctx.simple_framebuffer((width, height))
        ctx.enable(moderngl.DEPTH_TEST)
        ctx.enable(moderngl.CULL_FACE)

        # build VAOs
        def make_vaos(prog, use_uvn=True):
            out = []
            for mid, arr in batches.items():
                if use_uvn:
                    vbo = ctx.buffer(arr.tobytes())
                    vao = ctx.simple_vertex_array(prog, vbo, "in_position", "in_uv", "in_normal")
                else:
                    pos = np.ascontiguousarray(arr[:, 0:3])
                    vbo = ctx.buffer(pos.tobytes())
                    vao = ctx.simple_vertex_array(prog, vbo, "in_position")
                out.append((mid, vao, arr.shape[0]))
            return out

        shadow_vaos = make_vaos(shadow_prog, use_uvn=False)
        pbr_vaos = make_vaos(pbr_prog, use_uvn=True)

        proj = _mat4_perspective(60.0, width / float(height), 0.05, 100.0)
        model = _mat4_identity()
        light_dir = np.array([0.55, -1.0, 0.35], dtype=np.float32)
        light_dir = light_dir / np.linalg.norm(light_dir)
        light_color = np.array([6.0, 5.6, 5.0], dtype=np.float32)
        # light view/proj for shadows
        light_eye = np.array([4.0, 8.0, 3.0], dtype=np.float32)
        light_target = np.array([0.0, 0.5, 0.0], dtype=np.float32)
        light_view = _mat4_look_at(light_eye, light_target, np.array([0, 1, 0], dtype=np.float32))
        light_proj = _mat4_ortho(-6, 6, -6, 6, 0.5, 25.0)
        light_vp = _mat4_mul(light_proj, light_view)
        light_mvp = _mat4_mul(light_vp, model)

        poses = _parse_camera_path(camera_path, frames)

        def draw_shadow():
            shadow_fbo.use()
            ctx.viewport = (0, 0, shadow_size, shadow_size)
            shadow_fbo.clear()
            shadow_prog["u_light_mvp"].write(light_mvp.T.tobytes())
            ctx.cull_face = "front"
            for mid, vao, _n in shadow_vaos:
                vao.render(moderngl.TRIANGLES)
            ctx.cull_face = "back"

        def draw_frame(eye, target, up):
            view = _mat4_look_at(eye, target, up)
            mvp = _mat4_mul(proj, _mat4_mul(view, model))
            color_fbo.use()
            ctx.viewport = (0, 0, width, height)
            color_fbo.clear(0.02, 0.025, 0.035, 1.0)
            pbr_prog["u_mvp"].write(mvp.T.tobytes())
            pbr_prog["u_model"].write(model.T.tobytes())
            pbr_prog["u_light_mvp"].write(light_mvp.T.tobytes())
            pbr_prog["u_light_dir"].value = tuple(light_dir.tolist())
            pbr_prog["u_light_color"].value = tuple(light_color.tolist())
            pbr_prog["u_cam_pos"].value = tuple(np.asarray(eye, dtype=np.float32).tolist())
            shadow_depth.use(3)
            pbr_prog["u_shadow"] = 3
            ibl_tex.use(4)
            pbr_prog["u_ibl"] = 4
            for mid, vao, _n in pbr_vaos:
                mat_id = mid if mid < 4 and not use_glb else (0 if use_glb else mid)
                if use_glb:
                    mat_id = 0
                    mesh = glb_meta["meshes"][mid]
                    pbr_prog["u_metallic_override"].value = float(mesh.get("metallic", 0.0))
                    pbr_prog["u_has_metal_channel"].value = 1.0 if float(mesh.get("metallic", 0) or 0) > 0.01 else 0.0
                    alb = glb_albedos[mid] if mid < len(glb_albedos) else None
                    (alb or albedo_tex[0]).use(0)
                    normal_tex[0].use(1)
                    arm_tex[0].use(2)
                else:
                    pbr_prog["u_metallic_override"].value = 0.85 if mat_id == 3 else 0.0
                    pbr_prog["u_has_metal_channel"].value = float(metal_flags[mat_id])
                    albedo_tex[mat_id].use(0)
                    normal_tex[mat_id].use(1)
                    arm_tex[mat_id].use(2)
                pbr_prog["u_albedo"] = 0
                pbr_prog["u_normal_map"] = 1
                pbr_prog["u_arm"] = 2
                vao.render(moderngl.TRIANGLES)

        # warmup (not timed into P50)
        draw_shadow()
        ctx.finish()
        for i in range(warmup):
            eye, target, up = poses[min(i, len(poses) - 1)]
            draw_shadow()
            draw_frame(eye, target, up)
            ctx.finish()
            if progress_cb:
                progress_cb(0.05 * (i + 1) / max(warmup, 1))

        frame_timings = []
        strip_frames = []
        peak_vram = 0
        before_path = out_dir / "before.png"
        after_path = out_dir / "after.png"

        for i in range(frames):
            eye, target, up = poses[i]
            t0 = time.perf_counter()
            draw_shadow()
            draw_frame(eye, target, up)
            ctx.finish()
            t1 = time.perf_counter()
            render_ms = (t1 - t0) * 1000.0

            t2 = time.perf_counter()
            data = color_fbo.read(components=3, alignment=1)
            img = Image.frombytes("RGB", (width, height), data).transpose(Image.FLIP_TOP_BOTTOM)
            if i == 0:
                img.save(before_path)
            if i == frames - 1:
                img.save(after_path)
            if i % max(frames // 8, 1) == 0 or i == frames - 1:
                strip_frames.append(img.copy())
                img.save(out_dir / f"frame_{i:04d}.png")
            t3 = time.perf_counter()
            readback_encode_ms = (t3 - t2) * 1000.0

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
                "note": "render_ms = submit+shadow+shading+glFinish; NOT game FPS",
            })
            if progress_cb:
                progress_cb(0.05 + 0.9 * (i + 1) / frames)

        if strip_frames:
            tw = max(1, strip_frames[0].width // 4)
            th = max(1, strip_frames[0].height // 4)
            strip = Image.new("RGB", (tw * len(strip_frames), th))
            for idx, im in enumerate(strip_frames):
                strip.paste(im.resize((tw, th), Image.BILINEAR), (idx * tw, 0))
            strip.save(out_dir / "frame_strip.png")
            strip_name = "frame_strip.png"
        else:
            strip_name = None

        rms = [f["render_ms"] for f in frame_timings]
        ems = [f["readback_encode_ms"] for f in frame_timings]
        (out_dir / "frame_timings.json").write_text(json.dumps(frame_timings, indent=2) + "\n", encoding="utf-8")

        result = {
            "backend": f"ModernGL PBR+shadowMap+IBL (NOT Lumen) OpenGL {version}",
            "capability": "pbrRasterIBL",
            "gl_vendor": vendor,
            "gl_renderer": renderer,
            "gl_version": version,
            "resolution": [width, height],
            "frames": frames,
            "warmup_frames": warmup,
            "render_ms_p50": round(_percentile(rms, 50), 3),
            "render_ms_p95": round(_percentile(rms, 95), 3),
            "readback_encode_ms_p50": round(_percentile(ems, 50), 3),
            "readback_encode_ms_p95": round(_percentile(ems, 95), 3),
            "avg_render_ms": round(float(np.mean(rms)), 3) if rms else 0.0,
            "avg_readback_encode_ms": round(float(np.mean(ems)), 3) if ems else 0.0,
            "peak_vram_mib": peak_vram or None,
            "frame_strip": strip_name,
            "scene_glb": None,  # filled by run_hq_pbr_job with public relative/assetId only
            "scene_glb_path_internal": scene_glb,
            "used_bundled_scene": not use_glb,
            "lighting": "directional PBR + shadow maps + HDR IBL diffuse/spec approx — not Lumen",
            "assets_label": None,  # filled by run_hq_pbr_job from actual source
            "nvidia_verified": True,
        }

    finally:
        try:
            glfw.destroy_window(window)
        except Exception:
            pass
        try:
            glfw.terminate()
        except Exception:
            pass
    if progress_cb:
        progress_cb(1.0)
    return result


def _public_scene_ref(job) -> dict:
    """Never expose absolute Windows paths in benchmark/API artifacts."""
    aid = getattr(job, "asset_id", None) or (getattr(job, "meta", None) or {}).get("assetId")
    if aid:
        rel = f"assets/uploaded/{aid}/asset.glb"
        return {
            "assetId": str(aid),
            "relativePath": rel,
            "scene_glb": rel,
            "assets_label": f"uploaded GLB assetId={aid} (content-addressed upload); not world-model content",
        }
    scene = getattr(job, "scene_glb", None)
    if scene:
        s = str(scene).replace("\\", "/")
        # strip to relative under assets/ if possible
        marker = "assets/"
        idx = s.lower().find(marker)
        if idx >= 0:
            rel = s[idx:]
        else:
            rel = Path(s).name
        label = f"local assets path {rel}"
        low = rel.lower()
        if "polyhaven" in low or "damagedhelmet" in low:
            label = f"render-validation sample ({rel}); Polyhaven CC0 only if that sample is Polyhaven-sourced"
        elif "uploaded" in low:
            label = f"uploaded asset path {rel}"
        return {"assetId": None, "relativePath": rel, "scene_glb": rel, "assets_label": label}
    return {
        "assetId": None,
        "relativePath": None,
        "scene_glb": None,
        "assets_label": "bundled procedural/room PBR maps under scene/pbr (Polyhaven CC0 where those maps are used); not world-model content",
    }


def run_hq_pbr_job(job, art_dir: Path) -> None:
    from . import config
    from .gpu_info import get_gpu_snapshot, load_capabilities, save_capabilities, sample_vram_mib

    t_queue = time.perf_counter()
    w, h = job.resolution
    frames = max(1, min(int(job.frames), 300))
    warmup = getattr(job, "warmup_frames", 10) or 10

    def prog(p):
        job.progress = float(p)

    t_load0 = time.perf_counter()
    # ensure pbr maps present
    _ensure_pbr_maps(config.SCENE_DIR)
    load_ms = (time.perf_counter() - t_load0) * 1000.0

    vram_samples = []
    v0 = sample_vram_mib()
    if v0 is not None:
        vram_samples.append(v0)

    t_render0 = time.perf_counter()
    result = render_hq_pbr(
        config.SCENE_DIR,
        art_dir,
        width=w,
        height=h,
        frames=frames,
        warmup=warmup,
        scene_glb=getattr(job, "scene_glb", None),
        camera_path=getattr(job, "camera_path", None),
        progress_cb=prog,
    )
    wall_ms = (time.perf_counter() - t_render0) * 1000.0
    pub = _public_scene_ref(job)
    result["scene_glb"] = pub["scene_glb"]
    result["assetId"] = pub["assetId"]
    result["relativePath"] = pub["relativePath"]
    result["assets_label"] = pub["assets_label"]

    v1 = sample_vram_mib()
    if v1 is not None:
        vram_samples.append(v1)
    peak = max([x for x in vram_samples if x is not None] + [result.get("peak_vram_mib") or 0])

    gpu = get_gpu_snapshot()
    bench = {
        "job_id": job.id,
        "mode": "hq_pbr",
        "capability": "pbrRasterIBL",
        "not_lumen": True,
        "resolution": [w, h],
        "frames": frames,
        "warmup_frames": warmup,
        "gpu": gpu,
        "backend": result["backend"],
        "gl_vendor": result["gl_vendor"],
        "gl_renderer": result["gl_renderer"],
        "lighting": result["lighting"],
        "assets_label": result["assets_label"],
        "assetId": result.get("assetId"),
        "relativePath": result.get("relativePath"),
        "scene_glb": result.get("scene_glb"),
        "used_bundled_scene": result.get("used_bundled_scene"),
        "timings": {
            "render_ms_p50": result["render_ms_p50"],
            "render_ms_p95": result["render_ms_p95"],
            "readback_encode_ms_p50": result["readback_encode_ms_p50"],
            "readback_encode_ms_p95": result["readback_encode_ms_p95"],
            "avg_render_ms": result["avg_render_ms"],
            "avg_readback_encode_ms": result["avg_readback_encode_ms"],
            "scene_load_ms": round(load_ms, 3),
            "queue_wait_ms": round((t_render0 - t_queue) * 1000.0, 3),
            "wall_ms": round(wall_ms, 3),
            "network_ms": None,
            "network_ms_note": "measure at client only",
            "honesty": "render_ms is glFinish-synced submit+GPU; not claimed as interactive game FPS",
        },
        "peak_vram_mib": peak,
        "artifacts": {
            "before": "before.png",
            "after": "after.png",
            "frame_strip": result.get("frame_strip"),
            "frame_timings": "frame_timings.json",
            "ibl_preview": "ibl_irradiance_preview.png",
        },
        "pbrRasterIBL_verified": True,
    }
    (art_dir / "benchmark.json").write_text(json.dumps(bench, indent=2) + "\n", encoding="utf-8")

    job.timings = bench["timings"] | {"peak_vram_mib": peak}
    arts = ["benchmark.json", "before.png", "after.png", "frame_timings.json", "ibl_irradiance_preview.png"]
    if result.get("frame_strip"):
        arts.append(result["frame_strip"])
    for p in art_dir.glob("frame_*.png"):
        arts.append(p.name)
    job.artifacts = sorted(set(arts))
    job.meta = {
        "backend": result["backend"],
        "capability": "pbrRasterIBL",
        "not_lumen": True,
        "gl_renderer": result["gl_renderer"],
        "assets_label": result["assets_label"],
    }

    caps = load_capabilities(config.CAPABILITIES_FILE)
    caps["pbrRasterIBL"] = True
    caps["meshRender"] = True  # still true
    save_capabilities(config.CAPABILITIES_FILE, caps)
