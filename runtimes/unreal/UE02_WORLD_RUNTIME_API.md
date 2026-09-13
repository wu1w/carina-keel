## UE-02 WorldRuntime API (CLI ↔ Windows UE) — 2026-09-11 (rev review-1 + LIVE smoke 16:05 CST)

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
| `uninstall` | **LIVE** (stop streamer if paks locked) | Remove **this** MERGE side container (`CarinaPS-Windows_{label}` only). Never `global.utoc` / host `CarinaPS-Windows.*`. Idempotent if files already gone. |
| `activate` | **LIVE** (SoftObjectPath; no per-object LoadMap/restart) | Mount installed cache; async load SoftObjectPath; spawn/update at transform **without** per-object `LoadMap` / host restart. |
| Fail behavior | **REQUIRED** | Keep previous activated scene + `appliedRevision`. Mid-cook failure must uninstall **new** side containers and DELETE **this publish's** objects; do not strip pre-existing overlays. |

### HTTP surface (loopback LIVE after smoke)

Base: `http://127.0.0.1:18794/v1/` (never overload `:18793`).

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| `POST` | `/worlds/{worldId}/assets/prepare` | **LIVE** | Body: `{ assetId, assetHash, commandId, expectedRevision, revision }` — hash-check upload; no path/URL fetch |
| `POST` | `/worlds/{worldId}/assets/install` | **LIVE** (stop streamer if paks locked) | `{ assetHash, commandId, expectedRevision, revision }` |
| `POST` | `/worlds/{worldId}/assets/uninstall` | **LIVE** (stop streamer if paks locked) | `{ assetHash, commandId, expectedRevision, revision }` — MERGE side container only |
| `POST` | `/worlds/{worldId}/assets/activate` | **LIVE** | batch mount by `assetHash[]` |
| `POST` | `/worlds/{worldId}/objects` | **LIVE** | spawn/update: `{ objectId, assetHash, transform, commandId, expectedRevision, revision, collision? }`. `collision` defaults true; `*-space-shell` is forced false (visual overlay). |
| `PATCH` | `/worlds/{worldId}/objects/{objectId}` | **LIVE** | move: `{ transform?, commandId, expectedRevision, revision }` |
| `DELETE` | `/worlds/{worldId}/objects/{objectId}` | **LIVE** | remove: `{ commandId, expectedRevision, revision }` |
| `GET` | `/worlds/{worldId}` | **LIVE** | returns `appliedRevision` + objects with echoed ids/hashes |
| `POST` | `/host/streamer/stop` | **LIVE** (2026-09-13, `a7_live_cook_publish.json`) | Remount hook: kill packaged `CarinaPS.exe`, wait for pak handles to close. No revision, no paks touched. |
| `POST` | `/host/streamer/start` | **LIVE** | `/Run` the streamer task only if no host is running; wait for a fresh IPC heartbeat; then **replay** the viewport world's objects (host forgets actors on restart). Body optional: `{ replayWorldIds?: string[], replay?: boolean }`; default = last world that spawned (`state/active_world.json`), else newest world with objects. After replay, best-effort `isolate_then_enter` (isolate + Lit cvars + `player_pose` onto the interior scaffold floor, `hidePawn: false`). Not a P1 pass. Scaffold floor, not a walkable space-shell. |
| `POST` | `/host/isolate` | **LIVE** (`isolate_viewport.json`) | Hide the default Third Person map, exec Lit visibility cvars, then pose the possessed pawn at room center standing height. No remount, no cook, no paks. Always `p1Pass: false`, `claimsGeneratedLighting: false`. `playEnter` is scaffold spawn, not world-model collision. |
| `POST` | `/host/spawned` | **LIVE** | IPC `dump_spawned` only. Possessed pawn + spawned actors. Does not pose, isolate, remount, or cook. |
| `POST` | `/host/look` | **LIVE** | In-place `player_pose` yaw (`ueYawDeg` or Carina `yawRad`). No teleport. Not Cheat Walk. Always `p1Pass: false`. |

Remount rule (Carina client `remount: "streamer"`, default): stop → install **new** side containers → start(+replay) → activate → spawn. One host restart per publish, none when every hash is already installed. Rollback of new containers also stops the host first (paks are locked while mounted).

Container naming (2026-09-13): label = `{stem}_{assetId[:8]}` → `CarinaPS-Windows_bar_front_f0dde9d3`. Two GLBs with the same filename but different bytes used to share one container/content path; install now refuses to overwrite a present container with different content (`a7_live_rollback_run1_label_collision.json` is the incident record).

**CLI rule:** Routes marked **LIVE** after Win smoke `ue02-final` (2026-09-11 16:05 Asia/Shanghai). Evidence: `validation/ue02_dynamic_asset_entry.json` / Win `logs/ue02_dynamic_asset_entry.json`. Temporary script bridge only for fixtures still noted below.

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


## UE-03 notes (2026-09-11)

- Bind audited: `127.0.0.1:18794` only.
- `shaderMergeOk=false` marked **REQUIRED host cook** in contract; BoomBox_Mat usable without Missing-shader; Avocado Default until host cook.
- Host IPC extended: `player_pose`, `highresshot` (Windows Source).
