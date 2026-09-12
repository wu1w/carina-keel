"""CPU marching-cubes stand-in for TripoSR on ROCm. Not CUDA torchmcubes."""

from __future__ import annotations

import numpy as np
import torch
from skimage.measure import marching_cubes as sk_marching_cubes


def marching_cubes(volume, threshold: float = 0.0):
    vol = volume.detach().cpu().numpy() if torch.is_tensor(volume) else np.asarray(volume)
    verts, faces, _normals, _values = sk_marching_cubes(vol, level=float(threshold))
    v_pos = torch.from_numpy(np.ascontiguousarray(verts.astype(np.float32)))
    t_pos_idx = torch.from_numpy(np.ascontiguousarray(faces.astype(np.int64)))
    return v_pos, t_pos_idx
