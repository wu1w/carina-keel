"""Remove leftover fixture actors, then shoot overhead probes.

Not world-model. Used to tell baked-GLB double-translate from black materials.
"""
from __future__ import annotations

import json
import shutil
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from .ipc_ue import send_command, ue_bridge_available

ROOT = Path(r"C:\Users\wuyw\carina-rtx-validation")
WR = "http://127.0.0.1:18794"
WORLD = "ue02-final"
SHOT_DIR = Path(r"G:\carina-ue\CarinaPS\Packaged\Windows\CarinaPS\Saved\Screenshots\Windows")
OUT = ROOT / "logs" / "p1_locate"
EVIDENCE = ROOT / "logs" / "p1_clean_locate.json"
LEFTOVERS = ("avocado", "boombox", "tavern-scaffold-p0")
ASSET_HASH = "629373db5bc61c4c3beaaa0bf73e2f7baf93921e7a86e9675d2fca1ff4262673"
TAVERN = ROOT / "sourced-pbr-tavern"
SPAWNS = TAVERN / "spawns.json"


def http(method: str, path: str, body: dict | None = None, timeout: float = 60) -> dict:
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        WR + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if body is not None else {},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        payload = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(payload)
        except json.JSONDecodeError:
            parsed = {"error": payload}
        parsed["httpStatus"] = e.code
        parsed["ok"] = False
        return parsed


def mutate(path: str, extra: dict, expected: str, method: str = "POST") -> dict:
    nxt = extra.pop("revision", None) or ("p1-" + uuid.uuid4().hex[:10])
    body = {
        "commandId": str(uuid.uuid4()),
        "expectedRevision": expected,
        "revision": nxt,
        **extra,
    }
    return http(method, path, body)


def newest(after: float) -> Path | None:
    files = [p for p in SHOT_DIR.glob("HighresScreenshot*.png") if p.stat().st_mtime > after]
    return max(files, key=lambda p: p.stat().st_mtime) if files else None


def grab(name: str) -> str:
    before = time.time()
    send_command({"op": "highresshot", "exec": "HighResShot 1"})
    for _ in range(24):
        time.sleep(0.25)
        shot = newest(before)
        if shot:
            dest = OUT / f"{name}.png"
            shutil.copy2(shot, dest)
            return str(dest)
    return ""


def pose_cm(x: float, y: float, z: float, pitch: float, yaw: float) -> dict:
    return send_command(
        {
            "op": "player_pose",
            "ueLocationCm": {"x": x, "y": y, "z": z},
            "ueRotatorDeg": {"pitch": pitch, "yaw": yaw, "roll": 0},
            "springArmLength": 0,
        }
    )


def identity_transform() -> dict:
    return {
        "position": {"x": 0.0, "y": 0.0, "z": 0.0},
        "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
        "scale": {"x": 1.0, "y": 1.0, "z": 1.0},
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    if not ue_bridge_available():
        raise SystemExit("UE bridge down")
    world = http("GET", f"/v1/worlds/{WORLD}")
    revision = world.get("appliedRevision") or "0"
    deleted = []
    for object_id in LEFTOVERS:
        out = mutate(f"/v1/worlds/{WORLD}/objects/{object_id}", {}, revision, method="DELETE")
        revision = out.get("revision") or revision
        deleted.append({"objectId": object_id, "ok": out.get("ok"), "error": out.get("error")})

    for cmd in (
        "Cheat Ghost",
        "slomo 0.0",
        "ShowFlag.SkeletalMeshes 0",
        "viewmode Unlit",
        "r.DefaultFeature.AutoExposure 0",
        "r.EyeAdaptationQuality 0",
    ):
        send_command({"op": "highresshot", "exec": cmd})

    probes_offset = [
        ("offset_down_origin", 0, 0, 800, -89, 0),
        ("offset_down_room", 600, 500, 800, -89, 0),
        ("offset_down_double", 1200, 1000, 800, -89, 0),
        ("offset_inside", 600, 500, 160, -12, 90),
    ]
    shots: dict[str, str] = {}
    for name, x, y, z, pitch, yaw in probes_offset:
        pose_cm(x, y, z, pitch, yaw)
        time.sleep(0.4)
        shots[name] = grab(name)

    spawns = json.loads(SPAWNS.read_text(encoding="utf-8"))
    respawned = []
    for row in spawns["objects"]:
        object_id = "p1-" + row["meshName"]
        out = mutate(
            f"/v1/worlds/{WORLD}/objects",
            {
                "objectId": object_id,
                "assetHash": ASSET_HASH,
                "meshName": row["meshName"],
                "transform": identity_transform(),
            },
            revision,
        )
        revision = out.get("revision") or revision
        respawned.append({"objectId": object_id, "ok": out.get("ok"), "error": out.get("error")})

    probes_identity = [
        ("ident_down_origin", 0, 0, 800, -89, 0),
        ("ident_down_room", 600, 500, 800, -89, 0),
        ("ident_inside", 600, 500, 160, -12, 90),
        ("ident_bar", 420, 500, 155, -12, 180),
    ]
    for name, x, y, z, pitch, yaw in probes_identity:
        pose_cm(x, y, z, pitch, yaw)
        time.sleep(0.4)
        shots[name] = grab(name)

    send_command({"op": "highresshot", "exec": "viewmode Lit"})
    pose_cm(600, 500, 160, -12, 90)
    shots["ident_inside_lit"] = grab("ident_inside_lit")
    send_command({"op": "highresshot", "exec": "slomo 1"})

    evidence = {
        "ok": True,
        "notWorldModel": True,
        "deleted": deleted,
        "respawnedIdentity": respawned,
        "shots": shots,
        "note": "offset_* = leftover fixtures removed, tavern still at spawns.json; ident_* = tavern at origin",
    }
    EVIDENCE.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()
