# AGENT-04 report — NL → persistent SceneSpec (describe slice)

Session: `951d7e43-47f8-442b-b3f4-87514634c56f`  
Date: 2026-09-11

This slice compiles **natural language into a persistent SceneSpec** (metric bounds, regions, object list, reuse/generate/scaffold routing, provenance) and writes it into the world pack so `app.close()` + reopen on the same `dataDir` reads the same plan.

It is **not** 3D generation. SceneSpec is a plan. `route: generate` means “planned for later generation,” not “a world model produced a GLB.” The mock tavern, HTTP test doubles, bar-counter fixture, DamagedHelmet, and UE cooked meshes are not world-model products. Do not treat this report as P0, P1, or generation success.

Product goal is unchanged: describe → generate → explore → calibrate → freeze → continue/extend → export. This slice only lands the describe step.

## Files changed (this turn)

- `src/schema/v1/scene-spec.ts` — zod SceneSpec (`prompt`, metric `bounds`, `regions`, `objects[]` with `objectId`/`name`/`role`/`route`, `source`)
- `src/schema/v1/snapshot.ts` — optional `sceneSpec` + `sceneSpecRef` on `WorldSnapshot`
- `src/schema/v1/index.ts`, `src/schema/index.ts` — exports
- `src/schema/v1/v1.test.ts` — schema accepts `heuristic-plan`, rejects `world-model` / `native-mesh`
- `src/scene-compiler/compile-scene-spec.ts` — `compileSceneSpec({ prompt, name })`, heuristic, steward call, pack helpers
- `src/scene-compiler/index.ts` — public exports
- `src/scene-compiler/scene-spec.test.ts` — heuristic / steward fake-fetch / failure fallback
- `src/application/deps.ts` — optional injectable `compileSceneSpec`
- `src/application/create-application.ts` — `session.create` compiles and persists SceneSpec; does not bake generate items into GLB
- `src/application/load-deps.ts`, `src/application/fallback.ts` — later commits carry SceneSpec through write-set merges
- `src/application/scene-spec-create.test.ts` — create → freeze → close → reopen; injected compiler JSON round-trip
- `docs/development/AGENT-04_REPORT.md` — this file

Did not edit `runtimes/unreal`, `docs/benchmarks/windows-rtx5070ti`, `docs/development/COORDINATION.md`, live world data, or git history. Did not restart `:18790`. Did not connect to live `:18794`. Did not download DamagedHelmet. Did not change LingBot (`nativeMesh` remains `false`). Did not change the AGENT-03 HTTP native-mesh path.

## Behavior

1. **SceneSpec schema**  
   `schemaVersion: 1`, original `prompt`, `name`, metric AABB, `coordinateFrame` (meters, right, Y-up), `regions` (at least `interior`; optional `courtyard`), `objects[]` with `objectId`, `name`, `role`, `route` (`reuse` | `generate` | `scaffold`) and optional size/anchor.  
   `source` is only `steward-plan` (structured LLM call) or `heuristic-plan` (no apiKey / call failed). `world-model` and `native-mesh` are **not** valid SceneSpec sources. A plan is not a mesh.

2. **`compileSceneSpec({ prompt, name })`**  
   - No `config.apiKey` (existing tests): deterministic keyword heuristic. Same prompt+name → same JSON. Tavern/吧台 → ~12×10×4 interior, at least one `route: generate` (吧台正面 / 招牌). Station keywords do not silently become a tavern bar-front.  
   - With apiKey: one `CARINA_MODEL` / `modelBaseUrl` structured call (`maxRetries: 0`). Success → `source: steward-plan`. Failure or invalid JSON → bounded heuristic with `source: heuristic-plan`. Never silent mock-tavern-as-generated.

3. **`session.create` persistence**  
   After the session exists, the app compiles a SceneSpec, stages `assets/<sha256>.scene-spec.json`, and commits `sceneSpec` + `sceneSpecRef` onto the snapshot + `assetManifest`. Later generation/freeze commits carry those fields. `app.close()` then `createApplication` on the same `dataDir` reads the same prompt, objectId, route, and source.

4. **Does not rewrite the mock / HTTP mesh path**  
   Unset `CARINA_MESH_PROVIDER_URL` still uses the mock tavern for playable geometry (test/dev, not generation). AGENT-03 HTTP native-mesh still stages a GLB when the URL is set. Generate-route SceneSpec objects are **not** turned into `.glb` native-mesh successes. Mock tavern `mesh.json` objects are still the mock tavern; they are not renamed as SceneSpec success.

## Verification

| Command | Result |
|---|---|
| `pnpm exec tsx --test src/scene-compiler/scene-spec.test.ts src/application/scene-spec-create.test.ts src/schema/v1/v1.test.ts` | 12 pass (after fixing the steward fake-fetch body) |
| `pnpm exec tsx --test src/application/scene-spec-create.test.ts src/application/application.test.ts src/application/place-asset.test.ts src/application/native-mesh-create.test.ts src/providers/providers.test.ts src/providers/http-native-mesh.test.ts src/exporter/exporter.test.ts src/exporter/gltf-fidelity.test.ts src/spatial/bake-map.test.ts src/config.test.ts` | 49 pass |
| `pnpm test` | 238 pass, 0 fail |
| `pnpm typecheck` | pass |
| `pnpm build` | pass |

Existing application / place-asset / native-mesh tests still pass **without** a mesh URL. LingBot `getCapabilities().nativeMesh === false` still holds.

## Real backend probe

`CARINA_MESH_PROVIDER_URL` was **unset**. No live mesh POST. No live `:18794`. A steward-plan path was exercised only with a **fake fetch** in unit tests. No claim that a world model or native-mesh backend was called.

Status for a real 3D backend: still **BLOCKED** (no URL). SceneSpec does not fill that gap.

## Limitations

- SceneSpec is a **plan document**. It does not create GLB, PBR, collision, or a playable generated tavern.
- `route: generate` is routing intent. Nothing in this slice submits those items to a mesh provider.
- Unset mesh URL still bakes the **mock tavern** for spatial playable tests. That geometry is not compiled from SceneSpec generate items and is not “world model generated.”
- Heuristic plans are keyword templates (tavern / station / generic). They are reproducible, not a world model.
- Steward-plan requires `apiKey` and a reachable `modelBaseUrl`. On failure the source is honestly `heuristic-plan`.
- HTTP test doubles, `bar-counter-glb.ts`, AABB playable scaffolds, and the 4-vertex panel remain fixtures from earlier slices.

## Honest generation gaps

- There is still **no** connected generative 3D backend in this environment.
- LingBot cannot freeze 3D (`nativeMesh: false`).
- Mock `nativeMesh: true` remains a procedural tavern when the URL is unset.
- Persisting a SceneSpec is **not** “Carina generated a world.”
- Do not ship, demo, or report this slice as P0 or as native-mesh success.

## Next smallest real-model check

1. Keep this SceneSpec as the describe input.
2. Point `CARINA_MESH_PROVIDER_URL` at a service that implements `POST /v1/generate` and returns a parseable self-contained GLB.
3. Generate **one** SceneSpec `route: generate` object (for example `bar-front`) through that HTTP adapter, stage the GLB, freeze, reopen, `exportGlb`, parse with `@gltf-transform/core`.
4. A downloaded helmet, UE `Cooked/` mesh, the 4-vertex panel, the bar-counter test double, or this SceneSpec JSON is **not** that check.
