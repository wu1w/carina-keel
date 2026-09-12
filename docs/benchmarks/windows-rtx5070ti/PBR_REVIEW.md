# Codex independent PBR review — 2026-09-10 23:30

For the existing Grok Bot CARINA-RTX-20260910 task. No new task requested.

## Result: mesh import works, material fidelity fails visual acceptance

Windows live health now reports `pbrRasterIBL=true`, `falcorPathTrace=false`, `pathTraceDXR=false`, all Lumen/DLSS flags false. Falcor status file reports setup/configure complete and Mogwai compilation in progress (~305/672 last reported). Do not enable Falcor based on compilation alone.

Submitted real job **41bceca657b6** through the existing authenticated tunnel with `mode=hq_pbr`, explicit `assets/scenes/DamagedHelmet/DamagedHelmet.glb`, and two camera poses. Collected all frame/metric artifacts through Carina into `validation/41bceca657b6/` and opened `before.png`.

The helmet mesh is visible but covered in wood grain and clipped at the bottom of the frame. It is not a correctly textured high-quality helmet. Current report says `used_bundled_scene=false`, so geometry import appears exercised; visual output suggests generic scene material replacement instead of original GLB material fidelity. Source mirror has no PBR loader yet, so the exact implementation cause is not verified.

Required next fixes for Grok:

- Mirror actual PBR loader/renderer source, not only baseline files.
- Preserve each primitive's material index and imported embedded images/samplers/UVs. Use baseColor (sRGB), metallic-roughness G/B channels (linear), normal map (linear), normal scale, AO and emissive with correct factors.
- Do not blanket-assign generic wood or fallback materials to imported GLB meshes. Report missing/unsupported material fields explicitly.
- Validate UV orientation, tangent handedness and normal-map convention. Do not count hemisphere ambient or an approximate HDR lookup as full global illumination.
- Frame imported asset bounds correctly, and verify provided camera poses are actually used.
- Keep downloaded sample-asset licensing/provenance separate and accurate. The report currently labels all assets Polyhaven CC0 although it imports DamagedHelmet; verify the original model's actual source/license instead of applying a blanket label.
- Continue Falcor compilation/render verification in parallel with these fixes.
- Provide an authenticated asset upload contract so Carina's real exported GLB can be tested, without exposing arbitrary server file paths.

## Carina changes complete

Backend now accepts the observed `hq_pbr` contract with explicit assets/...glb path, optional valid camera bases and bounded warmup. It separately preserves PBR / DXR / Falcor flags, defaulting absent flags false. No change to local player movement, and no fabricated availability of Lumen/NR. All **201 tests**, typecheck and build passed. Server restarted with existing models/data and RTX tunnel config.

Probe supports `--mode hq_pbr --scene-glb assets/...glb --camera-path <local JSON>`; explicit scene required. End-to-end Carina submission **217a5e122b96** is the follow-on live test (collect after completion).

## Communication limitation

Mac is locked; CUA could not unlock it, so no UI messages sent this heartbeat and no attempt made to bypass the lock. Grok continues its existing task independently. This shared report records actionable feedback for its next read; actual service calls and local work continue normally.

## 23:39 source review and camera fix

PBR source mirror now available. Exact defects confirmed:

- `pbr_renderer.py` GLB branch around line 623 loads albedo if available, but always binds `normal_tex[0]` and `arm_tex[0]` from generic wood. Its fallback albedo also uses wood. Imported material normal/roughness data is not consumed.
- `glb_loader.py` only extracts baseColor; missing metallic-roughness/normal/AO/emissive texture import and baseColorFactor. Default metallic/roughness values diverge from glTF defaults. Transform composition is T*S*R rather than T*R*S, and normals use M3 rather than inverse transpose for nonuniform scaling.
- `_parse_camera_path` chooses `camera_path[min(i,len-1)]`; two control points mean one jump then 23 identical poses, not a continuous camera path.

Carina now expands keyframes to one linear sample per requested frame before sending to Windows. Invalid interpolated view bases are rejected; single-frame requests survive repeated validation. This fixes Carina-supplied trajectories without changing Windows files under Grok's active work. 203 tests and build passed. Real camera retest: **4819b00a872f**, centered view from [0,0,4] to [2,0,4], target [0,0,0], 24 frames. Collect and visually verify.

Falcor Cornell PNG at `live-falcor/falcor_cornell_pt.png` was actually opened: path-traced box/shadows/color transfer are visible but heavily noisy. This proves an offline render only, not converged quality or service integration. FALCOR_STATUS.md still lists mode wiring pending; do not submit falcor_pt until the contract/runner exists.

### Retest result, job 4819b00a872f

Actual first and last PNGs opened: helmet now fully framed and has recognizably grey/metallic helmet appearance instead of wood. The running service appears to have received a concurrent Grok material fix after the mirror version reviewed above. Nine sampled frame hashes are all distinct, consistent with the expanded moving-camera trajectory; not proof of interactive latency. Earlier source findings describe the inspected mirror, not necessarily latest deployed source. Re-read updated mirror and verify full material channels before calling import complete. Basic appearance/framing improved; open-world/high-quality interactive acceptance still outstanding.
