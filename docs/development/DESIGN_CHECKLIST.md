# 按设计验收：清单与待办

更新：2026-09-13。对照 [PRD](../../PRD.md) A1–A10 与 [NG-1](../NEXT_GENERATION_PLAN.md) 核心循环。状态以代码、测试与 live 证据为准，不以目录存在或 Windows 串流通为通过。

**本文是「项目离设计目标还差多少」的唯一口径。** 阶段关口与证据索引在 [P0_PROGRESS](P0_PROGRESS.md)；机器 / 隧道 / 端口 / 权重等环境事实在 [HANDOVER](../../HANDOVER.md)。那两份不再各自维护一份「当前状态」。

**不得把夹具酒馆、CC0 `tavern_pbr.glb`、目录组装、LingBot 短片、HTTP 测试替身 GLB、TripoSR 单件写成整座酒馆的世界模型。** 整空间候选只有 Windows 5070 Ti 上的 WorldGen 空间壳（`CARINA_SPACE_PROVIDER_URL=http://127.0.0.1:18796`，`provider: worldgen-flux-pano-da2`）：单视点球面网格，`coverage: single-viewpoint`，尺度先验 `confidence: low`。AIGA TripoSR（`:18795`）是特色物件 I23D。无 URL 时生产路径仍不得静默提交盒子酒馆。

本文件是验收口径，不是完成声明。A1–A10 仍不要勾通过。

## 总览

| 口径 | 未过 | 部分 | 阻塞 | 脚手架（手段≠产品） |
| --- | ---: | ---: | ---: | ---: |
| PRD A1–A10 | 0 | 10 | 0（整空间是单视点壳，不是可绕行重建） | P0/P1 视口 + 花园壳 |

通过：0。不要勾 A1–A10。

## PRD 验收故事

| ID | 故事 | 状态 | 已有 | 缺口 |
| --- | --- | --- | --- | --- |
| A1 | 多世界隔离 | 部分 | `session.switch`、包隔离、WORLD.md 分世界、HTTP 聊天走 application。图谱 CLI 在 `carina legacy` 下。设了空间 URL 时 create 先出空间壳再出物件。已提交壳在包内（`ng1-space-shell.json`）。门/桌/杯已升 generate 并 cook 进 `ng1-i23d`（`ng1_catalog_furniture_cook.json`，I23D） | 壳是单视点 overlay，不是可绕行的世界模型酒馆。椅/窗仍是目录件 |
| A2 | 管家控制世界模型生成 | **部分** | 可走网格上「看向门」改 yaw。HTTP POST 带 `camera` / `mode`。空间壳 live：NL → FLUX 全景 → DA-2 → 32 万顶点 GLB（`ng1-space-shell.json`），并已 cook/spawn 进 `ng1-i23d`（`ng1-space-shell-cook.json`）。物件仍是 TripoSR。开流后 `player_pose` 把 PS2 占有 pawn 放进室内（`play_enter.json`）；`POST /v1/host/look` 原地转 yaw（`play_look.json`）。Mac daemon 已接 `CARINA_WORLD_RUNTIME_URL` | 不是世界模型视频。壳没有背面。`cameraControl: true` 只表示合同带了相机 |
| A3 | 米制校准 ≤5cm | 部分 | `spatial.calibrate` 改 SceneSpec 与已提交 AABB；位移后核对 ≤5cm。新 generate 与 live 重贴都用 `regionFit.method=scenespec-aabb`（三轴 min 均匀缩放） | 核对的是已提交物件 + overlay 壳。壳仍是单视点，尺度 `confidence: low`。拟合 ≠ 修好的世界模型度量 |
| A4 | 固化 + 离线重玩 | 部分 | 包与 MEMORY.md 可重开；freeze 写修订；关生成 URL 后壳哈希不变、暂停仍可走（`offline_reopen.json`） | 可玩 3D 离线仍混有目录壳 + CC0 房间。JPEG 重开聊天算失败 |
| A5 | 运行 / 暂停 / 恢复 | 部分 | 词汇、pause 屏障、`generation.stop` 与 pause 分开；run → pause 冻结 simTime 与代理 NPC（`npc_pause_freeze.json`）。代理网格已 cook 进 `ng1-i23d`（`ng1_npc_proxy_cook.json`） | NPC 仍是 `proxy-mesh` 夹具老板。不是生成角色 |
| A6 | 记忆约束的扩展 | **部分** | 门外庭院贴门缝；live extend POST `courtyard-feature` + preserve + seam ≤10cm。花园四盒已 cook。`POST /v1/host/isolate` 关掉默认图碰撞后，占有 pawn 落在 `interior-garden-floor` 上站住（`ng1_garden_shell_stand13/ps_pawn_landed.json`；live isolate `isolate_viewport.json`，隐藏 72 个默认图 actor）。室内 SceneSpec 七盒已 cook；空间壳碰撞关闭后占有 pawn 站在室内脚手架地板（`ng1_interior_shell/ps_pawn_landed.json`，`movementMode=1`）。compose/extend 不把已提交室内件重造（`constrained_extend.json`）。成功 cook 后客户端会再调 isolate，不靠秘密 remount | 可走的是脚手架盒，不是重建房间。默认 Third Person 图仍在，仍必须 isolate。庭院景物 ≠ 世界模型重建 |
| A7 | 崩溃 / 取消 / 晚到结果 | 部分 | 包原子提交；`jobs.json` / `command-results.json`。cook 失败 live 回滚：`POST /assets/uninstall` 卸本轮新侧容器（`a7_live_rollback.json`）。成功 cook+spawn 见 `a7_live_cook_publish.json` | 观测仍 best-effort。`CARINA_WORLD_RUNTIME_COOK=0` 才退回只上传 |
| A8 | 导出 | **部分** | zip 世界包；NG-1 再导出无 24 顶点 `吧台`、无 `geometry_0`。Blender 点选吧台/壁炉/庭院/空间壳。空间壳 extras 带 `claimsWorldModelGeneration: true`。门/桌/杯是 I23D | 椅/窗仍是目录。手搓 `tavern_pbr.glb` 仍不是这次生成物 |
| A9 | 非开发者闭环 | 部分 | README / `carina chat` / `mcp` / `new 名字` 不再要 Place id。HTTP 与 MCP speak 走 WorldCommand。侧栏检查点列表 + 恢复：`GET /v1/sessions/:id/checkpoints`，`app.html` `#checkpoint-panel`，浏览器点恢复回退修订（`checkpoints_ux.json`） | 创建出的是空间壳 + I23D 特色/家具 + 目录椅窗，不是可走进去的世界模型酒馆。不是 3 个素人 10 分钟基线 |
| A10 | 规则是文件且约束动作 | 部分 | 文件、面板、NL 追加；四类关键词在 application 路径拒绝动作/生成。`lock_object` 拒校准/挪/拿；legacy `go`/`spawn`/`relate`/`attach` 读 WORLD.md；compose/extend 保留已锁定位姿与网格 | 散文只进 stewardConstraints（正确）。锁定不能阻止人改 WORLD.md 本文 |

## 核心循环（描述 → 生成 → 探索 → 校准 → 固化 → 继续或扩展 → 导出）

| 环节 | 状态 | 实际走的是什么 |
| --- | --- | --- |
| 描述 | 部分 | SceneSpec / heuristic 计划可落盘 |
| 生成 | **部分** | 有 `CARINA_SPACE_PROVIDER_URL` 且 sidecar `ready` 时，create 先 POST 空间壳（白名单 `worldgen-flux-pano-da2`），再逐件 POST TripoSR。无空间 URL 不得声称世界模型。无 mesh URL 时物件 generate 仍 BLOCKED |
| 探索 | 部分 | PS2 视口 = 空间壳 overlay + I23D + 花园/室内脚手架盒。开流/isolate 后占有 pawn 站在室内 `floor` 盒上（`play_enter.json`：pose `(600,500,170)`，落地 z≈100 cm，`movementMode=1`）。不是走进可碰撞的世界模型网格 |
| 校准 | 部分 | 已提交 AABB ≤5cm。live 壳已从 footprints 2.18× / 7.4 m 重贴为 `scenespec-aabb` 1.18× / 高 4 m（`worldgen/ng1-space-shell-refit.json`）。拟合 overlay ≠ 修好的度量 |
| 固化 | 部分 | revision 提交；壳与吧台/壁炉顶点数重开不变 |
| 扩展 | **部分** | preserve + seam 合同成立。已提交室内物件不进花园 compose。花园盒可走。不是世界模型约束扩展 |
| 导出 | **部分** | 命名 GLB；空间壳按物件名导出。门/桌/杯是 I23D；椅/窗仍是目录 |

## 杀伤力待办（实现顺序）

1. **世界模型** — 5070 Ti WorldGen 空间壳 spike **通过（有边界）**：NL → 房间尺度网格 + 来源 → 几何验证 → SceneSpec → freeze/reopen/导出。证据 `docs/benchmarks/windows-rtx5070ti/worldgen/`。单视点、无背面、尺度 low。不得把 TripoSR 写成 Marble/Genie。下一步：多视点补洞或换整场景模型时再加白名单项。
2. **停止藏** — 一套 WorldCommand 门面。`claimsWorldModelGeneration` 只在白名单空间壳已入包（`assetHash`）时为 true；物件 / 工厂 / SolarWM / 花园壳锁 false。`/health.worldModel` 只报接上的合同（`http-space-shell`），不报已生成。
3. **生成可恢复** — `jobs.json`、`command-results.json`。UE cook 失败 live 回滚已验证。配了 WorldRuntime 即默认 cook + remount；`CARINA_WORLD_RUNTIME_COOK=0` 退回只上传。
4. **规则真正约束动作** — 四类关键词已走 application + legacy 八工具 + compose/extend 保锁定件。无法抽出的句子保持 `stewardConstraints`。
5. Windows 串流是视口，不单独代表产品进度。
6. **SolarWM** — NG-1 **正式关闭**（`closed-ng1`）。5070 Ti 已分配给 UE + WorldGen；视频路径没有下游消费者。见 [SOLARWM_REVIEW §8](../SOLARWM_REVIEW.md)。设 `CARINA_SOLARWM_ROOT` 才重开实验，视频仍不是网格。
7. **花园 / 室内可行走（脚手架）** — 默认 Third Person 图碰撞必须 isolate 关掉（现有 `POST /v1/host/isolate`，`isolate_viewport.json`）。花园 stand13：占有 pawn `(300, -500, 92)`，脚下 `interior-garden-floor`。室内：空间壳 `actorCollision=false`；占有 pawn `(600, 445, 100)`，`movementMode=1`，脚下脚手架盒（`ng1_interior_shell/ps_pawn_landed.json`）。不是世界模型碰撞。isolate 挂 fill light。Unlit→Opaque 重 cook 后 posed-inside 静帧更可读（`ng1_interior_shell_reparent4/`），仍不是 P1。

## 明确不算完成的东西

- P1 CC0 酒馆、Avocado、BoomBox、隔夜 34KB `tavern.glb`
- TripoSR I23D 特色物件 ≠ 整座酒馆
- 空间壳 ≠ 可绕行、可碰撞的世界模型房间（壳现在是视觉 overlay；碰撞在 SceneSpec 盒上）
- 能力旗标为 true 但后端是夹具（已切断生产默认）
- 测试绿 ≠ 故事过

## 本轮可写代码

- [x] 无 mesh URL 时不静默提交盒子酒馆；夹具显式 `allowPrimitiveFixture`
- [x] HTTP 聊天有 application 时走 WorldCommand
- [x] jobs.json；重启中断 in-flight
- [x] 四类法则在 application 路径拒绝动作与生成
- [x] MCP `speak`；无包时 CLI `look`/`remember` 走管家
- [x] commandId 结果落盘
- [x] 校准对已提交物件做 ≤5cm 核对
- [x] A9 主路径去掉 Place id / 包路径口令
- [x] A2 可走网格上「看向门」走运行时 yaw
- [x] A6 扩展 POST `courtyard-feature` + preserve + seam
- [x] 生产网格 URL 指向 AIGA TripoSR；`claimsWorldModelGeneration` 对物件为 false
- [x] NG-1 句带壁炉时 create 对每个室内 generate 物件 POST
- [x] NG-1 导出 Blender 点选命名网格
- [x] 已有 `bar-front` 时不再实例化 24 顶点 reuse `吧台`
- [x] NG-1 特色网格 MERGE 进 `ng1-i23d`
- [x] A6 扩展网格 overlay；产品路径 extend 传 WorldRuntime
- [x] 停止藏：根 CLI / `/health` 不再把 LingBot 标成世界模型
- [x] A7 UE 发布回滚（代码 + live：`a7_live_rollback.json`）
- [x] 文档合一：HANDOVER 改历史；本文唯一验收口径；P0_PROGRESS 只留证据
- [x] 5070 Ti 世界模型 spike：`sidecars/worldgen-scene` + `http-space-shell`；证据 `worldgen/ng1-space-shell.json`
- [x] `claimsWorldModelGeneration` 按来源：白名单壳 + 包内 hash 才 true（`asset-plan` refine + 测试）
- [x] SolarWM NG-1 正式关闭（`runSolarWmExperiment` → `closed-ng1`）
- [x] 产品 daemon 默认 cook + remount（`CARINA_WORLD_RUNTIME_COOK=0` 关闭）；live 成功发布 `a7_live_cook_publish.json`
- [x] 花园壳 cook 进 UE（`ng1_garden_shell_cook.json`）；`claimsWorldModelGeneration` 永远 false
- [x] 花园落地站住：isolate 关默认图碰撞后 pawn 站在花园地板（`ng1_garden_shell_stand13/ps_pawn_landed.json`）。脚手架，不是世界模型
- [x] `lock_object` 走 compose/extend；legacy 八工具读 WORLD.md
- [x] 关生成 URL 离线重开：壳哈希不变、暂停可走（`offline_reopen.json`）
- [x] NPC 代理网格 cook + 暂停冻结（`ng1_npc_proxy_cook.json`、`npc_pause_freeze.json`）。不是生成角色
- [x] 检查点侧栏列表/恢复（`checkpoints_ux.json`）。不是素人 10 分钟基线
- [x] 空间壳 cook 进 live `ng1-i23d`（`worldgen/ng1-space-shell-cook.json`）：16.2 MB / `worldgen-flux-pano-da2` / `claimsWorldModelGeneration: true`。单视点 overlay，不是可绕行房间
- [x] 室内脚手架七盒 cook（`ng1_interior_shell_cook.json`）。`scaffold-primitive`，永不声称世界模型
- [x] 空间壳 spawn/isolate 关碰撞；室内落地站住（`ng1_interior_shell/ps_pawn_landed.json`）。脚手架盒，不是世界模型碰撞
- [x] 目录门/杯/桌换成 I23D 生成件并 cook 进 `ng1-i23d`（`ng1_catalog_furniture_cook.json`）。椅/窗仍是目录。不是整座酒馆世界模型
- [x] P4 expansion-hit probe（`p4_expansion_hit.json`）：进程内走近花园缝，调度器标 ready。`p4Pass: false`。花园是脚手架，不是 live UE 边界扩张故事
- [x] isolate HTTP：`POST /v1/host/isolate` + 成功 cook 后调用（`isolate_viewport.json`）。关掉默认 Third Person 图并切 Lit。不是 P1，不是生成光照
- [x] 开流/isolate 后把占有 pawn 放到室内脚手架地板上（`play_enter.py`，live `play_enter.json`）。`hidePawn: false`；落地 `movementMode=1`，z≈100 cm。人站在 SceneSpec 盒上，不是可走的空间壳。不是 P1
- [ ] P1 室内提亮：isolate 会挂 fill light 并 exec `lit_interior_execs()`。glTF Unlit/自发光 MIC 已改挂 host Opaque；同一 hash `2cbef055…` 已 `forcePrepare` 重 cook 进 `ng1-i23d`（`worldgen/ng1-space-shell-reparent-cook.json`）。posed-inside 静帧见 `validation/ng1_interior_shell_reparent4/`（`cameraPoseValid: true`，`interior_center` meanLuma 37.1→50.1，`from_door_looking_in` 可读）。仍是 fill light + Opaque MIC + cvars，不是生成光照。无 6 视点 / 10 分钟。不要勾 P1。`ng1_interior_shell_reparent/` 是虚空相机，不算。
- [ ] 多视点补洞或换整场景模型时再加白名单项
- [x] live 空间壳 `scenespec-aabb` 重贴（`worldgen/ng1-space-shell-refit.json`）：同一 GLB `2cbef055…`，scale 2.18→1.18，高 7.4 m→4 m。不是新 WorldGen，`a3Pass: false`
