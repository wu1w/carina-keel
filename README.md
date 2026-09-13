# Carina / 龙骨

An agent application for controllable generation, calibrated spatial memory, playable worlds, and editable 3D exports.

用自然语言控制生成式世界模型，将生成内容校准、固化为可游玩的世界，并导出建模资源。每个世界是一个独立、可恢复的 Agent session。

- **PRD：** [`PRD.md`](./PRD.md) v1.0（目标规格，不是当前能力）
- **实施顺序：** [`docs/NEXT_GENERATION_PLAN.md`](./docs/NEXT_GENERATION_PLAN.md)（NG-1）
- **按设计验收（当前状态唯一口径）：** [`docs/development/DESIGN_CHECKLIST.md`](./docs/development/DESIGN_CHECKLIST.md)
- **环境（机器 / 隧道 / 端口，历史文档）：** [`HANDOVER.md`](./HANDOVER.md)
- **仓库：** https://github.com/wu1w/carina-keel

Requires Node 22+ and [pnpm](https://pnpm.io).

**诚实状态：** 主路径是自然语言 → WorldCommand（HTTP 聊天、MCP `speak`、`carina chat` / `carina new`）。AIGA 上的 TripoSR 可经 `CARINA_MESH_PROVIDER_URL` 生成特色物件 GLB（吧台正面 / 壁炉 / 庭院景物），**不是**世界模型重建整座酒馆。WorldRuntime 世界 `ng1-i23d` 已把吧台/壁炉/庭院景物 MERGE overlay 进 Pixel Streaming，底下仍是 P1 CC0 房间，花园壳未进 UE。夹具酒馆、CC0、LingBot 短片都不是已生成的世界。A1–A10 不要当通过。图谱命令在 `carina legacy spawn` / `go`；无世界包时 `look` / `remember` 走管家。

---

## English

### Install / checks

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm carina --help
```

### First loop (no Place id, no pack path)

```bash
pnpm carina serve
# browser: http://127.0.0.1:18790/
# or another terminal:
pnpm carina chat
```

Tunnel the AIGA mesh sidecar first (`scripts/bring-up-workflow.sh`), then:

```bash
CARINA_MESH_PROVIDER_URL=http://127.0.0.1:18795 pnpm carina serve
```

Health `workflow.nativeMesh` is `"http"` only when that URL answers. Unset URL does not submit a box tavern. TripoSR I23D featured objects (bar front / fireplace / courtyard) are not a world-model tavern.

Then say: `新建一个黄昏湖边酒馆`. Pause, walk, calibrate (`把桌子往左移一米`, `门高两米`), freeze, export from the UI. Do not copy a Place id.

`pnpm carina new 黄昏湖边酒馆` creates a world session in `dataDir`. `pnpm carina new ./tavern.carina` still creates a legacy pack directory.

```bash
pnpm carina mcp
```

MCP with an application loaded exposes `speak` (same WorldCommand facade). The eight tools register only if the application failed to load. Do not put `CARINA_PACK` in `.cursor/mcp.json` unless you are using the leftover pack tools.

Env (only `src/config.ts` reads these): `CARINA_API_KEY` (or `OPENAI_API_KEY`), `CARINA_MODEL`, `CARINA_MODEL_BASE_URL`, `CARINA_TOKEN`, `CARINA_PORT` (default 18790), `CARINA_PACK` (legacy pack tools), `CARINA_LANG` (`zh` | `en`), `CARINA_RENDERER_URL` (LingBot stills, not a world model), `CARINA_MESH_PROVIDER_URL` (AIGA native-mesh I23D; unset = no generate-route mesh), `CARINA_WORLD_RUNTIME_URL` (upload only unless `CARINA_WORLD_RUNTIME_COOK=1`).

### Legacy pack tools

`carina legacy spawn` / `go` / `say` / `query` / `relate` / `attach` / `export` still write the v0 graph pack and are not the product loop. Without a pack, `look` and `remember` go through the steward. A `.carina.zip` unpacks beside itself into `.carina/`.

---

## 中文

### 安装 / 检查

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm carina --help
```

### 第一圈（不要 Place id，不要世界包路径）

```bash
pnpm carina serve
# 浏览器：http://127.0.0.1:18790/
# 或另一终端：
pnpm carina chat
```

先打 AIGA 网格隧道（`scripts/bring-up-workflow.sh`），再：

```bash
CARINA_MESH_PROVIDER_URL=http://127.0.0.1:18795 pnpm carina serve
```

`/health` 里 `workflow.nativeMesh` 为 `"http"` 才表示网格后端在。未设 URL 不会提交盒子酒馆。TripoSR 是特色物件 I23D，不是世界模型酒馆。

然后说：`新建一个黄昏湖边酒馆`。暂停、走动、校准（`把桌子往左移一米`、`门高两米`）、固化、从界面导出。不要抄 Place id。

`pnpm carina new 黄昏湖边酒馆` 在 dataDir 建世界 session。`pnpm carina new ./tavern.carina` 仍建旧世界包目录。

```bash
pnpm carina mcp
```

有 application 时 MCP 注册 `speak`。八工具只在 application 加载失败时出现。不要把 `CARINA_PACK` 写进产品用的 `.cursor/mcp.json`。

环境变量只在 `src/config.ts` 读取：`CARINA_API_KEY`（或 `OPENAI_API_KEY`）、`CARINA_MODEL`、`CARINA_MODEL_BASE_URL`、`CARINA_TOKEN`、`CARINA_PORT`（默认 18790）、`CARINA_PACK`（旧包工具）、`CARINA_LANG`（`zh` 或 `en`）、`CARINA_RENDERER_URL`（LingBot 静帧，不是世界模型）、`CARINA_MESH_PROVIDER_URL`（AIGA 特色物件 I23D；未设 = 没有 generate 网格）、`CARINA_WORLD_RUNTIME_URL`（默认只上传，不 cook）。

### 旧世界包工具

`carina legacy spawn` / `go` / `say` / `query` / `relate` / `attach` / `export` 仍写 v0 图谱包，不是产品闭环。无世界包时 `look` / `remember` 走管家。
