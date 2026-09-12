# CARINA-RTX-20260910 — Service

Bind: `127.0.0.1:18793` only.

## Modes

| Mode | Status |
|------|--------|
| `baseline` | Mesh textured room (fixed windings + in-room camera) |
| `hq_pbr` | PBR albedo/normal/ARM + shadow maps + HDR IBL (**not Lumen**); dedicated worker process |
| `falcor_pt` | Still blocked in API; offline Mogwai MinimalPathTracer cornell frame **verified** → `falcorPathTrace=true` |
| `lumen_*` | blocked — no UE |

## Capabilities (live)

meshRender, pbrRasterIBL, falcorPathTrace = true; pathTraceDXR/lumen*/dlss* = false (NR false).

## Artifacts of note

- Baseline fixed: `artifacts/cd1bd2303cb2/` → Mac `live-baseline/`
- HQ 720: `5e17af2411b7`; HQ 1080: `8752369e60a9`
- GLB DamagedHelmet: `41bceca657b6` (+ re-run after albedo bind fix)
- Falcor: `artifacts/falcor_smoke/falcor_cornell_pt.ToneMapper.dst.24.png`

## Timing honesty

`render_ms` = submit+glFinish; `readback_encode_ms` = PNG acceptance path; not game FPS.
