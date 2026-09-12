# Carina graphics service integration — 2026-09-10 overnight

## Current result

The Carina backend now proxies the actual Windows validation service contract, using the existing `/v1` authentication. This is validation infrastructure, **not yet a high-quality game renderer**. The browser's existing local scene/camera loop remains intact. No per-movement remote rendering requests were added.

Implementation: `src/server/graphics-service.ts`, config in `src/config.ts`, registration in `src/server/create-http-app.ts`.

Server-only environment:

- `CARINA_RTX_SERVICE_URL`: configured as http://127.0.0.1:18793 through the M920x loopback tunnel.
- `CARINA_RTX_SERVICE_KEY_FILE`: private credential file outside the repository. Windows credentials are never returned to the browser.

Routes:

- `GET /v1/graphics/health`: connected / unconfigured / misconfigured / unauthorized / unavailable. Capabilities only reflect verified upstream flags. Extra upstream fields are stripped.
- `POST /v1/graphics/jobs`: `{ "mode": "baseline", "resolution": [1280,720], "frames": 60 }`. Supports current baseline and three explicitly blocked Lumen modes. Limits: 720p or 1080p, 1–120 frames. No automatic POST retries. Unknown future modes must be integrated against their actual contract first.
- `GET /v1/graphics/jobs/:id`: strict hexadecimal 12-character ID, preserves queued/running/completed/failed/blocked. Connected does not imply successful job completion. Private metadata is stripped.
- `GET /v1/graphics/artifacts/:id/:name`: bounded streaming download, fixed image/video/JSON filename allowlist, 128 MiB maximum, no upstream cookies or headers forwarded. Current upstream request deadline is 4 seconds including body; long video downloads may need a separate measured timeout/range support.

## Verification

- `pnpm typecheck`: passed.
- `pnpm test`: 199 passed, zero failed.
- `pnpm build`: passed.
- Live Carina restarted on 127.0.0.1:18790 with existing data and model settings.
- Live `/health`: 200.
- Live unauthenticated graphics health: 401.
- Live authenticated graphics health: initially unconfigured; after tunnel setup connected to RTX 5070 Ti / driver 616.56.
- Before tunnel setup, valid requests correctly returned 503 unconfigured. After setup, real job f171f649263c completed and artifacts downloaded through Carina.
- Live out-of-bounds dimensions/frame count: 400.
- Unit tests cover credential isolation, blocked jobs, no duplicate retries on 429, invalid URLs/path traversal, artifact size rejection and upstream header stripping.

## Remaining overnight acceptance

1. Follow Grok Bot `ling`, work order CARINA-RTX-20260910. Do not submit a duplicate provisioning job. Bot is evaluating actual Falcor/DXR/PBR after simple ModernGL baseline was rejected as insufficient.
2. DONE: Grok established Windows → M920x reverse loopback and Mac → M920x local loopback forwards. Private key file /Users/william/.config/carina/rtx_service_key verified mode 600; credentials were not printed.
3. DONE: Carina configured and restarted, real health/job/artifact round trip exercised. See LIVE_INTEGRATION.json. Health total 142.94 ms (first call); job submission 14.99 ms; polling 31.36 ms; 679304-byte image download 132.04 ms. These are individual samples, not P95 or gaming input latency.
4. Inspect actual textured high-quality continuous-camera output. Require fixed geometry, real PBR material detail, shadows/indirect light, and no regenerated frame replacement.
5. Import the project's exported GLB into the high-quality backend when the actual import/camera contract exists. A third-party sample scene proves rendering only, not generated-world quality.
6. Record render, readback/encode, network and displayed-frame timing separately. Do not equate baseline glFinish timings with end-to-end 60 FPS.
7. Keep Lumen / DLSS Neural Rendering false until genuinely executed. Missing UE/NR SDK blocks those features, not independent PBR/DXR progress.

## Overnight follow-up

Heartbeat automation `carina` follows this task every 10 minutes until 2026-09-11 09:00 Asia/Shanghai, quiet while nothing actionable changes. On completion or deadline, report actual results and pause the automation. User is asleep; continue authorized reversible implementation without routine questions.

## Actual visual rejection, 23:15

Real job f171f649263c reports completed but before.png is flat grey noise and after.png nearly black. Both were opened and inspected. This is a failed visual acceptance, not a successful game scene. Preserved under live-baseline/f171f649263c/.

Source inspection found room extents ±2.5 with camera orbit radius 3.2 (crossing walls), and triangle winding opposite to declared inward normals while CULL_FACE is enabled. This explains outside-wall first view and culled interior last view. Specific fixes sent to Grok Bot: correct inward winding, keep trajectory inside room, verify actual output; do not merely disable culling. Matrix transpose upload already appears correct. Grok must finish repair and then continue actual PBR/DXR quality, not stop at corrected simple room.

## Repeatable probe

`scripts/probes/graphics-validation.py` now supports separate `submit` and `collect --job <hex12>` commands. Set `CARINA_TOKEN` in the environment; it only contacts the authenticated local Carina proxy, never reads or prints the Windows credential. `--output` chooses the report directory. Submit records verified health and HTTP samples; collect downloads individual still frames plus JSON metrics, hashes artifacts and marks visual acceptance pending. No auto-retry or polling loop; no inference of visual quality from job completion. The script was exercised against real job f171f649263c (14 artifacts collected).

At 23:17 Grok reported deploying winding/camera fixes. Independent validation job 27cbe56258c4 was submitted through the probe. Its submission report is under validation/27cbe56258c4/; inspect its output before accepting the fix.

## 23:19 independent retest

Grok's repaired job 7f3ed8ed792d (720p, 48 frames) was collected through Carina and first/middle/last PNGs visually inspected. Room planes, floor and perspective now visible. Basic visibility fix accepted at sampled poses; high-quality and continuous interactive gameplay remain unaccepted. Job 27cbe56258c4 hit the old running version before repair deployment and must not be mistaken for current state.

Remote report now separates finish-synchronized render (P50 0.112 ms, P95 0.218 ms) from readback/encode (P50 1.756 ms, P95 78.717 ms); total job render wall 1439.805 ms for 48 frames. These do not establish game FPS or hardware-timestamp GPU-only cost. Artifact collection is for validation, not a per-frame gameplay transport.

Grok instructed to proceed with actual Falcor/DXR/PBR assets, GLB import and measured build results; fixed crude room is not completion. Prefer asynchronous asset/bake output back to local movement loop. No additional UI change or claim of DLSS/Lumen availability.

## 23:30 PBR integration

See PBR_REVIEW.md for current failed material-fidelity acceptance. Real PBR service now available and Carina hq_pbr submit/collect works: job 217a5e122b96 completed; 14 artifacts collected. The imported helmet is assigned wood-like appearance, so this is not accepted as correct GLB materials or high-quality scene generation. New flags PBR/DXR/Falcor preserved separately, absent flags default false. 201 tests, typecheck, build passed. Probe supports explicit GLB and camera JSON options. Mac locked blocks Grok UI interaction; service/tunnel still operational. Shared review contains actionable feedback; continue independent work and existing Grok task without bypassing lock or asking sleeping user for routine action.

## 23:40 camera and latest material retest

Carina now interpolates requested camera keyframes into per-frame poses because Windows runner previously jumped once then froze. 203 tests/build pass; live server restarted. Job 4819b00a872f was submitted and collected through Carina: nine sampled frames have nine unique hashes. First/last images opened; asset is fully framed and now metallic-looking rather than wood, indicating concurrent Windows material repair. See PBR_REVIEW.md for evidence and remaining channel-validation gaps. Falcor offline Cornell frame actually inspected, heavily noisy; service wiring still pending per current report. Existing Grok task continues; no duplicate provisioning or lock bypass.

## 23:49 loader deployment candidate

No new Falcor service wiring in current reports; Grok UI remains inaccessible due to Mac lock. Prepared `patches/glb-transform-fix.patch` and full candidate for the existing Windows task, preserving live files. Fixes T*R*S ordering, inverse-transpose normals and last-element interleaved accessor reads. Two synthetic CPU regressions fail on original mirror and pass on candidate. NOT deployed; next Grok interaction should request applying/rebasing candidate while preserving newer material fixes. This is concrete local work, not a claimed runtime repair. See patches/README.md.

## 23:57 checkpoint (no new deployment)

Reports remain last updated 23:28–23:30; live authenticated health responds, with same PBR/offline Falcor capabilities. Reviewed existing 1080p bundled PBR room sample 8752369e60a9: textured box room with flat-looking illumination remains below requested fidelity. Its PNG readback/encode P95 is 170.655 ms, versus finish-synchronized render P95 0.314 ms. This is old validation data, not new progress or game performance. No new jobs submitted, no repeated deployment, no runtime changes. Pending local transform patch still requires deployment through the existing Grok task when UI access resumes. Keep subsequent unchanged checks quiet; do not generate repetitive user status notifications or claim completion.

## 00:17 follow-up backoff

Reports/source unchanged over multiple checks since 23:31; no new deployment or artifact. Avoid repeated GPU jobs and empty ten-minute loops. Existing automation `carina` updated to hourly on the hour, including the final 09:00 checkpoint; original deadline and task remain. Resume substantive integration when deployment changes or Grok UI access returns. This is a polling backoff, not completion or cancellation. No new user notification for unchanged state.
