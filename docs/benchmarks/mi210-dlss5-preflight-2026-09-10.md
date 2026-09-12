# MI210 / DLSS 5 / Lumen compatibility preflight

Run against SSH host `aiga`, without changing drivers or restarting world-generation services.

## Executed

- PCI enumeration: AMD Instinct MI210 at 03:00.0; Raphael integrated graphics at 0c:00.0.
- ROCm enumeration: MI210 `gfx90a`, wave64; integrated GPU `gfx1036`, wave32.
- PyTorch 2.10.0+rocm7.0: device 0 reports a generic `AMD Radeon Graphics` name, but its architecture `gfx90a:sramecc+:xnack-` and 64 GiB memory identify the MI210. Device names alone must not select the accelerator.
- Explicit gfx90a FP16 1024×1024 matrix multiplication: numerical check passed. Ten warmed iterations averaged approximately 0.025 ms. This only checks a small compute operation; it is NOT DLSS inference, an end-to-end performance result, or evidence of attainable rendering FPS.
- `vulkaninfo --summary`: only RADV Raphael integrated GPU and CPU llvmpipe enumerated. MI210 is absent from the installed Vulkan graphics device list.
- `wine` and `UnrealEditor` were not found on PATH. No installer, NVIDIA DLL, or unofficial executable was run.

Reproduction: copy `scripts/probes/mi210-render-capabilities.py` to the server and run with the existing LingBot virtual environment. Raw output: `mi210-render-capabilities-2026-09-10.json`.

## Examined implementations

- https://github.com/danielblnc/DLSS-NR-on-AMD : its README requires Windows 11, DX12/FSR, RDNA4/RDNA3 and an Adrenalin driver. Public repository lists documentation and binary releases, not a gfx90a-buildable runtime source tree. It requires a user-supplied Neural Rendering DLL. Its reported RX 9070 XT result must not be extrapolated to MI210.
- https://github.com/ccoredesenvolvimento/dlss5-linux-bridge : NGX/D3D12 forwarding under Proton, not a ROCm implementation. README explicitly says vendor-neutral Vulkan/HIP/ZLUDA runtime is a possible follow-up and is not implemented.
- https://dev.epicgames.com/documentation/unreal-engine/lumen-technical-details-in-unreal-engine?lang=en-US : Lumen provides software and hardware ray tracing for GI/reflections. It is an Unreal subsystem, not a standalone substitute for the whole rasterization pipeline. Software tracing does not remove the need for a working engine graphics backend.
- https://instinct.docs.amd.com/projects/system-acceptance/en/latest/gpus/mi210.html : MI210 is CDNA2/gfx90a, not RDNA3/4.

## Result

**Compute preflight passed; graphics preflight does not expose MI210; DLSS 5 and Lumen themselves were NOT run.**

The available AMD mod cannot be installed directly on this Linux/CDNA2 machine. A MI210 experiment would require a Linux ROCm/gfx90a-compatible neural runtime (source or binaries), compatible model inputs/weights and a way to exchange rendered buffers. A Proton forwarding wrapper alone cannot provide those pieces. This does not establish that porting the model to MI210 is theoretically impossible.

Lumen on the MI210 is likewise not a presently working path with this driver/engine setup. MI210 remains usable for background generation and compute workloads; real-time engine rendering needs a supported graphics device/backend. Cross-machine enhancement would additionally need measured upload, inference, encoding, networking and presentation latency.
