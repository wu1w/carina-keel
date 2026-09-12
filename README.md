# Carina / 龙骨

An agent application for controllable generation, calibrated spatial memory, playable worlds, and editable 3D exports.

用自然语言控制生成式世界模型，将生成内容校准、固化为可游玩的世界，并导出建模资源。每个世界是一个独立、可恢复的 Agent session。

- **下一版 PRD：** [`PRD.md`](./PRD.md) v1.0（目标规格，尚未实现）
- **模块架构：** [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- **实施路线：** [`NEXT_ITERATION_PLAN.md`](./NEXT_ITERATION_PLAN.md)
- **仓库：** https://github.com/wu1w/carina-keel
- **交接 / 联调资源：** [`HANDOVER.md`](./HANDOVER.md)（GPU、隧道、演示包、sidecar、测试资产全在那里）

Requires Node 22+ and [pnpm](https://pnpm.io).

**当前实现 / Current implementation:** 下方用法仍对应现有 v0.1 原型：世界包、八工具、管家、CLI/HTTP/MCP，以及本地联调的短片渲染。v1.0 的多世界 session、3D 校准固化、可玩运行时和建模导出尚未落地。The instructions below describe the existing prototype; the new session, spatial-memory, playable-runtime and mesh-export capabilities are specified, not implemented.

---

## 当前原型做什么

生成式世界（Marble、Genie、LingBot 一类）会造可看的地方，但不负责记忆、上下文预算、MCP、Skill、以及能换机器打开的包。Carina 做的是这一层。

| 能力 | 一期落地 |
| --- | --- |
| 记忆 | 图谱 + 编年 + `MEMORY.md` + 人在哪。杀进程还在 |
| 上下文 | 每轮只塞宪法、Skill、MEMORY、N 跳、今昨事件 |
| MCP | 八个世界工具的 stdio MCP |
| Skill | 包内 `SKILL.md`，只注入、不执行脚本 |
| 导出 | `*.carina.zip` 换目录打开 |

**不是**世界模型，不训练。**不是** OpenClaw 的 fork：不给管家宿主机 shell。画面可选；关掉渲染后端，纯文本仍能玩完整期。

三条壳共用八个工具（`look` `go` `say` `remember` `spawn` `relate` `attach` `export`）：CLI、loopback HTTP（默认端口 **18790**）、MCP。

---

## English

### Install / checks

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm carina --help
```

### First loop (no world-model GPU)

```bash
pnpm carina new ./tavern.carina
pnpm carina spawn ./tavern.carina --type Place --name Tavern
# Copy the Place id from the output, then:
pnpm carina go ./tavern.carina --placeId <place-id>
pnpm carina look ./tavern.carina
pnpm carina remember ./tavern.carina --fact "The vase is broken."
pnpm carina query ./tavern.carina
CARINA_PACK=./tavern.carina CARINA_TOKEN=dev-token pnpm carina serve
# another terminal:
CARINA_PACK=./tavern.carina CARINA_TOKEN=dev-token pnpm carina chat
pnpm carina export ./tavern.carina ./tavern.carina.zip
```

Unset `CARINA_RENDERER_URL` → `look` is plain text (`MockRenderer`). That is intentional (story C).

With a still/clip sidecar on `CARINA_RENDERER_URL`, `look` returns a short JPEG clip. The chat page plays it once, holds the last frame, and idles. How to wire LingBot + seed T2I on the home GPU is in [`HANDOVER.md`](./HANDOVER.md).

A `.carina.zip` unpacks beside itself into `.carina/` and then opens like a directory. If a sibling live `*.carina/` already exists, that directory is opened and the zip is not extracted again. Chat talks to `POST /v1/chat` on `127.0.0.1` only.

```bash
CARINA_PACK=./tavern.carina pnpm carina mcp
```

Env (only `src/config.ts` reads these): `CARINA_API_KEY` (or `OPENAI_API_KEY`), `CARINA_MODEL`, `CARINA_MODEL_BASE_URL`, `CARINA_TOKEN`, `CARINA_PORT` (default 18790), `CARINA_PACK`, `CARINA_LANG` (`zh` | `en`), `CARINA_RENDERER_URL`.

### Cursor MCP

Same eight tools as `carina chat`. Add to `.cursor/mcp.json` (absolute paths):

```json
{
  "mcpServers": {
    "carina": {
      "command": "pnpm",
      "args": ["--dir", "/ABS/carina-keel", "carina", "mcp"],
      "env": {
        "CARINA_PACK": "/ABS/tavern.carina",
        "CARINA_LANG": "zh"
      }
    }
  }
}
```

After `pnpm build`, `command` may be `node` with `args` `["/ABS/carina-keel/dist/cli/main.js", "mcp"]`.

---

## 中文

### 安装 / 检查

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm carina --help
```

### 第一圈（不接世界模型 GPU）

```bash
pnpm carina new ./tavern.carina
pnpm carina spawn ./tavern.carina --type Place --name 酒馆
# 从输出抄下 Place id，然后：
pnpm carina go ./tavern.carina --placeId <place-id>
pnpm carina look ./tavern.carina
pnpm carina remember ./tavern.carina --fact "花瓶碎了。"
pnpm carina query ./tavern.carina
CARINA_PACK=./tavern.carina CARINA_TOKEN=dev-token pnpm carina serve
# 另一终端：
CARINA_PACK=./tavern.carina CARINA_TOKEN=dev-token pnpm carina chat
pnpm carina export ./tavern.carina ./tavern.carina.zip
```

不设 `CARINA_RENDERER_URL` 时 `look` 是纯文本。这是验收故事 C，不是漏做。

接上 sidecar 之后，`look` 出短片：聊天页播一轮、停在最后一帧、轻微呼吸。家里 GPU、隧道、演示包「湖边酒馆」、LingBot / SDXL-Turbo 路径见 [`HANDOVER.md`](./HANDOVER.md)。

`*.carina.zip` 解到旁边的 `*.carina/` 再打开。若旁边已有活目录，则打开该目录、不再解压。聊天只打本机 `POST /v1/chat`。

```bash
CARINA_PACK=./tavern.carina pnpm carina mcp
```

环境变量只在 `src/config.ts` 读取：`CARINA_API_KEY`（或 `OPENAI_API_KEY`）、`CARINA_MODEL`、`CARINA_MODEL_BASE_URL`、`CARINA_TOKEN`、`CARINA_PORT`（默认 18790）、`CARINA_PACK`、`CARINA_LANG`（`zh` 或 `en`）、`CARINA_RENDERER_URL`。

### Cursor MCP

与 `carina chat` 同一套八工具。写入项目 `.cursor/mcp.json`（绝对路径）：

```json
{
  "mcpServers": {
    "carina": {
      "command": "pnpm",
      "args": ["--dir", "/ABS/carina-keel", "carina", "mcp"],
      "env": {
        "CARINA_PACK": "/ABS/tavern.carina",
        "CARINA_LANG": "zh"
      }
    }
  }
}
```

`pnpm build` 之后也可用 `node` + `["/ABS/carina-keel/dist/cli/main.js", "mcp"]`。
