# CARINA-RTX-20260910 — Grok Bot Windows service work order

William explicitly authorized Codex to ask the running local Grok Bot to provision the LAN Windows machine with an RTX 5070 Ti. Use existing connections, isolate this work from existing model services.

## Goal

A real 3D render/optional neural-enhancement validation sidecar, not an image filter falsely labeled DLSS 5. Carina currently runs on the Mac at localhost:18790. Its scene pipeline persists GLB geometry and colliders; input is handled locally. Windows should provide measured graphics capabilities and artifacts before any gameplay transport is changed.

## Environment and setup

Identify the Windows host, LAN address, GPU, VRAM, driver, D3D12/DXR support, disk availability, Unreal, VS Build Tools, Windows SDK, Streamline and DLSS SDK/runtime availability. Use an independent directory. Prefer existing/vendor-provided tools. Do not reboot, change existing LLM services, disable protections, or expose unauthenticated public endpoints. Report concrete blockers requiring purchases, new agreements, unknown-origin executables or access changes; continue independent work.

## Service contract

Prefer unused port 18793, initially localhost through an existing secure tunnel. Keep credentials on their machines, not in chat.

- GET /health: GPU/driver/backend, ready, verified capabilities: meshRender, lumenSW, lumenHW, dlssSuperResolution, dlssNeuralRendering. Unverified capability is false.
- POST /jobs: asynchronous render/benchmark submission.
- GET /jobs/:id: state/progress/error.
- GET /artifacts/:id: allowlisted task artifacts.
- Bounded queue, persisted task logs/results, isolated cache, reproducible start/stop commands.

## Graphics validation

Build an actual textured interior with a deterministic camera path using an available Unreal/D3D12 backend. Compare baseline, Lumen (explicitly software/hardware), and Lumen + DLSS 5 NR only if the corresponding SDK/runtime actually works. DLSS SR/frame generation, CUDA matmul, ordinary upscaling, empty HTTP endpoints, or merely detecting an RTX card do not validate DLSS 5 NR.

NR must use appropriate engine-produced color/motion vectors, temporal state and controls. If SDK/runtime unavailable, report the exact missing artifact and finish the runnable baseline/Lumen parts. Geometry/material exports and final display enhancement are separate artifacts.

## Measurements and handoff

At 720p and 1080p, run the same continuous camera sequence after warmup; report frame CPU/GPU P50/P95, peak VRAM, isolated NR cost where measurable, queue/load time and total processing time. Include same-camera images and continuous-frame output. 1080p60 is a target, not an unmeasured claim. Measure Mac-to-service transport separately before asserting game-like latency.

First reply with connection/environment/work directory, then continue. Final report: verified and blocked capabilities, protected access method without secrets, artifact paths, benchmark.json, exact start/stop commands and how Codex can collect the results. If possible write progress and final reports to this Mac's docs/benchmarks/windows-rtx5070ti/ directory; do not change other world repository files.
