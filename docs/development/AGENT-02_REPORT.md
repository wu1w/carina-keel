# AGENT-02 report — application path for staged GLB

Session: AGENT-02 implementation (COORDINATION dispatch `290797ce` / `b7afe3d0`)  
Date: 2026-09-11

This slice is **application staging + place + freeze + reopen export**. It is **not generation**. The textured panel fixture and any staged GLB bytes are **not** world-model products. Passing these tests does not mean a generative world model produced a mesh.

Product goal is unchanged: describe → generate → explore → calibrate → freeze → continue/extend → export. This slice only opens the application path that commits an already-authored pack GLB as a SceneObject so AGENT-01 export fidelity can be reached from `Application`.

## Files changed (this turn)

- `src/schema/v1/enums.ts` — add intent `spatial.placeAsset`
- `src/schema/v1/v1.test.ts` — parse the new intent
- `src/spatial/gltf-bounds.ts` — AABB from GLB/glTF geometry via locked `@gltf-transform/core` `getBounds`; reject if unparseable or no positions
- `src/spatial/index.ts` — export `aabbFromGltfBytes`
- `src/application/create-application.ts` — `stagePackAsset` wrapping `deps.pack.stageAsset`; `handlePlaceAsset`; route `spatial.placeAsset`
- `src/server/bind-application.ts` — `Application.stagePackAsset` on the HTTP facade type
- `src/server/create-http-app.test.ts` — stub `stagePackAsset` on the fake application
- `src/exporter/textured-panel-glb.ts` — shared self-contained textured 4-vertex panel fixture (extracted from exporter tests)
- `src/exporter/gltf-fidelity.test.ts` — import the shared fixture
- `src/application/place-asset.test.ts` — tavern → stage → place twice → freeze → close → reopen → `exportGlb` parse; reject missing / https / Cooked / corrupt
- `docs/development/AGENT-02_REPORT.md` — this file

Did not edit `runtimes/unreal`, `docs/benchmarks/windows-rtx5070ti`, `docs/development/COORDINATION.md`, `wrapProvider`, live world data, or git history. Did not restart `:18790`. Did not connect to `:18794`. Did not download DamagedHelmet.

## Behavior

1. **`Application.stagePackAsset(worldId, bytes, ext)`**  
   Writes content-addressed bytes through the existing pack API and returns `{ hash, posixPath }` (`assets/<sha256>.<ext>`). Staging alone does not create a SceneObject.

2. **`spatial.placeAsset`**  
   Arguments: `hash` (64 hex), `ext` (`glb`|`gltf` only), `name`, optional `transform` (default identity), optional `sceneObjectId`, optional `regionId` (default current interior).  
   - Confirms bytes with `pack.readAsset`.  
   - `assetRefs = ["assets/<hash>.<ext>"]`; appends `snapshot.assetManifest`.  
   - Adds `sceneObjectId` to the target region's `objectRefs`.  
   - AABB from GLB geometry (`@gltf-transform/core` `WebIO` + `getBounds` after applying instance TRS). Planar meshes get a 1 mm pad on a zero-extent axis so `isValidAabb` holds; that is still derived from vertices, not a stand-in box. No geometry or corrupt/external-URI glTF → `VALIDATION_FAILED`.  
   - `mobility: "static"`, `interactionProfile: "none"`.  
   - `commitSnapshot` only. Does **not** call `objectToLocalMesh` for the placed object.  
   - Rejects URL, absolute paths, `Cooked/`, non-glTF extensions, missing assets (`NOT_FOUND`), corrupt assets (`VALIDATION_FAILED`). Never substitutes a cup or AABB box mesh.

3. **`spatial.freeze`**  
   Unchanged AGENT-01 bake: committed `.glb`/`.gltf` `assetRefs` stay; primitives still get `mesh.json`.

4. **Reopen**  
   `app.close()` then `createApplication(testConfig(dataDir))` for the same `worldId`: `readPackAsset` still returns the hash; `exportGlb` parses as the original panel (4 verts, UVs, baseColor texture, distinct `extras.sceneObjectId`, distinct instance TRS), not a 24-vert box.

## Verification

| Command | Result |
|---|---|
| `pnpm exec tsx --test src/application/place-asset.test.ts src/exporter/gltf-fidelity.test.ts src/spatial/bake-map.test.ts src/schema/v1/v1.test.ts` | 12 pass |
| `pnpm exec tsx --test src/application/application.test.ts src/exporter/exporter.test.ts src/spatial/spatial.test.ts` | 22 pass |
| `pnpm exec tsx --test src/server/create-http-app.test.ts` | 15 pass |
| `pnpm typecheck` | pass |
| `pnpm build` | pass |

Place-asset tests parse export with `@gltf-transform/core` `WebIO.readBinary`: vertex count 4 (not a 24-vert box), `TEXCOORD_0`, baseColor texture, two instances with different rotation and non-uniform scale, duplicate display name `灯` mapped to two `glbNode`s / `sceneObjectId` extras. Missing 64-hex hash → `NOT_FOUND`. `https://…` and `Cooked/` → `COMMAND_REJECTED`. Corrupt staged GLB → `VALIDATION_FAILED` and is not committed.

## Limitations

- Place is a CLI/dispatch command only. No NL `interpretFast` “放入模型” this slice.
- AABB pad of 1 mm on a degenerate axis is only to satisfy `min < max`; it is not a replacement mesh.
- Each placed instance is a SceneObject pointing at the same content-addressed bytes; export still copies meshes per instance (AGENT-01 composition).
- Viewport committed-map still uses AABB/cup triangle meshes for play-mode (`buildCommittedMapView`); this slice did not change play rendering.
- `.gltf` with external buffer/image URIs is rejected (cannot derive AABB without fetching).

## Honest generation gaps (not this slice)

- `wrapProvider()` in `src/application/load-deps.ts` still uses `createMockProvider()`. `session.create` without an observe renderer still bakes the primitive tavern.
- `src/providers/lingbot-legacy.ts` still declares `nativeMesh: false`, `spatialExport: false`, `videoOnly: true`. `submitGeneration` throws `UNSUPPORTED`. It cannot freeze 3D.
- The in-test textured panel GLB is an authored fixture. Staging it through `stagePackAsset` is an application path, not a world-model output. Do not treat this report as generation success.

## Next smallest real-model check

Once a native-mesh provider exists: generate a candidate GLB, `stagePackAsset` / `spatial.placeAsset` (or commit from the provider), `spatial.freeze`, close the process, reopen from the same `dataDir`, `exportGlb`, and parse. Confirm inner nodes, UVs, and PBR match the generated asset. A downloaded helmet, UE cooked mesh, or this panel fixture is not that check.
