# CARINA-RTX-20260910 — Progress

Times: Asia/Shanghai (UTC+8)

## Timeline

| Time | Event |
|------|-------|
| 22:56–22:58 | ENV probe complete (`ENV_REPORT.md`) |
| 22:58–23:01 | Scaffolded `C:\Users\wuyw\carina-rtx-validation\` + FastAPI service + ModernGL mesh path |
| 23:01–23:02 | Python 3.11.15 venv + fastapi/uvicorn/moderngl/glfw/Pillow/numpy installed |
| 23:02 | Offline smoke render: OpenGL 3.3 NVIDIA GeForce RTX 5070 Ti — `meshRender=true` |
| 23:03 | Service started on `127.0.0.1:18793` (pid recorded under `logs/service.pid`) |
| 23:03 | `GET /health` OK — honest capabilities |
| 23:03 | Baseline job `bd27e797f19c` 1280×720×60 **completed** |
| 23:03 | Baseline job `d629806de8f8` 1920×1080×60 **completed** |
| 23:03 | Placeholder modes `lumen_sw` / `lumen_hw` / `lumen_dlss_nr` return **blocked** with reasons |

| 23:16–23:18 | **Mesh bugfix**: camera radius 3.2→1.85 (inside clear space); all room quad windings auto-validated against inward normals (CULL kept). Baseline job `cd1bd2303cb2` 1280×720 verified (before/after mean RGB ~73/93, std~22/27 — real interior, not noise/black). Frames under `live-baseline/cd1bd2303cb2/`. Honest timings: render_ms P50≈0.13 / readback_encode P50≈1.8. Resuming HQ PBR. |

| 23:16–23:18 | Mesh winding+camera fix; baseline `cd1bd2303cb2` verified interior |
| 23:22 | HQ PBR offline `5e17af2411b7` 720p — `pbrRasterIBL=true` (Polyhaven PBR+shadowMap+IBL, **not Lumen**) |
| 23:26 | HQ PBR 1080p `8752369e60a9`; Falcor Mogwai MinimalPathTracer cornell capture PNG verified |
| 23:27 | GLB DamagedHelmet job `41bceca657b6` completed (render-validation asset) |
| 23:27 | Health: meshRender+pbrRasterIBL+falcorPathTrace true; lumen*/NR false |

## Verified

- Mesh interior windings + in-room camera path (`cd1bd2303cb2`) — see `live-baseline/cd1bd2303cb2/`
- Timing honesty: `render_ms` / `readback_encode_ms` split (not claimed as game FPS)
- Job ID path validation `^[0-9a-f]{12}$` on `/jobs` and `/artifacts`

- Local HTTP service bound **only** to `127.0.0.1:18793`
- Auth via on-disk `.api_key` (`Authorization: Bearer` or `X-Api-Key`) — key **not** in any markdown
- GPU path: ModernGL/GLFW, vendor `NVIDIA Corporation`, renderer `NVIDIA GeForce RTX 5070 Ti/PCIe/SSE2`
- Procedural textured interior (floor/walls/ceiling/accent) + orbit camera path
- Artifacts + `benchmark.json` for both resolutions

## Still false / blocked

- `lumenSW`, `lumenHW`, `dlssSuperResolution`, `dlssNeuralRendering` — see `BLOCKERS.md`
- No Unreal Engine; no Streamline/DLSS NR SDK

## Isolation respected

- No llama/LLM/model service changes
- No reboot, no firewall changes, no public endpoints

## 2026-09-10 23:17 CST — baseline visual fix verified

Root cause (Codex): interior quad winding opposite inward normals + camera radius 3.2 outside room ±2.5; with CULL_FACE, inside views culled (black), outside saw wrong faces (noise).

Fix in `service/mesh_renderer.py`: auto-correct quad winding to match inward normals; camera orbit radius 1.7 inside clear space; keep CULL_FACE on; added interior pedestal; split `render_finish_ms` vs `readback_encode_ms`.

Re-run job `7f3ed8ed792d` (1280×720×48): before/after/strip show real textured interior (wood floor, plaster walls, accent panel) along path — not gray noise / black. Artifacts: `live-baseline/7f3ed8ed792d/`. Still baseline mesh quality; HQ PBR/DXR continues separately.

## 2026-09-11 — GLB upload + assetId (tavern pipeline)

- Added authenticated `POST /assets/glb` + `GET /assets/{assetId}` with sha256 content-hash dedup (`assetId` = first 16 hex).
- Jobs prefer `assetId`; absolute Windows `scene_glb` rejected (HTTP 400).
- `MAX_CONCURRENT=1` for heavy GPU work.
- Roundtrip evidence: upload DamagedHelmet → `assetId=a1e3b04de97b11de`, dedup true, job `7cf5e6835010` completed baseline 320x180; see Windows `logs/upload_roundtrip_evidence.json`.
- Source mirrored under `service-mirror/service/{app,jobs,config,assets_store}.py`.

## 2026-09-11 — GLB transform patch deployed

- Rebased `glb-transform-fix.patch` onto live loader; deployed Windows `service/glb_loader.py`.
- Kept existing material-channel handling; did **not** blanket wood normal/ARM onto GLBs.
- CPU regression tests passed on Windows venv.

## 2026-09-11 — Blender installed + first lightmap_bake OK

- No winget on DESKTOP-RLADDRR; installed portable **Blender 4.5.13 LTS** zip under `C:\Users\wuyw\carina-rtx-validation\bin\blender-4.5.13-windows-x64\`.
- Fixed bake script colorspace for 4.5 (`Linear Rec.709`).
- First job `c5c6ea68d59d` on assetId `a1e3b04de97b11de`: artifacts `lightmap.png` + `baked_uv2.glb` + `lightmap_manifest.json`; elapsed ~2.7s at 512² / 32 samples.
- nvidia-smi before/after both 794 MiB (delta 0) — bake likely CPU Cycles on this quick run; GPU device selection still to harden for heavier tavern bakes. Record Blender Cycles peak mem ~53 MiB in log.
- Evidence: Windows `logs/lightmap_bake_evidence.json`.

## 2026-09-11 — frames=1 + public scene refs

- Removed hidden `max(8, …)` clamp in `mesh_renderer` / `pbr_renderer`; submit clamps `frames` to 1..300.
- `benchmark.json` now uses `assetId` + `relativePath`; no Windows absolute `scene_glb`.
- `assets_label` reflects upload vs bundled Polyhaven room maps.
- One-frame evidence job `c380f2635ff9` (assetId `ac37c156cee5773d`): bench frames=1, frame_timings=1. Protocol/coarse only — not quality pass.

## 2026-09-11 — UE 5.8.2 installed (P0 unblocked)

- Engine: `G:\UE_5.8` / **5.8.2** / `UnrealEditor.exe` OK
- Pixel Streaming plugin on disk; signalling servers not yet fetched
- Epic launcher login done via UU; William finished install manually
- P0 packaged Pixel Streaming + browser input + GLB cook timing still **not started**

## 2026-09-11 — P0 after UE: scaffold + PS infra

- Registered `G:\UE_5.8` in `LauncherInstalled.dat` + HKCU Builds
- Scaffolded `G:\carina-ue\CarinaPS` (EngineAssociation 5.8, PixelStreaming enabled in `.uproject`)
- Ran `get_ps_servers.bat` → downloaded **PixelStreamingInfrastructure UE5.7-0.1.2** into engine WebServers (`SignallingWebServer`, Frontend, SFU, Matchmaker). Note: bat selected UE5.7 tag on a 5.8.2 engine; may need UE5.8 infra if incompatible.
- Still **not** P0-complete: no packaged runtime / browser input / GLB cook timing yet

## 2026-09-11 — P0 packaged Pixel Streaming slice

- Packaged: `G:\\carina-ue\\CarinaPS\\Packaged\\Windows\\...\\CarinaPS.exe` (UE 5.8.2, Dev)
- SWS: 8080/8888/8889; frontend `http://127.0.0.1:8080/player.html`
- Streamer connected; player UI CLICK TO START; **video frame / Mac ICE / GLB hotload still open**
- Status JSON: `logs/p0_ps_slice_status.json` on Windows


## 2026-09-11 11:53 Asia/Shanghai — Win PS2 video GREEN + Mac docs/ICE

- **Win GREEN:** `logs/p0_ps_accept.json` ok=true — 1280×720, framesDecoded rising, ICE connected, reconnect ok; PS2 EpicRtc; package `CarinaPS.exe` ~10:53; classic PS off / PS2 on; SFU off; loopback `127.0.0.1:8080`+`:8888`; sidecar `18793` intact
- **peer_options:** empty-string bug fixed via `peer_options.json` + `--peer_options_file`
- **Scripts:** `start_sws_ps2_loopback.bat`, `start_streamer_ps2.bat` (`-PixelStreamingConnectionURL=ws://127.0.0.1:8888`); LAN dual `start_sws_ps2_lan.bat` / `restart_ps2_stack_lan.bat` (`public_ip=192.168.5.16`); `firewall_ps2_lan_private.ps1` applied (Private/LocalSubnet)
- **Mac docs synced:** `RUNTIME_CONTRACT.md`, `P0_RUNTIME_STATUS.md`, this file; Mac mirror `runtimes/unreal/CarinaPS` README + uproject (PS2) + Config — **no `src/` edits**
- **Mac ICE:** **HARD_BLOCK** — Mac not on `192.168.5.0/24` (`en0=192.168.241.95` + V2BOX); evidence `logs/p0_mac_ice_block.json`. Do not claim WebRTC from HTTP SSH tunnel alone.
- **Next:** GLB hotload / single-asset cook timing; Mac ICE when Mac joins home LAN
- Isolation: no reboot; AIGA/llama untouched

## 2026-09-11 12:02 Asia/Shanghai — GLB import + single-asset cook timing (no full repackage)

- **Runtime GLB hotload into packaged `CarinaPS.exe`:** **BLOCKED** — packaged plugins lack Interchange/glTFRuntime (NNE only observed); no custom loader; cooked assets not mounted into Packaged IoStore/pak.
- **Editor path WORKS (no full-game repackage):**
  - Import: `UnrealEditor-Cmd -run=ImportAssets` Interchange `.glb` → `/Game/Imported/DamagedHelmet` (StaticMesh + `Material_MR` + 5 textures; Nanite build). Commandlet **1.91s**; Interchange span ~**1.27s**; mesh build **0.64s**; process wall ~**14s**.
  - Cook: `-run=Cook -TargetPlatform=Windows -package=/Game/.../StaticMeshes/DamagedHelmet` → `Saved/Cooked/Windows/.../Content/Imported/...` (**Packaged pak mtime unchanged** `10:56:58`, 11262059 bytes).
  - First cook with new asset: wall **20.42s** / commandlet **12.10s** / `CookWallTime` **16.01s**; packages total **594** (AlwaysCook `/Game/ThirdPerson` still pulls ~580 on non-iterate).
  - Iterate no-op: wall **10.42s** / commandlet **3.82s**; **0 cooked / 587 skipped**.
- **PBR:** partial — `Material_MR` + textures + SM5/SM6 shadermaps; **not** visually proven in PS player; **not** HQ tavern claim.
- **Collision:** partial/unproven — cook DDC shows BodySetup/NavCollision bytes; no pipeline collision settings verified; no packaged physics probe.
- **Sidecar `127.0.0.1:18793`:** intact; GLB upload/render path remains **separate** from UE PS play path.
- **Win PS2 GREEN preserved:** SWS `8080` HTTP 200; streamer `8888`; `CarinaPS` pid 19040 since 11:08; no reboot; AIGA/llama untouched.
- Evidence: `C:\Users\wuyw\carina-rtx-validation\logs\p0_glb_cook_timing.json` (+ import/cook logs `p0_glb_import_cmd.log`, `p0_glb_cook_package.log`, `p0_glb_cook_iterate.log`)
- **Next:** pak/IoStore mount or chunk for cooked prop into running package **or** Interchange-in-game plugin; Mac ICE when on LAN

## 2026-09-11 12:22 Asia/Shanghai — test-mirror IoStore inject SUCCESS (LIVE untouched)

- UnrealPak IoStore side container `DamagedHelmet-Windows.{utoc,ucas}` + basename-matched `.pak` from `Saved/Cooked` Imported/DamagedHelmet (~0.45s container; no full BuildCookRun).
- Test-mirror mount: NumPackages=7; soft-path hits `Material_MR` AssetLog (not SkipPackage). Live Packaged Paks SHA256 unchanged in that slice.
- Evidence: `C:\Users\wuyw\carina-rtx-validation\logs\p0_glb_pak_inject.json`

## 2026-09-11 12:30 Asia/Shanghai — LIVE IoStore inject applied + soft-path proven

- **LIVE inject YES:** copied `DamagedHelmet-Windows.{pak,utoc,ucas}` into `G:\carina-ue\CarinaPS\Packaged\Windows\CarinaPS\Content\Paks\` (additive; did **not** replace `global.*` or `CarinaPS-Windows.*`).
- Backup: `C:\Users\wuyw\carina-rtx-validation\artifacts\p0_glb_pak_inject\live_paks_backup_pre_inject\20260911_122743`
- Original 5-file SHA256 **unchanged** after inject.
- **LIVE mount proof** (PS restart log): `Mounted DamagedHelmet-Windows.utoc Id=c41634b0364f4257 NumPackages=7`; PackageStore `TotalPackages=588`.
- **Soft-path LIVE:** `logs/p0_live_inject_softexist.log` — `Material_MR` AssetLog under LIVE Packaged path (not SkipPackage). StaticMesh is not a Map → expected LoadMap fail.
- **Spawn/visual:** **HARD_LIMIT** — no packaged spawn API / Blueprint / level SoftRef; Premade `AssetRegistry.bin` lacks DamagedHelmet; ExecCmds probe did not place mesh into world; no PS player screenshot of helmet.
- **One-click scripts:** `G:\carina-ue\CarinaPS\scripts\inject_damagedhelmet_iostore.bat` + `.ps1` (`inject|remove|status`, optional `-RestartStreamer`).
- **PS2 still GREEN:** SWS `8080`=200; streamer `8888` ESTABLISHED; sidecar `18793` UP (401 without key); CarinaPS pid 22060; restartable via existing `restart_ps2_stack*.bat`.
- Evidence: `logs/p0_live_inject_apply.json` (+ Mac mirror `validation/p0_live_inject_apply.json`)
- Isolation: no full BuildCookRun; no reboot; AIGA/llama untouched; no Mac `src/` edits.
- **Next:** BP/level SoftRef or tiny cook of a placing map for visual spawn; Mac ICE when on LAN.

## 2026-09-11 13:50 Asia/Shanghai — DamagedHelmet SoftRef spawn BP + IoStore inject

- Authored `BP_SpawnDamagedHelmet` + `Lvl_HelmetSpawn` / `Lvl_HelmetFromTP` via Editor Python automation (no full GUI).
- Incremental cook + UnrealPak IoStore side container (9 pkgs) injected live; original Packaged SHA unchanged; no full BCR.
- Soft path / LoadMap proven in packaged streamer logs; **helmet pixels in PS player not yet proven** (exposure + WP external-actor cook gap).
- Evidence: Windows `logs/p0_glb_spawn_bp.json`. PS2 green + sidecar 18793 preserved.


## 2026-09-11 14:19 CST — helmet visual proven
- `visual_proven: true` via `Lvl_HelmetVis` in PS (see validation/p0_glb_spawn_bp.md).
- PS2 / sidecar 18793 preserved; no full BuildCookRun; no Mac src/.

## 2026-09-11 15:04 CST — P0 PRIORITY1 Material_MR (NOT complete)

- Diagnosed SM6 shadermap miss (`1DA4D67AA48F72E0`) + Nanite usage + MountOrder=3 side-pak limit.
- Authored `M_HelmetPBR`; Order=204 inject clears Missing-shader; full ShaderArchive replace → D3D12 residency fatal.
- **Blocked** on MERGE-only shader library patch. PBR close-up **not** proven. Stop before item 2.
- Evidence: `validation/p0_pbr_material_mr.json`; Windows `logs/p0_pbr_material_mr.json` + `p0_pbr_material_mr_highres.png`.
- Sidecar 18793 / original pak SHA preserved; VPN not killed.

## 2026-09-11 15:39 CST — P0 Item 1 Material_MR PBR PROVEN

- Host Dev package rebuilt; Material_MR in main ShaderArchive (1783).
- PS2 Lit close-up mean RGB~[73,71,72] chroma 8.88 > BasicShape baseline 2.92; gold metallic + weathering visible.
- Screenshots: `p0_pbr_material_mr_close_proven.png`, `*_highres_proven.png`, `*_wide_highres.png`.
- Interface note: generative assets need shader-library cook/merge; fail keeps old scene. Next = WorldRuntime dynamic entry (not more helmet lighting).

## 2026-09-11 16:23 CST — UE-02 follow-up AFTER LIVE (pbr-orbit + collision)

- Material_MR FRONT/SIDE/orbit stills + gif/mp4: **PARTIAL** full-object (HardRef scale=100); shader log clean (no Missing/Default).
- Collision: move avocado/boombox UE ~0.005ms; remove ~0.048ms; respawn ~1.0ms; hitch walkaround mean ~16.7ms, max 33ms, 0×>40ms.
- Paths: Win `logs/ue02_material_mr_*.png|gif|mp4`, `logs/ue02_collision_orbit.json`; Mac `validation/ue02_*`.
- Stopped before lighting polish. `:18794` live; `:18793` preserved.


## 2026-09-11 16:52 CST — UE-03 closeout (STOP for Cursor acceptance)

- Item1 collision: BlockAll + `player_pose`/`highresshot` walkaround visuals on BoomBox; WASD PS sky-locked under RenderOffScreen (honest). Hitch prior sample 0×>40ms.
- Item2 visuals: **BoomBox_Mat PBR** front/orbit/strafe stills; Avocado remains Default (Missing shader). Not helmet.
- Item3 bind: `:18794` = **127.0.0.1** loopback (`netstat` + `config.HOST`). Sidecar `:18793` intact. HTTP ≠ WebRTC.
- Item4 shaders: **REQUIRED host cook**; `shaderMergeOk=false`; no full ShaderArchive replace.
- Item5 Mac sync: `validation/ue03_closeout.json`; portable `runtimes/unreal/CarinaPS/Source` + `world_runtime/*.py`; Content **not** mirrored.
- Win IPC: added `player_pose` + `highresshot` ops; rebuilt Packaged `CarinaPS.exe`.
- **Do not claim P0/P1 complete. Do not start tavern art.**

## 2026-09-11 17:24 CST — UE-04 closeout (STOP for Cursor)

### Proven
- WorldRuntime `:18794` LISTENING `127.0.0.1` (pid kept; config.HOST loopback). Sidecar `:18793` pid **2108** intact.
- Private reverse tunnel Win→`vps` `-R 127.0.0.1:18794` up; pid `logs/tunnel_win_to_vps_18794.pid`. `:18793` tunnel not stolen.
- Mac PNGs: `validation/ue03/` BoomBox contact/stop, strafe, orbit, front/far HighResShots.
- API sync: `docs/runtimes/unreal/UE02_WORLD_RUNTIME_API.md` (+ contract copy) = LIVE `:18794`, smoke `ue02-final`, Avocado/BoomBox hashes, Euler XYZ, loopback.
- `ACCESS.md`: Mac `-L 127.0.0.1:18794 … ixiaotao-cloud` documented. **HTTP tunnel ≠ WebRTC.**

### Blocked / honest (unchanged)
- Collision walkaround **PARTIAL** (player_pose visuals; WASD PS sky-locked under RenderOffScreen).
- Avocado shader **Missing** → Default Material; `shaderMergeOk=false`; host cook still required; no full ShaderArchive replace.
- Mac WebRTC / PS ICE **HARD_BLOCK** (VPN/LAN).
- No Mac `src/`; no tavern; no helmet polish; no Avocado host cook this round.

Evidence: Win `logs/ue04_closeout.json` → Mac `validation/ue04_closeout.json`.

## 2026-09-11 17:56 CST — UE-05 Avocado host cook MERGE (STOP for Cursor)

- Host Development cook with AlwaysCook `/Game/Imported/Dynamic/Avocado` (+BoomBox) → ShaderMapHash `03303C52B6749A75` for `2256_Avocado_d` in main CarinaPS ShaderArchive (601 pkgs; SM6 unique shaders 1786).
- BuildCookRun `-skipcook -stage -pak -iostore -archive` MERGED into Packaged main (not Order=204 full ShaderArchive replace). Side Avocado/BoomBox containers kept; BoomBox still playable.
- Streamer logs: **0** Missing-shader / `03303C52` / Failed-to-compile after activate+spawn. `asset_registry.shaderMergeOk=true`.
- Mac stills: `validation/ue05/` (≥2 HighResShots). Closeout: Win `logs/ue05_closeout.json` + Mac `validation/ue05_closeout.json`.
- Kept: `:18794` loopback + Win `-R 18794`; `:18793` intact. No Mac `src/`; no tavern/helmet/VPN/sshd/reboot/AIGA. P0/P1 **not** claimed. WASD sky PARTIAL left.
