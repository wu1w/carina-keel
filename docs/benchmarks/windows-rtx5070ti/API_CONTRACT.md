# CARINA-RTX-20260910 — API contract

Bind: `127.0.0.1:18793` only. No secrets in this file.

## Auth

Key file (Windows only): `C:\Users\wuyw\carina-rtx-validation\.api_key`

Send either `Authorization: Bearer <key>` or `X-Api-Key: <key>`.

## Security

`job_id` on `GET /jobs/{job_id}` and `GET /artifacts/{job_id}/...` must match `^[0-9a-f]{12}$` exactly. Otherwise HTTP 400.

## GET /health

Includes `capabilities`, `backend`, and `timing_notes` explaining `render_ms` vs `readback_encode_ms` vs client `network_ms`.

Honest flags (unverified stay false; Lumen* and NR forced false without UE/Streamline NR):

`meshRender`, `pbrRasterIBL`, `pathTraceDXR`, `falcorPathTrace`, `lumenSW`, `lumenHW`, `dlssSuperResolution`, `dlssNeuralRendering`

## POST /jobs

### Baseline

```json
{"mode":"baseline","resolution":[1280,720],"frames":60,"warmup_frames":10}
```

### HQ PBR (shadow maps + IBL — **not Lumen**)

Bundled Polyhaven CC0 interior (render-validation assets only):

```json
{
  "mode": "hq_pbr",
  "resolution": [1920, 1080],
  "frames": 60,
  "warmup_frames": 10,
  "camera_path": {"path": "orbit_interior"}
}
```

With GLB + camera poses:

```json
{
  "mode": "hq_pbr",
  "resolution": [1280, 720],
  "frames": 36,
  "warmup_frames": 6,
  "scene_glb": "C:/Users/wuyw/carina-rtx-validation/scene/assets/DamagedHelmet.glb",
  "camera_path": {
    "poses": [
      {"eye": [2.2, 1.2, 2.2], "target": [0, 0.5, 0], "up": [0, 1, 0]},
      {"eye": [0.2, 1.6, 2.5], "target": [0, 0.5, 0], "up": [0, 1, 0]}
    ]
  }
}
```

| Field | Notes |
|-------|-------|
| `scene_glb` | Absolute Windows path. Missing file → job `failed` with `asset missing: ...`. Omitted → bundled PBR room |
| `camera_path` | `{"path":"orbit_interior"}` or `{poses:[{eye,target,up},...]}` or bare pose list |
| `materials` | Reserved; GLB uses embedded metallic-roughness + baseColor; bundled scene uses `scene/pbr/*` Polyhaven maps |

Blocked modes: `lumen_sw`, `lumen_hw`, `lumen_dlss_nr`, `falcor_pt`, `dxr_pt` (until verified).

`hq_pbr` runs in a **dedicated worker process** (avoids GLFW AV when sharing uvicorn threads).

## Timings honesty

PNG readback is **acceptance/validation only**, not a player loop.

- `render_ms` / P50 / P95 — submit + GPU + `glFinish` (**not** game FPS)
- `readback_encode_ms` — FBO read + PNG encode
- `network_ms` — client-only; null on server

## Artifacts

Allowlisted: `.png` `.jpg` `.jpeg` `.mp4` `.json` under `artifacts/{job_id}/`.

## Source

- Windows live: `C:\Users\wuyw\carina-rtx-validation\`
- Mac mirror: `docs/benchmarks/windows-rtx5070ti/service-mirror/`

## Asset upload (tavern / GLB)

Authenticated only (`Authorization: Bearer` or `X-Api-Key`).

### `POST /assets/glb`
Multipart form:
- `file` — GLB bytes (required)
- `source_label` — optional short provenance string

Validates:
- size ≤ 80 MiB (`MAX_GLB_BYTES`)
- magic `glTF`, version 2, header length == body length
- rejects unsafe URI fragments in JSON chunk (`file://`, `../`, absolute Windows/`/` URIs)

Dedup: `contentHash = sha256(bytes)`; `assetId = contentHash[:16]` (lowercase hex). Re-upload of identical bytes returns same `assetId` with `deduped: true`.

Response (example fields): `assetId`, `contentHash`, `byteLength`, `deduped`, `originalFilename`, `createdAt`.

### `GET /assets/{assetId}`
Returns public metadata only. **No absolute Windows paths.** `relativePath` is like `assets/uploaded/<assetId>/asset.glb`.

### Jobs with assets
Prefer:
```json
{ "mode": "hq_pbr", "assetId": "<16 hex>", "frames": 1, "resolution": [1280, 720] }
```
Absolute `scene_glb` paths (`C:\...`, `\\`, `/...`, `..`) are **rejected** (HTTP 400). Legacy relative paths under `assets/` still resolve, but new tavern clients should use `assetId` only.

Service concurrency for heavy GPU work: `MAX_CONCURRENT=1`.

### Roundtrip evidence (Windows host)
See service `logs/upload_roundtrip_evidence.json` after `scripts/roundtrip_upload.py`.

## Job mode: `lightmap_bake`

Requires `assetId` (upload GLB first). Runs Blender Cycles static **indirect** lightmap (UV2 / `TEXCOORD_1`).

Request example:

```json
{ "mode": "lightmap_bake", "assetId": "<16 hex>", "resolution": [512, 512], "bake_samples": 32 }
```

Artifacts: `lightmap.png`, `baked_uv2.glb`, `lightmap_manifest.json`, `bake_log.txt`.
Original PBR kept for viewport; Falcor screenshots are **not** lightmaps.
Blocked if Blender missing. Records `vram_*` / `elapsed_ms` in manifest when available.
Health exposes `blender_lightmap: { available, path, version_lines }`.

