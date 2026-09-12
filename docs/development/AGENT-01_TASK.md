# AGENT-01 — 交给本机 Grok CLI（2026-09-11 16:20 重派）

在 `/Users/william/world` 开发。先读 `PRD.md`、`docs/NEXT_GENERATION_PLAN.md` 目标校正、`docs/development/COORDINATION.md`。

你是实现者，不是调度器。禁止调用 grok_start / grok_resume / spawn 子 agent 写代码。禁止等待其他进程。直接改文件。

Cursor 统筹；Grok Bot 只做 Windows / `runtimes/unreal`。只改你的文件范围：`src/`、针对性测试、必要依赖、`scripts/probes`、本报告。

## 现状（已核实，不要再审计一轮就结束）

上次 session `087a0fa6-c943-4481-b207-d4e3afc97cbb` 在读文件后被取消，**代码未改**。当前仍是：

- `src/exporter/build-model-export.ts` 对每个 `SceneObject` 调用 `objectToLocalMesh`，再 `buildMeshesGlb`。复杂 GLB/PBR/节点变换会丢。
- `src/spatial/bake-map.ts` 无条件把 `assetRefs` 改成新的 `mesh.json`。再次 freeze 可能覆盖已提交 GLB。
- `wrapExporter()` 只把 snapshot 交给导出器，没有走 `pack.readAsset`。
- 生产 provider 仍 mock；`src/providers/lingbot-legacy.ts` 明确不能三维提交。报告里写清，不要为了测试绿而假装已接世界模型。

## 有界目标

修复：已提交空间资产 → 重新打开世界包 → GLB 导出保真。

1. 从磁盘读取已提交资产（`pack.readAsset` / `assets/<sha256>.<ext>` + `snapshot.assetManifest`），不要另造平行 world 身份。
2. 有 GLB/glTF 资产引用的对象：导出保留原始几何、内部节点层级、实例变换、UV、PBR 纹理。场景对象的 `transform` 作用在实例上；`sceneObjectId` 稳定映射。同名不同 ID 必须分开。
3. 明确的 primitive 对象（无真实网格资产、本来就是盒子/杯子）可以继续走 `objectToLocalMesh`。
4. **有资产引用但读取失败或不支持 → 明确失败或在 manifest `unsupportedFeatures` / validation fail。禁止静默 primitive 替代。**
5. `bakeMapAssets` 不得覆盖已提交 GLB `assetRefs`。局部 freeze 不得把其他对象资产换成粗模。
6. 导出固定 snapshot revision，不依赖 UE cooked 包、绝对 Windows 路径或临时 URL。
7. 可用成熟 glTF 库（例如 `@gltf-transform/core`），pnpm 锁版本，解释选择。不下载大模型、不提交 git、不重启主服务、不动正在用的世界数据。

## 测试（必须程序解析 GLB，不只查 magic）

至少：

- 小型自包含非粗模 GLB 夹具（含纹理 + 内部节点变换）。可在测试里程序生成，不要去网上下 DamagedHelmet。
- 同一资产两个实例，不同旋转 / 非均匀缩放。
- 两个对象同名、不同 `sceneObjectId`。
- 缺失资产、损坏 GLB。
- 写入真实 pack 目录、关掉再打开、再导出，哈希仍可解析。
- 现有 `src/exporter/exporter.test.ts` 的门/椅子/杯子 primitive 用例仍过。

导出不是拷贝输入文件：实例变换与对象身份必须正确，网格/贴图来自原资产。

## 验证与报告

跑与改动相关的测试、`pnpm typecheck`、`pnpm build`。不要全仓无关重构。

完成后写 `docs/development/AGENT-01_REPORT.md`：本轮文件、行为变化、验证命令与结果、限制、下一步最小真实模型验证、session id。诚实列出 mock/LingBot 缺口。有失败继续修，只有明确外部阻塞才停。
