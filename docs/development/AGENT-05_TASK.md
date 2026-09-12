# AGENT-05 — 交给本机 Grok CLI（2026-09-11 21:44）

在 `/Users/william/world` 开发。先读 `PRD.md`、`docs/NEXT_GENERATION_PLAN.md` 目标校正、`docs/development/COORDINATION.md`、`docs/development/AGENT-03_REPORT.md`、`docs/development/AGENT-04_REPORT.md`。

你是实现者，不是调度器。禁止调用 grok_start / grok_resume / spawn 子 agent 写代码。禁止等待其他进程。直接改文件。

Cursor 统筹；Grok Bot 只做 Windows / `runtimes/unreal`。只改你的文件范围：`src/`、针对性测试、必要依赖、`scripts/probes`、`docs/development/AGENT-05_REPORT.md`。

不要改 `runtimes/unreal/`、`docs/benchmarks/windows-rtx5070ti/`、`docs/development/COORDINATION.md`。不要 git commit。不要重启 `:18790`。不要连 live `:18794`。不要下载 DamagedHelmet。不要宣称 P0/P1。不要把 SceneSpec / mock 酒馆 / HTTP 测试替身称作世界模型产物。不要发明 Meshy/Tripo SDK。

## 现状（已核实）

AGENT-04 已过 Cursor 独立验收（**描述切片，不是生成**）：

- NL → `compileSceneSpec` → `assets/<hash>.scene-spec.json` + snapshot `sceneSpec` / `sceneSpecRef`
- 无 apiKey → `source: heuristic-plan`；schema 拒绝 `world-model` / `native-mesh`
- freeze / 同一 `dataDir` 重开 spec 仍在
- `route: generate` **没有**变成 `.glb`

AGENT-03 HTTP native-mesh 契约已落地。`runGeneration` 仍把 **裸 prompt** 交给 `generateScene`，**不读 SceneSpec**。有 `CARINA_MESH_PROVIDER_URL` 时，POST `{url}/v1/generate` 只有 `prompt` + 旧 `GenerationPlan`，返回的 GLB 用新 ulid 物件，对不上 `bar-front`。无 URL 时仍 mock 酒馆。

环境里 **没有** 真实三维后端。`CARINA_MESH_PROVIDER_URL` 未设。不得假装打过真实模型。

**主链缺口：** 描述计划没有驱动生成请求。用户说「湖边酒馆，旧木吧台」之后，generate 路由的特色物件不会被送到 native-mesh 适配器。

## 有界目标

打通：**已持久的 SceneSpec → 选出 ≥1 个 `route: generate` 物件 → 有 mesh URL 时按该 objectId 走现有 HTTP native-mesh → stage GLB 挂到同一 sceneObjectId → freeze / 重开 / `exportGlb` 保真。**

这是「描述驱动生成请求」切片，**不是**三维生成成功。测试替身仍是 `bar-counter-glb.ts`。

1. **`runGeneration` / `wrapProvider.generateScene` 必须带上 SceneSpec**  
   从 `pack.readSnapshot(worldId).sceneSpec`（或 `sceneSpecFromSnapshot`）读取刚持久化的计划。把它传进 `generateScene`（扩展 input，例如 `sceneSpec?: SceneSpec`）。无 spec 时保持 AGENT-03 行为，不要为此失败 mock 路径。

2. **HTTP POST 必须包含 generate 路由**  
   `POST /v1/generate` JSON 至少含：
   - 原文 `prompt` / `sceneDescription`
   - `sceneSpec`（或等价字段）
   - 本次要生成的物件：`objectId`（优先第一个 `route: generate`，酒馆 heuristic 是 `bar-front`）、`name`、`role`、可选 `dimensions` / `anchor`
   一次请求只生成 **一个** 特色物件即可。其余 `reuse` / `scaffold` 不得假装已生成 GLB。

3. **GLB 挂到 SceneSpec objectId**  
   返回资产的 `GeneratedSceneAsset.objectId` / `GeneratedMeshAsset.objectId` 必须是该 `objectId`（例如 `bar-front`），`attachGeneratedMeshAssets` 已按此匹配。不要再为成功网格新建随机 `native-mesh-<ulid>` 当作特色物件身份。  
   SceneSpec 的 `source` **保持** `heuristic-plan` 或 `steward-plan`。成功拿到测试替身 GLB **不得** 把 spec.source 改成 `native-mesh` 或 `world-model`。网格来源可以留在 candidate / extras（已有 `http-native-mesh-test-double`），不要污染计划来源。

4. **无 URL 路径不变**  
   未设 `CARINA_MESH_PROVIDER_URL` 时仍走 mock 酒馆。generate 项仍不得变成 `.glb` native-mesh 成功。现有 `application.test.ts` / `place-asset.test.ts` / `scene-spec-create.test.ts` / `native-mesh-create.test.ts` 必须仍过。

5. **失败诚实**  
   HTTP 5xx / 坏 GLB：create/generation 失败，不退回 primitive 酒馆，也不把 SceneSpec 标成已生成。LingBot `nativeMesh` 保持 `false`。

## 测试

新文件例如 `src/application/scene-spec-generate.test.ts`（可复用 `src/providers/bar-counter-glb.ts` 与 AGENT-03 的 `node:http` 替身写法）。

至少：

- 有 mesh URL + 酒馆/吧台 prompt：`session.create` → snapshot 仍有 `sceneSpec`（`source: heuristic-plan`，含 `bar-front` generate）→ **替身收到的 POST body 含该 objectId / sceneSpec** → freeze → close → 同一 `dataDir` 重开 → `bar-front`（或同 id 的 SceneObject）带 `.glb` → `exportGlb` 用 `@gltf-transform/core` 解析为吧台替身（≥8 顶点、UV、baseColor），**不是** 24 顶点盒子、**不是** 4 顶点面板。spec.source 仍不是 `world-model` / `native-mesh`。
- 无 mesh URL：沿用 AGENT-04 断言，generate 项没有 `.glb`。
- 替身 500：generation 失败，不得静默 mock 酒馆。
- 现有 native-mesh-create / http-native-mesh / scene-spec-create / application / place-asset 仍过。

## 验证与报告

跑与改动相关的测试、`pnpm typecheck`、`pnpm build`。不要全仓无关重构。

完成后写 `docs/development/AGENT-05_REPORT.md`：文件、行为、命令与结果、限制、**诚实**写出「POST 了测试替身 ≠ 世界模型生成了酒馆」、session id。有失败继续修，只有明确外部阻塞才停。
