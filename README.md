# Carina / 龙骨

Agent layer for generative world models. The pack is the world; pixels are illustration.

生成式世界模型的类 Agent 层。世界包是真相；画面只是插画。

Requires Node 22+.

## English

### Install / run

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm carina --help
```

### First loop (no paid world API)

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
# another machine or directory:
pnpm carina query ./tavern.carina.zip
CARINA_PACK=./tavern.carina.zip CARINA_TOKEN=dev-token pnpm carina serve
```

`look` is plain text in phase 1 (`MockRenderer`). A `.carina.zip` unpacks beside itself into `.carina/` and then opens like a directory. Chat talks to `POST /v1/chat` on `127.0.0.1` only. If TTY is unavailable, open the printed URL. MCP:

```bash
CARINA_PACK=./tavern.carina pnpm carina mcp
```

Env: `CARINA_API_KEY`, `CARINA_MODEL`, `CARINA_MODEL_BASE_URL`, `CARINA_TOKEN`, `CARINA_PORT` (default 18790), `CARINA_PACK`, `CARINA_LANG` (`zh` | `en`).

## 中文

### 安装 / 运行

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm carina --help
```

### 第一圈（不接付费世界 API）

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
# 换目录或换机器：
pnpm carina query ./tavern.carina.zip
CARINA_PACK=./tavern.carina.zip CARINA_TOKEN=dev-token pnpm carina serve
```

一期 `look` 只返回纯文本（`MockRenderer`）。`*.carina.zip` 会解到旁边的 `*.carina/` 再打开。聊天只打本机 `POST /v1/chat`。TTY 不可用时打开打印出的 URL。MCP：

```bash
CARINA_PACK=./tavern.carina pnpm carina mcp
```

环境变量：`CARINA_API_KEY`、`CARINA_MODEL`、`CARINA_MODEL_BASE_URL`、`CARINA_TOKEN`、`CARINA_PORT`（默认 18790）、`CARINA_PACK`、`CARINA_LANG`（`zh` 或 `en`）。
