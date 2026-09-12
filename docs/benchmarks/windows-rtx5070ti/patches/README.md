# GLB transform deployment candidate

Status: **deployed to Windows service** on 2026-09-11 (Asia/Shanghai).

`glb-transform-fix.patch` was rebased onto live `service/glb_loader.py`. Live and candidate differed only by the three transform/interleaved fixes; material-channel code was already aligned. Procedural wood textures remain mesh-baseline-only (`mesh_renderer.py`), not applied to uploaded GLBs.

Changes:

- Node composition T*R*S (previous T*S*R distorted rotated, nonuniformly scaled objects).
- Inverse-transpose normal transformation; singular transforms fail explicitly.
- Interleaved accessors only require bytes through the last element, not nonexistent padding after it.

Verified: `python -m unittest test_glb_transforms.py -v` on Windows venv (service dir). Mirrored to `service-mirror/service/glb_loader.py`.
