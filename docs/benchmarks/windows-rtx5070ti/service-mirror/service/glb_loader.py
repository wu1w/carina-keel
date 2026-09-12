"""Minimal GLB/glTF 2.0 loader for PBR validation (POSITION/NORMAL/TEXCOORD_0 + baseColor)."""
from __future__ import annotations
import json
import struct
from pathlib import Path
from typing import Any

import numpy as np


class GlbLoadError(Exception):
    pass


def _read_accessor(gltf: dict, buffers: list[bytes], accessor_idx: int) -> np.ndarray:
    acc = gltf["accessors"][accessor_idx]
    bv = gltf["bufferViews"][acc["bufferView"]]
    buf = buffers[bv.get("buffer", 0)]
    offset = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    count = acc["count"]
    ctype = acc["componentType"]
    typ = acc["type"]
    comp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[typ]
    dtype = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}[ctype]
    item = np.dtype(dtype).itemsize * comp
    stride = bv.get("byteStride", item)
    if stride == item:
        arr = np.frombuffer(buf, dtype=dtype, count=count * comp, offset=offset).reshape(count, comp)
    else:
        raw = np.frombuffer(buf, dtype=np.uint8, count=(count - 1) * stride + item if count else 0, offset=offset)
        flat = np.empty(count * comp, dtype=dtype)
        for i in range(count):
            flat[i * comp : (i + 1) * comp] = np.frombuffer(
                raw[i * stride : i * stride + item].tobytes(), dtype=dtype
            )
        arr = flat.reshape(count, comp)
    return np.asarray(arr, dtype=np.float32 if ctype == 5126 else arr.dtype)


def load_glb(path: Path) -> dict[str, Any]:
    """Return meshes list with interleaved pos/uv/normal float32 arrays and optional albedo path."""
    data = Path(path).read_bytes()
    if len(data) < 12 or data[0:4] != b"glTF":
        raise GlbLoadError(f"not a GLB: {path}")
    magic, version, length = struct.unpack_from("<III", data, 0)
    if version != 2:
        raise GlbLoadError(f"unsupported glTF version {version}")
    offset = 12
    json_chunk = None
    bin_chunk = b""
    while offset + 8 <= len(data):
        chunk_len, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        chunk = data[offset : offset + chunk_len]
        offset += chunk_len
        if chunk_type == 0x4E4F534A:  # JSON
            json_chunk = json.loads(chunk.decode("utf-8"))
        elif chunk_type == 0x004E4942:  # BIN
            bin_chunk = chunk
    if json_chunk is None:
        raise GlbLoadError("missing JSON chunk")
    buffers = []
    for i, b in enumerate(json_chunk.get("buffers", [])):
        if "uri" in b and not b["uri"].startswith("data:"):
            raise GlbLoadError("external buffer URI not supported in minimal loader")
        if i == 0 and bin_chunk:
            buffers.append(bin_chunk)
        else:
            buffers.append(b"\x00" * b.get("byteLength", 0))
    if not buffers and bin_chunk:
        buffers = [bin_chunk]

    images_dir = Path(path).parent
    meshes_out = []
    nodes = json_chunk.get("nodes", [])
    scenes = json_chunk.get("scenes", [])
    scene_idx = json_chunk.get("scene", 0)
    root_nodes = scenes[scene_idx]["nodes"] if scenes else list(range(len(nodes)))

    def walk(ni: int, parent: np.ndarray):
        node = nodes[ni]
        # glTF node transforms use T * R * S; matrix arrays are column-major.
        M = parent
        if "matrix" in node:
            m = np.array(node["matrix"], dtype=np.float32).reshape(4, 4).T
            M = parent @ m
        else:
            T = np.eye(4, dtype=np.float32)
            if "translation" in node:
                t = node["translation"]
                T[0, 3], T[1, 3], T[2, 3] = t
            if "rotation" in node:
                x, y, z, w = node["rotation"]
                xx, yy, zz = x * x, y * y, z * z
                xy, xz, yz = x * y, x * z, y * z
                wx, wy, wz = w * x, w * y, w * z
                R = np.array(
                    [
                        [1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy), 0],
                        [2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx), 0],
                        [2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy), 0],
                        [0, 0, 0, 1],
                    ],
                    dtype=np.float32,
                )
                T = T @ R
            if "scale" in node:
                scale = node["scale"]
                T = T @ np.diag([*scale, 1.0]).astype(np.float32)
            M = parent @ T
        if "mesh" in node:
            mesh = json_chunk["meshes"][node["mesh"]]
            for prim in mesh.get("primitives", []):
                attrs = prim.get("attributes", {})
                if "POSITION" not in attrs:
                    continue
                pos = _read_accessor(json_chunk, buffers, attrs["POSITION"]).astype(np.float32)
                # transform positions
                ones = np.ones((pos.shape[0], 1), dtype=np.float32)
                pos_h = np.concatenate([pos[:, :3], ones], axis=1)
                pos_w = (M @ pos_h.T).T[:, :3]
                if "NORMAL" in attrs:
                    nor = _read_accessor(json_chunk, buffers, attrs["NORMAL"]).astype(np.float32)[:, :3]
                    try:
                        N3 = np.linalg.inv(M[:3, :3]).T
                    except np.linalg.LinAlgError as exc:
                        raise GlbLoadError("singular node transform") from exc
                    nor = (N3 @ nor.T).T
                    nor /= np.linalg.norm(nor, axis=1, keepdims=True) + 1e-8
                else:
                    nor = np.tile(np.array([[0, 1, 0]], dtype=np.float32), (pos_w.shape[0], 1))
                if "TEXCOORD_0" in attrs:
                    uv = _read_accessor(json_chunk, buffers, attrs["TEXCOORD_0"]).astype(np.float32)[:, :2]
                else:
                    uv = np.zeros((pos_w.shape[0], 2), dtype=np.float32)
                if "indices" in prim:
                    idx = _read_accessor(json_chunk, buffers, prim["indices"]).astype(np.int64).reshape(-1)
                else:
                    idx = np.arange(pos_w.shape[0], dtype=np.int64)
                interleaved = np.zeros((idx.shape[0], 8), dtype=np.float32)
                interleaved[:, 0:3] = pos_w[idx]
                interleaved[:, 3:5] = uv[idx]
                interleaved[:, 5:8] = nor[idx]
                albedo = None
                metallic = 0.0
                roughness = 0.5
                mat_idx = prim.get("material")
                if mat_idx is not None:
                    mat = json_chunk["materials"][mat_idx]
                    pbr = mat.get("pbrMetallicRoughness", {})
                    metallic = float(pbr.get("metallicFactor", 0.0))
                    roughness = float(pbr.get("roughnessFactor", 0.5))
                    tex = pbr.get("baseColorTexture")
                    if tex is not None:
                        ti = json_chunk["textures"][tex["index"]]
                        ii = ti.get("source")
                        if ii is not None:
                            img = json_chunk["images"][ii]
                            if "uri" in img:
                                albedo = str((images_dir / img["uri"]).resolve())
                            elif "bufferView" in img:
                                # embedded image — dump next to glb
                                bv = json_chunk["bufferViews"][img["bufferView"]]
                                blob = buffers[bv.get("buffer", 0)][
                                    bv.get("byteOffset", 0) : bv.get("byteOffset", 0) + bv["byteLength"]
                                ]
                                ext = ".png" if img.get("mimeType") == "image/png" else ".jpg"
                                dump = Path(path).with_suffix("") 
                                outp = Path(str(dump) + f"_img{ii}{ext}")
                                outp.write_bytes(blob)
                                albedo = str(outp)
                meshes_out.append(
                    {
                        "interleaved": interleaved,
                        "albedo_path": albedo,
                        "metallic": metallic,
                        "roughness": roughness,
                        "name": mesh.get("name", f"mesh_{node['mesh']}"),
                    }
                )
        for c in node.get("children", []):
            walk(c, M)

    I = np.eye(4, dtype=np.float32)
    for ni in root_nodes:
        walk(ni, I)
    if not meshes_out:
        raise GlbLoadError("no mesh primitives found")
    return {"meshes": meshes_out, "source": str(path)}
