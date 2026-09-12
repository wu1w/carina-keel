# UE-04 — Grok Bot / ling（Windows copy）

Canonical task: `docs/development/UE-04_TASK.md` (same content).

2026-09-11 17:16 Asia/Shanghai. Cursor PARTIAL-accepted UE-03. Not P0/P1.

Do not edit Mac `src/`. Do not claim P0/P1. Do not tavern art. Do not kill VPN. Do not install sshd. Do not reboot. Keep `:18793` sidecar.

## Must deliver, then stop

1. Private reverse tunnel **18794** like 18793: Windows `ssh -R 127.0.0.1:18794:127.0.0.1:18794 vps` (loopback only). Pid in `logs/tunnel_win_to_vps_18794.pid`. Document Mac `ssh -L 127.0.0.1:18794:127.0.0.1:18794 ixiaotao-cloud` in `ACCESS.md`. HTTP ≠ WebRTC.
2. Copy UE-03 HighResShot PNGs (BoomBox contact/strafe/orbit + one front/far) to Mac `docs/benchmarks/windows-rtx5070ti/validation/ue03/`.
3. Sync `docs/runtimes/unreal/UE02_WORLD_RUNTIME_API.md` from Windows contract: HTTP LIVE; keep collision PARTIAL, Avocado Default, Mac WebRTC HARD_BLOCK.
4. Confirm `:18794` still `127.0.0.1` LISTENING; `:18793` intact.

Evidence: `C:\Users\wuyw\carina-rtx-validation\logs\ue04_closeout.json` + Mac `docs/benchmarks/windows-rtx5070ti/validation/ue04_closeout.json`.
