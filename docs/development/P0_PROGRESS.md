# 六阶段实施进度

更新：2026-09-12。总计划见 [NG-1](../NEXT_GENERATION_PLAN.md)。

## 当前状态

**P0 工程关口通过（样板≠生成）。** P1 CC0 酒馆已按世界烘焙网格 identity spawn 组装成 12×10×4 m 房间；天花 Unlit 与门口 Lit 能看到木纹，室内仍暗。**未写 NG-1 完成，未写 P2 生成工厂已通，不是世界模型生成。** 观感最终句仍等 William。`CARINA_MESH_PROVIDER_URL` 未设，真实三维生成仍 BLOCKED。

主服务：http://127.0.0.1:18790/。WorldRuntime 仅 `127.0.0.1:18794`。Pixel Streaming 玩家页 `http://192.168.5.16:8080/player.html`。产品视口默认该 LAN PS2，不是 WebGL 粗模。

### 2026-09-12 P0/P1 关口（Cursor 出门自动跑）

- P0-T：Mac 契约测试（WorldRuntime / 上传诚实 / 导出 `claimsWorldModelGeneration=false`）。
- P0-1：LAN PS2 ICE + `framesDecoded` 增量。证据 `docs/benchmarks/windows-rtx5070ti/validation/p0/lan_ps2.json`。
- P0-2：脚手架 `8dd45448bbac70a0` prepare/install/activate/spawn。不是 Avocado，不是酒馆画质。
- P0-3：窗口化（非 RenderOffScreen）地板 WASD。证据 `validation/p0/wasd.json`。
- P1-T：墙滑移、门外距离 `too_far`、杯子无幽灵、`generation.stop` 后仍可 `player.act`；`src/play` 状态机 `connecting/live/disconnected/reconnecting`，HQ fallback 恒为 `none`。
- P1-1：`src/play` + `app.html` 主视口 PS2；断开 overlay 与「生成已停」文案分开。
- P1-2：Windows 无 Quixel/Fab；Blender 4.5.13 + ambientCG CC0 组 12×10 m GLB（`tavern_pbr.glb`，assetId `629373db5bc61c4c`）。host MERGE（AlwaysCook 只加 `tavern_pbr`，未整包替换 ShaderArchive，`global.utoc` 未改）。
- P1-3：14/14 spawn。根因：Interchange 网格已含世界坐标，再按物体中心 spawn 会双倍平移；packaged 默认 Static mobility 下 `SetStaticMesh` 不粘。修复：identity spawn + Movable 后再赋网格。门/杯 native interact（`moveFallback=false`）。`isolate_carina` 藏 ThirdPerson 模板。证据 `validation/p1/door_inside_lit2.png`、`overhead_unlit.png`。室内仍暗，**未写贴图全面过关**。

不得把该 CC0 样板、隔夜 34KB `tavern.glb`、Avocado/BoomBox 写成世界模型产物。

## 已通过的检查

### 2026-09-11 历史记录（已被 09-12 P0 工程关口取代，原文保留）

Windows代理当时报告独立Dev包已产生，8080玩家页和8888推流信令可用；玩家页仍停在CLICK TO START，尚无连续视频帧证据。该判断已被 2026-09-12 Mac LAN ICE + `framesDecoded` 证据取代，见 `validation/p0/lan_ps2.json`。

- 全项目回归209/209通过，typecheck与build通过。
- 此后增加实际HTTP应用鉴权测试，相关图形/资产测试17/17通过，Python探针语法检查通过；该额外测试后未重复全量回归。
- 真实上传assetId `ac37c156cee5773d`，查询哈希一致，第二次上传去重；在正式18790端口复核成功。
- 首次真实渲染任务确认读取上传GLB，不是内置样板；画面仍是粗模，不能作为P1画质通过。
- 修复后任务c380f2635ff9经主服务收集，benchmark帧数1、frame_timings长度1、frame_0000.png唯一帧产物；资产路径为相对路径，来源标签不再误标Polyhaven。见[单帧复核](evidence/p0-single-frame.json)。

证据：[上传](evidence/p0-upload.json)、[全量回归](evidence/p0-tests.txt)、[图形与鉴权回归](evidence/p0-graphics-tests.txt)、[初次渲染问题](evidence/p0-first-render.json)。

## 资产接口使用

保持现有Carina认证。上传为multipart的file字段（自包含GLB，≤80MiB）及可选source_label；响应含assetId/contentHash/byteLength。上传并发1，失败不自动重试。

通过现有探针执行，无需暴露Windows凭据：

```sh
python3 scripts/probes/graphics-validation.py upload --file /absolute/path/asset.glb
python3 scripts/probes/graphics-validation.py submit --mode hq_pbr --asset-id <uploaded-id> --frames 1
python3 scripts/probes/graphics-validation.py collect --job <job-id>
```

CARINA_TOKEN由运行环境提供。三步为离线协议/渲染验证，不是键鼠游戏循环。

## 外部依赖与当前分工

用户已确认Windows侧完成，无需重复请求安装许可。Grok Bot负责Windows工程、打包、信令/媒体验证及资产热加载；Codex负责Mac业务集成与结果复核。要求同步RUNTIME_CONTRACT.md和可移植工程源码；不把代理文字报告当作完整验收证据。

当前私有通道经中继，不是LAN。正式LAN延迟验收须使用真实LAN路径；还没有WebRTC媒体/输入闭环，不把HTTP耗时充当游戏延迟。

## 下一项验收

14:23交付已证明Windows串流中头盔几何可见，但使用BasicShapeMaterial，原PBR缺SM6 shader；测试关卡硬引用模型，仍非通用动态加载。根据用户续办指令，已让Grok继续：修复原PBR → 通用运行时资产入口（两个未硬引用资产，不换关卡/重启宿主）→ 碰撞与移除/移动 → Mac媒体连通。不得以几何轮廓截图或只剩网络作为收尾依据。见[当前资产证据](../benchmarks/windows-rtx5070ti/validation/p0_glb_spawn_bp.md)、[Windows状态](../benchmarks/windows-rtx5070ti/P0_RUNTIME_STATUS.md)。
