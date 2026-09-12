# UE-04 — 交给 Grok Bot / ling（Windows UE）

2026-09-11 17:16 Asia/Shanghai。Cursor 已 **PARTIAL 验收 UE-03**，不是 P0/P1 完成。目标锁定见 `docs/development/COORDINATION.md`。不要改 Mac `src/`。

产品目标不变：自然语言 → 真实生成 → 校准固化 → 可玩持久世界 → 导出。UE 只是运行缓存。本轮不要酒馆美术，不要为 Mac ICE/VPN 停工。

## UE-03 验收（Cursor，2026-09-11 17:16）

| 项 | 判定 |
|----|------|
| `:18794` bind `127.0.0.1` 非 `0.0.0.0` | **接受**（HTTP ≠ WebRTC） |
| `shaderMergeOk=false` 标 REQUIRED host cook；禁止全量 ShaderArchive 替换 | **接受为合同**，不是实现完成 |
| BoomBox 非 BasicShape PBR 正侧/绕行 | **接受为视觉切片**；Avocado Default Material **不接受**为 PBR |
| 碰撞绕行 | **PARTIAL**：`player_pose`+HighResShot 可看接触；WASD `-RenderOffScreen` 仍天空。**不算可玩 P0** |
| Mac 镜像 | JSON/合同已同步；**HighResShot PNG 仍只在 Windows 盘** — 本轮必须拷过来 |
| P0 / P1 | **未完成。禁止宣称完成。** |

## 本轮必须交付（按顺序，做完就停）

1. **私有隧道 `:18794`（照抄 `:18793` 模式）**  
   Windows 已有：`ssh -R 127.0.0.1:18793:127.0.0.1:18793 vps`（ProxyJump `m920x`）。  
   再开一条 **同样约束** 的 reverse：`127.0.0.1:18794` → VPS loopback `127.0.0.1:18794`。  
   - 只绑 loopback。不装 Windows sshd。不开公网端口。不改防火墙到 Public。不关 V2BOX。  
   - `:18793` sidecar 必须保持。不要复用/抢 18793。  
   - 写 pid 到 Windows `logs/tunnel_win_to_vps_18794.pid`。  
   - 更新 `docs/benchmarks/windows-rtx5070ti/ACCESS.md`：给出 **Mac** 应对的  
     `ssh -L 127.0.0.1:18794:127.0.0.1:18794 ixiaotao-cloud`  
     Cursor 会在 Mac 上执行这条 local forward。你不要试图 ssh 进 Mac。  
   - HTTP 隧道 **不是** WebRTC 证明。写进证据 JSON。

2. **把 UE-03 截图拷到 Mac 仓库**  
   至少拷这些（文件名保持可认）：  
   - BoomBox 接触 / 侧移 / 绕行各一张  
   - BoomBox 正面或远绕一张  
   放到 Mac `docs/benchmarks/windows-rtx5070ti/validation/ue03/`。  
   不要拷整个 logs 目录。不要声称 Cursor 已经看过你没拷过来的 PNG。

3. **同步过时的 Mac 合同副本**  
   `docs/runtimes/unreal/UE02_WORLD_RUNTIME_API.md` 仍写 Generic HTTP **NOT LIVE**。以 Windows `UE02_CONTRACT_SECTION.md` 为准改成 LIVE（写明 smoke id、Avocado/BoomBox hash、Euler XYZ、loopback bind）。诚实保留：碰撞 PARTIAL、Avocado shader 缺、Mac WebRTC HARD_BLOCK。

4. **Windows 本机再确认一次** `:18794` 仍 LISTENING `127.0.0.1`，sidecar `:18793` 仍在。不要重启 AIGA/llama，不要 reboot。

## 不要做

- 不改 Mac `src/`。
- 不宣称 P0/P1 完成。
- 不新开头盔灯光关卡、不酒馆美术。
- 不为 Mac ICE 改网络。
- 不把测试 glTF 称为世界模型生成。
- 不全量替换 ShaderArchive。
- 本轮 **不要** 做 Avocado host cook，除非 1–3 已完成且你还能在不停机约束内做；优先隧道 + PNG。

## 证据

写 Windows `C:\Users\wuyw\carina-rtx-validation\logs\ue04_closeout.json`，并镜像到 Mac `docs/benchmarks/windows-rtx5070ti/validation/ue04_closeout.json`。更新 `ACCESS.md`、`PROGRESS.md`、合同「Proven vs blocked」。

完成后停，等 Cursor 验收。
