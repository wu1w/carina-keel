# P0 开发基线与进展

日期：2026-09-11。P0 进行中，尚未通过完整运行时关口。

## 可恢复基线

修改前源码备份：`/Users/william/.local/share/carina/backups/20260911-085148/`。

包含 `workspace.tar.gz`、记录原HEAD/文件数/归档SHA256的 `manifest.json` 与 `git-status.txt`。385个Git跟踪及非忽略未跟踪文件，归档33,101,903字节。未改动或清理已有大量未提交工作。备份不包含Git忽略的运行数据、模型权重或凭据；它是源码基线，不是运行世界的一致快照。

恢复时先核对manifest中的归档哈希，解压到另一个目录比较，不直接覆盖现工作区。世界数据仍在原应用数据目录，未迁移。

## 已有代码的复用边界

- sessions/registry：世界注册和身份代码已有；Windows会话租约及串流连接尚未接入。
- pack/spatial：空间版本、对象和资产处理已有；高质量资产及引擎格式转换仍需实际验收。
- jobs/queue：已有epoch/revision/readSet适用性检查；不能据此宣称GPU任务持久化与崩溃恢复全部完成。
- runtime/create-runtime：当前TypeScript运行时20Hz、玩家半径/速度和AABB碰撞；计划迁移至游戏引擎后要重新确定状态权威，不能两边同时推进同一对象。
- graphics-service：原离线验证代理已有；P0新增内容寻址资产上传/查询及assetId渲染请求。与未来实时游玩通道分开。
- app.html：正式视口仍是旧绘制路径，尚未完成UE/串流替换，当前画质不符合P1验收。

## 本机已经实施

1. 新增 `POST /v1/graphics/assets/glb`，multipart字段file与可选source_label；单GLB≤80MiB，限定并发1、实际请求体大小和上传超时。
2. GLB头/块布局/JSON资产版本校验，要求资源自包含；外部URI在进入Windows前拒绝。此检查不是拓扑或材质质量验收。
3. 本机计算完整SHA256，与返回contentHash/assetId/byteLength核对。查询元数据只返回允许字段；Windows密钥仍仅由服务器读取。
4. hq_pbr接收assetId或历史assets/...glb相对路径，必须且只能指定一个；拒绝不相关模式的资产字段。不自动重试写入请求。
5. graphics-validation.py新增upload与--asset-id，可重复执行上传、查询、去重和渲染链路。
6. 主服务18790已重启加载改动，保持原数据目录和模型配置；临时18794服务仅用于隔离验证。

## 实际验证

代码验证：209项测试、typecheck和build通过；随后新增真实应用鉴权回归，最新结果见P0_PROGRESS中的最终记录。

真实Windows协议验证输入为现有粗模0,0.glb，只验证链路，不作为画质样板。assetId `ac37c156cee5773d`：初次上传deduped=false，再次上传deduped=true；完整哈希与GET元数据一致。主服务18790重复上传与查询也通过。

离线渲染job `847301ebc52c` 确认used_bundled_scene=false，使用该上传资产。人工查看返回图像仍为粗模平涂，画质未通过。发现请求frames=1但实际生成8帧，以及benchmark含绝对路径/错误来源标签；Windows工作器已修复，新job `c380f2635ff9` 经正式主服务复核：实际1帧、计时记录1条、路径相对化且来源标签正确。

协议原始报告：`/tmp/carina-p0-validation/` 和 `/tmp/carina-p0-live/`。重要摘要另存项目开发目录，不能将/tmp作为长期唯一证据。

## Windows与连接限制

见 `../benchmarks/windows-rtx5070ti/P0_RUNTIME_STATUS.md`。Epic Launcher已完成安装并启动；后续Epic登录/协议操作需用户完成。已提示用户，依赖阶段尚不能继续。

当前恢复通道通过私有SSH中继并仅绑定loopback；不是LAN直连。因此当前HTTP往返耗时不能用于证明LAN输入到显示80–120ms目标，更不能用于推断WebRTC媒体性能。

P0完整通过仍需：实际UE打包程序、浏览器连续键鼠/断连释放、打包后资产加载与PBR/碰撞正确、明确版本与启动命令。P1–P5均未通过，不把接口完成算作下一代完成。
