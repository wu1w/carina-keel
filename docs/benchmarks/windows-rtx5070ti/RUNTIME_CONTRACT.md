# RUNTIME_CONTRACT — CARINA-RTX P0 (UE5 Pixel Streaming 2)

Last update: 2026-09-11 15:50 Asia/Shanghai (UE-02 review-1: Euler + opaque revision)

## Locked engine

| Field | Value |
|-------|-------|
| Install | `G:\\UE_5.8` |
| Version | **5.8.2** (`Major=5 Minor=8 Patch=2`, changelist **56702186**, branch `++UE5+Release-5.8`) |
| Editor | `G:\\UE_5.8\\Engine\\Binaries\\Win64\\UnrealEditor.exe` |
| Source of truth | On-disk `Engine/Build/Build.version` (not Epic download UI labels) |

## Plugins

| Plugin | Path | Notes |
|--------|------|-------|
| **PixelStreaming2** (P0 primary) | `Engine/Plugins/Media/PixelStreaming2/PixelStreaming2.uplugin` | **Enabled** in CarinaPS `.uproject` |
| PixelStreaming (classic) | `Engine/Plugins/Media/PixelStreaming/PixelStreaming.uplugin` | **Disabled** for this slice (endpointIdConfirm / Wilbur mismatch) |
| PixelStreamingPlayer | `Engine/Plugins/Experimental/PixelStreamingPlayer/` | Unused for host streamer |

## Signalling / frontend infrastructure

| Field | Value |
|-------|-------|
| Required match | **Must match engine major.minor** — UE 5.8 → UE5.8 infra |
| Stack | **PixelStreaming2** WebServers **`UE5.8-0.1.0`** under `G:\\UE_5.8\\Engine\\Plugins\\Media\\PixelStreaming2\\Resources\\WebServers` |
| SFU | **Off** (`--sfu_port 0`; port **8889 not used**) |
| peer options | **`--peer_options_file peer_options.json`** — do **not** pass empty-string `--peer_options` (RTCConfiguration bug) |
| peer_options.json | `{"iceServers":[{"urls":["stun:stun.l.google.com:19302"]}]}` at SWS root |

## Project (Windows)

| Field | Value |
|-------|-------|
| Project | `G:\\carina-ue\\CarinaPS\\CarinaPS.uproject` |
| EngineAssociation | `5.8` |
| Content baseline | ThirdPerson restored from `G:\\UE_5.8\\Templates\\TP_ThirdPersonBP` → `/Game/ThirdPerson/Lvl_ThirdPerson` |
| Packaged exe | `G:\\carina-ue\\CarinaPS\\Packaged\\Windows\\CarinaPS\\Binaries\\Win64\\CarinaPS.exe` (~2026-09-11 10:53 Asia/Shanghai) |
| Mac mirror (sources only) | `/Users/william/world/runtimes/unreal/CarinaPS/` (no binaries/caches/credentials/large assets) |

## Connection contract (measured)

| Item | Contract |
|------|----------|
| Streamer ↔ signalling | `-PixelStreamingConnectionURL=ws://127.0.0.1:8888` (PS2); legacy `-PixelStreamingURL` also accepted |
| Browser frontend | `http://127.0.0.1:8080/player.html` or `uiless.html` (Win loopback GREEN) |
| LAN frontend (when Mac on LAN) | `http://192.168.5.16:8080/player.html` via `start_sws_ps2_lan.bat` (`public_ip=192.168.5.16`) |
| Auth | **No public unauthenticated exposure.** Loopback **or** Windows Firewall **Private + LocalSubnet** only |
| Mac reachability | Prefer LAN. Existing SSH loopback tunnel proves **HTTP/TCP** only. **WebRTC media requires ICE/UDP** — do **not** claim Mac WebRTC from HTTP SSH tunnel alone |
| Sidecar | CARINA validation `127.0.0.1:18793` remains separate; not the play path |

## Launch scripts (`G:\\carina-ue\\CarinaPS\\scripts\\`)

### Loopback (Win-local GREEN — default keep-alive)

```bat
REM SWS PS2 loopback — SFU off, peer_options_file
start_sws_ps2_loopback.bat
REM Streamer
start_streamer_ps2.bat
REM Or: restart_ps2_stack.bat
```

Equivalent:

```bat
node dist\index.js --peer_options_file peer_options.json --serve --http_root www --homepage player.html ^
  --player_port 8080 --streamer_port 8888 --sfu_port 0 --public_ip=127.0.0.1 ...

CarinaPS.exe -PixelStreamingConnectionURL=ws://127.0.0.1:8888 -RenderOffScreen -Unattended ^
  -AudioMixer -PixelStreamingEncoderCodec=H264 -ForceRes -ResX=1280 -ResY=720
```

### LAN (Mac on `192.168.5.0/24` Private)

```bat
REM Apply once (elevated): firewall_ps2_lan_private.ps1
REM Then:
restart_ps2_stack_lan.bat
REM Player: http://192.168.5.16:8080/player.html
```

Firewall rules (applied): `CarinaPS2-SWS-Player-8080-TCP`, `CarinaPS2-SWS-Streamer-8888-TCP`, `CarinaPS2-WebRTC-UDP-Ephemeral` — **Profile=Private**, **RemoteAddress=LocalSubnet** (TCP 8080/8888, UDP 49152-65535). No Public profile.

| Port | Role | Loopback bind (GREEN) | LAN bind (when switched) |
|------|------|------------------------|---------------------------|
| **8080** | Player HTTP/WS | `127.0.0.1:8080` | `192.168.5.16` / non-loopback via `public_ip` |
| **8888** | Streamer WebSocket | `127.0.0.1:8888` | same machine still dials `ws://127.0.0.1:8888` |
| **8889** | SFU | **off** | **off** |
| **18793** | CARINA sidecar | `127.0.0.1:18793` | unchanged |

**Auth:** SWS unauthenticated. Never expose 8080/8888 to Public/internet.

## Win GREEN accept (2026-09-11 ~11:09 Asia/Shanghai)

Evidence: `C:\\Users\\wuyw\\carina-rtx-validation\\logs\\p0_ps_accept.json` — `ok: true`

- 1280×720; `framesDecoded` rising (e.g. delta 227)
- `iceConnectionState` / `connectionState` **connected**
- disconnect/reconnect **ok**
- PS2 EpicRtc path; `endpointIdConfirm` errors **0**

## Mac ICE status

| Gate | Status |
|------|--------|
| Mac → `http://192.168.5.16:8080` WebRTC framesDecoded | **HARD_BLOCK** — Mac not on Win LAN (`en0=192.168.241.95` + V2BOX VPN `utun4`); ping `192.168.5.16` 100% loss |
| HTTP SSH tunnel | Not WebRTC proof |
| Evidence | `C:\\Users\\wuyw\\carina-rtx-validation\\logs\\p0_mac_ice_block.json` |

Unblock: Mac join home LAN (or stop VPN hijacking `192.168.5.0/24`) → run `restart_ps2_stack_lan.bat` → measure Mac `framesDecoded` delta.

## Provenance / evidence

| Artifact | Location |
|----------|----------|
| Compat audit | `C:\\Users\\wuyw\\carina-rtx-validation\\logs\\ue_ps_compat.json` |
| Win accept GREEN | `C:\\Users\\wuyw\\carina-rtx-validation\\logs\\p0_ps_accept.json` |
| Mac ICE block | `C:\\Users\\wuyw\\carina-rtx-validation\\logs\\p0_mac_ice_block.json` |
| GLB import/cook timing | `C:\\Users\\wuyw\\carina-rtx-validation\\logs\\p0_glb_cook_timing.json` |
| P0 status narrative | `./P0_RUNTIME_STATUS.md` |

## GLB / cook contract (2026-09-11 12:02 Asia/Shanghai)

| Path | Status | Notes |
|------|--------|-------|
| Runtime GLB hotload in packaged PS2 | **BLOCKED** | No Interchange/glTF in packaged plugins; no custom loader; Saved/Cooked not mounted into Packaged pak/IoStore |
| Editor Interchange import `.glb`→uasset | **WORKS** | `ImportAssets`; ~1.91s commandlet / ~14s wall; `Material_MR` + textures + Nanite |
| Single-asset cook without full repackage | **WORKS (caveat)** | `-package=` into `Saved/Cooked`; Packaged pak untouched; AlwaysCook ThirdPerson still cooks ~580 on non-iterate; Iterate skips unchanged |
| PBR in packaged player | **UNPROVEN** | Assets exist; no PS visual accept this slice |
| Collision gameplay | **UNPROVEN** | BodySetup/NavCollision DDC only |
| Sidecar `/assets/glb` @18793 | Separate | Render-validation path; not UE play |

## P0 completion bar (do not claim early)

1. ~~Packaged Windows runtime with HW encode + Pixel Streaming~~ **DONE (PS2)**
2. ~~Browser shows live frames; reconnect~~ **DONE Win-local**; Mac ICE still blocked
3. ~~Single-asset cook/import timing without full game recook~~ **DONE**; ~~additive IoStore pak inject~~ **DONE (LIVE)**; spawn/visual SoftRef still **HARD_LIMIT**; raw GLB hotload still **BLOCKED**
4. Mac browser path explicitly measured (or blocked with ICE/UDP diagnosis) — **HARD_BLOCK logged** (not inferred success)


## LIVE IoStore side-container inject (2026-09-11 12:30 Asia/Shanghai)

| Path | Status | Notes |
|------|--------|-------|
| Runtime raw `.glb` hotload in packaged PS2 | **BLOCKED** | No Interchange/glTF in packaged plugins |
| Additive IoStore side container inject (cooked prop) | **WORKS** | Drop `DamagedHelmet-Windows.{pak,utoc,ucas}` into `Content/Paks`; mount NumPackages=7; TotalPackages=588 |
| SoftObjectPath package existence after inject | **WORKS** | LIVE log `Material_MR` AssetLog (not SkipPackage); mesh is not a Map |
| Spawn / place StaticMesh in packaged play | **HARD_LIMIT** | No spawn API/BP/level SoftRef in package; Premade AssetRegistry lacks asset; no visual PS proof |
| One-click inject/remove | **WORKS** | `scripts/inject_damagedhelmet_iostore.bat` / `.ps1` |
| Replace `global.utoc` while live | **FORBIDDEN** | Keep additive side container; originals SHA256 pinned |

Evidence: Win `logs/p0_live_inject_apply.json`, `logs/p0_glb_pak_inject.json`; Mac `validation/p0_live_inject_apply.json`.

Restart: `restart_ps2_stack.bat` / `restart_ps2_stack_lan.bat` (inject script optional `-RestartStreamer`).

## UE-02 WorldRuntime API (CLI ↔ Windows UE) — 2026-09-11 (rev review-1)

Owner: Grok Bot (Windows UE). Agent code stays on Grok CLI (`src/`). Codex accepts.
Aligned with `src/schema/v1/geometry.ts`: Carina meters, right-handed, **Y-up**; `transform.rotation` = **XYZ Euler radians** `{x,y,z}` (not quaternion on the wire).

UE cooked assets are a **derived runtime cache only**. Original GLB + scene manifest remain Agent-managed world truth.

### Coordinate contract

| Space | Units | Up | Handedness | Role |
|-------|-------|-----|------------|------|
| **Carina / Agent (wire)** | meters | **Y-up** | right-handed | All request/response transforms |
| **UE runtime (internal)** | centimeters | **Z-up** | UE left-handed | Applied only inside one UE-boundary converter |

Wire transform (must match Agent `transformSchema`):

```json
{
  "position": {"x": 0.0, "y": 0.0, "z": 0.0},
  "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
  "scale": {"x": 1.0, "y": 1.0, "z": 1.0}
}
```

- `rotation` = **XYZ Euler radians** (Agent order). Do **not** put quaternions on this API.
- If UE internally uses a quaternion, name it e.g. `ueRotationQuat` **inside** the converter only — never mix both shapes on the wire.
- Validate with a **non-symmetric** object so axis/handedness bugs cannot hide.

### Identity and revision (every mutating call)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `worldId` | string | yes | Echoed unchanged |
| `objectId` | string | yes | Echoed unchanged |
| `assetHash` | string (full hex) | yes when asset-related | Source asset content hash Agent owns; echoed unchanged |
| `assetId` | string | yes on prepare | Existing upload/registry id (prefer over path/URL) |
| `expectedRevision` | **opaque string** | yes on mutate | Must equal currently **applied** revision or reject; **not** ordered/comparable |
| `revision` | **opaque string** | yes on mutate | Revision **to apply** if command succeeds |
| `commandId` | string | yes on mutate | Idempotency key; duplicate `commandId` replays prior result |

Rules:
- `revision` / `expectedRevision` are **opaque strings** (not `string|int`, no numeric/lexical “newer” compare).
- On failure: **do not** advance `appliedRevision`; keep previously activated scene.
- On success: `appliedRevision` becomes the request’s `revision`.
- Responses echo `worldId`, `objectId`, `assetHash` (when present) **verbatim**.

Status query must return at least: `{ worldId, appliedRevision, objects: [{ objectId, assetHash, transform, ... }] }`.

### Publish / load steps

| Step | Status | Meaning |
|------|--------|---------|
| `prepare` | **LIVE** (assetId+assetHash → Interchange/cook/IoStore) | Offline/Editor: resolve **`assetId` + verify full `assetHash`** against uploaded bytes (reuse existing asset upload/registry). Interchange → cook → IoStore artifacts + shader-merge into host archive as needed. **Do not** accept arbitrary `glbPath` / `glbUrl` or fetch remote URLs. |
| `install` | **LIVE** (additive side container; stop streamer if file lock) | Install additive side containers named for MountOrder; shader **merge** only (full ShaderArchive replace **FORBIDDEN**). |
| `activate` | **LIVE** (SoftObjectPath; no per-object LoadMap/restart) | Mount installed cache; async load SoftObjectPath; spawn/update at transform **without** per-object `LoadMap` / host restart. |
| Fail behavior | **REQUIRED** | Keep previous activated scene + `appliedRevision`. |

### HTTP surface (planned loopback — not for CLI until LIVE)

Planned base: `http://127.0.0.1:18794/v1/` (never overload `:18793`).

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| `POST` | `/worlds/{worldId}/assets/prepare` | **LIVE** | Body: `{ assetId, assetHash, commandId, expectedRevision, revision }` — hash-check upload; no path/URL fetch |
| `POST` | `/worlds/{worldId}/assets/install` | **LIVE** (stop streamer if paks locked) | `{ assetHash, commandId, expectedRevision, revision }` |
| `POST` | `/worlds/{worldId}/assets/activate` | **LIVE** | batch mount by `assetHash[]` |
| `POST` | `/worlds/{worldId}/objects` | **LIVE** | spawn/update: `{ objectId, assetHash, transform, commandId, expectedRevision, revision }` |
| `PATCH` | `/worlds/{worldId}/objects/{objectId}` | **LIVE** | move: `{ transform?, commandId, expectedRevision, revision }` |
| `DELETE` | `/worlds/{worldId}/objects/{objectId}` | **LIVE** | remove: `{ commandId, expectedRevision, revision }` |
| `GET` | `/worlds/{worldId}` | **LIVE** | returns `appliedRevision` + objects with echoed ids/hashes |

**CLI rule:** Routes below marked **LIVE** after Win smoke `ue02-final` (2026-09-11 16:05 Asia/Shanghai). Evidence: `validation/ue02_dynamic_asset_entry.json` / Win `logs/ue02_dynamic_asset_entry.json`. in this file with a measured smoke curl. Temporary bridge = documented Windows scripts only.

Script bridge (temporary, fixture-oriented):

| Script | Maps to |
|--------|---------|
| Editor Interchange + `-run=Cook -package=` + shader merge into host | prepare |
| `G:\carina-ue\CarinaPS\scripts\inject_damagedhelmet_iostore.bat` | install (fixture; not generic) |
| `start_streamer_ps2*.bat` | host lifecycle (upgrade only; not per-object) |

### Proven vs blocked (UE-02)

| Capability | Status |
|------------|--------|
| Win-local PS2 play | **GREEN** |
| Additive IoStore content inject | **GREEN** |
| SoftObjectPath package resolve after inject | **GREEN** |
| Material_MR real PBR in packaged PS2 | **GREEN** (host ShaderArchive; `logs/p0_pbr_material_mr.json`) |
| Generic HTTP WorldRuntime `:18794` | **LIVE** (smoke `ue02-final`) |
| Two non-hard-ref assets hotload + spawn without LoadMap/restart | **PARTIAL→GREEN** (Avocado+BoomBox; one host restart for mount) |
| Collision / walkaround / move-remove timings | **PARTIAL** (BlockAll + move/remove timed; walkaround hitch not instrumented) |
| Mac WebRTC | **HARD_BLOCK** (VPN/LAN) — logged separately; does not block Windows UE-02 |


### PBR visual acceptance (Codex 2026-09-11 ~15:42)

| Item | Status |
|------|--------|
| Close-up textured (not flat BasicShape) | **PARTIAL evidence** — camera too close / clipping; not full channel accept |
| Full-object front + side + short orbit clip with Material_MR | **REQUIRED** (capture during dynamic-entry work; do not infinite helmet polish) |
| Texture-channel + shader log (Material_MR, no Missing/Default fallback) | **REQUIRED** with orbit set |
| BasicShapeMaterial | **Not** acceptable as PBR proof |

### Non-goals

- Rewriting Agent world session / generation providers.
- UE as export source of truth.
- Closing VPN or changing global Mac network for UE work.
- Shipping fake HTTP that CLI might bind to early.
