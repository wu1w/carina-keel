# AGENT-05 report — persisted SceneSpec drives native-mesh HTTP request

Session: `ed0c9777-1180-443c-9585-0e048167d95d`  
Date: 2026-09-11

This slice wires a **persisted SceneSpec into `runGeneration` / `generateScene` and the HTTP native-mesh POST**. After `session.create` compiles a plan, the first `route: generate` object (tavern heuristic: `bar-front`) is sent to `POST /v1/generate`. The returned GLB attaches to that same `objectId`.

It is **not** 3D generation success. The HTTP test double and `bar-counter-glb.ts` are contract stand-ins. Passing these tests does not mean a world model produced a tavern. Do not treat this report as P0, P1, or generation success. DamagedHelmet, UE cooked meshes, LLM asset-library assembly, the 4-vertex textured panel, the primitive tavern, and this bar-counter fixture are not native-mesh success.

Product goal is unchanged: describe → generate → explore → calibrate → freeze → continue/extend → export. This slice only lands “describe drives the generate request.”

## Files changed (this turn)

- `src/providers/types.ts` — `NativeMeshGenerateTarget` / `NativeMeshSubmitExtras`; `submitGeneration` optional extras
- `src/providers/index.ts` — export the extras types
- `src/providers/http-native-mesh.ts` — POST includes `sceneSpec` + first generate object; GLB `objectId` is that identity (no new `native-mesh-<ulid>` featured object when extras are present)
- `src/providers/http-native-mesh.test.ts` — POST body extras contract
- `src/scene-compiler/compile-scene-spec.ts` — `firstGenerateObject` (tavern heuristic: `bar-front`)
- `src/scene-compiler/index.ts` — export `firstGenerateObject`
- `src/scene-compiler/scene-spec.test.ts` — first generate object is `bar-front`
- `src/application/deps.ts` — `generateScene` input may include `sceneSpec`
- `src/application/load-deps.ts` — `wrapProvider.generateScene` forwards SceneSpec extras
- `src/application/create-application.ts` — `runGeneration` reads `pack.readSnapshot(worldId).sceneSpec` and passes it
- `src/application/scene-spec-generate.test.ts` — create → POST → freeze → reopen → `exportGlb`; no-URL; 500
- `docs/development/AGENT-05_REPORT.md` — this file

Did not edit `runtimes/unreal`, `docs/benchmarks/windows-rtx5070ti`, `docs/development/COORDINATION.md`, live world data, or git history. Did not restart `:18790`. Did not connect to live `:18794`. Did not download DamagedHelmet. Did not invent a Meshy/Tripo SDK.

## Behavior

1. **`runGeneration` reads the persisted plan**  
   After `session.create` compiles and commits SceneSpec, `runGeneration` calls `sceneSpecFromSnapshot`. If a spec exists, it is passed into `generateScene`. If none exists, AGENT-03 behavior is unchanged (bare prompt + `GenerationPlan`). Missing spec does not fail the mock path.

2. **HTTP POST includes the generate route**  
   When extras are present, `POST {url}/v1/generate` JSON includes:
   - original `prompt` / `sceneDescription`
   - `sceneSpec`
   - this request’s object: `objectId`, `name`, `role`, optional `dimensions` / `anchor`  
   One request generates **one** featured object (first `route: generate`). Tavern heuristic is `bar-front`. Remaining `reuse` / `scaffold` items, and later generate items such as `sign`, are not turned into a GLB by this request. Without extras the AGENT-03 body `{ prompt, plan }` is unchanged.

3. **GLB attaches to the SceneSpec objectId**  
   `GeneratedMeshAsset.objectId` and the candidate mesh `sceneObjectId` are that generate objectId (`bar-front`). `attachGeneratedMeshAssets` already matches on this. A successful test-double GLB does **not** rewrite `SceneSpec.source` to `native-mesh` or `world-model`. Source stays `heuristic-plan` or `steward-plan`. Mesh provenance may remain on the candidate / fixture (`http-native-mesh-test-double`); it is not the plan source.

4. **Unset URL path is unchanged**  
   No `CARINA_MESH_PROVIDER_URL` still uses the mock tavern. Generate-route items are not native-mesh `.glb` successes. Existing application / place-asset / scene-spec-create / native-mesh-create tests stay on this path unless a URL is injected.

5. **Failure stays honest**  
   HTTP 5xx / bad GLB: create/generation fails. No silent primitive tavern. SceneSpec is not marked generated. LingBot `nativeMesh` remains `false`.

## Verification

| Command | Result |
|---|---|
| `pnpm exec tsx --test src/application/scene-spec-generate.test.ts src/providers/http-native-mesh.test.ts src/application/native-mesh-create.test.ts src/application/scene-spec-create.test.ts src/scene-compiler/scene-spec.test.ts src/config.test.ts src/providers/providers.test.ts` | 32 pass |
| `pnpm exec tsx --test src/application/application.test.ts src/application/place-asset.test.ts src/exporter/exporter.test.ts src/exporter/gltf-fidelity.test.ts src/spatial/bake-map.test.ts src/schema/v1/v1.test.ts` | 30 pass |
| `pnpm test` | 242 pass, 0 fail |
| `pnpm typecheck` | pass |
| `pnpm build` | pass |

Create-path test: tavern/bar prompt → snapshot `sceneSpec.source === heuristic-plan` with `bar-front` generate → test double POST body contains that `objectId` / `sceneSpec` → freeze → close → same `dataDir` reopen → `bar-front` has `.glb` → `exportGlb` parses with `@gltf-transform/core` as the bar-counter double (10 verts, UV, baseColor, metallic 0.08 / roughness 0.62, inner node `bar-body`). Not a 24-vert box, not a 4-vert panel. `spec.source` is still not `world-model` / `native-mesh`. Unset URL: generate items have no `.glb`. Test-double 500: create fails, no silent `门` / `桌子` tavern.

## Real backend probe

`CARINA_MESH_PROVIDER_URL` was **unset** in this session. No live POST was made. No live `:18794`. Tests used a local `node:http` double returning `bar-counter-glb.ts`. **POSTing the test double is not a world model generating a tavern.**

Status for a real native-mesh backend: **BLOCKED** (no URL). Adapter + SceneSpec wiring is still landed.

## Limitations

- SceneSpec remains a **plan document**. This slice submits one generate-route object to the existing HTTP contract; it does not create a world-model tavern.
- Only the first `route: generate` object is requested. Other generate items (for example `sign`) stay plans.
- Playable scaffold objects (`playable-door` / `playable-prop-*`) are still AABB stand-ins so spatial freeze checks pass. They are not generated native mesh.
- Unset URL still bakes the **mock tavern**. That geometry is not compiled from SceneSpec generate items.
- The `node:http` double and `bar-counter-glb.ts` are authored fixtures. **Test double ≠ world model.**
- HTTP adapter does not invent a Meshy/Tripo SDK. It only speaks the HTTP contract above.

## Honest generation gaps

- There is still **no** connected generative 3D backend in this environment.
- LingBot cannot freeze 3D (`nativeMesh: false`).
- Mock `nativeMesh: true` remains a procedural tavern when the URL is unset.
- A POST that returns the bar-counter fixture is **not** “Carina generated a world.”
- Do not ship, demo, or report this slice as P0 or as native-mesh success.

## Next smallest real-model check

1. Point `CARINA_MESH_PROVIDER_URL` at a service that implements `POST /v1/generate`, accepts `sceneSpec` + `objectId` (first generate route), and returns a parseable self-contained GLB (optional `CARINA_MESH_PROVIDER_KEY_FILE` for Bearer).
2. One real POST: record HTTP status and whether the body (or follow-up GET) starts with GLB magic `glTF`. Do not paste secrets or large base64 into a report.
3. `session.create` with a tavern/bar prompt and **no** `observe` renderer → freeze → close the process → `createApplication` on the same `dataDir` → `bar-front` still has that GLB → `exportGlb` → parse with `@gltf-transform/core`. Inner nodes / UVs / PBR must match **that** generated asset. `sceneSpec.source` must stay `heuristic-plan` or `steward-plan`.
4. A downloaded helmet, UE `Cooked/` mesh, the 4-vertex panel, this bar-counter test double, or the SceneSpec JSON is **not** that check.
