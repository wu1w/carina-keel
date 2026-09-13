#!/usr/bin/env bash
# Mac control plane: AIGA tunnels + Carina daemon.
# Does not bind 18793/18794 to LAN. Does not claim world-model generation.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -x "$ROOT/scripts/bring-up-workflow.sh" ]]; then
  "$ROOT/scripts/bring-up-workflow.sh"
fi

MESH_HEALTH="$(curl -sS -m 5 http://127.0.0.1:18795/health || true)"
if echo "$MESH_HEALTH" | grep -q '"ok": true'; then
  export CARINA_MESH_PROVIDER_URL="${CARINA_MESH_PROVIDER_URL:-http://127.0.0.1:18795}"
  echo "mesh sidecar ready → CARINA_MESH_PROVIDER_URL=$CARINA_MESH_PROVIDER_URL"
else
  echo "mesh sidecar not ready; CARINA_MESH_PROVIDER_URL stays unset (no fake nativeMesh)"
  unset CARINA_MESH_PROVIDER_URL || true
fi

# Whole-space world model (WorldGen sidecar on the Windows 5070 Ti, via `ssh -L 18796:127.0.0.1:18796 carina-win`).
# Only wired when the sidecar reports ready; a URL alone never claims generation.
SPACE_HEALTH="$(curl -sS -m 5 http://127.0.0.1:18796/health || true)"
if echo "$SPACE_HEALTH" | grep -q '"ready": true'; then
  export CARINA_SPACE_PROVIDER_URL="${CARINA_SPACE_PROVIDER_URL:-http://127.0.0.1:18796}"
  echo "space sidecar ready → CARINA_SPACE_PROVIDER_URL=$CARINA_SPACE_PROVIDER_URL (worldgen-flux-pano-da2, single-viewpoint shell)"
else
  echo "space sidecar not ready; CARINA_SPACE_PROVIDER_URL stays unset (no world-model claim)"
  unset CARINA_SPACE_PROVIDER_URL || true
fi

if curl -sS -m 3 http://127.0.0.1:18791/health >/dev/null 2>&1; then
  export CARINA_RENDERER_URL="${CARINA_RENDERER_URL:-http://127.0.0.1:18791}"
fi

if curl -sS -m 3 http://127.0.0.1:18794/health >/dev/null 2>&1; then
  export CARINA_WORLD_RUNTIME_URL="${CARINA_WORLD_RUNTIME_URL:-http://127.0.0.1:18794}"
  export CARINA_WORLD_RUNTIME_WORLD_ID="${CARINA_WORLD_RUNTIME_WORLD_ID:-ng1-i23d}"
  # Cook + remount are the defaults once WR is configured (live rollback + remount verified
  # 2026-09-13). Set CARINA_WORLD_RUNTIME_COOK=0 for upload-only.
  if curl -sS -m 3 http://127.0.0.1:18794/health | grep -q '"hostRemount": *true'; then
    echo "WorldRuntime ready → CARINA_WORLD_RUNTIME_URL=$CARINA_WORLD_RUNTIME_URL worldId=$CARINA_WORLD_RUNTIME_WORLD_ID (cook=${CARINA_WORLD_RUNTIME_COOK:-1} remount=${CARINA_WORLD_RUNTIME_REMOUNT:-1})"
  else
    export CARINA_WORLD_RUNTIME_REMOUNT=0
    echo "WorldRuntime ready but without host remount routes → CARINA_WORLD_RUNTIME_REMOUNT=0 (new side containers will fail activate and roll back)"
  fi
fi

export CARINA_TOKEN="${CARINA_TOKEN:-dev-token}"
export CARINA_LANG="${CARINA_LANG:-zh}"
export CARINA_PORT="${CARINA_PORT:-18790}"
unset CARINA_PRIMITIVE_FIXTURE || true

echo "TripoSR I23D is native-mesh, not a world model."
exec pnpm exec tsx src/cli/main.ts serve
