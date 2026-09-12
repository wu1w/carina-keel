# CARINA-RTX-20260910 — Access channels (no secrets)

## Current (2026-09-11)

| Channel | Status |
|---------|--------|
| Grok Bot local-exec (DESKTOP-RLADDRR) | Parked (no new dispatch 22:53) |
| Windows OpenSSH **client** | Present |
| Mac ↔ home LAN (`192.168.5.16`) | **GREEN** — Mac `en0=192.168.5.31`; Cursor `ssh carina-win` pubkey OK |
| Blender | **Installed** 2026-09-11 — `C:\Program Files\Blender Foundation\Blender 4.5\blender.exe` **4.5.13 LTS** |
| Private VPS tunnel | Still up as fallback (`-R`/`-L` 18793/18794). Prefer LAN SSH when home. |
| Public / firewall for `:18793` | Intentionally not created; sidecar/WorldRuntime stay **loopback only** |
| Windows OpenSSH **Server** (sshd) | **Installed** — listen `0.0.0.0:22`; password auth off; Mac ed25519 only |
| Mac Remote Login / sshd `:22` | Closed |

Sidecar binds **`127.0.0.1:18793` only**; WorldRuntime binds **`127.0.0.1:18794` only** on Windows (loopback).

## Active private hop (restore)

**Windows** (detached; pid in `logs/tunnel_win_to_vps.pid`):

```bat
ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -R 127.0.0.1:18793:127.0.0.1:18793 vps
```

(`Host vps` uses `ProxyJump m920x`.)

**Mac**:

```bash
ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:18793:127.0.0.1:18793 ixiaotao-cloud
```

Then on Mac: `http://127.0.0.1:18793/health` with Bearer from `~/.config/carina/rtx_service_key`.

Verified 2026-09-11: Mac urllib health **200** via this path.


## WorldRuntime `:18794` private hop (UE-04)

**HTTP WorldRuntime tunnel ≠ WebRTC / PixelStreaming ICE.** Mac `-L` gives CLI/HTTP access only.

**Windows** (detached; pid in `logs/tunnel_win_to_vps_18794.pid`):

```bat
ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -R 127.0.0.1:18794:127.0.0.1:18794 vps
```

(`Host vps` uses `ProxyJump m920x`.) Do **not** steal the `:18793` tunnel.

**Mac** (Cursor runs this `-L`; Grok Bot does **not** ssh into Mac):

```bash
ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:18794:127.0.0.1:18794 ixiaotao-cloud
```

Then on Mac: `http://127.0.0.1:18794/v1/` (WorldRuntime). Sidecar remains `http://127.0.0.1:18793/health`.


### Private key paths (no secret values)

- Key file: `~/.config/carina/rtx_service_key` (chmod 600)
- Env: `~/.config/carina/rtx_service.env`
  - `CARINA_RTX_SERVICE_URL=http://127.0.0.1:18793`
  - `CARINA_RTX_SERVICE_KEY_FILE=/Users/william/.config/carina/rtx_service_key`

Never commit key material; never paste keys into chat/docs.

## Preferred when Mac is back on LAN

Windows → M920x loopback reverse, Mac → `ixiaotao-lan` local forward (or Mac Remote Login + direct Windows→Mac `-R`). Until LAN works, keep the VPS loopback hop.

## PixelStreaming2 player (2026-09-11 11:53 Asia/Shanghai)

| Path | Status |
|------|--------|
| Win loopback `http://127.0.0.1:8080/player.html` | **GREEN** (PS2; SFU off) |
| LAN `http://192.168.5.16:8080` | Scripts + Private/LocalSubnet firewall ready; **Mac not on LAN** → ICE HARD_BLOCK |
| SSH tunnel to player HTTP | TCP only — **not** WebRTC/ICE proof |

Firewall: `CarinaPS2-*` rules Profile=Private RemoteAddress=LocalSubnet only. No public `:8080`/`:8888`.

