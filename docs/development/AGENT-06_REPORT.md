# AGENT-06 report — NL / spatial.calibrate patches persisted SceneSpec

Session: `87dceda0-a365-40bd-87c0-028ce5477f91`  
Date: 2026-09-11

This slice compiles **natural-language calibrate** (no apiKey) into `spatial.calibrate` and writes the same metric displacement onto the persisted SceneSpec `anchor` / `dimensions`. `freeze` + reopen on the same `dataDir` keeps the patched plan.

It is **not** 3D generation. Patching a SceneSpec anchor is not a world model editing a mesh. The mock tavern, HTTP test doubles, and `bar-counter-glb.ts` stay fixtures. Do not treat this report as P0, P1, or generation success.

Product goal is unchanged: describe → generate → explore → calibrate → freeze → continue/extend → export. This slice only lands “calibrate the plan (and the matching SceneObject when present).”

## Files changed (this turn)

- `src/scene-compiler/compile-scene-spec.ts` — `findSceneSpecObject`, `resolveBarPlanObjectId`, `applySceneSpecCalibrate` (source unchanged)
- `src/scene-compiler/index.ts` — export the calibrate helpers
- `src/application/interpret-fast.ts` — no-LLM tavern calibrate phrases → `spatial.calibrate` with metric `delta` (left = −X)
- `src/application/create-application.ts` — `handleCalibrate` restages `.scene-spec.json` and updates `sceneSpec` / `sceneSpecRef` / `assetManifest`; `interpretText` passes plan object ids
- `src/application/interpret-fast.test.ts` — 吧台左移 / 看向吧台 regression
- `src/application/scene-spec-calibrate.test.ts` — NL + direct command round-trip; no generate POST; bar-front SceneObject moves with the plan
- `docs/development/AGENT-06_REPORT.md` — this file

Did not edit `runtimes/unreal`, `docs/benchmarks/windows-rtx5070ti`, `docs/development/COORDINATION.md`, live world data, or git history. Did not restart `:18790`. Did not connect to live `:18794`. Did not download DamagedHelmet. Did not invent a Meshy/Tripo SDK. Did not set a fake `CARINA_MESH_PROVIDER_URL`. Did not POST the mesh adapter as part of calibrate.

## Behavior

1. **`spatial.calibrate` patches SceneSpec when a plan object exists**  
   Lookup is `objectId`, then name. For 吧台 aliases, prefer `bar-front`, else `bar`. The same `delta` / `heightMeters` is applied to `anchor` / `dimensions`. The patched JSON is staged as a new `.scene-spec.json`, then `sceneSpec`, `sceneSpecRef`, and `assetManifest` are updated. `source` stays `heuristic-plan` or `steward-plan`. It is never rewritten to `world-model` or `native-mesh`.

2. **Missing plan object is honest**  
   If the snapshot has no matching SceneSpec object, the plan is not claimed updated. A matching runtime `SceneObject` can still be calibrated with the previous transform/height logic. If neither exists, the command is `NOT_FOUND`.

3. **No-apiKey NL**  
   `interpretFast` recognizes phrases such as 「把吧台往左移一米」 and 「吧台左移 1 米」 before look/view matching (those phrases contain 往左, which would otherwise become a camera shot). Result: `spatial.calibrate`, `objectId` `bar-front` when that id is in the plan (else `bar`), `delta: { x: -1, y: 0, z: 0 }`. Pause / run / freeze / create / look-at-bar are unchanged.

4. **Generate path is untouched**  
   Calibrate does not call `generateScene` and does not POST `/v1/generate`. Unset mesh URL still uses the mock tavern. Generate-route items are not turned into `.glb`. Existing `scene-spec-create` / `scene-spec-generate` (no-URL) / `application` / `place-asset` / `native-mesh-create` still pass.

5. **Matching SceneObject moves with the plan**  
   When `snapshot.objects` already has `sceneObjectId === bar-front` (AGENT-05 HTTP path, or an injected object), `transform.position` and `spec.anchor` both take the same delta. Mock tavern without a `bar-front` object still patches the plan and reopens with the new anchor.

## Verification

| Command | Result |
|---|---|
| `pnpm exec tsx --test src/application/interpret-fast.test.ts src/application/scene-spec-calibrate.test.ts src/scene-compiler/scene-spec.test.ts` | 19 pass |
| `pnpm exec tsx --test src/application/scene-spec-create.test.ts src/application/scene-spec-generate.test.ts src/application/application.test.ts src/application/place-asset.test.ts src/application/native-mesh-create.test.ts src/schema/v1/v1.test.ts` | 30 pass |
| `pnpm test` | 249 pass, 0 fail |
| `pnpm typecheck` | pass |
| `pnpm build` | pass |

Create-path test: no apiKey, tavern/bar prompt → text 「把吧台往左移一米」 → `spatial.calibrate` accepted → `bar-front` `anchor.x` decreases by 1 m → freeze → close → same `dataDir` reopen, packed `.scene-spec.json` still has the calibrated anchor, `source` is still `heuristic-plan`. Direct `{ objectId: "bar-front", delta: { x: -1, y: 0, z: 0 } }` round-trips the same way. Injected compiler + no mesh URL: `generateScene` is not called again during calibrate; generate items have no `.glb`.

## Real backend probe

`CARINA_MESH_PROVIDER_URL` was **unset**. No live mesh POST. No live `:18794`. Calibrate never submits generate. Tests used the mock tavern and an injected `generateScene` counter, not a world model.

Status for a real 3D backend: still **BLOCKED** (no URL). SceneSpec anchor calibrate does not fill that gap.

## Limitations

- SceneSpec remains a **plan document**. Moving `anchor.x` by −1 is not moving a generated mesh.
- Mock tavern furniture still has no `bar-front` SceneObject. Plan-only calibrate is the no-URL path. That geometry is not compiled from SceneSpec generate items.
- When a `bar-front` SceneObject exists, its transform is shifted; that object is still whatever mesh/fixture was already attached (HTTP test double or injected AABB). Calibrate does not regenerate it.
- Heuristic plans and `interpretFast` phrases are deterministic templates, not a world model.
- Height calibrate (`heightMeters` → `dimensions.y` / runtime bounds) is implemented on the same path but is not the required NL phrase.

## Honest generation gaps

- There is still **no** connected generative 3D backend in this environment.
- LingBot cannot freeze 3D (`nativeMesh: false`).
- Mock `nativeMesh: true` remains a procedural tavern when the URL is unset.
- **SceneSpec anchor calibrate ≠ a world model changed a mesh.**
- Do not ship, demo, or report this slice as P0, P1, or native-mesh success.

## Next smallest real-model check

1. Keep this calibrated SceneSpec as the describe+calibrate input.
2. Point `CARINA_MESH_PROVIDER_URL` at a service that implements `POST /v1/generate` and returns a parseable self-contained GLB.
3. Generate **one** SceneSpec `route: generate` object (`bar-front`) through that HTTP adapter, then NL-calibrate it, freeze, reopen, `exportGlb`. The plan anchor and the attached object must both keep the calibrated pose. `sceneSpec.source` must stay `heuristic-plan` or `steward-plan`.
4. A downloaded helmet, UE `Cooked/` mesh, the 4-vertex panel, the bar-counter test double, or this SceneSpec JSON is **not** that check.
