# AGENT-01 report — committed GLB export fidelity

Session: `14d1f6da-fd1e-47fe-9721-9193053d9dcc`  
Previous cancelled session (read-only, no code): `087a0fa6-c943-4481-b207-d4e3afc97cbb`  
Date: 2026-09-11

This slice is **export fidelity only**. Product goal is unchanged: natural language → real generative 3D candidates → calibrate/freeze → playable exploration + local edits → reopen consistent → editable GLB/texture export → extend under committed constraints.

## Files changed (this turn)

- `package.json`, `pnpm-lock.yaml` — add locked `@gltf-transform/core@4.2.1` and `@gltf-transform/functions@4.2.1`
- `src/spatial/gltf-asset-ref.ts` — detect committed `.gltf`/`.glb` refs
- `src/spatial/bake-map.ts` — do not rewrite committed GLB `assetRefs` to `mesh.json`
- `src/spatial/index.ts` — export the detector
- `src/spatial/bake-map.test.ts` — freeze keeps a committed GLB across a second bake
- `src/exporter/asset-ref.ts` — pack POSIX resolve, unsafe/unsupported paths, unique node names, XYZ Euler → quaternion
- `src/exporter/compose-scene-glb.ts` — load pack GLB/glTF, instance TRS, keep inner hierarchy / UVs / PBR
- `src/exporter/build-model-export.ts` — primitive path still uses `objectToLocalMesh`; GLB path never falls back to a box/cup
- `src/exporter/index.ts` — export `ReadPackAsset`
- `src/exporter/gltf-fidelity.test.ts` — programmatic GLB parse (not magic bytes)
- `src/application/load-deps.ts` — `wrapExporter(pack)` calls `pack.readAsset(worldId, hash, ext)` using `snapshot.assetManifest`
- `docs/development/AGENT-01_REPORT.md` — this file

Did not edit `runtimes/unreal`, `docs/benchmarks/windows-rtx5070ti`, live world data, or git history. Did not restart the Carina server on 18790.

## Behavior

1. **Committed glTF/GLB**  
   If a `SceneObject` has a `.gltf`/`.glb` `assetRef`, export reads `assets/<sha256>.<ext>` through `readAsset` after resolving `snapshot.assetManifest`. The source mesh, inner nodes, UVs, and PBR textures are copied. `SceneObject.transform` is applied on a wrapper instance node (`translation` + XYZ Euler → quaternion + scale, including non-uniform scale). `extras.sceneObjectId` and `manifest.objectMapping` are the stable identity. Duplicate display names get distinct `glbNode` values (`name__sceneObjectId`).

2. **Primitives**  
   Empty refs, `.mesh.json`, and `.mesh` placeholders still go through `objectToLocalMesh` + `buildMeshesGlb`. Door / chair / cup tests stay on that path.

3. **Failures**  
   Missing pack bytes, corrupt GLB, unsupported mesh formats (fbx/obj/usd/…), URLs, Windows/Unix absolute paths, and UE `Cooked/` paths throw `CarinaError("EXPORT_FAILED")`. They are **not** replaced with a box or cup.

4. **Freeze**  
   `bakeMapAssets` leaves committed GLB `assetRefs` (and region `visualRefs`) alone. Primitive objects still get `mesh.json`. A later freeze of a mixed scene does not clobber the GLB objects.

5. **Fixed snapshot**  
   Export uses the given snapshot revision and pack-relative POSIX paths (`scene.glb`, `assets/<hash>.<ext>`). No UE cooked paths, temp URLs, or host absolute paths.

## Library choice

`@gltf-transform/core@4.2.1` + `@gltf-transform/functions@4.2.1` (pnpm lockfile, not `^`).

- Core `WebIO.readBinary` / `writeBinary` works on `Uint8Array` only — no filesystem URIs, so Windows absolute paths cannot leak into the export.
- `mergeDocuments` copies node hierarchy, accessors, materials, and embedded textures into one scene.
- `unpartition` + `prune` collapse merged buffers.
- Core PBR (`baseColorTexture`, metallic/roughness factors) is enough for this slice; no Draco/Meshopt extra deps.

4.5.0 is published; this lock is a matching 4.2.1 pair so the composition API stays reproducible.

No large models were downloaded. The textured fixture is a 4-vertex panel + 2×2 PNG generated in the test.

## Verification

| Command | Result |
|---|---|
| `pnpm exec tsx --test src/exporter/exporter.test.ts src/exporter/gltf-fidelity.test.ts src/spatial/bake-map.test.ts` | 8 pass (door/chairs/cup, instances+PBR, missing/corrupt, pack reopen, bake keep-GLB) |
| `pnpm exec tsx --test src/application/application.test.ts src/pack/revision.test.ts src/spatial/spatial.test.ts` | 25 pass including A8 export |
| `pnpm test` | 214 pass, 0 fail |
| `pnpm typecheck` | pass |
| `pnpm build` | pass |

Fidelity tests parse the output with `@gltf-transform/core` `WebIO.readBinary`: vertex count 4 (not a 24-vert box), inner node `offset-arm` translation, TEXCOORD_0, baseColor texture bytes, metallic 0.2 / roughness 0.35, two instances with different rotation and non-uniform scale, duplicate name `灯` mapped to two `glbNode`s. Pack test: `createPack` → `stageAsset` → commit → freeze (GLB ref kept) → export → re-`readHead`/`readSnapshot` → export again; hashes still resolve and the GLB still parses. Cup in the mixed scene still has >24 vertices.

## Limitations

- Primitive export still rebuilds AABB/cup meshes from the object, not by decoding `mesh.json`. That is allowed for this slice and keeps existing tests green.
- Each GLB instance is merged as its own copy (duplicate meshes/textures per instance). Correct, not instanced GPU-style.
- `.gltf` with *external* buffer/image URIs is rejected (unsupported), not fetched.
- Unknown glTF extensions fail parse (strict), which is treated as corrupt/unsupported rather than stripped.
- Skeletal animation, production topology, and automatic UV unwrap remain listed as `unsupportedFeatures`.
- Viewport committed-map still uses AABB/cup triangle meshes (`buildCommittedMapView`); this slice did not change play-mode rendering.

## Honest generation gaps (not this slice)

- `wrapProvider()` in `src/application/load-deps.ts` still uses `createMockProvider()`. Creating a world without a renderer still bakes the primitive tavern.
- `src/providers/lingbot-legacy.ts` declares `nativeMesh: false`, `spatialExport: false`, `videoOnly: true`. `submitGeneration` throws `UNSUPPORTED`. It cannot freeze 3D.
- In-test GLB fixtures and UE PBR test assets are **not** world-model products. Passing export tests does not mean generation works.

## Next smallest real-model check

Once a native-mesh provider exists (or an authored pack GLB is committed by hand): freeze that revision, close the session, reopen from disk, export, and open `scene.glb` in a DCC. Confirm inner nodes, UVs, and PBR textures match the committed asset, and that instance TRS matches `SceneObject.transform`. Do not treat a downloaded helmet or UE cooked mesh as generation success.
