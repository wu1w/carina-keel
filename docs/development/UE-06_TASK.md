# UE-06 — 交给 Grok Bot / ling（Windows UE）

2026-09-11 20:48 Asia/Shanghai。Grok Bot.app **没崩**（pid 40638 仍在）。你停着是因为 Cursor 让 UE-05 取景切片停等。现在继续。不要改 Mac `src/`。

目标锁定见 `docs/development/COORDINATION.md`。产品仍是生成式世界 Agent，不是 UE demo。不要宣称 P0/P1。

## UE-05 判定（Cursor，2026-09-11 18:50）

| 项 | 判定 |
|----|------|
| host cook MERGE，禁止全量 ShaderArchive 替换 | **接受为日志切片**（`shaderMergeOk=true` 自称；BoomBox 仍可玩） |
| Avocado 画面不是 Default / 能认出果实 PBR | **不接受**。`ue05_avocado_*_framed.png` 是天空/黑块/碎片。你自报 `fruit_pbr_visible_in_stills=false` 同意 |
| ToggleDebugCamera | **禁止再用**（D3D12 residency） |
| 隧道 | Mac `-L` 会被 VPS 掐；Cursor 会重开 Mac 侧。Windows `-R` 必须自己保活 |

本轮 **不要** 再拍 Avocado、不要重 cook、不要 ToggleDebugCamera。

## 本轮必须交付（按顺序，做完就停）

1. **可玩绕行（地面，不是天空）**  
   在已打包 CarinaPS / 当前可玩场景里，让 pawn **走在地面上**绕 BoomBox（或同场景可走碰撞体）一小圈。  
   - 允许：`player_pose` / WorldRuntime 移动 / 正常 PlayerController WASD（不要 `-RenderOffScreen` 若它必然锁天空）。  
   - 禁止：ToggleDebugCamera、飞天、只截人偶+天空。  
   - 证据：Mac `docs/benchmarks/windows-rtx5070ti/validation/ue06/` **至少 3 张** HighResShot 或等价 still：起步接触、侧移后、绕后。画面里要有 **地面或物体接触**，不能三张都是天空。记下 pose 前后 delta。

2. **Windows → VPS `-R` 保活**  
   VPS 已两次 `closed by remote host`（~19:52、~20:29）。  
   - `:18793` 与 `:18794` 各一条 `-R 127.0.0.1:PORT:127.0.0.1:PORT vps`，不要互抢。  
   - 断线自动重连（循环或等价）。pid 写 `logs/tunnel_win_to_vps.pid` 与 `logs/tunnel_win_to_vps_18794.pid`。  
   - 服务必须 `127.0.0.1` LISTENING。不装 sshd，不开公网，不 reboot，不关 V2BOX。  
   Cursor 负责 Mac `-L`。你不要 ssh 进 Mac。HTTP ≠ WebRTC。

3. **证据 JSON**  
   Windows `C:\Users\wuyw\carina-rtx-validation\logs\ue06_closeout.json`  
   镜像 Mac `docs/benchmarks/windows-rtx5070ti/validation/ue06_closeout.json`。  
   Proven vs blocked 写清：绕行是否仍 PARTIAL；不要宣称 P0。

## 不要做

- 不改 Mac `src/`。不重 cook Avocado。不用 ToggleDebugCamera。
- 不酒馆美术、不新开头盔关卡、不为 Mac ICE/VPN 停工。
- 不把 glTF 测试件称为世界模型生成。
- 不碰 AIGA/llama。

完成后停，等 Cursor 验收。
