# AGENT-02 — 交给本机 Grok CLI（2026-09-11 17:16）

在 `/Users/william/world` 开发。先读 `PRD.md`、`docs/NEXT_GENERATION_PLAN.md` 目标校正、`docs/development/COORDINATION.md`、`docs/development/AGENT-01_REPORT.md`。

你是实现者，不是调度器。禁止调用 grok_start / grok_resume / spawn 子 agent 写代码。禁止等待其他进程。直接改文件。

Cursor 统筹；Grok Bot 只做 Windows / `runtimes/unreal`。只改你的文件范围：`src/`、针对性测试、必要依赖、`scripts/probes`、`docs/development/AGENT-02_REPORT.md`。

不要改 `runtimes/unreal/`、`docs/benchmarks/windows-rtx5070ti/`、`docs/development/COORDINATION.md`。不要 git commit。不要重启 `:18790`。不要连 live `:18794`。

## 现状（已核实）

AGENT-01 已过 Cursor 独立验收（exporter + bake 8/8）：

- 已提交 `.glb`/`.gltf` 经 `pack.readAsset` 导出，保留网格/内部节点/UV/PBR + 实例 TRS。
- `bakeMapAssets` 不再把已提交 GLB `assetRefs` 改写成 `mesh.json`。
- `wrapExporter(pack)` 已接 `readAsset`。
- `Application.exportGlb(worldId)` 已存在。

**主链缺口：** 应用层没有把真实 GLB 放进 world session 的产品路径。

- `session.create` / freeze 仍走 mock provider + `bakeMapAssets` 的 primitive 酒馆。
- `stageAsset` 只给 bake 的 `mesh.json` / still 用。
- 没有 `spatial.placeAsset`（或等价命令）。
- `src/application/application.test.ts` 只断言 freeze 后存在 `.mesh.json`，没有「staged GLB → 命令提交 → freeze → 关进程重开 → `exportGlb` 仍是原网格」的验收。
- 生产 `wrapProvider()` 仍 mock；LingBot `nativeMesh: false`。本轮 **不要** 假装已接世界模型。

## 有界目标

打通：**自包含 GLB 进入世界包 → 成为 SceneObject → freeze 保引用 → 关应用重开 → `exportGlb` 保真。**

这不是生成。fixture / staged GLB ≠ 世界模型产物。报告里写清。

1. 给 `Application` 增加 `stagePackAsset(worldId, bytes, ext)`，内部走已有 `deps.pack.stageAsset`，返回 `{ hash, posixPath }`。`src/server/bind-application.ts` 的 `Application` 类型一并更新。
2. 新增 intent `spatial.placeAsset`（`src/schema/v1/enums.ts` 的 `intentKindSchema`；相关 schema 测试跟上）。
3. `handlePlaceAsset`：
   - 参数：`hash`（64 hex）、`ext`（仅 `glb`/`gltf`）、`name`、可选 `transform`（缺省单位变换）、可选 `sceneObjectId`、可选 `regionId`（默认当前室内 `interiorRegion`）。
   - 用 `pack.readAsset` 确认字节在包里。写入 `SceneObject.assetRefs = ["assets/<hash>.<ext>"]`，并追加 `snapshot.assetManifest`。
   - 把 `sceneObjectId` 加入目标 region 的 `objectRefs`。
   - AABB：从 GLB 几何推导（可用已锁的 `@gltf-transform/core`）；推不出则拒绝，不要默默给一个巨大盒子冒充。
   - `mobility: "static"`，`interactionProfile: "none"`。
   - `commitSnapshot`（不要为了 place 去 `objectToLocalMesh`）。校验失败 → `VALIDATION_FAILED`。
   - 拒绝：URL、绝对路径、`Cooked/`、非 glTF 扩展名、缺失/损坏资产。错误用已有 `CarinaError` / `EXPORT_FAILED` / `COMMAND_REJECTED` / `NOT_FOUND`，**禁止静默换成杯子/盒子**。
4. `spatial.freeze` 必须继续走 AGENT-01 的 bake 行为：已提交 GLB 引用保持；primitive 仍可 `mesh.json`。
5. 关 `Application`、用同一 `dataDir` 再 `createApplication`，同一 `worldId` 的 GLB hash 仍可 `readPackAsset`；`exportGlb` 程序解析后仍是原网格，不是 AABB 盒子。
6. 同资产两个实例（不同旋转 / 非均匀缩放）、同名不同 `sceneObjectId` 必须在导出里分开（沿用 AGENT-01 的 `glbNode` / `extras.sceneObjectId` 约定）。
7. 不需要本轮做 NL `interpretFast`「放入模型」。测试用 `dispatchCommand`。不要改 `wrapProvider`。不要加真实生成后端。不要碰 UE。

## 测试（必须程序解析 GLB）

写在 `src/application/`（新文件或扩 `application.test.ts`）。可从 `src/exporter/gltf-fidelity.test.ts` 抽出共享 fixture 生成器，不要下载 DamagedHelmet。

至少：

- `session.create` 酒馆 → `stagePackAsset` 带纹理的自包含 GLB → 两次 `spatial.placeAsset`（同 hash，不同 transform；可同名）→ `spatial.freeze` → 断言 snapshot 里两条 `.glb` `assetRefs` 仍在，**没有**被改成 `.mesh.json`。
- `app.close()` 后新 `createApplication(testConfig(dataDir))` → `exportGlb(worldId)` → `@gltf-transform/core` 解析：顶点数不是 24 的盒子、有 UV、有 baseColor 纹理、两实例 TRS 不同、`sceneObjectId` extras 可分。
- `placeAsset` 对 missing hash / `https://…` / `Cooked/` 拒绝。
- 现有 `src/application/application.test.ts`、`src/exporter/*`、`src/spatial/bake-map.test.ts` 仍过。

## 验证与报告

跑与改动相关的测试、`pnpm typecheck`、`pnpm build`。不要全仓无关重构。

完成后写 `docs/development/AGENT-02_REPORT.md`：本轮文件、行为变化、验证命令与结果、限制、诚实写出 mock/LingBot 缺口、session id。有失败继续修，只有明确外部阻塞才停。
