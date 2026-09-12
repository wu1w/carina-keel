# P0 Material_MR SM6 shadermap — PROVEN (2026-09-11 15:39 CST)

## Result
**Item 1 SUCCESS.** Packaged PS2 Lit close-up shows real `Material_MR` PBR (weathered albedo, normals, gold metallic sheen) — not flat BasicShape.

## How fixed
- **Host Development rebuild** (Cook + `BuildCookRun -skipcook -stage -pak -archive`) cooked `Material_MR` + `M_HelmetPBR` into **main** `CarinaPS` ShaderArchive.
- CarinaPS library: **1776 → 1783** unique shaders; hash `1DA4D67AA48F72E0` present; **no** Missing-shader at runtime.
- `bShareMaterialShaderCode=True` **unchanged** (never flipped).
- Side-container **full** ShaderArchive replace at Order=204 was abandoned (D3D12 residency fatal). Content-only inject without shader merge was insufficient.

## Capture (do not re-polish lighting)
- BugItGo `800 0 300 -15 180 0` via **.bat-quoted** `-ExecCmds=...` (PowerShell `ArgumentList` previously zeroed coords → near-black).
- dpcvars: `r.EyeAdaptation.CachedLightingPreExposure=1.5,r.DefaultFeature.AutoExposure=0`
- Player close mean RGB ≈ `[73,71,72]`, chroma **8.88** vs BasicShape baseline chroma **2.92**.

## Screenshots (Windows)
- `C:\Users\wuyw\carina-rtx-validation\logs\p0_pbr_material_mr_close_proven.png`
- `C:\Users\wuyw\carina-rtx-validation\logs\p0_pbr_material_mr_highres_proven.png`
- `C:\Users\wuyw\carina-rtx-validation\logs\p0_pbr_material_mr_wide_highres.png`
- Evidence: `logs/p0_pbr_material_mr.json` + Mac `validation/p0_pbr_material_mr.json`

## WorldRuntime interface implications
- New materials/meshes for generative assets **must** land ShaderCode in host CarinaPS library (cook into main package or MERGE hashes). Full side ShaderArchive replace → residency crash.
- Dynamic entry API should treat **UE cooked package as cache only**; install/activate must include shader-library merge or host re-cook of touched materials.
- Fail path must keep old scene (do not mount broken shader overrides).
- Transform: Carina meters Y-up → UE cm Z-up centralized at boundary.
- ExecCmds multi-command strings must be single argv (quoting); camera/teleport is part of validation UX only, not product API.

## Stop
Item 1 complete. Do **not** start item 2 lighting polish. Next: generic dynamic asset entry per COORDINATION / RUNTIME_CONTRACT.
