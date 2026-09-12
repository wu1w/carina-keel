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
| `activate` | **LIVE** (SoftObjectPath; no per-object LoadMap/restart) | Mount installed cache; async load SoftObjectPath; spawn/update at transform **without** per-object `LoadMap` / host restart. |
| Fail behavior | **REQUIRED** | Keep previous activated scene + `appliedRevision`. |

### HTTP surface (loopback LIVE after smoke)

Base: `http://127.0.0.1:18794/v1/` (never overload `:18793`).

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| `POST` | `/worlds/{worldId}/assets/prepare` | **LIVE** | Body: `{ assetId, assetHash, commandId, expectedRevision, revision }` — hash-check upload; no path/URL fetch |
| `POST` | `/worlds/{worldId}/assets/install` | **LIVE** (stop streamer if paks locked) | `{ assetHash, commandId, expectedRevision, revision }` |
| `POST` | `/worlds/{worldId}/assets/activate` | **LIVE** | batch mount by `assetHash[]` |
| `POST` | `/worlds/{worldId}/objects` | **LIVE** | spawn/update: `{ objectId, assetHash, transform, commandId, expectedRevision, revision }` |
| `PATCH` | `/worlds/{worldId}/objects/{objectId}` | **LIVE** | move: `{ transform?, commandId, expectedRevision, revision }` |
| `DELETE` | `/worlds/{worldId}/objects/{objectId}` | **LIVE** | remove: `{ commandId, expectedRevision, revision }` |
| `GET` | `/worlds/{worldId}` | **LIVE** | returns `appliedRevision` + objects with echoed ids/hashes |

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
