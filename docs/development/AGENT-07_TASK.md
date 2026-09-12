# AGENT-07 — 交给本机 Grok CLI（2026-09-11 22:21）

在 `/Users/william/world` 开发。先读 `PRD.md`、`docs/NEXT_GENERATION_PLAN.md` 目标校正、`docs/development/COORDINATION.md`、`docs/development/AGENT-04_REPORT.md`、`docs/development/AGENT-06_REPORT.md`。

你是实现者，不是调度器。禁止调用 grok_start / grok_resume / spawn 子 agent 写代码。禁止等待其他进程。直接改文件。

Cursor 统筹；Grok Bot 只做 Windows / `runtimes/unreal`。只改你的文件范围：`src/`、针对性测试、必要依赖、`scripts/probes`、`docs/development/AGENT-07_REPORT.md`。

不要改 `runtimes/unreal/`、`docs/benchmarks/windows-rtx5070ti/`、`docs/development/COORDINATION.md`。不要 git commit。不要重启 `:18790`。不要连 live `:18794`。不要下载 DamagedHelmet。不要宣称 P0/P1。不要把 SceneSpec / mock 花园 / HTTP 测试替身称作世界模型产物。不要发明 Meshy/Tripo SDK。不要设假的 `CARINA_MESH_PROVIDER_URL`。

## 现状（已核实）

AGENT-04/05/06 已过 Cursor 独立验收：NL → 持久 SceneSpec；有 URL 时 generate 路由驱动 HTTP；无 apiKey 校准句会补丁计划锚点并重开。真实三维后端仍 **BLOCKED**。

`generation.extend` / `maybeExtendNearDoor` 已经能在 mock 路径长出花园，且「走到门口扩展花园」测试要求不替换酒馆资产。**SceneSpec 不会因此多出 courtyard 区域。** NG-1 要求：在已提交空间约束下扩展相邻内容；重开后计划与约束仍在。当前扩展只动了 mock 几何，计划层掉了。

## 有界目标

打通：**已有酒馆 SceneSpec → `generation.extend`（或现有门口扩展路径）→ 计划增加 courtyard 区域与至少 1 个相邻物件，不替换 interior / 已有 objectId → freeze / 同一 `dataDir` 重开仍在。**

这是「继续/扩展」的**计划**切片，**不是**三维生成。不要为了扩展去 POST 网格适配器。不要把 `source` 改成 `world-model` / `native-mesh`。校准过的 `bar-front` 锚点必须保留。

1. **扩展必须补丁 SceneSpec**  
   无 courtyard 时追加 `kind: courtyard` 区域（米制，贴着现有 interior，不要把室内 12×10 改掉）。至少 1 个新物件（例如 `garden-gate` 或 `courtyard-tree`），`route` 为 `scaffold` 或 `generate`（generate 仍只是计划）。重新 `stageAsset` `.scene-spec.json`，更新 `sceneSpec` / `sceneSpecRef` / `assetManifest`。`source` 保持原值。

2. **已提交约束**  
   原 `prompt`、interior bounds、已有 `objectId`（含校准后的 `bar-front.anchor`）不得被新计划换掉。扩展失败则明确错误，不要静默写成一座新酒馆。

3. **不要破坏现有 mock 扩展**  
   `application.test.ts`「approaching the door extends a garden without replacing tavern assets」必须仍过。无 mesh URL 不得把 generate 项变成 `.glb`。校准 / create / generate（无 URL）测试仍过。

4. **无 apiKey NL**  
   现有 `interpretFast` 花园扩展句可继续用。若扩展走 `generation.extend`，确保该路径也会补丁 SceneSpec，不要只观察镜头。

## 测试

新文件例如 `src/application/scene-spec-extend.test.ts`。

至少：

- 无 apiKey：`session.create` 酒馆 → （可选）校准吧台左移 1 米 → `generation.extend` 或门口扩展 → SceneSpec 有 courtyard + 原 interior；`bar-front` 仍在且若已校准则锚点不变 → freeze → close → 同一 `dataDir` 重开计划一致，`source` 仍是 `heuristic-plan`。
- 扩展 **没有** POST `/v1/generate`（注入 generateScene 计数或无 mesh URL）。
- 现有 application 花园扩展、scene-spec-create、scene-spec-calibrate、place-asset 仍过。

## 验证与报告

跑与改动相关的测试、`pnpm typecheck`、`pnpm build`。不要全仓无关重构。

完成后写 `docs/development/AGENT-07_REPORT.md`：文件、行为、命令与结果、限制、**诚实**写出 SceneSpec 增加 courtyard ≠ 世界模型生成了花园、session id。有失败继续修，只有明确外部阻塞才停。
