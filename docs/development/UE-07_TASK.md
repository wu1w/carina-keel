# UE-07 — 交给 Grok Bot / ling（Windows 内网远程）

2026-09-11 22:36 Asia/Shanghai。William **人在家**，Mac 已回到 `192.168.5.0/24`（`en0=192.168.5.31`）。Cursor 已 ping 通 `192.168.5.16`（路由走 `en0`，不是 VPN）。**所有 TCP 端口关闭**（22 / 3389 / 8080 / 18793 / 18794）。VPS 隧道可以暂时留着；本刀目标是让 Cursor **直接 SSH 进这台 Windows**，从而自己跑 UE / Blender / WorldRuntime，不必每步贴 ling。

William **当场批准**安装 Windows OpenSSH Server。此前「不装 sshd」作废。

产品目标不变：生成式世界 Agent，不是 UE demo。不要宣称 P0/P1。不要改 Mac `src/`。不要 ToggleDebugCamera。不要重 cook Avocado。不要 reboot。不要关 V2BOX。不要碰 AIGA/llama。不要把 18793/18794 绑到公网或 `0.0.0.0` 无防火墙。

## 要做的（按顺序，做完就停）

1. **确认本机就是 DESKTOP-RLADDRR / `wuyw` / `192.168.5.16`**  
   把真实 LAN IPv4 写进证据。若 IP 变了，写新地址，不要假装还是 `.16`。

2. **安装并启动 OpenSSH Server**  
   ```
   Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
   Start-Service sshd
   Set-Service -Name sshd -StartupType Automatic
   ```
   需要管理员就提权做完。**不要 reboot**。若必须 reboot 才能装完，停并写进 JSON，等 Cursor。  
   `sshd_config`：`PasswordAuthentication no`，`PubkeyAuthentication yes`。sshd 监听 LAN（`0.0.0.0:22` 或 `192.168.5.16:22` 均可）。  
   **禁止**开密码登录。**禁止** Public 配置文件放行 22。

3. **只收 Mac 这把钥匙**（原样写入 `C:\Users\wuyw\.ssh\authorized_keys`，ACL 仅 SYSTEM + wuyw）：
   ```
   ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKGI3EzSiBZRco6Kmqv6m23MhdQ2w5QuvfYTZOwN0OPq carina-mac-lan-WilliamdeMacBook-Pro
   ```
   权限：`.ssh` 与 `authorized_keys` 不要 Everyone 可写。

4. **防火墙：仅 Private + LocalSubnet**  
   新建规则 `CarinaSSH-LAN`：Inbound TCP 22，Profile=Private，RemoteAddress=LocalSubnet。  
   把 `192.168.5.16` 那块网卡 Network Category 设为 **Private**（若现在是 Public，这就是 TCP 全关的原因）。  
   不要新建 Public 规则。不要改 V2BOX。不要给 `:18793`/`:18794` 开 LAN。它们继续 `127.0.0.1`。Cursor 会用 SSH `-L`。

5. **桌面快照脚本**（Cursor 看 UE/Blender 窗口用）  
   `C:\Users\wuyw\carina-rtx-validation\scripts\desktop_shot.ps1`  
   无参：把主屏截成 PNG，写到 `C:\Users\wuyw\carina-rtx-validation\logs\desktop_shot.png`。不要弹窗。Cursor 将 `scp carina-win:.../desktop_shot.png`。

6. **探路，不要启动新编辑器**  
   报告（写入 JSON，不要只口头）：  
   - `blender.exe` 全路径（若有）  
   - `UnrealEditor.exe` / 已打包 `CarinaPS` 可执行文件全路径（若有）  
   - WorldRuntime `:18794` 是否仍 `127.0.0.1` LISTENING  
   - sidecar `:18793` 是否仍 `127.0.0.1` LISTENING  
   **不要**为了本刀新开 UE Editor 或 Blender GUI。SSH 通了 Cursor 自己开。

7. **证据**  
   Windows `C:\Users\wuyw\carina-rtx-validation\logs\ue07_lan_ssh.json`  
   镜像 Mac `docs/benchmarks/windows-rtx5070ti/validation/ue07_lan_ssh.json`  
   并更新 `docs/benchmarks/windows-rtx5070ti/ACCESS.md`：OpenSSH Server = LAN Private/LocalSubnet；公网仍关。  
   JSON 至少：`lanIPv4`, `sshdListening`, `sshdListenAddress`, `firewallRule`, `nicProfile`, `passwordAuth`, `pubkeyInstalled`, `blenderPath`, `unrealEditorPath`, `carinaPsPath`, `port18794`, `port18793`, `rebootUsed`。

## 不要做

- 不装 TeamViewer / AnyDesk / RustDesk / Sunshine。本刀只要 OpenSSH。
- 不强制开 RDP（Cursor 没有 Windows 密码）。已开着可保留，不要为它改 Public 防火墙。
- 不把 sidecar / WorldRuntime 改成 LAN bind。
- 不宣称 P0/P1、不酒馆美术、不新开头盔关卡、不用 ToggleDebugCamera。
- 不改 Mac `src/`。

完成后停。Cursor 会从 Mac `ssh -o BatchMode=yes carina-win hostname` 独立验收。SSH 通了才算完，服务自报不够。
