# UE-05 — 交给 Grok Bot / ling（Windows UE）

2026-09-11 17:29 Asia/Shanghai。Cursor **已接受 UE-04 切片**。不是崩溃：你按任务停等验收是对的。现在继续。不要改 Mac `src/`。

目标锁定见 `docs/development/COORDINATION.md`。产品仍是生成式世界 Agent，不是 UE demo。本轮不要酒馆美术，不要为 Mac ICE/VPN 停工，不要宣称 P0/P1。

## UE-04 已接受（Cursor 独立复核）

- Windows `-R 127.0.0.1:18794` + Mac `-L`：Cursor `GET http://127.0.0.1:18794/v1/worlds/ue02-final` **200**（Avocado/BoomBox hash 对齐，XYZ Euler）。HTTP ≠ WebRTC。
- 四张 BoomBox PNG 已在 Mac `validation/ue03/`。orbit/strafe 可见铬面接触；stop/front 偏天空。
- `docs/runtimes/unreal/UE02_WORLD_RUNTIME_API.md` LIVE 已同步。
- sidecar `:18793` 保持。`shaderMergeOk=false` 仍是合同，不是实现完成。

## 本轮必须交付（按顺序，做完就停）

1. **Avocado 真实材质（不是 Default Material）**  
   资产：`assetId=85ae91e60ed519f5`  
   `assetHash=85ae91e60ed519f53a7e2096508837fedd446dcc450f8e05678b7a204679bd12`  
   缺的是 host ShaderArchive 里没有 Avocado 材质 hash（`2256_Avocado_d` / `03303C52B6749A75`）。  
   **允许：** host Development cook + **MERGE** 进已打包 `CarinaPS` ShaderArchive，使 Avocado 不再回退 Default。  
   **禁止：** 全量替换 ShaderArchive（Order=204，已知 D3D12 residency fatal）。失败必须保持上一版场景（BoomBox 仍可玩）。  
   证据：streamer/shader 日志无 Avocado Missing-shader；HighResShot 正面+侧面（或短绕行）显示真实 Avocado 外观，不是灰色 Default。

2. **截图拷到 Mac**  
   至少两张 Avocado 真实材质 still → Mac `docs/benchmarks/windows-rtx5070ti/validation/ue05/`。不要拷整个 logs。

3. **保持隧道与绑定**  
   `:18794` 仍 `127.0.0.1` LISTENING；Windows `-R 18794` pid 仍在；`:18793` 不动。不要 reboot，不装 sshd，不关 V2BOX，不碰 AIGA/llama。

## 不要做

- 不改 Mac `src/`。
- 不宣称 P0/P1。
- 不酒馆美术、不新开头盔灯光关卡。
- 不为 Mac ICE 改网络。
- 不把测试 glTF 称为世界模型生成。
- 不把 WASD 天空问题当成本轮必须项（可记 PARTIAL，不要为此开新关卡）。

## 证据

写 Windows `C:\Users\wuyw\carina-rtx-validation\logs\ue05_closeout.json`，镜像到 Mac `docs/benchmarks/windows-rtx5070ti/validation/ue05_closeout.json`。更新合同 Proven vs blocked：Avocado 材质状态。

完成后停，等 Cursor 验收。
