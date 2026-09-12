# Carina（龙骨）产品需求文档

- 版本：0.5
- 日期：2026-09-09
- 阶段：第一期（个人开发者可交付）
- 状态：已根据架构讨论冻结；改范围先改本文

---

## 0. 命名

**决定：英文名 Carina，中文名龙骨，CLI 与仓库名 `carina`。**

一句话：**专为生成式世界模型做的类 Agent 层：让世界有记忆、上下文、MCP、Skill，生成资源可导出、可迁移。**

龙骨不改写 Marble / Genie。世界模型仍然只负责画面；记忆和可带走的状态在包里。

| 用法 | 写法 |
| --- | --- |
| 产品名 | Carina |
| 中文名 | 龙骨 |
| CLI | `carina` |
| 守护进程 | `carina serve` |
| 世界包目录 | `*.carina/`（目录即包） |
| 导出件 | `*.carina.zip` |
| 管家角色 | Steward（对用户可叫「管家」，不要叫龙虾以免品牌寄生） |
| 定位句 | 住在世界包里的管家。图谱是龙骨，画面是船壳。 |

### 为什么叫这个

- **Carina** 是船的龙骨，也是龙骨座。世界模型造的是船壳（像素 / splat / 视频）；本项目造的是龙骨：身份、地点、因果、可带走的资产。
- **龙骨** 两个字能记，和「龙虾」同有「龙」而不抄 OpenClaw。
- 可检索，不像 Hearth / Keep / Atlas 那样被游戏和笔记产品淹没。
- CLI 短：`carina go tavern`、`carina export`。

### 备选（否决前可换）

| 名字 | 含义 | 不采用的原因 |
| --- | --- | --- |
| Hearth / 火塘 | 第二天还回到炉边 | 检索差，Hearthstone 过重 |
| Chela / 螯 | 螯足，螯合=把资产绑到节点 | 发音门槛高，仍像开源龙虾皮肤 |
| Worldclaw | 直球 | 永远活在 OpenClaw 影子里 |

不要用的名字：龙虾、Claw、Molt、OpenWorld、WorldGPT、任何 `*forge` / `*atlas`。

---

## 1. 问题

生成式世界（Marble、Genie 一类）会造可看的地方，但不负责五件事：

1. **记忆**：酒馆老板记得你，花瓶还碎着。Marble 的持久是几何；Genie 一类跨会话几乎不记得。
2. **上下文**：不能把整座世界塞进窗口。要按地点、人物、事件做预算。
3. **MCP**：Cursor / Claude / 别的 Agent 无法按同一套工具操作这座世界。
4. **Skill**：没有可检查、可迁移的玩法说明书，每次都靠口头教管家。
5. **资产可带走**：生成物不能当有名字、有出处、换机器仍能打开的内容用。

个人开发者不做世界模型。做的是包在模型外面的 Agent 层。

---

## 2. 产品是什么

Carina 是 **生成式世界的类 Agent 层**，本地优先。

工作区是一个世界包，不是家目录。同一套八个工具，三条壳都能用：`carina chat`、loopback HTTP、MCP。关掉进程再打开，人还在原地。包可以 zip 走。

它克隆 OpenClaw 的契约（记忆文件、Skill、MCP、工具写盘），不 fork 代码，也不把宿主机当电脑：

| OpenClaw | Carina |
| --- | --- |
| 本机 Gateway | loopback daemon |
| 工作区 | `*.carina/` 世界包 |
| SOUL / USER / MEMORY | `WORLD.md` / `PLAYER.md` / `MEMORY.md` |
| Skills | 包内 `skills/*/SKILL.md`，只注入上下文，不执行脚本 |
| MCP | 同一套八工具的 stdio MCP |
| 会写盘的工具 | 只改包，无 host shell |

**系统真相：图谱 + 事件日志。** 画面只是 `look`。商业世界 API 是可选渲染后端。

---

## 3. 产品不是什么

- 不是世界模型，不训练、不微调生成模型。
- 不是 Unity / Blender，不做场景编辑器。
- 不是 OpenClaw 的 fork，不给 Steward 执行宿主机 shell / 浏览器。
- 不是多玩家服务器，不是飞书 / Telegram 矩阵。
- 不是通用 Agent OS。MCP 只暴露世界工具，不暴露 shell / 浏览器 / 任意文件。
- 不是 Skill 市场。Skill 是包内 Markdown，随包迁移。

---

## 4. 原则

1. **包是产品。** 能在 Finder 里打开、能邮件发出去，才叫「拿出来用」。
2. **图先于像素。** 先改图，再可选渲染。纯文本必须能玩完整期。
3. **没有用户读不到的状态。** 记忆就是文件。禁止隐式数据库当唯一真相。
4. **上下文预算是功能。** 每轮只注入：宪法文件 + 压缩 MEMORY + 当前地点 N 跳 + 今昨编年。
5. **适配层只有一个函数。** 先 mock，再接一家付费 API。
6. **本体锁死。** 七种节点、七种边。演示被卡住再加类型。

---

## 5. 谁用、干什么

一期用户就是开发者本人，以及能接受 CLI 的创作者。

| 角色 | 要完成的工作 |
| --- | --- |
| 创作者 / 自己 | 把一个地方用成「能回去的世界」，而不是一次性生成 |
| 后续（一期不服务） | 制片、独立游戏叙事、资产管线集成 |

第一期证明：**跨天连续 + MCP 能改同一座世界 + 包可迁移。**

---

## 6. 第一期范围

产品五件事，全部要做。实现上仍是包、工具、管家、三张壳。

| 产品能力 | 一期怎么做 |
| --- | --- |
| **记忆** | 图谱 + `events/` + `MEMORY.md` + `session.json`。杀进程仍在。 |
| **上下文** | 每轮只注入宪法、MEMORY、N 跳、今昨编年、当前对话。整图禁止进 prompt。 |
| **MCP** | stdio MCP，工具 = 八个世界工具，Resource = 包内只读文件。无 host exec。 |
| **Skill** | 加载 `skills/*/SKILL.md` 进 Steward 上下文（有 token 上限）。不跑脚本、无市场。 |
| **导出 / 迁移** | `export` 打 zip；另一台机器 `carina serve` 打开。路径 POSIX。 |

支撑能力（仍要做）：daemon、`carina chat`、presence、八工具、mock `look`。

默认带一份示例 Skill：`skills/tavern-continuity/SKILL.md`（过夜时该 remember 什么）。

### 一期明确砍掉

- 世界心跳 / NPC 定时行动
- 多聊天软件、子 Steward
- 宿主机 shell / 浏览器 / MCP 暴露包外路径
- Skill 市场、Skill 里的代码/exec
- 付费世界 API 作为运行依赖
- 多世界同时打开、云同步、多人

---

## 7. 用户故事与验收

### 故事 A — 过夜

1. 用户 `carina new tavern.carina`，用几句话种下一间酒馆。
2. `carina chat`：走进去，告诉老板自己的名字，打碎一只花瓶。
3. 退出并杀掉 daemon。
4. 第二天 `carina serve` + `carina chat`。

**通过：** Steward 不用用户提醒就能说到：人在酒馆、老板叫得出名字、花瓶仍碎。

### 故事 B — 带走

1. 用户 `export`。
2. 在另一目录或另一台机器 `carina serve other.carina.zip`。

**通过：** 地点、人物、碎花瓶、MEMORY 中的名字都在。路径上没有商业世界 API。

### 故事 C — 纯文本

关掉一切渲染后端（默认即关）。

**通过：** A 和 B 仍然成立。`look` 只返回文字。

### 故事 D — MCP 与迁移

1. 用 MCP 客户端对同一包调用 `go` / `remember`（或等价工具）。
2. `export` 后在另一路径打开。
3. `carina chat` 仍能说到 MCP 写下的事实。

**通过：** 聊天、CLI、MCP 改的是同一座世界；zip 换目录后仍在。

---

## 8. 世界包规格（v0）

目录示例：`tavern.carina/`

```
WORLD.md          规则、语气、边界（对应 SOUL）
PLAYER.md         你是谁、希望被如何称呼
STEWARD.md        管家如何操作这张图、何时 remember
MEMORY.md         精炼的跨会话事实，不是流水账
graph.json        节点与边
events/           只追加；建议 events/YYYY-MM-DD.jsonl
assets/           二进制 + 同名 sidecar（出处、license、node id）
skills/           一期仅示例 SKILL.md
session.json      当前地点、上一轮、模型 id
```

### 节点（7）

`World` `Place` `Entity` `Object` `Event` `Asset` `Claim`

### 边（7）

`in` `contains` `knows` `owns` `caused` `depicted_as` `derived_from`

属性一律进节点/边的 JSON，不新增类型。

`Event` 既是图上的节点类型，也以 jsonl 落在 `events/`。文件是日志；图是投影。冲突时以日志重放为准。

---

## 9. 工具契约

所有工具禁止访问世界包以外的路径。没有 `exec`。

| 工具 | 做什么 | 写入 |
| --- | --- | --- |
| `look` | 描述「这里」；可选渲染 | 无，或一件 Asset |
| `go` | 把玩家移到一个 Place | presence + Event |
| `say` | 对视野内 Entity 说话 | Event，或一条 Claim |
| `remember` | 把耐久事实晋升 | MEMORY.md 与/或 Claim |
| `spawn` | 创建 Place / Entity / Object | 节点 + Event |
| `relate` | 增加或撤销一条边 | 边 + Event |
| `attach` | 把文件绑到节点 | Asset 记录 |
| `export` | 写出可分发包 | zip 或目录 |

`look` 的渲染端口（冻结，一期只实现 mock）：

```
render(view: { placeId, entities, camera?, style? }) → { media, warnings? }
```

`media` 一期可以是纯文本。禁止把渲染结果写回为地点的权威几何。

---

## 10. 上下文组装（每轮）

按顺序注入，超限则截断靠后的检索结果，不截断 WORLD.md 的硬边界句：

1. `STEWARD.md` + `WORLD.md` 硬规则
2. 当前包内 `skills/*/SKILL.md`（有总 token 上限；超了只留 frontmatter 名称）
3. `PLAYER.md`
4. `MEMORY.md`（过长则只保留头部精炼段）
5. Presence：当前 Place、N 跳子图（默认 N=2）
6. `events/` 今天 + 昨天
7. 本会话最近对话（独立于世界编年，有条数上限）

模型可换。换模型不得换包格式。

---

## 11. 技术栈（已冻结）

**语言：TypeScript（`strict`）。运行时：Node 22 LTS 官方构建。** CLI、daemon、图谱、工具循环同仓、同一语言。不引入第二运行时。

一期支持：**macOS、Windows 10+、Linux（glibc）× amd64 / arm64**。世界包在这六种组合上必须能打开。不保证：Alpine/musl、浏览器内运行、iOS/Android、无 Node 的双击即用（那是二期可选 SEA / 独立二进制）。

选它而不是 Python：产品是网关 + 包格式 + 流式聊天。契约要用类型钉死。PyInstaller / 原生 wheel 是跨平台的坑，不是优势。

选它而不是 Go / Rust：八周要的是改工具循环的速度。Go 在「无 Node 单文件」上更强，但一期分发是 `npx` / `npm i -g`，不是六套交叉编译。**代价是必须零 native addon**，否则 Windows / ARM 会把 TS 的跨平台优势吃掉。包格式稳定后，可以用 Go 写只读加载器，不改 pack。

选它而不是 Bun / Deno：Node 官方构建覆盖 Win/macOS/Linux 最完整；Bun 的 Windows 与 addon 生态仍是风险。Deno `compile` 留作二期分发备选，不作为开发运行时。

| 层 | 选择 | 不选（跨平台原因） |
| --- | --- | --- |
| 包管理 | pnpm | 不要 monorepo |
| 校验 | Zod | 裸 `as` |
| CLI | citty 或 commander + `node:readline` | Ink / blessed / 依赖 raw TTY 的 TUI |
| daemon | Hono + **TCP `127.0.0.1` + HTTP + SSE** | Unix socket、命名管道、gRPC、Electron |
| 流式 | SSE | 一期不上 WebSocket |
| Agent | Vercel AI SDK + OpenAI 兼容 provider | LangChain；绑死一家 SDK |
| 模型 | 用户 Key；OpenAI 兼容端点 | 产品内置模型 |
| 包内数据 | UTF-8、LF、**包内路径一律 POSIX**（`assets/foo.png`） | SQLite 当唯一真相 |
| 索引 | 一期不建。若需要：只许 `node:sqlite`（随 Node 分发） | `better-sqlite3`、`sqlite3`、任何 node-gyp |
| 压缩 | JS 实现的 zip（如 fflate） | 调用系统 `zip` / `tar` |
| 测试 | node:test 或 vitest | 只在 darwin 上测 |

### 跨平台硬规则

- **零 native addon。** `optionalDependencies` 里的平台二进制也不要。CI 在 ubuntu-latest、windows-latest、macos-latest 跑同一套测试。
- **进程间只用 HTTP。** CLI 连 `http://127.0.0.1:<port>`，带 token。禁止 Unix socket（Windows 行为不一致）。
- **包内路径永远 `/`。** 只有「包根目录」用 `node:path` 拼到宿主 FS。禁止把 `C:\` 或反斜杠写进 `graph.json`。
- **导出 zip 自包含。** 另一台机器只需要 Node 22 + 本 CLI，不需要同一套 shell 工具。
- **聊天是协议，不是终端。** daemon 暴露同一套 SSE API。`carina chat` 是 readline 瘦客户端；daemon 同时提供一份**零构建静态页**（无打包器、无原生模块），TTY 不可用时打开浏览器。这是一个协议的两个壳，不是两个产品面。
- **不要为「打开浏览器」调系统命令。** 打印 URL；需要时用纯 JS 的 opener 并处理 win/mac/linux 三分支，失败则只打印。
- 文件监视不作为正确性依赖（`fs.watch` 在 Windows 上不可靠）。

其余约束：

- daemon 默认 `127.0.0.1`，请求带 token。
- LLM 走用户自己的 API Key；产品不带模型。
- 一期无向量。子图 + 关键字通过验收。
- 禁止宿主机 `exec`、浏览器自动化依赖。
- 适配层：一个 `Renderer` 接口 + `MockRenderer`。不把 Marble SDK 写进核心。渲染器返回的是字节或 URL，不假设 OS 预览器。

---

## 12. 成功标准

第一期结束当且仅当：

1. 故事 A、B、C、D 全过。
2. 一个未读过代码的人只靠 `README` 能 `new` → `chat` → 过夜 → `export`，并能把 MCP 接到 Cursor。
3. 适配层代码不超过「一个接口 + mock」。没有第二家 provider 实现也可以发布。
4. 八周内（兼职则按等效工时）能对着镜头演示故事 A+B，并顺手展示 MCP 改同一座世界。

不作为一期成功标准：画面好看、多模型评测、用户量、技能生态。

---

## 13. 风险

| 风险 | 对策 |
| --- | --- |
| 本体膨胀 | 类型写死在 PRD；新类型必须先改本文 |
| 做成渲染客户端 | 故事 C 不过就不能接付费 API |
| 做成 OpenClaw 皮肤 | 禁止 host shell；聊天面只有 `carina chat` |
| 实验室自己做实体图 | 护城河是包格式和创作流程，不是画面 |
| LLM 费用 | 工具优先；能图上解决的不问模型 |

---

## 14. 里程碑

| 周 | 交付 | 完成定义 |
| --- | --- | --- |
| 1–2 | 包格式 + CLI：`new` `query` `spawn` `relate` `export`，无 LLM | 不用模型也能建酒馆、碎花瓶、导出 |
| 3–5 | daemon + `carina chat` + 八工具 + 上下文预算 | 故事 A 在同一次开机内可走通 |
| 6 | 杀进程过夜 + 故事 C | 故事 A、C 稳定 |
| 7–8 | 导出迁移 + MCP + 示例 Skill + README | 故事 B、D；可演示 |

周次是日历建议。验收只认故事，不认周次。

---

## 15. 第一期之后（不实施，只占位）

- 一个付费 `look` 后端（例如 Marble generate/export）
- 静帧 / 全景作为 Asset
- 把静态聊天页做成完整 UI（一期只有零构建退路页）
- Skill 市场、带代码的 Skill
- 包格式版本迁移
- MCP 以外的渠道（飞书等）

未写进第 6 节的，一律视为第一期不存在。

---

## 16. 第一期模块（冻结）

**9 个目录，一个仓。** 不是 npm workspaces。依赖只能向下。

核心（无 HTTP、无 MCP、无 `ai`）：`schema` `pack` `world` `render` `tools`  
壳：`steward`（唯一可 import `ai`）`server` `mcp` `cli`

```
schema → pack → world → tools → steward → server
                       ↗                ↘
                 render            cli / mcp
```

`cli` 在 1–2 周直连 `world` / `tools`。`carina chat` 走 `server`。MCP 与 HTTP 只调 `executeTool`。

### 目录与公开函数（名字冻结）

```
src/
  schema/     契约。无 fs
  pack/       目录与 zip
  world/      图、编年、session、MEMORY
  render/     Renderer + mock
  tools/      八工具
  steward/    上下文、Skill 注入、runTurn
  server/     Hono + SSE + chat.html
  mcp/        stdio MCP
  cli/        入口
  config.ts   CarinaConfig，读 CARINA_* 环境变量
  errors.ts   CarinaError
```

| 模块 | 公开名字（一期只许这些当跨模块 API） |
| --- | --- |
| schema | `NodeType` `EdgeType` `NodeRecord` `EdgeRecord` `GraphFile` `ChronicleEvent` `ToolName` `toolInputSchema` `RenderView` `RenderResult` |
| pack | `createPack` `openPack` `exportZip` `resolvePosix` `listSkills` `readMarkdown` |
| world | `WorldStore`：`query` `mutate` `appendEvent` `setPresence` `remember` `hopNeighborhood` |
| render | `Renderer` `MockRenderer` `render` |
| tools | `executeTool` `ToolContext` |
| steward | `assembleContext` `runTurn` |
| server | `createHttpApp` `startHttpServer` |
| mcp | `startMcpServer` |
| cli | `main` |

每个模块一个 `index.ts`，外部只从 `index.ts` 进。

### 依赖规则

1. `schema` 只依赖 `zod`。
2. `world` 不 import `hono` / `ai` / `@modelcontextprotocol/*`。
3. `tools` 不 import `ai`。`look` 只调 `Renderer`。`export` 只调 `exportZip`。
4. 只有 `steward` 可依赖 `ai`。
5. `cli` / `server` / `mcp` 禁止再实现一套工具。
6. `mcp` 不 import `ai`。对话走 `server`。

### 与产品能力

| 能力 | 模块 |
| --- | --- |
| 世界包 | schema + pack |
| 记忆 / 编年 / Presence | world |
| 八工具 / 导出 | tools + pack |
| Mock look | render |
| 上下文 + Skill | steward |
| MCP | mcp |
| 聊天 | server + cli |

### 开工顺序

| 步 | 模块 | 可演示 |
| --- | --- | --- |
| 1 | schema + pack | `carina new tavern.carina` |
| 2 | world + spawn/relate/query | 无模型建酒馆、碎花瓶 |
| 3 | exportZip | 换目录打开 |
| 4 | session + remember | 杀进程状态还在 |
| 5 | look/go/say/attach | 八工具齐，无模型 |
| 6 | steward + server + chat | 故事 A |
| 7 | mcp + 示例 Skill + README | 故事 A/B/C/D |

### 不要建的目录

`plugins/` `vector/` `channels/` `marble/` `packages/` `skills-runtime/`。

---

## 17. 代码与命名（冻结）

语言：TypeScript `strict`。ESM（`"type": "module"`）。开发用 `tsx`，发布用 `tsc`。NodeNext：相对 import 写 `.js` 后缀。

**代码标识符用英语。** 注释、说明、CLI、前端、MCP 描述、错误文案、默认世界模板：中英双语从第一行代码就要在，禁止只写一种语言再「以后补翻译」。

### 17.1 拼写形状

| 种类 | 规则 | 正例 | 反例 |
| --- | --- | --- | --- |
| 目录 / 文件 | kebab-case，`.ts` | `event-log.ts` `world-store.ts` | `eventLog.ts` `WorldStore.ts` |
| 函数 / 变量 / 参数 | camelCase | `openPack` `hopCount` `placeId` | `open_pack` `hop_count` |
| 类型 / 类 / 接口 | PascalCase，不要 `I` 前缀 | `WorldStore` `ObjectNode` | `IWorld` `TPlace` |
| 常量（真常量） | `SCREAMING_SNAKE` | `DEFAULT_HOP_COUNT` `TOOL_NAMES` | |
| Zod schema | camelCase + `Schema` | `nodeRecordSchema` | `NodeRecordSchema` 与类型重名也可，但一期用 camelCase schema |
| 环境变量 | `CARINA_` + SCREAMING | `CARINA_API_KEY` | `OPENAI_API_KEY` 可作 fallback，代码里仍映射到 `CarinaConfig` |
| npm 包 / bin | `carina` | | |
| JSON 字段 | camelCase | `placeId` `createdAt` | `place_id` |
| 包内路径字符串 | POSIX，`/` | `assets/vase.png` | `assets\\vase.png` |
| 磁盘文件名 | 已在第 8 节冻结 | `WORLD.md` `graph.json` | 不要改成 `world.md` |

布尔：`is` / `has` / `can` 开头（`isLoopback` `hasPresence`）。  
函数：动词开头。工厂：`createX` / `openX` / `startX`。  
不要缩写：`id` `uri` `url` `mcp` `sse` 除外。禁止 `ctx2` `tmp` `data1`。

### 17.2 避开 JS 保留字（磁盘字符串不变）

图谱里的字面量按第 8 节；TypeScript 类型另开一名。

| 磁盘 / JSON | TypeScript 类型 | 变量名 |
| --- | --- | --- |
| `"type": "World"` | `WorldNode` | `worldNode` |
| `"type": "Object"` | `ObjectNode` | `objectNode`（禁止 `Object` `object` 当类型名） |
| `"type": "Event"` | `EventNode` | `eventNode` |
| `"type": "in"` | `EdgeType.In`（值仍是 `"in"`） | `edgeType`；禁止 `const in =` |
| jsonl 一行 | `ChronicleEvent` | `chronicleEvent` |
| 运行中的世界 | `WorldStore` | `store` 或 `worldStore`（禁止类名 `World`） |

`NodeType` / `EdgeType` 用 `as const` 对象 + 联合类型，不要 `enum`。

```ts
export const NodeType = {
  World: "World",
  Place: "Place",
  Entity: "Entity",
  Object: "Object",
  Event: "Event",
  Asset: "Asset",
  Claim: "Claim",
} as const;
```

工具名单冻结，全小写：`look` `go` `say` `remember` `spawn` `relate` `attach` `export`。实现函数与之一一对应：`runLook` `runGo` … `runExport`（`export` 是保留字，故加 `run` 前缀，八个一律 `run` + PascalCase）。

### 17.3 id、时间、错误

- 所有节点 / 边 / 事件：`id` 为 ULID 字符串（可排序）。不要 `uuid` 混用。
- 时间：ISO-8601 UTC，字段名 `createdAt` `occurredAt`。不要 epoch 混用。
- 错误：只抛 `CarinaError`，带 `code: string`（`PACK_NOT_FOUND` `SANDBOX` `UNKNOWN_TOOL` …）。边界用 Zod `safeParse`，不把 `error` 吃掉。
- 禁止 `any`。跨边界用 Zod。禁止非空断言 `!`，除非上一行刚收窄。

### 17.4 模块内部文件名

一期建议（可增文件，不可改公开 API 名）：

| 目录 | 文件 |
| --- | --- |
| schema | `node-types.ts` `edge-types.ts` `graph-file.ts` `chronicle.ts` `tool-io.ts` `render.ts` `index.ts` |
| pack | `paths.ts` `create.ts` `open.ts` `zip.ts` `sandbox.ts` `markdown.ts` `skills.ts` `index.ts` |
| world | `world-store.ts` `graph.ts` `events.ts` `session.ts` `memory.ts` `query.ts` `index.ts` |
| render | `renderer.ts` `mock-renderer.ts` `index.ts` |
| tools | `execute.ts` `run-look.ts` … `run-export.ts` `index.ts` |
| steward | `assemble-context.ts` `inject-skills.ts` `run-turn.ts` `index.ts` |
| server | `create-http-app.ts` `chat-sse.ts` `public/chat.html` `index.ts` |
| mcp | `start-mcp-server.ts` `index.ts` |
| cli | `main.ts` `commands/*.ts` |

### 17.5 环境变量

| 变量 | 含义 |
| --- | --- |
| `CARINA_API_KEY` | LLM |
| `CARINA_MODEL` | 模型 id |
| `CARINA_MODEL_BASE_URL` | OpenAI 兼容端点 |
| `CARINA_TOKEN` | daemon / HTTP 鉴权 |
| `CARINA_PORT` | 默认如 `18790`（避开 OpenClaw 18789） |
| `CARINA_PACK` | 当前包路径 |
| `CARINA_LANG` | `zh` 或 `en`，界面与说明的显示语言，缺省 `zh` |

配置对象：`CarinaConfig`。禁止在业务模块里直接 `process.env`，只在 `config.ts` 读。

### 17.6 格式与测试

- `strict`：`strict` `noUncheckedIndexedAccess` `exactOptionalPropertyTypes`。
- 格式：Prettier 默认（无分号争议则用 Prettier 默认）。不引入 Biome / 带 native 的 lint 作为运行时依赖。
- 测试：`node:test` 或 vitest，文件 `*.test.ts` 与实现同目录或 `test/` 下一期统一用 `src/**/*.test.ts`。
- 日志：`console.error` 给 CLI 致命错误；daemon 用简单 `log.info` 函数，不要 winston。面向用户的日志句子走 i18n，不要在 `console.log` 里写死某一种语言。

未写进本节的风格不要另开一套。

### 17.7 中英双语（冻结）

从仓库第一天起，中文和英文是对等的，不是「中文产品、英文以后再说」。

**1. 用户看得见的字：只许从词表出。**

- 词表：`src/i18n/zh.ts` 与 `src/i18n/en.ts`，同一组 key，两边都要有值。
- 取值：`t(key)`，语言来自 `CarinaConfig.lang`（`CARINA_LANG`）。
- 禁止在 `cli/`、`server/public/chat.html`、MCP `description`、`CarinaError` 的用户报文里写死单语字符串。
- `chat.html` 用 `data-i18n="key"` 或启动时注入词表，禁止 HTML 里只写中文或只写英文。
- MCP 工具描述用词表拼出「中文。English.」一句，Cursor 里两种语言都能搜到。

**2. 注释与 JSDoc：中英都写。**

导出函数、类型、模块顶注释必须用：

```ts
/**
 * zh: 打开世界包并校验 graph.json。
 * en: Open a world pack and validate graph.json.
 */
export function openPack(packDir: string): PackHandle {}
```

行内注释同一格式，可写一行：

```ts
// zh: 包内路径必须是 POSIX。 en: Pack-relative paths must be POSIX.
```

禁止只有 `zh:` 或只有 `en:`。实现细节的短注释也要双语，不要用「太短就只写英文」当例外。

**3. 说明文档与模板。**

- `README.md` 中英分节都要有（或 `README.zh.md` + `README.en.md` 同时存在，禁止只交一份）。
- 默认世界模板：`src/i18n/templates/zh/` 与 `src/i18n/templates/en/` 成对（`WORLD.md` `PLAYER.md` `STEWARD.md` `MEMORY.md` 与示例 Skill）。`createPack` 按 `CARINA_LANG` 选一套，另一套仍留在仓库里。
- 用户写进自己世界包的正文不强制双语（那是用户的世界）。

**4. 错误码对用户。**

- `CarinaError.code` 仍是英语大写（`PACK_NOT_FOUND`）。
- `CarinaError.message` 对用户展示时走 `t("error.packNotFound")`，词表里中英都有。日志可同时打 `code`。

**5. 检查。**

- 新增 key 必须同时改 `zh.ts` 和 `en.ts`。缺一边视为构建失败（一期用简单测试：两个对象 key 集合相等）。
- 不引入 i18n 框架全家桶。`t` 就是查表。

`src/i18n/` 是基础设施，不算第 10 个产品模块；`cli` / `server` / `mcp` / `pack` 都依赖它取文案。`schema` / `world` 不依赖 i18n（不拼用户句子）。
