# CARINA-RTX-20260910 — Blockers

Updated: 2026-09-10 (Asia/Shanghai)

## lumenSW / lumenHW — BLOCKED

- **Required**: Unreal Engine install with Lumen (SW and HW/RT paths).
- **Present**: No Unreal / Epic Games under `C:\Program Files\Epic Games`; `UnrealEditor` not on PATH.
- **Why not auto-installed**: Epic Games Launcher / UE download requires interactive Epic account login and a large download (tens of GiB). This agent does not perform interactive Epic login or purchase/agreement flows.
- **William action**: Install Epic Games Launcher, sign in, install UE5.x with Lumen, then re-run validation to wire `lumen_sw` / `lumen_hw` job modes.

## dlssNeuralRendering — BLOCKED

- **Required**: NVIDIA Streamline SDK + DLSS Neural Rendering (DLSS 5 NR) integration artifacts and an engine/plugin path that can invoke them.
- **Present**: Only game/NVIDIA App NGX runtime fragments (e.g. `NvDLISR`, game `NGX_Logs`). **No Streamline SDK**, no DLSS NR developer package.
- **Detecting RTX / NGX game DLLs is not NR validation.**
- **William action**: Download Streamline + DLSS NR SDK from NVIDIA developer program (account/license may be required) into a known path and point the service at it.

## dlssSuperResolution — NOT VERIFIED (false)

- NGX runtime bits may exist on the system, but there is no Streamline integration or engine path exercised by this service.
- Remains `false` until a real SR pass is wired and measured.

## meshRender — FEASIBLE / implemented

- Implemented via ModernGL + GLFW OpenGL 3.3 core on the NVIDIA GPU (vendor string checked).
- Fallback chosen over custom D3D12 C++ binary for faster deterministic Python deployment with existing VS Build Tools remaining available for a future D3D12 path.
- Procedural textured interior room + fixed orbit camera path; baseline jobs produce `benchmark.json` + before/after PNGs.

## Out of scope / isolation

- No changes to llama/LLM/model services.
- No reboot, no firewall changes, no public bind (127.0.0.1 only).


## falcorPathTrace — VERIFIED offline

- Mogwai.exe built; cornell MinimalPathTracer PNG captured under `live-falcor/`.
- Service `mode=falcor_pt` still returns blocked (wiring pending); capability flag true from offline evidence.
- Packman DLSS ≠ Neural Rendering.

## Reverse SSH tunnel — BLOCKED on Mac sshd

- Windows OpenSSH client present; Mac `:22` closed. William: enable Remote Login.

### Update 2026-09-11
Blender 4.5.13 LTS portable installed under carina `bin/`; `lightmap_bake` unblocked. Remaining: force Cycles GPU (CUDA/OptiX) and sample VRAM mid-bake for peak.


## Packaged spawn of injected StaticMesh — HARD_LIMIT (2026-09-11 12:30)

- Additive IoStore side-container **mount + soft-path** work on LIVE Packaged PS2.
- **Blocked for visual/play placement:** no packaged Blueprint/console spawn API that SoftLoads `/Game/Imported/DamagedHelmet/.../StaticMeshes/DamagedHelmet` into the ThirdPerson world; Premade `AssetRegistry.bin` does not list the injected asset.
- Unblock path (not done this slice): cook a tiny placing level/BP SoftRef (still avoid full BuildCookRun) **or** ship a runtime spawn Exec/HTTP hook in the packaged game.
- Raw `.glb` hotload remains separately blocked (no Interchange in package).

## Material_MR SM6 shadermap / PBR visual (2026-09-11 15:04)

- Packaged shader library missing hash `1DA4D67AA48F72E0` for Material_MR.
- Full ShaderArchive override (Order=204) clears error but crashes: `pSet->Open() failed` / D3D12Residency.
- Unblock: merge-only ShaderCode into packaged CarinaPS archive; inject as `CarinaPS-Windows_*_1_P`.
- Do not flip `bShareMaterialShaderCode`.

## Material_MR SM6 shadermap / PBR visual — RESOLVED (2026-09-11 15:39)

- Host rebuild cooked MR+HP into main CarinaPS ShaderArchive (1783 shaders). Packaged Lit close-up proven.
- Abandoned: Order=204 full ShaderArchive replace (residency fatal); content-only without shader merge.
- Kept: bShareMaterialShaderCode=True; sidecar :18793 untouched.
- See `runtimes/unreal/P0_MATERIAL_MR_SHADERMAP.md` + `validation/p0_pbr_material_mr.json`.

## Avocado Missing shader — RESOLVED (2026-09-11 17:56)

- Host cook AlwaysCook Avocado + skipcook stage/pak MERGED `03303C52B6749A75` into main CarinaPS ShaderArchive.
- Streamer: no Missing-shader for `2256_Avocado_d`. Evidence: validation/ue05_closeout.json + validation/ue05/ stills.
