# AGENT-04 — 交给本机 Grok CLI（2026-09-11 21:25）

在 `/Users/william/world` 开发。先读 `PRD.md`、`docs/NEXT_GENERATION_PLAN.md` 目标校正、`docs/development/COORDINATION.md`、`docs/development/AGENT-03_REPORT.md`。

你是实现者，不是调度器。禁止调用 grok_start / grok_resume / spawn 子 agent 写代码。禁止等待其他进程。直接改文件。

Cursor 统筹；Grok Bot 只做 Windows / `runtimes/unreal`。只改你的文件范围：`src/`、针对性测试、必要依赖、`scripts/probes`、`docs/development/AGENT-04_REPORT.md`。

不要改 `runtimes/unreal/`、`docs/benchmarks/windows-rtx5070ti/`、`docs/development/COORDINATION.md`。不要 git commit。不要重启 `:18790`。不要连 live `:18794`。不要下载 DamagedHelmet。不要宣称 P0/P1。不要把 SceneSpec / mock 酒馆 / HTTP 测试替身称作世界模型产物。

## 现状（已核实）

AGENT-03 已过 Cursor 独立验收（契约切片，不是生成）：

- `CARINA_MESH_PROVIDER_URL` → HTTP native-mesh；失败不退回 primitive 酒馆。
- `runGeneration` 先 stage GLB 再 bake。
- 环境里 **没有** 真实三维后端。`CARINA_MESH_PROVIDER_URL` 未设时生产仍走 mock 酒馆。
- AGENT-03 为过 spatial playable 检查加了 AABB `playable-door` / `playable-prop-*`。那些不是生成网格。

**主链缺口：** 用户自然语言还没有变成可持久、带来源的 SceneSpec。`session.create` 要么 mock 酒馆，要么（有 URL 时）一个 GLB + 脚手架盒子。管家编译场景意图（NG-1 / 酒馆流程 A）还没落地。

## 有界目标

打通：**自然语言描述 → 结构化 SceneSpec（米制空间、区域、物件清单、生成/复用路由、来源）→ 写入世界包 → 关应用重开仍在。**

这是「描述」切片，**不是**三维生成。没有 `CARINA_MESH_PROVIDER_URL` 时，不得把 spec 里的 generate 项冻成 mock 酒馆网格并称为已生成。

1. **SceneSpec schema**（zod，放 `src/schema` 或 `src/scene-compiler`）至少含：
   - `prompt` 原文
   - 米制边界（约酒馆 12×10×H，可按描述调整，但要有数）
   - regions（至少 interior；可选 courtyard）
   - objects[]：`objectId`、`name`、`role`、`route`（`reuse` | `generate` | `scaffold`）、可选尺寸/锚点
   - `source`: 例如 `steward-plan`（LLM）或 `heuristic-plan`（无 apiKey）
   - **禁止** `source: world-model` / `native-mesh` 除非真的走了 AGENT-03 HTTP 网格
2. **编译器** `compileSceneSpec({ prompt, name })`：
   - 有 `config.apiKey` 时走现有 `CARINA_MODEL` / `modelBaseUrl` 一次结构化调用，失败则明确错误或有界 heuristic，不要静默酒馆。
   - 无 apiKey（现有测试默认）走 **确定性 heuristic**（从 prompt/name 抽关键词），`source: heuristic-plan`。测试必须可复现。
   - 至少 1 个 `route: generate` 特色物件（例如招牌/吧台正面），其余可 `reuse`/`scaffold`。报告写清：generate 只是计划，不是已生成 GLB。
3. **`session.create` 持久化**  
   把 SceneSpec 写进世界包（建议 `documents` 或 `assets/<hash>.scene-spec.json` + snapshot 引用）。`app.close()` 后同一 `dataDir` 重开能读回同一 spec（prompt、objectId、route、source）。
4. **不要破坏 AGENT-03 / mock 测试**  
   无 mesh URL 时现有 `application.test.ts` / `place-asset.test.ts` / native-mesh 测试仍过。不要把 mock 酒馆改名为 SceneSpec 成功。
5. **不要** 发明 Meshy SDK，不要改 LingBot `nativeMesh`，不要宣称生成成功。

## 测试

新文件例如 `src/scene-compiler/scene-spec.test.ts` 与 `src/application/scene-spec-create.test.ts`。

至少：

- 无 apiKey：`session.create` 名称/prompt 含「酒馆」「吧台」→ spec 有 interior、≥1 generate、source=`heuristic-plan`；freeze/重开后 spec 仍在。
- 注入编译器（或 fake fetch）返回固定 spec → 磁盘重开 JSON 一致。
- spec 的 generate 项 **没有** 被写成「世界模型已生成」；无 mesh URL 时不要把 generate 物件变成带 `.glb` 的 native-mesh 成功。
- 现有 application / place-asset / native-mesh-create / providers / bake 仍过。

## 验证与报告

跑与改动相关的测试、`pnpm typecheck`、`pnpm build`。不要全仓无关重构。

完成后写 `docs/development/AGENT-04_REPORT.md`：文件、行为、命令与结果、限制、**诚实**写出 SceneSpec ≠ 三维生成、session id。有失败继续修，只有明确外部阻塞才停。
