# Agent 主链与 UE 运行时协作

2026-09-11 16:20 Asia/Shanghai。William 授权 Cursor 接手统筹。目标锁定，不因渲染支线改写。

## 锁定目标（不变）

自然语言驱动真实生成能力 → 可验证的三维候选 → 校准/固化到持久 world session → 游戏式探索和局部修改 → 重开保持一致 → 可编辑 GLB/贴图导出 → 受旧空间约束扩展。

产品是可控生成式世界 Agent，不是 UE demo。UE / Pixel Streaming / IoStore / PBR 测试件只是实现手段。资产库拼装、测试头盔、视频观测、fixture 均不得冒充世界模型产物。UE cooked 包只是派生运行缓存；可移植 GLB + 世界快照才是恢复/导出真相。

首版范围仍是 NG-1：一座约 12×10 米酒馆 + 相邻庭院；Windows RTX 5070 Ti + UE5 Pixel Streaming 为正式视口；Mac 为控制面。P0–P5 关口定义不降级。

## 文件所有权

- **Cursor（本机 + LAN SSH）**：Mac `src/`、测试、Windows 上的 UE / WorldRuntime / Blender、`runtimes/unreal/`、`docs/benchmarks/windows-rtx5070ti/`。通道：`ssh carina-win`（`192.168.5.16`）。
- **Grok CLI / Grok Bot：停派。** 2026-09-11 22:53 William 取消自动派活。已完成切片保留；不再 `grok_start`、不再给 ling 新任务，除非 William 再要求。
- 保留已有未提交修改。不 reset、不覆盖凭据、不重启正在跑的主服务、不提交 git，除非 William 明确要求。

## 本轮任务（2026-09-11 17:16）

| ID | 执行方 | 状态 | 有界目标 |
|----|--------|------|----------|
| AGENT-01 | Grok CLI | **Cursor 接受（导出切片）** | 已提交 GLB/PBR → 磁盘重开 → 建模导出保真。生产 provider 仍 mock。 |
| UE-03 | Grok Bot | **Cursor PARTIAL 接受** | `:18794` loopback 接受；BoomBox 视觉接受；碰撞仅 pose+截图，不算可玩 P0；PNG 未上 Mac。 |
| AGENT-02 | Grok CLI | **Cursor 接受（应用层切片）** `290797ce` / `b7afe3d0` exit 0 | 应用层：stage GLB → `spatial.placeAsset` → freeze → 重开 → `exportGlb` 保真。不是生成。 |
| UE-04 | Grok Bot | **Cursor 接受切片** | 18794 私有隧道 Mac HTTP 已通（`GET /v1/worlds/ue02-final` 200）；PNG 已上 Mac；API 文档 LIVE。HTTP ≠ WebRTC；P0 未过。 |
| UE-05 | Grok Bot | **Cursor PARTIAL（取景停）** | cook MERGE 日志 GREEN；果实画面不接受。禁止再 ToggleDebugCamera。 |
| UE-06 | Grok Bot | **Cursor PARTIAL** | 绕行画面不接受为地面可玩（起步天空；后两张是站在 BoomBox 上）。Windows `-R` keepalive 接受（Mac HTTP 仍 200/401）。未宣称 P0。 |
| AGENT-03 | Grok CLI | **Cursor 接受（契约切片）** `4bb225eb` / `c4856ed5` exit 0 | HTTP native-mesh + `runGeneration` stage GLB。测试替身 ≠ 世界模型。无 URL 仍 mock。 |
| AGENT-04 | Grok CLI | **Cursor 接受（描述切片）** `951d7e43` / `7f8e134d` exit 0 | NL → 持久 SceneSpec。heuristic/steward 计划 ≠ 三维生成。 |
| AGENT-05 | Grok CLI | **Cursor 接受（请求切片）** `ed0c9777` / `4c17973d` exit 0 | SceneSpec generate 路由驱动 HTTP POST，GLB 挂 `bar-front`。替身 ≠ 世界模型。 |
| AGENT-06 | Grok CLI | **Cursor 接受（校准切片）** `87dceda0` / `70c28d9b` exit 0 | NL/`spatial.calibrate` 补丁 SceneSpec 锚点并重开。不是生成。 |
| AGENT-07 | Grok CLI | **Cursor 接受（扩展切片）** `351d0c52` / `1918aca5` exit 0 | `generation.extend` 把 courtyard 写入持久 SceneSpec。不是生成。 |
| UE-07 | Grok Bot | **Cursor 接受（LAN SSH）** | Mac `ssh carina-win` 通；18793/18794 仍 loopback。不是 P0。 |

Cursor 验收：只认真实 diff 与可复现证据。六阶段目标不被子任务替代。**2026-09-11 22:53 起不再自动派 Grok CLI / Grok Bot。**

## 当前已知主链缺口

- AGENT-01 导出保真 + AGENT-02 应用层 stage/place + AGENT-03 HTTP native-mesh 契约 + AGENT-04 持久 SceneSpec + AGENT-05 SceneSpec 驱动 HTTP 请求 + AGENT-06 计划校准 + AGENT-07 计划层 courtyard 扩展已落地。无 `CARINA_MESH_PROVIDER_URL` 时 `session.create` 仍 mock 酒馆。测试替身 / AABB playable scaffold / SceneSpec JSON / mock 花园 ≠ 世界模型产物。
- production 无真实三维后端（BLOCKED）。legacy LingBot `nativeMesh: false`。不得把 mock 酒馆或 SceneSpec 写成世界模型已生成。
- William 回家：UE-07 LAN OpenSSH **已通**（`ssh carina-win` → `DESKTOP-RLADDRR`）。`:18793`/`:18794` 仍 `127.0.0.1`。Blender **4.5.13 LTS** 已装到 `C:\Program Files\Blender Foundation\Blender 4.5\blender.exe`。PS2 `8080` 仍只绑 loopback，LAN `192.168.5.16:8080` 不通。Mac WebRTC 仍 HARD_BLOCK。碰撞绕行仍 PARTIAL（UE-06）。
- 没有可调用的真实三维生成后端时，记为阻塞并走有证据的替代路线，不把 fixture 验收称作生成成功。


## UE-02 follow-up AFTER LIVE (2026-09-11 16:23)

Bot Windows: pbr-orbit **PARTIAL** (Material_MR shader-clean; full-object framing blocked by HardRef scale=100). Collision **PARTIAL→instrumented** (BlockAll move/remove timings + hitch). `:18794` LIVE; `:18793` untouched. Evidence under `docs/benchmarks/windows-rtx5070ti/validation/ue02_*`. No Mac src changes.
