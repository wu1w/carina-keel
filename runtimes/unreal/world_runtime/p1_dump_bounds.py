"""Dump live CarinaDynamic bounds. Not world-model."""
from __future__ import annotations

import json

from .ipc_ue import send_command


def main() -> None:
    d = send_command({"op": "dump_spawned"})
    print(json.dumps({k: d.get(k) for k in ("ok", "error", "aliveCount", "trackedCount", "ms")}, indent=2))
    for a in d.get("actors") or []:
        dx = float(a.get("maxX", 0)) - float(a.get("minX", 0))
        dy = float(a.get("maxY", 0)) - float(a.get("minY", 0))
        dz = float(a.get("maxZ", 0)) - float(a.get("minZ", 0))
        print(
            f"{a.get('objectId'):20} loc=({a.get('x'):.1f},{a.get('y'):.1f},{a.get('z'):.1f}) "
            f"extent=({dx:.1f},{dy:.1f},{dz:.1f})"
        )


if __name__ == "__main__":
    main()
