# CarinaPS

Windows source of truth: `G:\carina-ue\CarinaPS`

- EngineAssociation: 5.8 (`G:\UE_5.8` / 5.8.2)
- Walkable: ThirdPerson restored from `G:\UE_5.8\Templates\TP_ThirdPersonBP` → `/Game/ThirdPerson/Lvl_ThirdPerson`
- **PixelStreaming2 enabled**; classic PixelStreaming **off**
- Packaged: `G:\carina-ue\CarinaPS\Packaged\Windows\CarinaPS\Binaries\Win64\CarinaPS.exe` (~2026-09-11 10:53 Asia/Shanghai)
- Signalling: PS2 WebServers `UE5.8-0.1.0`; SFU **off** (`sfu_port=0` / 8889 off)
- Launch scripts (`G:\carina-ue\CarinaPS\scripts\`):
  - Loopback (Win GREEN): `start_sws_ps2_loopback.bat` + `start_streamer_ps2.bat` (`-PixelStreamingConnectionURL=ws://127.0.0.1:8888`)
  - LAN (Mac when on `192.168.5.0/24`): `start_sws_ps2_lan.bat` / `restart_ps2_stack_lan.bat` (`public_ip=192.168.5.16`)
  - `--peer_options_file peer_options.json` (empty-string `--peer_options` caused RTCConfiguration bug)
- Firewall helper: `firewall_ps2_lan_private.ps1` — Private profile + LocalSubnet only (no public internet)
- Mac tree: portable text sources only (no Content binaries / caches / packages / credentials)
- **Do not claim Mac WebRTC from HTTP SSH tunnel alone** — need ICE/UDP on LAN

See `/Users/william/world/docs/benchmarks/windows-rtx5070ti/RUNTIME_CONTRACT.md`


## Portable Mac mirror notes (UE-03)

- Mirrored: `Config/`, `.uproject`, `README`, `Source/CarinaPS/*` (incl. WorldRuntime IPC: spawn/move/destroy/activate/player_pose/highresshot).
- Mirrored separately: `runtimes/unreal/world_runtime/*.py` (HTTP `:18794` service sources).
- **Not mirrored:** `Content/` (uasset/umap), `Saved/`, `Intermediate/`, `Binaries/`, `Packaged/`, caches, credentials.
- Windows SoT remains `G:\carina-ue\CarinaPS` + `C:\Users\wuyw\carina-rtx-validation\world_runtime`.
- `shaderMergeOk=false` ⇒ **REQUIRED host cook** of new materials into main CarinaPS ShaderArchive (MERGE only; never full side ShaderArchive replace).
