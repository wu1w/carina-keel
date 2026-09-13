# 六阶段实施进度（证据索引）

更新：2026-09-13。总计划见 [NG-1](../NEXT_GENERATION_PLAN.md)。

**本文只做两件事：** 记录 P0–P5 每个关口的通过/部分/未过，以及指向证据文件。「距离设计目标还差多少、A1–A10 状态、下一步做什么」不在这里重复，**唯一口径**是 [DESIGN_CHECKLIST](DESIGN_CHECKLIST.md)。环境（机器 / 隧道 / 端口 / 权重）见 [HANDOVER](../../HANDOVER.md)。

不得把夹具酒馆、CC0 `tavern_pbr.glb`、目录组装、LingBot 短片、HTTP 测试替身 GLB、TripoSR I23D 特色物件写成整座酒馆的世界模型。空间壳是单视点候选，见 `../benchmarks/windows-rtx5070ti/worldgen/`。

## 关口状态

- **P0 运行时与资产入口** — 通过（样板 ≠ 生成）。
  - P0-T Mac 契约测试（WorldRuntime / 上传诚实 / 导出工厂路径 `claimsWorldModelGeneration=false`）。
  - P0-1 LAN PS2 ICE + `framesDecoded` 增量：`../benchmarks/windows-rtx5070ti/validation/p0/lan_ps2.json`。
  - P0-2 脚手架 `8dd45448bbac70a0` prepare/install/activate/spawn。
  - P0-3 窗口化地板 WASD：`validation/p0/wasd.json`。
  - 早期：真实上传 `ac37c156cee5773d` 去重；单帧复核 [evidence/p0-single-frame.json](evidence/p0-single-frame.json)、[上传](evidence/p0-upload.json)、[全量回归](evidence/p0-tests.txt)、[图形与鉴权回归](evidence/p0-graphics-tests.txt)、[初次渲染问题](evidence/p0-first-render.json)。
- **P1 高质量可玩酒馆** — 部分。
  - P1-T 墙滑移、门外 `too_far`、杯子无幽灵、`generation.stop` 后仍可 `player.act`；`src/play` 状态机；HQ fallback 恒为 `none`。
  - P1-1 `src/play` + `app.html` 主视口 PS2；断开 overlay 与「生成已停」文案分开。
  - P1-2 Blender 4.5.13 + ambientCG CC0 组 12×10 m `tavern_pbr.glb`（assetId `629373db5bc61c4c`）；host MERGE，`global.utoc` 未改。
  - P1-3 14/14 spawn（identity spawn + Movable 后赋网格）；门/杯 native interact。证据 `validation/p1/door_inside_lit2.png`、`overhead_unlit.png`。
  - 未过：P1 仍未过。isolate + Unlit→Opaque 重 cook 后，**posed-inside** 静帧更可读（`validation/ng1_interior_shell_reparent4/`，`cameraPoseValid: true`，`luma.json`：`interior_center` 37.1→50.1）。光照是 fill light + host Opaque MIC + Lit cvars，不是生成光照。`ng1_interior_shell_reparent/` 是相机掉虚空，不算室内证据。6 固定视点 / 10 分钟路线 / 帧时基线未做。`p1Pass: false`。
- **P2 生成到建模资产工厂** — 部分。
  - 物件：AIGA TripoSR I23D。证据 `../benchmarks/aiga-native-mesh/ng1-loop.json`、`ng1-export-named.json`、`ng1-blender-named.json`、`live-loop.json`。
  - 整空间：WorldGen 空间壳 spike 通过（有边界）。证据 `../benchmarks/windows-rtx5070ti/worldgen/ng1-space-shell.json`、`worldgen/ng1-space-shell-cook.json`、`worldgen/ng1-space-shell-refit.json`、`worldgen/ng1-space-shell-reparent-cook.json`、`worldgen/README.md`。320400 顶点，16.2 MB，已 cook/spawn `interior-space-shell` 进 `ng1-i23d`。live 已从 footprints 2.18× / 7.4 m 重贴为 `scenespec-aabb` 1.18× / 高 4 m（同一 hash，不是新 generate）。Unlit→Opaque 重 cook 仍是同一 hash。`claimsWorldModelGeneration: true` 仅此路径。单视点 overlay，不是可绕行房间。
  - 未过：可绕行多视点；一种生成材质正确绑定。门/桌/杯已是 I23D 并 cook 进 `ng1-i23d`（`validation/ng1_catalog_furniture_cook.json`）；椅/窗仍是目录。I23D ≠ 整座酒馆。
  - SolarWM：NG-1 正式关闭。`src/solarwm/experiment.ts` → `closed-ng1`。[SOLARWM_REVIEW §8](../SOLARWM_REVIEW.md)。
- **P3 管家编辑与空间记忆** — 部分。校准 ≤5cm（committed-bounds）、pause 屏障、freeze 修订、切世界；10 条固定 NL 任务证据未成册。
- **P4 边玩边扩展** — 部分（调度器数据，不是故事通过）。`evaluateExpansionHit` + `scripts/probes/p4-expansion-hit.ts`：进程内走近花园缝标 ready（`validation/p4_expansion_hit.json`，`p4Pass: false`）。花园是脚手架。无 live UE 边界扩张。
- **P5 恢复、导出与整体验收** — 未开始。

## WorldRuntime 视口证据

- `../benchmarks/aiga-native-mesh/ng1-viewport-cook.json`：世界 `ng1-i23d` MERGE 侧容器 `bar_front` / `fireplace`，overlay spawn，`global.utoc` 未改。
- `../benchmarks/aiga-native-mesh/ng1-viewport-extend.json`：`courtyard-feature` 侧容器，actor 在门外 (6,0,−4)。
- `validation/a7_live_rollback.json`：scratch 世界 cook 中途失败，uninstall 卸本轮 pak，保护 `ng1-i23d` / `ue02-final`。
- `validation/a7_live_cook_publish.json`：scratch 世界 cook+spawn 成功。
- `validation/ng1_garden_shell_cook.json`：花园四块局部盒 cook+spawn（地板/西墙/东墙/南墙），`sourceLabel=scaffold-primitive`。
- `validation/ng1_garden_shell/`：墙体剪影可见。早期 stand 掉出天空是默认图碰撞未关，不是花园盒没 cook。
- `validation/ng1_garden_shell_stand13/ps_pawn_landed.json`：isolate 后占有 pawn 站在 `interior-garden-floor`，`movementMode=1`。脚手架盒。
- `validation/ng1_interior_shell_cook.json`：室内 SceneSpec 七盒 cook+spawn（地板/墙），`sourceLabel=scaffold-primitive`。
- `validation/ng1_interior_shell/ps_pawn_landed.json`：空间壳 `actorCollision=false` / `collisionEnabled=0`；占有 pawn 室内落地 `movementMode=1`，z≈100 cm。脚下是脚手架盒，不是壳网格。`walkProof=true`。不是世界模型碰撞。
- `validation/ng1_npc_proxy_cook.json`：夹具老板 `proxy-mesh` cook+spawn，`claimsWorldModelGeneration=false`。
- `validation/npc_pause_freeze.json`：pause 冻结 simTime 与代理 NPC 位移。
- `validation/offline_reopen.json`：无 mesh/space URL 重开空间包，壳哈希不变，暂停可走。
- `validation/constrained_extend.json`：compose 不重造已提交室内件；花园可走引用 stand13。
- `validation/checkpoints_ux.json`：HTTP 列出/恢复检查点；浏览器 `#checkpoint-panel` 点恢复，管家回「已退回上一个检查点」。
- `validation/ng1_catalog_furniture_cook.json`：门/桌/杯 I23D cook+spawn，`sourceLabel=http-native-mesh`，`claimsWorldModelGeneration=false`。椅仍是目录。
- `validation/p4_expansion_hit.json`：调度器走近花园缝标 ready。`p4Pass: false`。
- `validation/play_enter.json`：开流/isolate 后 `isolate_then_enter` 把占有 pawn 放到室内脚手架地板。pose `(600,500,170)` yaw −90（朝南门），2.5s 后落地 `(600,500,99.65)`，`movementMode=1`，`floor.hidden=true` 且仍有碰撞。`p1Pass: false`。不是空间壳碰撞，不是重建房间。
- `validation/play_look.json`：`POST /v1/host/look` 原地改 yaw（Carina `yawRad:0` → UE 90），z 仍 99.65、`movementMode=1`。不传送。不是 P1。
- `validation/isolate_viewport.json`：`POST /v1/host/isolate` live。隐藏 72 个默认图 actor，`viewmodeLit: true`，现含 `playEnter`。`p1Pass: false`。不是生成光照。
- `worldgen/ng1-space-shell-reparent-cook.json`：同一 hash `2cbef055…` force-reprepare + 卸旧侧容器再装。`isolated: true`。`p1Pass: false`。不是新 WorldGen。
- `validation/ng1_interior_shell_reparent4/`：posed-inside 静帧 + `luma.json`。`cameraPoseValid: true`。`from_door_looking_in` 能看清壳内地毯/壁炉/窗。不是 P1，不是生成光照。`ng1_interior_shell_reparent/` 相机在虚空，不要当室内证据。
- 正式视口 = 空间壳 overlay + I23D（吧台/壁炉/门/桌/杯）+ 花园/室内脚手架盒（isolate 后可站）。配了 `:18794` 即默认 cook + remount。

服务：Mac `http://127.0.0.1:18790/`；WorldRuntime `127.0.0.1:18794`；Pixel Streaming 玩家页 `http://192.168.5.16:8080/player.html`。

## 资产接口使用

保持现有 Carina 认证。上传为 multipart 的 file 字段（自包含 GLB，≤80MiB）及可选 source_label；响应含 assetId/contentHash/byteLength。上传并发 1，失败不自动重试。

```sh
python3 scripts/probes/graphics-validation.py upload --file /absolute/path/asset.glb
python3 scripts/probes/graphics-validation.py submit --mode hq_pbr --asset-id <uploaded-id> --frames 1
python3 scripts/probes/graphics-validation.py collect --job <job-id>
```

三步为离线协议 / 渲染验证，不是键鼠游戏循环。

## 历史（已被取代，仅存档）

2026-09-11：Windows 代理报告独立 Dev 包已产生、玩家页停在 CLICK TO START；全项目回归 209/209。该判断被 2026-09-12 LAN ICE + `framesDecoded` 证据取代。当时私有通道经中继，不是 LAN。
