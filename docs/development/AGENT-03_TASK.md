# AGENT-03 — 交给本机 Grok CLI（2026-09-11 21:00）

在 `/Users/william/world` 开发。先读 `PRD.md`、`docs/NEXT_GENERATION_PLAN.md` 目标校正、`docs/development/COORDINATION.md`、`docs/development/AGENT-01_REPORT.md`、`docs/development/AGENT-02_REPORT.md`。

你是实现者，不是调度器。禁止调用 grok_start / grok_resume / spawn 子 agent 写代码。禁止等待其他进程。直接改文件。

Cursor 统筹；Grok Bot 只做 Windows / `runtimes/unreal`。只改你的文件范围：`src/`、针对性测试、必要依赖、`scripts/probes`、`docs/development/AGENT-03_REPORT.md`。

不要改 `runtimes/unreal/`、`docs/benchmarks/windows-rtx5070ti/`、`docs/development/COORDINATION.md`。不要 git commit。不要重启 `:18790`。不要连 live `:18794`。不要下载 DamagedHelmet。不要宣称 P0/P1。不要把 fixture / HTTP 测试替身称作世界模型产物。

## 现状（已核实）

AGENT-01 导出保真、AGENT-02 `stagePackAsset` / `spatial.placeAsset` 已过 Cursor 独立验收。

**主链缺口：生产生成路径仍不是原生网格。**

- `src/application/load-deps.ts` `wrapProvider()` **写死** `createMockProvider()`。`session.create` 在无 `observe` 时走 `runGeneration` → mock primitive 酒馆 → `bakeMapAssets` → `mesh.json`。
- `src/providers/lingbot-legacy.ts`：`nativeMesh: false`，`submitGeneration` 抛 `UNSUPPORTED`。
- Application 的 `GenerationProvider.generateScene` 只返回 `{ regions, objects }`，没有把 GLB 字节送进 pack 的通道。因此即便 schema 层 `submitGeneration` 能返回 candidate，生产 `runGeneration` 也无法 stage 真实 GLB。
- `bakeMapAssets` 对已有 `.glb`/`.gltf` `assetRefs` 会保留；但 mock 对象从来没有这些引用。
- 仓库里没有 Meshy/Tripo 等密钥。本轮 **不要** 发明一个假的云厂商 SDK，也不要用 LLM 挑资产库拼场景冒充 `nativeMesh`。

## 有界目标

打通：**native-mesh provider → 自包含 GLB 进入 pack → `session.create` / `runGeneration` 提交带 `.glb` 引用的候选 → freeze 保引用 → 关应用重开 → `exportGlb` 保真。**

测试替身可以证明契约。报告必须写：替身 ≠ 世界模型。若环境里没有可调用的真实三维后端，记为 BLOCKED，适配器仍然要落地。

1. **HTTP native-mesh adapter**（schema `GenerationProvider`：`getCapabilities` / `submitGeneration` / `cancelJob`）  
   文件建议：`src/providers/http-native-mesh.ts`。  
   - URL：`CARINA_MESH_PROVIDER_URL`（空字符串 = 未设置）。可选 `CARINA_MESH_PROVIDER_KEY_FILE`（读文件作 Bearer，**不要**把密钥写进仓库或报告）。  
   - `nativeMesh: true` 仅当该适配器确实按合同取回可解析 GLB；失败不得改口称 mock 酒馆。  
   - 合同（可微调，但要测）：`POST {url}/v1/generate` JSON（prompt / plan），响应含 job 与 GLB（inline base64 或随后 GET 字节）。5xx、非 GLB、空网格 → 明确错误，**禁止**退回 `buildPrimitiveTavern`。  
   - LingBot 保持 videoOnly，不要把它标成 nativeMesh。

2. **配置只在 `src/config.ts` 读环境**  
   `meshProviderUrl?`、`meshProviderKeyFile?`。`src/config.test.ts` 覆盖空字符串视为未设置。不要打印密钥。

3. **统一生产包装**  
   `wrapProvider()`：  
   - 有 `meshProviderUrl` → HTTP adapter。  
   - 否则 → 现有 mock（保证现有 application 测试仍过）。  
   `generateScene` 必须能把 provider 的 GLB 字节带出来（扩展返回值，例如 `assets?: Array<{ bytes: Uint8Array; ext: "glb" | "gltf" }>`，objects 的 `assetRefs` 在 stage 之后才能填 hash——见下条）。不要再只把 mock 的 `.mesh` 路径假装成已提交资产。

4. **`runGeneration` 必须先 stage GLB 再 bake**  
   在 `src/application/create-application.ts`：  
   - 若 `generateScene` 带回 GLB 字节：先 `pack.stageAsset`，把返回的 `assets/<hash>.glb` 写进对应 `SceneObject.assetRefs` 与 `assetManifest`。  
   - 然后才 `bakeMapAssets`。已有 GLB 引用必须按 AGENT-01 规则保留，不得改成 `mesh.json`。  
   - 无 GLB 的 primitive mock 路径保持现状（现有测试）。  
   - 坏 GLB / stage 失败 → `VALIDATION_FAILED` 或已有错误码，不静默酒馆。

5. **能力诚实**  
   mock 继续声明 `nativeMesh: true`（它返回的是程序网格，测试用）。HTTP adapter 在拿不到网格时不要把 mock 能力抄上去。生产未配置 URL 时，不要在 UI/日志里把 mock 酒馆写成「世界模型已生成」。若有现成 source/provenance 字段就填 `mock-native-mesh` vs `http-native-mesh`；没有就不要大重构 metadata。

## 测试（必须程序解析 GLB）

新测试文件（例如 `src/providers/http-native-mesh.test.ts` 与 `src/application/native-mesh-create.test.ts`）。

本地 HTTP **测试替身**（`node:http`）返回自包含 GLB：  
- **不是** `textured-panel-glb.ts` 那块 4 顶点面板。  
- **不是** primitive 酒馆 AABB / 24 顶点盒子。  
- 程序生成一枚带 UV + baseColor 纹理的小网格（例如 ≥8 顶点的吧台板或斜切盒），在响应/candidate 里标记 source=`http-native-mesh-test-double`。这是契约测试，不是生成成功。

至少：

- 替身 200 + 合法 GLB：注入该 provider 的 `createApplication`（无 `observe`）→ `session.create` → freeze → `close` → 新 `createApplication(testConfig(dataDir))` → `exportGlb` 用 `@gltf-transform/core` 解析：顶点/UV/纹理与替身网格一致，不是 24 顶点盒子。  
- 替身 500 或损坏 GLB：create/generation **失败**，snapshot 不得出现静默 mock 酒馆网格冒充成功。  
- `loadConfig` 未设 URL 时 `wrapProvider` 仍走 mock；现有 `src/application/application.test.ts`、`place-asset.test.ts`、`providers.test.ts`、exporter/bake 仍过。  
- HTTP adapter `getCapabilities().nativeMesh === true`；LingBot 仍 `false`。

不要全仓无关重构。不要为了绿测试把 LingBot 改成 nativeMesh。

## 若发现真实后端

启动时扫描环境（只认已有变量，不写死第三方 SDK）：若 `CARINA_MESH_PROVIDER_URL` 已指向本机可连服务，可 **一次** 真实 POST 并把 HTTP 状态/是否返回 GLB magic 写进报告（不要把密钥或大 base64 贴进报告）。失败记 BLOCKED，适配器代码仍要交。没有 URL 就不要假装打过真实模型。

## 验证与报告

跑与改动相关的测试、`pnpm typecheck`、`pnpm build`。

完成后写 `docs/development/AGENT-03_REPORT.md`：本轮文件、行为变化、验证命令与结果、限制、**诚实**写出「测试替身 ≠ 世界模型」、缺什么才能做最小真实模型验收、session id。有失败继续修，只有明确外部阻塞才停。
