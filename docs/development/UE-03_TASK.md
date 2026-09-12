# UE-03 — 交给 Grok Bot / ling（Windows UE）

2026-09-11 16:20 Asia/Shanghai。Cursor 接手统筹。目标锁定见 `docs/development/COORDINATION.md`。不要改 Mac `src/`。

产品目标不变：自然语言 → 真实生成 → 校准固化 → 可玩持久世界 → 导出。UE 只是运行缓存。本轮不要新开截图关卡，不要为 Mac VPN/ICE 停工。

## 已接受的 UE-02 声明（需用本轮证据收口，不重做头盔灯光）

Bot 16:05 报：`:18794` LIVE；Avocado `85ae91e60ed519f5` + BoomBox `84c32a396684d0b3` 非硬引用；spawn/move/delete 不 LoadMap；Euler XYZ 弧度；opaque revision。Win 本机 PS2 仍 GREEN。sidecar `:18793` 保持。

仍未过 Cursor 验收：碰撞绕行、完整正侧/绕行 PBR、shaderMergeOk=false、`:18794` 实际监听范围、Mac 镜像可复建。

## 本轮必须交付（按顺序，做完就停）

1. **碰撞绕行（可玩性，不是 API 字段）**  
   在已激活的 Avocado 或 BoomBox 上 BlockAll。Win 本机 PS2 录：走向物体停下、侧向绕开。记录截图 + 前后 transform + hitch 是否发生。没有绕行证据不算碰撞完成。

2. **非对称物件视觉**  
   对 Avocado 或 BoomBox（不要再切头盔近景）：正面、侧面、短绕行。须是 Material_MR / 真实 PBR，不是 BasicShapeMaterial。日志证明无 Missing-shader / Default 回退。

3. **WorldRuntime 绑定**  
   测 `18794` 实际 bind。若在 `0.0.0.0`，改为 loopback 或文档写明仅 Private/LocalSubnet，并说明谁能连。不要把 HTTP 可达当成 WebRTC。

4. **shader merge**  
   `shaderMergeOk=false` 要么修到新资产可用，要么在合同里标 **REQUIRED host cook**，失败时保持上一版场景。禁止再次全量替换 ShaderArchive（已知 D3D12 residency fatal）。

5. **Mac 镜像**  
   同步 `runtimes/unreal/` 可移植源（缺 Content 要写明）、`docs/benchmarks/windows-rtx5070ti/UE02_CONTRACT_SECTION.md` 与 `validation/ue02_*.json`、本任务证据 JSON。

## 不要做

- 不改 Mac `src/`。
- 不为 Mac ICE / VPN 改网络、关 V2BOX、开公网端口。
- 不再为 DamagedHelmet 开灯光精修或新测试关卡。
- 不把测试 glTF 称为世界模型生成。
- 不重启 AIGA / llama；不装 sshd；不 reboot。
- 不宣称 P0/P1 完成。P0 仍差 Mac 媒体；P1 是酒馆游玩。

## 证据

写 Windows `C:\Users\wuyw\carina-rtx-validation\logs\ue03_closeout.json`，并镜像到 Mac `docs/benchmarks/windows-rtx5070ti/validation/ue03_closeout.json`。更新 `PROGRESS.md`、`P0_RUNTIME_STATUS.md`、合同「Proven vs blocked」。

完成后停，等 Cursor 验收。不要自动开始酒馆美术。
