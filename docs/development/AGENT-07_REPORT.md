# AGENT-07 report — generation.extend patches persisted SceneSpec courtyard

Session: `351d0c52-b566-4672-a231-8928813d5d77`  
Date: 2026-09-11

This slice compiles **continue/extend** into a persisted SceneSpec patch: `generation.extend` and the door-near garden path append a `kind: courtyard` region and at least one adjacent object (`garden-gate`, `route: scaffold`). `freeze` + reopen on the same `dataDir` keeps the patched plan.

It is **not** 3D generation. **SceneSpec gaining a courtyard is not a world model generating a garden.** The mock tavern garden geometry, HTTP test doubles, and `bar-counter-glb.ts` stay fixtures. Do not treat this report as P0, P1, or generation success.

Product goal is unchanged: describe → generate → explore → calibrate → freeze → continue/extend → export. This slice only lands “extend the plan (and the existing mock garden path still grows spatial geometry).”

## Files changed (this turn)

- `src/scene-compiler/compile-scene-spec.ts` — `applySceneSpecExtend` (source, prompt, interior bounds, and existing objectIds unchanged)
- `src/scene-compiler/index.ts` — export `applySceneSpecExtend`
- `src/scene-compiler/scene-spec.test.ts` — courtyard adjacency, calibrated `bar-front`, steward-plan, missing interior
- `src/application/create-application.ts` — `persistExtendedSceneSpec`; `generation.extend` and `runExtensionLocked` restage `.scene-spec.json`
- `src/application/scene-spec-extend.test.ts` — NL calibrate+extend round-trip; door-near; no generate POST
- `docs/development/AGENT-07_REPORT.md` — this file

Did not edit `runtimes/unreal`, `docs/benchmarks/windows-rtx5070ti`, `docs/development/COORDINATION.md`, live world data, or git history. Did not restart `:18790`. Did not connect to live `:18794`. Did not download DamagedHelmet. Did not invent a Meshy/Tripo SDK. Did not set a fake `CARINA_MESH_PROVIDER_URL`. Did not POST the mesh adapter as part of extend.

## Behavior

1. **`generation.extend` patches SceneSpec when a plan exists**  
   `applySceneSpecExtend` appends `kind: courtyard` adjacent to the existing interior (metric, sharing the interior +X face). It does not rewrite interior 12×10 bounds. It appends `garden-gate` (`route: scaffold`) if no courtyard-adjacent object exists. The patched JSON is staged as a new `.scene-spec.json`, then `sceneSpec`, `sceneSpecRef`, and `assetManifest` are updated. `source` stays `heuristic-plan` or `steward-plan`. It is never rewritten to `world-model` or `native-mesh`. Original `prompt` and existing `objectId`s (including a calibrated `bar-front.anchor`) stay.

2. **Door-near mock garden still grows, and now also patches the plan**  
   `runExtensionLocked` persists the SceneSpec courtyard before attaching the primitive garden. Existing test “approaching the door extends a garden without replacing tavern assets” still passes: interior `visualRefs` and the cup stay. The mock garden is still mock geometry, not a generated mesh.

3. **Failure is explicit**  
   If a SceneSpec exists but cannot be patched (no interior region), extend returns `VALIDATION_FAILED`. It does not silently compile a new tavern. Missing SceneSpec is left alone; spatial mock extend may still run.

4. **No-apiKey NL**  
   `interpretFast` 「在门外生成花园」 still compiles to `generation.extend`. That path patches SceneSpec; it is not camera-only observation. Observe-injected worlds still patch the plan before looking through the doorway.

5. **Generate path is untouched**  
   Extend does not call `generateScene` and does not POST `/v1/generate`. Unset mesh URL still uses the mock tavern. Generate-route items are not turned into `.glb`. Existing `scene-spec-create` / `scene-spec-calibrate` / `scene-spec-generate` (no-URL) / `application` / `place-asset` / `native-mesh-create` still pass.

## Verification

| Command | Result |
|---|---|
| `pnpm exec tsx --test src/scene-compiler/scene-spec.test.ts src/application/scene-spec-extend.test.ts src/application/scene-spec-create.test.ts src/application/scene-spec-calibrate.test.ts src/application/interpret-fast.test.ts` | 29 pass |
| `pnpm exec tsx --test src/application/application.test.ts src/application/scene-spec-generate.test.ts src/application/place-asset.test.ts src/application/native-mesh-create.test.ts src/schema/v1/v1.test.ts` | 27 pass |
| `pnpm test` | 256 pass, 0 fail |
| `pnpm typecheck` | pass |
| `pnpm build` | pass |

Create-path test: no apiKey, tavern/bar prompt → text 「把吧台往左移一米」 → `spatial.calibrate` → `bar-front.anchor.x` −1 m → text 「在门外生成花园」 → `generation.extend` accepted → SceneSpec has courtyard + original 12×10 interior; `bar-front` still at the calibrated anchor; `garden-gate` is `scaffold` → freeze → close → same `dataDir` reopen, packed `.scene-spec.json` still has courtyard and the calibrated anchor, `source` is still `heuristic-plan`. Door-near `player.act` move also writes courtyard without dropping tavern object ids. Injected compiler + no mesh URL: `generateScene` is not called again during extend; generate items have no `.glb`.

## Real backend probe

`CARINA_MESH_PROVIDER_URL` was **unset**. No live mesh POST. No live `:18794`. Extend never submits generate. Tests used the mock tavern, the primitive garden, and an injected `generateScene` counter, not a world model.

Status for a real 3D backend: still **BLOCKED** (no URL). SceneSpec courtyard extend does not fill that gap.

## Limitations

- SceneSpec remains a **plan document**. Adding `kind: courtyard` and `garden-gate` is not generating a garden mesh, collision, or playable courtyard.
- The mock garden attached by `extendPrimitiveGarden` is still the primitive AABB garden from earlier slices. It is not compiled from the SceneSpec courtyard and is not “world model generated.”
- `route: scaffold` on `garden-gate` is routing intent. Nothing in this slice submits that object to a mesh provider. `route: generate` items stay plans.
- Heuristic courtyard placement is a template: 8 m beyond the interior +X face, 3 m high, same Z span. It is reproducible, not a world model.
- Observe-only worlds patch the plan without growing mock garden geometry (they have no mock tavern meshes).

## Honest generation gaps

- There is still **no** connected generative 3D backend in this environment.
- LingBot cannot freeze 3D (`nativeMesh: false`).
- Mock `nativeMesh: true` remains a procedural tavern when the URL is unset.
- **SceneSpec adding a courtyard ≠ a world model generated a garden.**
- Do not ship, demo, or report this slice as P0, P1, or native-mesh success.

## Next smallest real-model check

1. Keep this extended SceneSpec as the describe+calibrate+extend input.
2. Point `CARINA_MESH_PROVIDER_URL` at a service that implements `POST /v1/generate` and returns a parseable self-contained GLB.
3. Generate **one** SceneSpec `route: generate` object (`bar-front`) through that HTTP adapter, NL-calibrate it, then extend the courtyard plan, freeze, reopen. Interior bounds and the calibrated `bar-front` must stay. `sceneSpec.source` must stay `heuristic-plan` or `steward-plan`.
4. A downloaded helmet, UE `Cooked/` mesh, the 4-vertex panel, the bar-counter test double, the mock garden, or this SceneSpec JSON is **not** that check.
