# P0 Runtime Status — UE5 Pixel Streaming gate

Date: 2026-09-12 (Asia/Shanghai). Scope: CARINA-RTX-20260910 / NG P0 then P1 sample gates. Preferred path: **UE5 + PixelStreaming2**.

## Update 2026-09-12 09:55 Asia/Shanghai — P0 工程关口通过（样板≠生成）

| Gate | Status | Notes |
|------|--------|-------|
| P0-T Mac tests | **GREEN** | WorldRuntime HTTP rejects `glbPath`/`glbUrl`; prepare needs `assetId`+64 hex; upload sidecar assetId is not world-model; export `claimsWorldModelGeneration=false` |
| P0-1 LAN PS2 | **GREEN** | Mac `http://192.168.5.16:8080/player.html` ICE `connected`, `framesDecoded` rising; HTTP 200 is not this proof. `:18793`/`:18794` stay loopback |
| P0-2 new GLB cook/spawn | **GREEN (entry)** | Uploaded scaffold `assetId` `8dd45448bbac70a0` prepare→install→activate→spawn. **Not Avocado reuse. Not P1 art. Not world-model.** `shaderMergeOk=false` |
| P0-3 windowed WASD | **GREEN (engineering)** | Windowed, no `-RenderOffScreen`; indoor floor + wall box. Not standing on BoomBox |
| P0 product | **P0 工程关口通过（样板≠生成）** | LAN video + new GLB spawn + WASD on floor + tests green. Mock/overnight 34KB tavern/Avocado/BoomBox are **not** world-model generation |
| P1 sample (this round) | **PARTIAL** | See `validation/p1/p1_closeout.json`. Sourced CC0 12×10 tavern `629373db5bc61c4c` cooked/spawned/MERGE. Near-field stills stay black (not textured). **Not NG-1. Not P2 generate factory.** User feel still needs William |
| `CARINA_MESH_PROVIDER_URL` | **unset → real 3D generate BLOCKED** | Unchanged |

Evidence: `validation/p0/` (LAN ICE, cook/spawn, WASD) and `validation/p1/` (provenance, MERGE, 6 views).

---

## Update 2026-09-11 16:52 Asia/Shanghai — UE-03 closeout (not P0/P1 done)

| Gate | Status | Notes |
|------|--------|-------|
| Win PS2 play | **GREEN** | loopback; sidecar `:18793` intact |
| WorldRuntime `:18794` | **LIVE + loopback bind** | `127.0.0.1:18794` only; HTTP ≠ WebRTC |
| Dyn Avocado/BoomBox | **LIVE** | non-hardref; spawn/move/delete; BlockAll |
| Collision walkaround visuals | **PARTIAL→player_pose HighResShot** | WASD PS sky-locked under RenderOffScreen |
| BoomBox real PBR | **GREEN** | BoomBox + Avocado real materials (UE-05 MERGE) |
| shaderMergeOk | **GREEN Avocado** | true after UE-05 host MERGE; fail keeps scene |
| Mac WebRTC / media | **HARD_BLOCK** | unchanged; does not block Win UE-03 |
| P0 / P1 complete | **NOT CLAIMED** | stop for Cursor acceptance; no tavern art |

Evidence: `validation/ue03_closeout.json` / Win `logs/ue03_closeout.json`.

---

This document records **measured** install/access state. Offline PNG, editor screenshots, Falcor stills, and VAE streams are **not** browser play completion.

Evidence on Windows: `C:\Users\wuyw\carina-rtx-validation\logs\p0_ps_accept.json`, `p0_mac_ice_block.json`.



## Update 2026-09-11 11:53 Asia/Shanghai — Win PS2 GREEN + Mac docs sync + Mac ICE HARD_BLOCK

| Gate | Status | Notes |
|------|--------|-------|
| Packaged Windows runtime | **READY (Dev, PS2)** | `CarinaPS.exe` ~2026-09-11 10:53 Asia/Shanghai; ThirdPerson from `TP_ThirdPersonBP` |
| Plugins | **PS2 on / classic PS off** | `.uproject` PixelStreaming2=true, PixelStreaming=false |
| Signalling | **UP loopback** | PS2 WebServers UE5.8-0.1.0; `127.0.0.1:8080` + `:8888`; **SFU/8889 off**; sidecar `:18793` intact |
| peer_options | **FIXED** | empty-string `--peer_options` → RTCConfiguration bug; use `--peer_options_file peer_options.json` |
| Win browser WebRTC | **GREEN** | `p0_ps_accept.json` ok=true; 1280x720; framesDecoded rising; ICE connected; reconnect ok |
| Launch scripts | **READY** | `start_sws_ps2_loopback.bat`, `start_streamer_ps2.bat` (`-PixelStreamingConnectionURL=ws://127.0.0.1:8888`); dual LAN: `start_sws_ps2_lan.bat` / `restart_ps2_stack_lan.bat` (`public_ip=192.168.5.16`) |
| Firewall LAN | **READY** | Private + LocalSubnet rules for TCP 8080/8888 + UDP 49152-65535 (not Public) |
| Mac browser / ICE | **HARD_BLOCK** | Mac `192.168.241.95` + V2BOX VPN; not on `192.168.5.16` LAN; ping loss; HTTP SSH tunnel ≠ WebRTC |
| GLB post-package | **NOT STARTED** | **next** after this sync / when Mac on LAN |
| Docs / Mac mirror | **SYNCED** | RUNTIME_CONTRACT / this file / PROGRESS + `runtimes/unreal/CarinaPS` README+uproject+Config |

**Mac URL (when unblocked):** `http://192.168.5.16:8080/player.html` (or `uiless.html`). Do **not** claim success from tunnel-only HTTP.

**Win still green:** loopback SWS+streamer listening `127.0.0.1:8080/8888`; player.html 200.

---

## Update 2026-09-11 10:23 Asia/Shanghai — UE install verified

| Gate | Status | Notes |
|------|--------|-------|
| UE5 editor / engine install | **READY** | `G:\UE_5.8` — **5.8.2** (`Build.version` changelist 56702186, branch `++UE5+Release-5.8`); `UnrealEditor.exe` present |
| Epic Games Launcher | **READY** | Installed + logged in (account used for install); library registered via `LauncherInstalled.dat` + `HKCU\...\Builds\UE_5.8` |
| Pixel Streaming plugin | **PRESENT** | `G:\UE_5.8\Engine\Plugins\Media\PixelStreaming\PixelStreaming.uplugin` (EnabledByDefault false — enable per project); also PixelStreaming2 + get_ps_servers scripts |
| Packaged Windows runtime + browser WebRTC play | **NOT STARTED** | Engine unblocked; next: minimal PS project + package |
| Packaged GLB/PBR/collision hot-load or cook timing | **NOT STARTED** | After packaged runtime |
| NVENC | **AVAILABLE** | unchanged |
| Disk | **OK** | `G:` ~593 GiB free after install (~30 GiB used under `G:\UE_5.8`) |
| CARINA sidecar | **keep alive** | still not the play path |

**Install notes:** William completed Epic login (UU remote) and manually installed the engine. Observed download UI earlier showed UE 5.5 queue; **on-disk result is UE 5.8.2** at `G:\UE_5.8` (not under `G:\Epic Games\`). Quixel Bridge / Fab plugin were queued with the install.

**Next (ling):** (1) run `get_ps_servers` for signalling stack; (2) scaffold minimal Pixel Streaming project on `G:`; (3) package + browser input proof; (4) single-GLB cook/import timing.




## Update 2026-09-11 10:28 Asia/Shanghai — PS infra corrected to UE5.8

- Replaced incompatible **UE5.7-0.1.2** WebServers pull with **UE5.8-0.1.0** (`DOWNLOAD_VERSION`).
- Plugins present: PixelStreaming + PixelStreaming2 + PixelStreamingPlayer; **P0 uses PixelStreaming + UE5.8 infra**.
- Template available: `G:\\UE_5.8\\Templates\\TP_ThirdPersonBP` (walkable baseline).
- `RUNTIME_CONTRACT.md` created.
- Packaging / browser proof / Mac ICE still **in progress** (Windows worker).



## Update 2026-09-11 10:47 Asia/Shanghai — packaged PS slice (Win local)

| Gate | Status | Notes |
|------|--------|-------|
| Packaged Windows runtime | **READY (Dev)** | `G:\\carina-ue\\CarinaPS\\Packaged\\Windows\\...\\CarinaPS.exe` (580 cooked pkgs) |
| Signalling UE5.8-0.1.0 | **UP** | player `http://127.0.0.1:8080/player.html`, streamer `ws://127.0.0.1:8888`, SFU `:8889` (binds 0.0.0.0) |
| Browser UI | **PARTIAL** | CLICK TO START seen; **WebRTC video frame not yet proven** |
| Mac browser / ICE | **NOT PROVEN** | tunnel ≠ WebRTC |
| GLB post-package | **NOT STARTED** | next after Win video green |

Evidence: `C:\\Users\\wuyw\\carina-rtx-validation\\logs\\p0_ps_slice_status.json`, screenshots `p0_ps_player_*.png`.

## Verdict (P0 gate)

| Gate | Status | Notes |
|------|--------|-------|
| UE5 editor / engine install | **BLOCKED** | No `UnrealEditor.exe`, no `C:\Program Files\Epic Games`, no Epic Games Launcher binary found |
| Pixel Streaming plugin | **BLOCKED** | Depends on UE install |
| Packaged Windows runtime + browser WebRTC play | **NOT STARTED** | Cannot scaffold without engine |
| Packaged GLB/PBR/collision hot-load or single-asset cook timing | **NOT STARTED** | Requires packaged UE project |
| NVENC (hardware encode capability) | **AVAILABLE** | ffmpeg reports `h264_nvenc`, `hevc_nvenc`, `av1_nvenc`; RTX 5070 Ti / driver 616.56 |
| VS / WinSDK compile toolchain | **PARTIAL** | VS 2022 **Build Tools** 17.14.37 + WinSDK 10.0.26100; VC Tools present; Native Desktop / .NET 4.8 workloads **not** detected via vswhere `-requires` |
| CARINA validation sidecar | **UP** | `127.0.0.1:18793` health ready; keep alive (not the play path) |
| Disk for UE install | **FEASIBLE with care** | See disk table; prefer `G:` (~670 GiB free) for Epic/UE library |

**Hard access blocker:** installing UE requires Epic Games Launcher + interactive Epic account login and accepting Epic’s install/EULA flow. This run does **not** procure licenses, accept new agreements, or perform that login. William must install UE (or provide an already-licensed offline engine tree) before NG-03/NG-04 can proceed.

## Host snapshot

| Item | Value |
|------|--------|
| Host | `DESKTOP-RLADDRR` / user `wuyw` |
| GPU | NVIDIA GeForce RTX 5070 Ti, 16303 MiB, driver **616.56**, CUDA UMD reports **13.4** |
| VRAM in use at audit | 794 MiB |
| Python (carina venv) | 3.11.15 |

### Disk free (2026-09-11 audit)

| Drive | Total GiB | Free GiB |
|-------|-----------|----------|
| C: | 881.4 | **127.4** |
| D: | 2000.4 | 166.3 |
| E: | 512.1 | 39.9 |
| F: | 4096.8 | 103.3 |
| G: | 1165.9 | **670.3** |

UE5 + engine + sample + Intermediate/DerivedData often wants **>150 GiB** working headroom after install. Recommend Epic library / project on **`G:`** (or another large volume), not filling `C:` below ~50 GiB free.

## Unreal / Epic

| Check | Result |
|-------|--------|
| `UnrealEditor.exe` candidates (UE 5.3–5.7 under Program Files) | **none** |
| `C:\Program Files\Epic Games` listing | **directory absent / empty** |
| Epic Games Launcher `EpicGamesLauncher.exe` | **not found** |
| Pixel Streaming plugin paths | **none** |

Prior docs (`ENV_REPORT.md`, `BLOCKERS.md`) already recorded “Unreal absent”; re-audit 2026-09-11 confirms unchanged.

### What William needs to unblock (access only)

1. Install **Epic Games Launcher** on DESKTOP-RLADDRR (interactive).
2. Sign in with Epic account; install **UE 5.x** (prefer a current 5.4+ with Pixel Streaming samples documented for that version).
3. Place engine/library on a volume with space (prefer **`G:`**).
4. Confirm Pixel Streaming plugin enabled for the project; note exact engine version string.
5. Ping ling with: engine path, version, whether Pixel Streaming sample packaged OK.

No agent-side silent UE download in this phase (agreement/login boundary).

## Visual Studio / Windows SDK

| Item | Result |
|------|--------|
| vswhere | present |
| Product | **Visual Studio Build Tools 2022** `17.14.37516.0` / display 17.14.37 (July 2026) |
| Path | `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools` |
| VC Tools (`Microsoft.VisualStudio.Component.VC.Tools.x86.x64`) | **present** |
| Workload `NativeDesktop` | **not** matched by vswhere `-requires` |
| .NET 4.8 SDK component (vswhere) | **not** matched |
| Windows SDK Include | **10.0.26100.0** |
| `msbuild` on PATH | **no** |
| MSBuild full path | `C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\MSBuild\\Current\\Bin\\MSBuild.exe` **present** |
| MSVC toolset | **14.44.35207** |

**Risk for UE:** Epic’s recommended VS components often include Game Development with C++ / .NET desktop / Windows SDK beyond bare Build Tools. After UE installer runs, it may prompt for missing components—expect a second VS Modify pass. Not a substitute for missing UE itself.

## Encoding (Pixel Streaming relevance)

| Check | Result |
|-------|--------|
| ffmpeg | `C:\Users\wuyw\scoop\shims\ffmpeg.EXE` |
| NVENC encoders listed | `h264_nvenc`, `hevc_nvenc`, `av1_nvenc` |
| nvidia-smi encoder util at idle | 0 % |

Hardware encode path on the 5070 Ti looks **present**. This is **not** yet a Pixel Streaming WebRTC session proof—only encoder binary/capability evidence.

## Existing CARINA sidecar (keep available)

| Item | Value |
|------|--------|
| Service | `CARINA-RTX-20260910` |
| Bind | `127.0.0.1:18793` |
| Ready | true |
| Capabilities (honest) | meshRender, pbrRasterIBL, falcorPathTrace **true**; pathTraceDXR / lumen* / dlssNR **false** |
| Blender lightmap | available (`Blender 4.5.13 LTS` portable under carina `bin\`) |
| Start/stop | `venv\Scripts\python.exe scripts\start_service.py` / `stop_service.py` |
| Auth | on-disk `.api_key`; Bearer / X-Api-Key |

Tunnel (Mac ↔ M920x ↔ Windows loopback) left as previously documented in `ACCESS.md`. **Not** a substitute for Pixel Streaming.

Interfaces already useful for P0 asset pipeline (Mac control plane owns assetId proxy; Windows store remains):

- `POST /assets/glb` → `assetId` (sha256[:16] dedup)
- `GET /assets/{assetId}`
- `POST /jobs` with `assetId` (`baseline` / `hq_pbr` / `lightmap_bake`)
- Absolute Windows `scene_glb` paths rejected

These remain **offline validation** APIs. They do **not** complete browser play.

## Packaged runtime / cook / browser play

| Work item | Status |
|-----------|--------|
| Minimal packaged UE runtime | **blocked** — no engine |
| Pixel Streaming signaling + browser keyboard/mouse | **blocked** |
| Post-package GLB/PBR/collision load | **blocked** |
| Single-asset cook timing (vs full repackage) | **blocked** — no cook toolchain |

No launch command for a packaged game yet (none exists on disk).

## What was **not** done (by policy)

- No Epic/UE purchase, EULA accept, or interactive launcher login
- No machine reboot
- No new cron/routines
- No changes to AIGA / LLM model services
- No Mac `src/` edits (assetId proxy remains William’s)
- No claim that Falcor PNG / lightmap / hq_pbr jobs equal browser play

## Next actions (ordered)

1. **William:** install Epic Launcher + UE5 on `G:` (or chosen volume); reply with version + path.
2. **ling:** create `runtimes/unreal/` (or Windows-local project under carina) minimal Pixel Streaming package; measure cold start + browser input; document ports/signaling.
3. **ling:** single new GLB → cook/import experiment; record wall time; forbid full-game recook for one prop.
4. Keep validation sidecar up for assetId / PBR / lightmap workers during runtime work (one heavy GPU job at a time).

## ADR stub (pending engine)

Decision pending install: lock **engine version**, **Pixel Streaming plugin revision**, **signaling stack** (Epic sample vs custom), and **asset import path** (runtime glTF plugin vs offline `.uasset` cook). Until then, P0 NG-03/NG-04 remain **access-blocked**, not engineering-blocked on NVENC/disk alone.


## Update 2026-09-11 — tunnel restored + Epic install in progress

### Private tunnel (Mac reachable)

Mac is **not** on home LAN (ping to `192.168.5.16` / `.27` lost). Restored private hop:

1. Windows: `ssh -R 127.0.0.1:18793:127.0.0.1:18793 vps` (ProxyJump `m920x`); pid in `logs/tunnel_win_to_vps.pid`
2. Mac: `ssh -L 127.0.0.1:18793:127.0.0.1:18793 ixiaotao-cloud`

VPS binds **127.0.0.1 only** (no public `:18793`). Mac urllib `GET /health` → **200** with `~/.config/carina/rtx_service_key`. Sidecar kept up (`start_service.py`). See updated `ACCESS.md`.

### API / mirror sync

Mirrored live Windows service modules into `service-mirror/service/` including `assets_store.py`, `lightmap_bake.py`, `blender_lightmap_bake.py`, `app.py`, `jobs.py`, `config.py`, `glb_loader.py`. `API_CONTRACT.md` documents asset upload + `lightmap_bake`.

### Epic Games Launcher

- Official MSI downloaded: `bin\_downloads\EpicGamesLauncherInstaller.msi` (~87 MB, version noted in msiexec log as 1.3.193.0)
- Silent `/qn` install **failed rc=1603** (ran with user privileges; “Failed to properly run launcher start tab setup”)
- Elevated UAC install (`/qb` + RunAs) launched — **requires William to approve UAC on DESKTOP-RLADDRR**, then open Launcher and **sign in / accept Epic EULA / install UE5** (prefer library on `G:`). Agent will not click-through login or accept new agreements.

### P0 completion

**Not claimed.** Still need: UE installed, packaged Pixel Streaming runtime, browser input proof, packaged GLB load/cook timing.


## Update 2026-09-11 — Epic Launcher installed (login pending)

- Elevated MSI install succeeded. Launcher binary: `C:\Program Files\Epic Games\Launcher\Portal\Binaries\Win64\EpicGamesLauncher.exe`
- **William action required:** sign in to Epic, accept any EULA, install UE5 (prefer library on `G:`). Agent will not complete login/EULA.
- Sidecar protocol fixes landed (frames=1, public assetId paths); evidence job `c380f2635ff9`. Still **not** P0 play/runtime complete.

## 2026-09-11 12:02 Asia/Shanghai — GLB cook timing slice

| Gate | Status | Evidence |
|------|--------|----------|
| Win PS2 loopback video | **GREEN (preserved)** | SWS 8080 HTTP 200; CarinaPS pid 19040; pak mtime still 10:56:58 |
| Sidecar 18793 | **intact** | LISTENING; not used for UE play |
| Runtime GLB→packaged hotload | **BLOCKED** | No Interchange in Packaged plugins; no pak mount |
| Editor Interchange import timing | **DONE** | commandlet 1.91s; wall ~14s; `Material_MR`+5 tex+Nanite |
| Single-asset cook (no full repackage) | **DONE** | `-package=` → Saved/Cooked; first cook wall 20.42s; Iterate 0/587 skip; Packaged untouched |
| PBR / collision in PS player | **UNPROVEN** | Import/cook artifacts only |

Evidence JSON: `C:\Users\wuyw\carina-rtx-validation\logs\p0_glb_cook_timing.json`

**Honest gaps (as of 12:02; superseded 12:30):** IoStore inject was still open then; see Update 12:30 — LIVE inject DONE; remaining: spawn/visual SoftRef, runtime raw GLB, collision, HQ tavern, Mac ICE.

## Update 2026-09-11 12:30 Asia/Shanghai — LIVE IoStore inject + soft-path (spawn HARD_LIMIT)

| Gate | Status | Evidence |
|------|--------|----------|
| Win PS2 loopback | **GREEN (preserved)** | SWS 8080 HTTP 200; CarinaPS↔8888 ESTABLISHED; pid 22060 |
| Sidecar 18793 | **intact** | LISTENING; 401 without key |
| Additive LIVE IoStore inject | **DONE** | `DamagedHelmet-Windows.{pak,utoc,ucas}` in LIVE `Content/Paks`; originals SHA256 unchanged; backup `.../live_paks_backup_pre_inject/20260911_122743` |
| LIVE mount | **DONE** | `CarinaPS.log`: utoc Id=`c41634b0364f4257` NumPackages=7; TotalPackages=588 |
| Soft-path loadable | **DONE** | `p0_live_inject_softexist.log` Material_MR AssetLog on LIVE path |
| Spawn / visual in PS player | **HARD_LIMIT** | No BP/level SoftRef/spawn API; AssetRegistry.bin premade; no helmet screenshot |
| One-click script | **DONE** | `G:\carina-ue\CarinaPS\scripts\inject_damagedhelmet_iostore.{bat,ps1}` |
| Raw runtime GLB hotload | **BLOCKED** | unchanged (no Interchange in package) |
| Mac ICE | **HARD_BLOCK** | unchanged |

Evidence JSON: `C:\Users\wuyw\carina-rtx-validation\logs\p0_live_inject_apply.json` (prior test-mirror: `p0_glb_pak_inject.json`).

**Honest gaps:** world spawn/visual of injected StaticMesh; gameplay collision; HQ tavern; Mac ICE.

## Update 2026-09-11 13:50 Asia/Shanghai — SoftRef spawn BP + incremental IoStore (PARTIAL visual)

| Gate | Status | Notes |
|------|--------|-------|
| SoftRef spawn BP | **PARTIAL** | `BP_SpawnDamagedHelmet` authored via `UnrealEditor-Cmd -ExecutePythonScript`; SoftObjectPath metadata + SCS StaticMesh; **BeginPlay Soft LoadObject graph NOT wired** (UE5.8 Python K2 limits) |
| Demo maps | **READY (content)** | `/Game/Imported/DamagedHelmet/Lvl_HelmetSpawn` (non-WP HardRef) + `Lvl_HelmetFromTP` (WP clone of ThirdPerson + helmet) |
| Incremental cook | **WORKS** | e.g. Packages Cooked: 2 / Skipped: 587 — **no full BuildCookRun** |
| IoStore side inject | **WORKS** | `DamagedHelmet-Windows.{pak,utoc,ucas}` ~9 pkgs; originals SHA intact; mount NumPackages=9 |
| Soft path / LoadMap | **WORKS (log)** | Packaged `LoadMap` of side-container maps OK; `Material_MR` resolves from inject (shader fallback) |
| Helmet visible in PS | **NOT PROVEN** | HelmetSpawn: exposure black/white; FromTP: sky-only (WP `__ExternalActors__` not in side IoStore). ThirdPerson baseline PS mean~129 proves stack can show geometry |
| Win PS2 green | **PRESERVED** | SWS `:8080` 200; streamer relaunched default ThirdPerson; sidecar `:18793` untouched |

Evidence (Windows): `C:\Users\wuyw\carina-rtx-validation\logs\p0_glb_spawn_bp.json`, streamer logs `p0_glb_spawn_bp_streamer*.log`, screenshots `p0_glb_spawn_bp_player*.png`.

**Next for visual clear:** Editor GUI SoftRef BeginPlay wiring, **or** inject WP external-actor packages / ThirdPerson-delta container mounting **after** `CarinaPS-Windows`, **or** fix exposure+shadermap on non-WP map.


### 2026-09-11 15:39 — Material_MR Item 1 DONE
Host rebuild; packaged PBR close-up proven; success=true in validation/p0_pbr_material_mr.json. Stop lighting polish; next dynamic asset API.