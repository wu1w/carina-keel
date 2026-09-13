# Carina / 龙骨 — 环境交接（历史文档）

> **本文不是当前状态。** 项目距离设计目标还差多少、哪些验收过了、下一步做什么，**唯一口径**是 [`docs/development/DESIGN_CHECKLIST.md`](./docs/development/DESIGN_CHECKLIST.md)；阶段证据索引在 [`docs/development/P0_PROGRESS.md`](./docs/development/P0_PROGRESS.md)。目标规格见 [PRD v1.0](PRD.md)，实施顺序见 [NG-1](./docs/NEXT_GENERATION_PLAN.md)。
>
> 本文保留的是 2026-09-10 v0.5 联调时的**环境事实**：机器、隧道、端口、权重路径、sidecar 启停、环境变量。下文“八工具 / 本体锁死 / 画面只作插画 / `main` 是 `94352b9`”等描述是旧设计与旧基线，已被取代；`carina spawn` / `go` 等图谱命令现在挂在 `carina legacy` 下。

- 日期：2026-09-10（环境部分 2026-09-12 仍有效，见 §5–§6、§6.10）
- 读者：需要复现 AIGA / Windows 联调环境的人
- 原产品需求：[`PRD v0.5`](./docs/archive/PRD-v0.5.md)（已归档）
- 仓库：https://github.com/wu1w/carina-keel
- 本机工作区：`/Users/william/world`（跟踪 `origin/main`）

---

## 1. 产品是什么

Carina（中文名**龙骨**）是生成式世界模型外面的 **Agent 层**。世界模型只出像素；身份、地点、记忆、MCP、Skill、可带走的包在本仓库。

| 是 | 不是 |
| --- | --- |
| 世界包 = 真相（图谱 + 编年） | 世界模型、训练、微调 |
| 管家（Steward）用八个工具改包 | OpenClaw fork、宿主机 shell / 浏览器 |
| `look` 可选渲染 | 把像素写回成几何 |

定位句：图谱是龙骨，画面是船壳。

三条壳、同一套工具、同一个包：

| 壳 | 入口 | 后端 |
| --- | --- | --- |
| CLI | `pnpm carina look/go/… ./pack.carina` | 直连 tools，可不跑 daemon |
| HTTP | `pnpm carina serve ./pack.carina` → `http://127.0.0.1:18790/` | daemon + SSE |
| MCP | `pnpm carina mcp` | stdio，同一套八工具 |

八工具：`look` `go` `say` `remember` `spawn` `relate` `attach` `export`。

本体锁死：节点 `World` `Place` `Entity` `Object` `Event` `Asset` `Claim`；边 `in` `contains` `knows` `owns` `caused` `depicted_as` `derived_from`。

---

## 2. 代码怎么长

```
schema → pack → world → tools → steward → server
                       ↗                ↘
                 render            cli / mcp
```

| 目录 | 职责 |
| --- | --- |
| `src/schema/` | Zod 契约。无 fs |
| `src/pack/` | `*.carina/` 与 zip |
| `src/world/` | 图、编年、presence、MEMORY |
| `src/render/` | `Renderer`；缺省 mock；`CARINA_RENDERER_URL` 时走 HTTP sidecar |
| `src/tools/` | 八工具唯一实现 |
| `src/steward/` | 上下文预算 + Vercel AI SDK；全仓只有这里 import `ai` |
| `src/server/` | Hono + SSE + 零构建 `chat.html` |
| `src/mcp/` | stdio MCP |
| `src/cli/` | citty；`chat` 只打 HTTP |
| `sidecars/lingbot-still/` | AIGA 上的 Python sidecar（**不进 Carina 核心、不 import LingBot SDK**） |

冻结栈：TypeScript `strict` + `exactOptionalPropertyTypes`，Node 22，ESM NodeNext（相对 import 带 `.js`），pnpm，Zod 4，Hono + SSE，Vercel AI SDK + OpenAI 兼容（`openai.chat()`），citty，fflate，`@modelcontextprotocol/sdk`。环境变量只在 `src/config.ts` 读。

标识符英语；用户可见文案走 `src/i18n/zh.ts` + `en.ts`。注释双语。

---

## 3. 画面怎么出来（本机未提交的联调）

LingBot-World v2 的 1.3B 是 **I2V**（必须有种子图）。种子若是官方湖景示例，后面怎么演都是湖。当前做法：

1. 玩家说话。管家调用 `look`，带上地点名、实体、`style`（画面说明）、`fresh`（是否重做建立镜头），以及这一轮玩家原话 `intent`。
2. Sidecar：没有该地点静帧、或 `fresh=true`、或画面说明变了 → **SDXL-Turbo 文生图**烘焙种子；否则沿用上一张静帧。
3. LingBot I2V 把种子生成 **13 帧 JPEG**（约 8fps），返回短片 + 末帧。
4. 浏览器播这一回合，**停在最后一帧**，做轻微呼吸；不循环整段，也不自动每 12 秒再生成。

`look` **不把画面写进图谱**。`GET /v1/world` 仍可循环 look（给调试），聊天页默认不连它。

---

## 4. 怎么跑（不接 GPU）

```bash
cd /Users/william/world
pnpm install
pnpm typecheck
pnpm test          # 约 101 个测试，MockRenderer，不碰网、不碰 GPU
pnpm build
pnpm carina --help
```

CI：`.github/workflows/ci.yml`，Node 22，ubuntu / windows / macos，`typecheck` + `test` + `build`。

最小可玩（纯文本）：

```bash
pnpm carina new ./tavern.carina
pnpm carina spawn ./tavern.carina --type Place --name 酒馆
pnpm carina go ./tavern.carina --placeId <place-id>
pnpm carina look ./tavern.carina
pnpm carina remember ./tavern.carina --fact "花瓶碎了。"
CARINA_PACK=./tavern.carina CARINA_TOKEN=dev-token pnpm carina serve
# 浏览器：http://127.0.0.1:18790/
```

未设 `CARINA_RENDERER_URL` 时 `look` 只有文字，这是一期验收故事 C，必须还能玩。

---

## 5. 联调环境（有画面）

两台机器：

| 角色 | 机器 | 用途 |
| --- | --- | --- |
| 开发机 | William 的 Mac | Carina daemon、浏览器、SSH 隧道 |
| GPU | 家里 **aiga** `10.10.10.3` 用户 `wuyw` | LingBot 1.3B + SDXL-Turbo + Grok 反代 |

SSH：`~/.ssh/config` 里 `Host aiga`，`ProxyJump ixiaotao-cloud`（VPS `150.158.109.231`，用户 `ubuntu`）。不要用 `pkill -f still_server.py`：远程命令行会匹配到 SSH 自己，把跳板会话杀掉。停 sidecar 只杀 **python 的精确 PID**。

### 5.1 aiga GPU

- 卡：**AMD Instinct MI210**，64 GB，`gfx90a`，ROCm 7.2.4（torch 报 `2.10.0+rocm7.0`）
- **必须** `HIP_VISIBLE_DEVICES=0`（以及 `CUDA_VISIBLE_DEVICES=0`）。`GPU[1]` 是 7800X3D 核显，忽略。
- 盘：`/data/disk1`
- 14B **放不进** 64GB；联调用的是 **1.3B causal-fast**。

### 5.2 Mac 隧道（画面 + 管家都要）

```bash
ssh -N -L 18645:10.10.10.3:8645 aiga          # Grok 反代
ssh -N -L 18791:127.0.0.1:18791 aiga        # LingBot sidecar
```

健康检查：

```bash
curl -sS http://127.0.0.1:18645/v1/models | head
curl -sS http://127.0.0.1:18791/health
# 期望 sidecar：ready true，t2iReady true
```

### 5.3 本机 daemon（演示用）

```bash
cd /Users/william/world
CARINA_PACK=/tmp/carina-demo.carina \
CARINA_TOKEN=dev-token \
CARINA_LANG=zh \
CARINA_API_KEY=local \
CARINA_MODEL=grok-4.6 \
CARINA_MODEL_BASE_URL=http://127.0.0.1:18645/v1 \
CARINA_RENDERER_URL=http://127.0.0.1:18791 \
CARINA_MESH_PROVIDER_URL=http://127.0.0.1:18795 \
CARINA_PORT=18790 \
pnpm exec tsx src/cli/main.ts serve /tmp/carina-demo.carina
```

浏览器：http://127.0.0.1:18790/  
`tsx` 每次 `GET /` 读磁盘上的 `chat.html`；改 TS 后要重启 daemon。

---

## 6. 测试用到的全部资源

### 6.1 代码与文档

| 资源 | 位置 | 说明 |
| --- | --- | --- |
| 产品 PRD | `/Users/william/world/PRD.md` | v0.5 冻结范围 |
| 本仓库 | https://github.com/wu1w/carina-keel | `main`；联调代码可能仅在工作区 |
| 单元测试 | `src/**/*.test.ts`（27 个文件） | `pnpm test`，无 GPU |
| 世界模板 | `src/i18n/templates/{zh,en}/` | `carina new` 复制 |
| 示例 Skill | `skills/tavern-continuity/SKILL.md` | 过夜连续性 |
| Sidecar 源 | `sidecars/lingbot-still/server.py` | 同步到 aiga 的 `still_server.py` |
| 聊天页 | `src/server/public/chat.html` | 零构建 |

### 6.2 演示世界包

| 资源 | 位置 |
| --- | --- |
| 演示包 | `/tmp/carina-demo.carina/` |
| World | `carina-demo`（`01M24M88YZ1AFSY350NFGM8KGT`） |
| Place | **湖边酒馆** `01M24M9P64F4C6FN1H2BM0GBV8` |
| 会话 | `session.json` 的 `placeId` 即上者 |

包内文件：`WORLD.md` `PLAYER.md` `STEWARD.md` `MEMORY.md` `graph.json` `session.json` `events/2026-09-10.jsonl` `skills/tavern-continuity/SKILL.md`。

`/tmp` 重启可能丢掉。要留着就 `pnpm carina export /tmp/carina-demo.carina ./lake-tavern.carina.zip`。

### 6.3 管家（LLM）

| 资源 | 值 |
| --- | --- |
| 模型 | `grok-4.6`（xAI，经家里 Hermes 反代） |
| 反代（aiga） | `10.10.10.3:8645`，systemd `hermes-grok-proxy.service` |
| 反代允许的路径 | `/v1/chat/completions` `/completions` `/embeddings` `/models` `/responses` |
| **没有** | `/v1/images/generations`（所以种子图不走 Grok，走 SDXL-Turbo） |
| Mac 映射 | `127.0.0.1:18645` |
| Carina | `CARINA_MODEL=grok-4.6` `CARINA_MODEL_BASE_URL=http://127.0.0.1:18645/v1` `CARINA_API_KEY=local` |

反代会列出更多 grok 别名；联调实际用的是 **`grok-4.6`**。

### 6.4 世界模型（I2V）

| 资源 | 值 |
| --- | --- |
| 项目 | [LingBot-World v2](https://github.com/Robbyant/lingbot-world-v2) |
| 许可 | CC BY-NC-SA 4.0（非商业） |
| 代码 | aiga `/home/wuyw/builds/lingbot-world-v2` |
| 权重 | `/data/disk1/models/lingbot-world-v2-1.3b-bundle`（1.3B causal-fast + 从 14B 包抽的 T5/VAE） |
| 未使用 | `/data/disk1/models/lingbot-world-v2-14b-causal-fast`（约 74GB，MI210 装不下） |
| 推理 | `WanI2VCausal`，`infer_mode=causal_fast`，`t5_cpu=True` |
| `frame_num` | **13**（必须 `4n+1`，且 `lat_f >= chunk_size`；不要用 5） |
| `chunk_size` | 4 |
| 尺寸 | `LINGBOT_SIZE=480*832` → 实际约 832×464 |
| 动作/相机 | `LINGBOT_ACTION` 默认 `examples/03`（官方湖景轨迹；短回合只是轻微漂移） |
| 预热种子 | `examples/03/image.jpg`（Wanaka 湖，**只用于 prewarm**，不再当酒馆首帧） |
| 输出 | JPEG 帧数组，不是 mp4（aiga 无可用 ffmpeg/imageio/WebP） |

### 6.5 种子图（T2I）

| 资源 | 值 |
| --- | --- |
| 模型 | [stabilityai/sdxl-turbo](https://huggingface.co/stabilityai/sdxl-turbo) |
| 权重 | aiga `/data/disk1/models/sdxl-turbo`（`variant=fp16`） |
| 下载镜像 | `HF_ENDPOINT=https://hf-mirror.com`，`HF_HOME=/data/disk1/models/.hf-home` |
| 步数 | 4，`guidance_scale=0.0` |
| 分辨率 | 832×480 |
| 许可 | CreativeML Open RAIL++（本地种子，不进 git） |

venv 里的 **torchvision 已卸掉**（与 `~/.local` 的 torch 2.10+rocm 冲突，`torchvision::nms` 会炸）。不要再装回旧版 torchvision，除非版本对齐。Sidecar 用的是用户站点里的 ROCm torch + venv 的 `diffusers`/`wan`。

### 6.6 Sidecar 进程

| 资源 | 值 |
| --- | --- |
| 脚本 | `/home/wuyw/builds/lingbot-world-v2/still_server.py`（从仓库 `sidecars/lingbot-still/server.py` scp 过去） |
| 监听 | `127.0.0.1:18791` |
| 接口 | `POST /v1/still`，`GET /health`，`GET /stills/{placeId}.jpg` |
| 静帧目录 | `/data/disk1/models/lingbot-stills/` |
| 日志 | `/data/disk1/models/lingbot-still-server.log` |
| Python | `/home/wuyw/builds/lingbot-world-v2/.venv/bin/python` |

启动示例（在 **aiga** 上）：

```bash
cd /home/wuyw/builds/lingbot-world-v2
nohup env \
  HIP_VISIBLE_DEVICES=0 \
  CUDA_VISIBLE_DEVICES=0 \
  LINGBOT_REPO=/home/wuyw/builds/lingbot-world-v2 \
  LINGBOT_CKPT=/data/disk1/models/lingbot-world-v2-1.3b-bundle \
  LINGBOT_STILL_DIR=/data/disk1/models/lingbot-stills \
  LINGBOT_STILL_HOST=127.0.0.1 \
  LINGBOT_STILL_PORT=18791 \
  LINGBOT_T2I=/data/disk1/models/sdxl-turbo \
  .venv/bin/python -u still_server.py \
  >> /data/disk1/models/lingbot-still-server.log 2>&1 < /dev/null &
echo $!
```

停：查 python cmdline 含 `still_server.py` 的 PID，只 `kill` 那个 PID。

`POST /v1/still` 体：`placeId`，可选 `placeName` `entities` `style` `intent` `camera` `fresh`。成功：`ok`、末帧 `base64`、`clip.frames[]`、`okSeed`（是否刚烘焙种子）。

超时：Carina `HttpStillRenderer` 等 **300s**。首轮 T2I 冷加载 + I2V 大约 1–2 分钟。

### 6.7 HTTP 契约（daemon）

只绑 loopback。非 loopback Host → 403。`/v1/*` 要 token（`Authorization: Bearer` 或查询参数，见 `src/server/auth.ts`）。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/health` | `{ ok, name: "carina" }`，无需 token |
| GET | `/` | 聊天页 |
| POST | `/v1/chat` | SSE：`status` / `clip` / `still` / `text` / `done` / `error` |
| GET | `/v1/view` | 进程内最后一张 JPEG |
| GET | `/v1/world` | 循环 look（页面默认不用） |

### 6.8 本机曾用过、不要当规范的路径

| 资源 | 位置 | 说明 |
| --- | --- | --- |
| 末帧抽查 | `/tmp/carina-tavern-last.jpg` | 2026-09-10 按「湖边酒馆」T2I+I2V 的末帧 |
| 旧静帧 | aiga `lingbot-stills/01M24KRKJ9YCKK2575PDGJ2B7A.jpg` | 更早一次 look，湖景 |
| 官方湖景 | LingBot `examples/03/image.jpg` | 联调前期误当种子，已不用作出场首帧 |

### 6.9 试过、没有接进产品的资源

| 资源 | 结论 |
| --- | --- |
| NVIDIA NIM / `nvapi-…` | **不要写进仓库、不要提交。** 未作为渲染后端 |
| LingBot 14B / SGLang realtime | 显存不够；官方 60fps 路径未部署 |
| Grok 出图 | 家里反代不转发 images |
| Marble / HunyuanWorld SDK | 禁止进核心；只允许 HTTP `Renderer` |

aiga `/data/disk1/models/` 里还有 Qwen、MiniMax、plastic-lm 等 LLM 权重，**不是**本项目 look 后端。

### 6.10 环境变量速查

Carina（只在 `src/config.ts`）：

| 变量 | 联调值 | 缺省 |
| --- | --- | --- |
| `CARINA_PACK` | `/tmp/carina-demo.carina` | 无 |
| `CARINA_TOKEN` | `dev-token` | `dev-token` |
| `CARINA_LANG` | `zh` | `zh` |
| `CARINA_API_KEY` | `local` | 也认 `OPENAI_API_KEY` |
| `CARINA_MODEL` | `grok-4.6` | `gpt-4o-mini` |
| `CARINA_MODEL_BASE_URL` | `http://127.0.0.1:18645/v1` | OpenAI |
| `CARINA_RENDERER_URL` | `http://127.0.0.1:18791` | 无 → mock |
| `CARINA_MESH_PROVIDER_URL` | `http://127.0.0.1:18795`（AIGA TripoSR，经隧道） | 无 → 不提交盒子酒馆 |
| `CARINA_SPACE_PROVIDER_URL` | `http://127.0.0.1:18796`（Windows WorldGen，经 `ssh -L`） | 无 → 不声称世界模型 |
| `CARINA_WORLD_RUNTIME_URL` | `http://127.0.0.1:18794` | 无 → 不发布到 UE |
| `CARINA_WORLD_RUNTIME_WORLD_ID` | `ng1-i23d` | 未设则用 Carina worldId |
| `CARINA_WORLD_RUNTIME_COOK` | 未设（配了 WR 即默认 cook） | `0` = 只上传 |
| `CARINA_PORT` | `18790` | `18790` |

Sidecar：

| 变量 | 联调值 |
| --- | --- |
| `LINGBOT_REPO` | `/home/wuyw/builds/lingbot-world-v2` |
| `LINGBOT_CKPT` | `/data/disk1/models/lingbot-world-v2-1.3b-bundle` |
| `LINGBOT_T2I` | `/data/disk1/models/sdxl-turbo` |
| `LINGBOT_STILL_DIR` | `/data/disk1/models/lingbot-stills` |
| `LINGBOT_STILL_HOST` / `PORT` | `127.0.0.1` / `18791` |
| `LINGBOT_FRAME_NUM` | `13` |
| `LINGBOT_SEED` | 仅 prewarm，默认 `examples/03/image.jpg` |
| `LINGBOT_ACTION` | 默认 `examples/03` |
| `HIP_VISIBLE_DEVICES` | `0` |

---

## 7. 单元测试在测什么（无 GPU）

`pnpm test` 覆盖故事与契约，不启动 sidecar：

| 故事 / 主题 | 代表文件 |
| --- | --- |
| A 过夜：人还在、名字还在、花瓶仍碎 | `src/world/overnight.test.ts` |
| B zip 换目录打开 | `src/pack/zip.test.ts` |
| C 无渲染后端则纯文本 look | `src/render/story-c.test.ts` |
| D MCP 写下的事实换目录仍在 | `src/mcp/mcp-path.test.ts` |
| HTTP SSE 静帧/短片缓存 | `src/server/create-http-app.test.ts` |
| look 把 `placeName` / `intent` / `fresh` 交给渲染器 | `src/tools/execute.test.ts` |
| sidecar JSON 契约 | `src/render/http-still-renderer.test.ts` |

改渲染契约时至少跑：`pnpm typecheck && pnpm test`。

---

## 8. 浏览器里怎么验收

1. 隧道 + sidecar `ready` + daemon 已监听。
2. 打开 http://127.0.0.1:18790/
3. 说「看一眼湖边酒馆」。应出现 `status: look`，然后短片播一遍，停在木厅+窗外湖，轻微呼吸。
4. 再说闲话、不换景：不应整段重做种子。
5. 明确换镜头（「看向吧台」）时管家应 `look` 且 `fresh=true` 或换 `style`，才会新烘焙种子。

页面：Enter 发送，Shift+Enter 换行。`prefers-reduced-motion` 则只定格、不呼吸。

---

## 9. 已知限制

- 1.3B 不是 14B，也不是官方 SGLang 实时 60fps。一回合约 13 帧、生成十几秒到两分钟。
- I2V 仍吃 `examples/03` 的相机轨迹；建立镜头靠 T2I，不靠那张湖的 JPEG。
- SDXL-Turbo 英文更稳。地点中文名会在 sidecar 里扩成英文场景；管家应把 `style` 写成具体画面。
- 刷新页面会 `GET /v1/view` 末帧；caption 可能仍是「现场」，`placeName` 只在 SSE 的 clip/still 里。
- LingBot 权重非商用许可。Carina 核心 MIT。
- bitsandbytes 在 aiga 上会打 ROCm 警告，可忽略。

---

## 10. 不要做的事

- 不要把 Marble / LingBot / Hunyuan SDK 写进 `src/`。
- 不要把像素当成图谱几何。
- 不要 `pkill -f still_server.py`。
- 不要重启家里的 llama / `flash-next-mtp` 除非主人明确说可以。
- 不要提交 API key、`.env`、权重、静帧 JPEG。
- 不要默认 `git commit` / `git push`，除非主人要求。

---

## 11. 下一步

不在本文维护。见 [`docs/development/DESIGN_CHECKLIST.md`](./docs/development/DESIGN_CHECKLIST.md) 的「杀伤力待办」。
