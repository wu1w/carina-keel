# AGENT-06 — 交给本机 Grok CLI（2026-09-11 22:03）

在 `/Users/william/world` 开发。先读 `PRD.md`、`docs/NEXT_GENERATION_PLAN.md` 目标校正、`docs/development/COORDINATION.md`、`docs/development/AGENT-04_REPORT.md`、`docs/development/AGENT-05_REPORT.md`。

你是实现者，不是调度器。禁止调用 grok_start / grok_resume / spawn 子 agent 写代码。禁止等待其他进程。直接改文件。

Cursor 统筹；Grok Bot 只做 Windows / `runtimes/unreal`。只改你的文件范围：`src/`、针对性测试、必要依赖、`scripts/probes`、`docs/development/AGENT-06_REPORT.md`。

不要改 `runtimes/unreal/`、`docs/benchmarks/windows-rtx5070ti/`、`docs/development/COORDINATION.md`。不要 git commit。不要重启 `:18790`。不要连 live `:18794`。不要下载 DamagedHelmet。不要宣称 P0/P1。不要把 SceneSpec / mock 酒馆 / HTTP 测试替身称作世界模型产物。不要发明 Meshy/Tripo SDK。不要设假的 `CARINA_MESH_PROVIDER_URL`。

## 现状（已核实）

AGENT-04/05 已过 Cursor 独立验收：

- NL → 持久 SceneSpec（`heuristic-plan` / `steward-plan`）
- 有 mesh URL 时，第一个 `route: generate`（酒馆 `bar-front`）驱动 HTTP POST，GLB 挂到同一 objectId
- 无 URL 仍 mock 酒馆。真实三维后端 **BLOCKED**

`spatial.calibrate` 已经能改 `snapshot.objects[].transform` / 高度，**但不改 SceneSpec**。关应用重开后计划锚点仍是创建时的数。NG-1 要求：自然语言修改一个对象或局部区域，保存/重开保持一致。当前只动了运行时物体，计划层掉了。

无 apiKey 时 `interpretFast` 也还不能把「把吧台往左移一米」编成校准命令。

## 有界目标

打通：**自然语言（无 apiKey 也要可测）→ 校准一个已有 SceneSpec 物件 → 计划锚点与（若存在）对应 SceneObject 一起提交 → freeze / 同一 `dataDir` 重开仍在。**

这是「描述/校准」切片，**不是**三维生成。不要为了校准去 POST 网格适配器。不要把 `source` 改成 `world-model` / `native-mesh`。

1. **`spatial.calibrate` 必须补丁 SceneSpec**  
   当 snapshot 有 `sceneSpec`，用 `objectId`（或名称回退）找到计划物件，应用同一位移/高度到 `anchor` / `dimensions`。然后重新 `stageAsset` `.scene-spec.json`，更新 `sceneSpec` + `sceneSpecRef` + `assetManifest`。找不到计划物件时：不要假装成功改了计划；运行时物体仍可按现有逻辑校准。`source` 保持原值。

2. **无 apiKey 的确定性 NL**  
   `interpretFast`（或同等不调 LLM 的路径）识别酒馆校准句，例如「把吧台往左移一米」「吧台左移 1 米」。编成 `spatial.calibrate`，`objectId` 指向 SceneSpec 里的吧台（优先 `bar-front`，否则 `bar`），`delta` 为米制（左 = −X，1 米）。现有 pause/run/freeze/create 识别不得回归。

3. **不要碰生成路径**  
   无 mesh URL 时现有 `scene-spec-create` / `scene-spec-generate`（无 URL 分支）/ `application` / `place-asset` / `native-mesh-create` 仍过。校准不得把 generate 项变成 `.glb`，也不得触发 HTTP generate。

4. **有对应 SceneObject 时一起动**  
   若 snapshot 已有 `sceneObjectId === bar-front`（AGENT-05 HTTP 路径），transform 与 spec.anchor 都要变。无 mesh URL 的 mock 酒馆可能没有 `bar-front` 物体：仍必须改 SceneSpec 锚点并重开可读。

## 测试

新文件例如 `src/application/scene-spec-calibrate.test.ts`，必要时补 `interpret-fast.test.ts`。

至少：

- 无 apiKey：`session.create` 酒馆/吧台 prompt → 文本「把吧台往左移一米」→ `spatial.calibrate` 被接受 → SceneSpec 里 `bar-front`（或 `bar`）的 `anchor.x` 减少约 1 米 → freeze → close → 同一 `dataDir` 重开，计划锚点仍是校准后的值，`source` 仍是 `heuristic-plan`。
- 注入/直接 `spatial.calibrate` `{ objectId: "bar-front", delta: { x: -1, y: 0, z: 0 } }` 同样 round-trip。
- 校准 **没有** POST `/v1/generate`（可用注入 compiler + 无 mesh URL 断言）。
- 现有 interpret-fast / scene-spec-create / application / place-asset 仍过。

## 验证与报告

跑与改动相关的测试、`pnpm typecheck`、`pnpm build`。不要全仓无关重构。

完成后写 `docs/development/AGENT-06_REPORT.md`：文件、行为、命令与结果、限制、**诚实**写出 SceneSpec 锚点校准 ≠ 世界模型改了网格、session id。有失败继续修，只有明确外部阻塞才停。
