# AGENT-03 report — HTTP native-mesh adapter + runGeneration GLB staging

Session: `4bb225eb-7b2f-4ccf-83af-7b8cdada4c69`  
Date: 2026-09-11

This slice wires a **native-mesh HTTP adapter** so `session.create` / `runGeneration` can stage a self-contained GLB before `bakeMapAssets`. It is **not** world-model generation.

The HTTP **test double** used in tests is a contract stand-in. It is **not** a world-model product. Passing these tests does not mean a generative world model produced a mesh. Do not treat this report as P0, P1, or generation success. DamagedHelmet, UE cooked meshes, LLM asset-library assembly, the 4-vertex textured panel, and the primitive tavern are not native-mesh success.

Product goal is unchanged: describe → generate → explore → calibrate → freeze → continue/extend → export.

## Files changed (this turn)

- `src/config.ts` — `meshProviderUrl?` / `meshProviderKeyFile?` from `CARINA_MESH_PROVIDER_URL` / `CARINA_MESH_PROVIDER_KEY_FILE`; empty string is unset
- `src/config.test.ts` — empty URL/key-file treated as unset
- `src/providers/types.ts` — `GeneratedMeshAsset`; `submitGeneration` may return GLB/glTF bytes
- `src/providers/http-native-mesh.ts` — schema adapter: `getCapabilities` / `submitGeneration` / `cancelJob`
- `src/providers/bar-counter-glb.ts` — contract-test chamfered bar GLB (UV + baseColor). **Not** a world-model product
- `src/providers/index.ts` — export HTTP adapter
- `src/providers/providers.test.ts` — HTTP `nativeMesh: true`; LingBot still `false`
- `src/providers/http-native-mesh.test.ts` — contract tests against `node:http` double
- `src/application/deps.ts` — `generateScene` may return `assets` bytes
- `src/application/load-deps.ts` — `wrapProvider(config)`: URL → HTTP adapter, else mock. HTTP failure does **not** call `buildPrimitiveTavern`
- `src/application/create-application.ts` — `runGeneration` stages GLB, writes `assets/<hash>.glb` into `assetRefs` + `assetManifest`, then `bakeMapAssets`
- `src/application/native-mesh-create.test.ts` — create → freeze → close → reopen → `exportGlb` parse; 500/corrupt fail without a silent tavern
- `docs/development/AGENT-03_REPORT.md` — this file

Did not edit `runtimes/unreal`, `docs/benchmarks/windows-rtx5070ti`, `docs/development/COORDINATION.md`, live world data, or git history. Did not restart `:18790`. Did not connect to live `:18794`. Did not download DamagedHelmet.

## Behavior

1. **Config**  
   `loadConfig` reads `CARINA_MESH_PROVIDER_URL` and `CARINA_MESH_PROVIDER_KEY_FILE`. Empty string is unset. The key file is read as a Bearer token at request time. The token is not logged and is not in this report.

2. **HTTP adapter (`id: http-native-mesh`)**  
   `nativeMesh: true`, `videoOnly: false`. LingBot stays `nativeMesh: false` / `videoOnly: true` / `submitGeneration` → `UNSUPPORTED`.  
   Contract: `POST {url}/v1/generate` JSON `{ prompt, plan }`. Response is inline `glbBase64` (or `assets[].base64`) or a later `GET` of GLB bytes (`glbUrl` or `/v1/jobs/{id}/glb`).  
   5xx / unreachable → `INTERNAL`. Non-GLB, empty mesh, unparseable mesh → `VALIDATION_FAILED`. **No** fallback to `buildPrimitiveTavern`.

3. **`wrapProvider`**  
   - `meshProviderUrl` set → HTTP adapter. Missing candidate or missing GLB bytes → `VALIDATION_FAILED`, never the mock tavern.  
   - URL unset → existing mock. Existing application / place-asset / exporter / bake tests stay on this path.

4. **`runGeneration`**  
   If `generateScene` returns GLB/glTF bytes: parse (`aabbFromGltfBytes`), `pack.stageAsset`, write `assets/<hash>.glb` onto the matching `SceneObject.assetRefs` and into `assetManifest`, **then** `bakeMapAssets`. AGENT-01 bake keeps committed `.glb`/`.gltf` refs. Primitive mock (no bytes) is unchanged. Bad GLB / stage failure → `VALIDATION_FAILED` (or the existing `CarinaError` code). Snapshot is not filled with a silent mock tavern.

5. **Playable scaffold (honest)**  
   Spatial playable checks still require a door, ≥3 movable/pickup objects, colliders, and `navigationRef`. A real Meshy-style backend typically returns one GLB, not a Carina scene graph. The HTTP adapter therefore adds AABB stand-ins named `playable-door` / `playable-prop-*` so freeze can run. Those stand-ins bake to `mesh.json`. They are **not** generated native mesh. The generated GLB is the `generated-mesh` object. This is not `buildPrimitiveTavern` and does not use tavern names (`门`, `桌子`, …).

## Verification

| Command | Result |
|---|---|
| `pnpm exec tsx --test src/providers/http-native-mesh.test.ts src/application/native-mesh-create.test.ts src/config.test.ts src/providers/providers.test.ts` | 19 pass |
| `pnpm exec tsx --test src/application/application.test.ts src/application/place-asset.test.ts src/providers/providers.test.ts src/exporter/exporter.test.ts src/exporter/gltf-fidelity.test.ts src/spatial/bake-map.test.ts` | 30 pass |
| `pnpm test` | 228 pass, 0 fail |
| `pnpm typecheck` | pass |
| `pnpm build` | pass |

Create-path tests parse export with `@gltf-transform/core` `WebIO.readBinary`: POSITION count 10 (not 24-vert box, not 4-vert panel), `TEXCOORD_0`, baseColor texture, metallic 0.08 / roughness 0.62, inner node `bar-body`. 500 and corrupt GLB reject `session.create`; snapshot has no `门` / `桌子` / `mesh.json` tavern. `getCapabilities().nativeMesh === true` for the HTTP adapter; LingBot remains `false`.

## Real backend probe

`CARINA_MESH_PROVIDER_URL` was **unset** in this session. No live POST was made. No claim that a world model was called. Connecting to live `:18794` was forbidden and was not done.

Status for a real native-mesh backend: **BLOCKED** (no URL). Adapter code is still landed.

## Limitations

- The `node:http` double and `bar-counter-glb.ts` are authored fixtures. **Test double ≠ world model.**
- Unset URL still uses the mock tavern. That path is test/dev geometry, not generation.
- Playable scaffold objects are AABB stand-ins so existing spatial checks pass. They are not native-mesh success.
- Viewport committed-map still uses AABB/cup triangle meshes for play-mode. This slice did not change play rendering.
- HTTP adapter does not invent a Meshy/Tripo SDK. It only speaks the HTTP contract above.
- `.gltf` with external buffer/image URIs still fails parse (`VALIDATION_FAILED`), same as AGENT-01/02.

## Honest generation gaps

- There is still **no** connected generative 3D backend in this environment.
- LingBot cannot freeze 3D (`nativeMesh: false`).
- Mock `nativeMesh: true` remains a procedural tavern for tests when the URL is unset. UI/logs were not rewritten to call that “world model generated.”
- Do not ship, demo, or report this slice as “Carina generated a world.”

## Next smallest real-model check

1. Point `CARINA_MESH_PROVIDER_URL` at a service that implements `POST /v1/generate` and returns a parseable self-contained GLB (optional `CARINA_MESH_PROVIDER_KEY_FILE` for Bearer).
2. One real POST: record HTTP status and whether the body (or follow-up GET) starts with GLB magic `glTF`. Do not paste secrets or large base64 into a report.
3. `session.create` with **no** `observe` renderer → `spatial.freeze` → close the process → `createApplication` on the same `dataDir` → `exportGlb` → parse with `@gltf-transform/core`. Inner nodes / UVs / PBR must match **that** generated asset.
4. A downloaded helmet, UE `Cooked/` mesh, the 4-vertex panel, or this bar-counter test double is **not** that check.
