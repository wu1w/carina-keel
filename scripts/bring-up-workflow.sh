#!/usr/bin/env bash
# Mac loopback tunnels: AIGA LingBot (ProxyJump, must stay in foreground)
# and Windows WorldRuntime. Does not bind 18793/18794 to LAN. Does not restart :18793.
set -euo pipefail

start_local_forward() {
  local local_port="$1"
  local remote_host="$2"
  shift 2
  if nc -z -G 1 127.0.0.1 "$local_port" 2>/dev/null; then
    echo "tunnel $local_port already open"
    return 0
  fi
  ssh -fN -o BatchMode=yes -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=15 -o ServerAliveCountMax=6 \
    -L "127.0.0.1:${local_port}:127.0.0.1:${local_port}" \
    "$remote_host"
  echo "started tunnel $local_port -> ${remote_host}"
}

echo "AIGA hop is ProxyJump; prefer a long-lived:"
echo "  ssh -N -o ServerAliveInterval=15 -L 127.0.0.1:18791:127.0.0.1:18791 -L 127.0.0.1:18792:127.0.0.1:18792 -L 127.0.0.1:18795:127.0.0.1:18795 aiga"
start_local_forward 18791 aiga
start_local_forward 18792 aiga
start_local_forward 18795 aiga
start_local_forward 18794 carina-win
start_local_forward 18793 carina-win

echo "=== health ==="
curl -sS -m 5 http://127.0.0.1:18791/health || true
echo
curl -sS -m 5 http://127.0.0.1:18792/health || true
echo
curl -sS -m 5 http://127.0.0.1:18795/health || true
echo
curl -sS -m 5 http://127.0.0.1:18794/health || true
echo
curl -sS -m 5 -o /dev/null -w "ps2 %{http_code}\n" http://192.168.5.16:8080/player.html || true
echo
echo "Set CARINA_MESH_PROVIDER_URL=http://127.0.0.1:18795 only when 18795 health.ok is true."
echo "TripoSR I23D is native-mesh, not a world model."
