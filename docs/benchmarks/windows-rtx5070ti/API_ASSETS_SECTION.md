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
