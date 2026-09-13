#!/usr/bin/env bash
# Run on AIGA. Binds loopback only. Do not pkill -f — kill this PID only.
set -euo pipefail
ROOT="${CARINA_NATIVE_MESH_ROOT:-/data/disk1/models/carina-native-mesh}"
cd "$ROOT"
export HIP_VISIBLE_DEVICES="${HIP_VISIBLE_DEVICES:-0}"
export CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-0}"
export TRIPOSR_ROOT="${TRIPOSR_ROOT:-$ROOT/TripoSR}"
export CARINA_T2I="${CARINA_T2I:-/data/disk1/models/sdxl-turbo}"
export CARINA_MESH_HOST="${CARINA_MESH_HOST:-127.0.0.1}"
export CARINA_MESH_PORT="${CARINA_MESH_PORT:-18795}"
export HF_HOME="${HF_HOME:-/data/disk1/models/.hf-home}"
export HUGGINGFACE_HUB_CACHE="${HUGGINGFACE_HUB_CACHE:-/data/disk1/models/.hf-cache}"
export HF_HUB_CACHE="$HUGGINGFACE_HUB_CACHE"
export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
PYTHON="${CARINA_MESH_PYTHON:-/home/wuyw/builds/lingbot-world-v2/.venv/bin/python}"
echo $$ > "$ROOT/mesh-server.pid"
exec "$PYTHON" -u "$ROOT/server.py"
