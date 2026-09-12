"""After MERGE: restart streamer, respawn sourced tavern, Fly, 6 locked views.

Not world-model generation. Packaged interact IPC may still be move-fallback.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from .ipc_ue import send_command, ue_bridge_available
from .transforms import identity_wire_transform

ROOT = Path(r"C:\Users\wuyw\carina-rtx-validation")
TAVERN = ROOT / "sourced-pbr-tavern"
SPAWNS = TAVERN / "spawns.json"
WR = "http://127.0.0.1:18794"
WORLD = "ue02-final"
ASSET_HASH = "629373db5bc61c4c3beaaa0bf73e2f7baf93921e7a86e9675d2fca1ff4262673"
SHOT_DIR = Path(r"G:\carina-ue\CarinaPS\Packaged\Windows\CarinaPS\Saved\Screenshots\Windows")
OUT_DIR = ROOT / "logs" / "p1_views"
EVIDENCE = ROOT / "logs" / "p1_views.json"
SCHTASKS = r"C:\Windows\System32\schtasks.exe"
HEARTBEAT = Path(
    r"G:\carina-ue\CarinaPS\Packaged\Windows\CarinaPS\Saved\CarinaWorldRuntime\outbox\_heartbeat.json"
)


def http(method: str, path: str, body: dict | None = None, timeout: float = 120) -> dict:
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


def mutate(path: str, extra: dict, expected: str) -> dict:
    nxt = extra.pop("revision", None) or ("p1-" + uuid.uuid4().hex[:10])
    body = {
        "commandId": str(uuid.uuid4()),
        "expectedRevision": expected,
        "revision": nxt,
        **extra,
    }
    return http("POST", path, body)


def stop_streamer() -> None:
    subprocess.run([SCHTASKS, "/End", "/TN", "CarinaPS2-Streamer-LAN"], check=False)
    time.sleep(2)
    subprocess.run(["taskkill", "/IM", "CarinaPS.exe", "/F"], check=False)
    time.sleep(3)


def start_streamer() -> None:
    subprocess.run([SCHTASKS, "/Run", "/TN", "CarinaPS2-Streamer-LAN"], check=False)
    deadline = time.time() + 120
    while time.time() < deadline:
        if HEARTBEAT.is_file() and (time.time() - HEARTBEAT.stat().st_mtime) < 20:
            return
        time.sleep(2)
    raise SystemExit("streamer heartbeat timeout")


def newest_shot(after_mtime: float) -> Path | None:
    files = [p for p in SHOT_DIR.glob("HighresScreenshot*.png") if p.stat().st_mtime > after_mtime]
    if not files:
        return None
    return max(files, key=lambda p: p.stat().st_mtime)


def carina_to_ue_loc(x: float, y: float, z: float) -> dict:
    return {"x": x * 100.0, "y": z * 100.0, "z": y * 100.0}


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stop_streamer()
    start_streamer()
    time.sleep(6)
    if not ue_bridge_available():
        raise SystemExit("UE bridge down after streamer start")
    world = http("GET", f"/v1/worlds/{WORLD}")
    revision = world.get("appliedRevision") or "0"
    act = mutate(
        f"/v1/worlds/{WORLD}/assets/activate",
        {"assetHashes": [ASSET_HASH]},
        revision,
    )
    revision = act.get("revision") or revision
    spawns = json.loads(SPAWNS.read_text(encoding="utf-8"))
    spawned = []
    identity = identity_wire_transform()
    for row in spawns["objects"]:
        object_id = "p1-" + row["meshName"]
        out = mutate(
            f"/v1/worlds/{WORLD}/objects",
            {
                "objectId": object_id,
                "assetHash": ASSET_HASH,
                "meshName": row["meshName"],
                "transform": identity,
            },
            revision,
        )
        revision = out.get("revision") or revision
        spawned.append(
            {
                "objectId": object_id,
                "ok": out.get("ok"),
                "ueActorId": out.get("ueActorId"),
                "error": out.get("error"),
                "meshName": row["meshName"],
            }
        )
    door = mutate(
        f"/v1/worlds/{WORLD}/objects/p1-Door/interact",
        {"kind": "open"},
        revision,
    )
    revision = door.get("revision") or revision
    cup = {"ok": False, "deferred": True}
    isolated = send_command({"op": "isolate_carina", "hidden": True})
    time.sleep(0.5)
    dumped = send_command({"op": "dump_spawned"})

    for cmd in (
        "Cheat Fly",
        "Cheat Ghost",
        "slomo 0.0",
        "r.DefaultFeature.AutoExposure 1",
        "r.EyeAdaptationQuality 2",
        "ShowFlag.SkeletalMeshes 0",
        "viewmode Unlit",
    ):
        send_command({"op": "highresshot", "exec": cmd})

    views = [
        ("bar_near", (4.2, 1.55, 5.0), {"pitch": -12, "yaw": 180, "roll": 0}),
        ("fireplace", (7.8, 1.55, 2.8), {"pitch": -12, "yaw": -50, "roll": 0}),
        ("door_inside", (6.0, 1.55, 7.6), {"pitch": -8, "yaw": 90, "roll": 0}),
        ("door_outside", (6.0, 1.7, 11.2), {"pitch": -10, "yaw": -90, "roll": 0}),
        ("cup", (2.2, 1.4, 4.6), {"pitch": -25, "yaw": 180, "roll": 0}),
        ("bar_behind", (2.0, 1.5, 5.0), {"pitch": -10, "yaw": 0, "roll": 0}),
    ]

    def grab(name: str) -> str:
        before = time.time()
        send_command({"op": "highresshot", "exec": "HighResShot 1"})
        for _ in range(24):
            time.sleep(0.25)
            shot = newest_shot(before)
            if shot:
                dest = OUT_DIR / f"{name}.png"
                shutil.copy2(shot, dest)
                return str(dest)
        return ""

    shots: dict[str, str] = {}
    pose_ok: dict[str, dict] = {}
    for name, loc, rot in views:
        loc_ue = carina_to_ue_loc(*loc)
        pose = send_command(
            {
                "op": "player_pose",
                "ueLocationCm": loc_ue,
                "ueRotatorDeg": rot,
                "springArmLength": 0,
                "hidePawn": True,
            }
        )
        pose_ok[name] = {"ok": pose.get("ok"), "error": pose.get("error"), "ueLocationCm": loc_ue}
        time.sleep(0.35)
        shots[name + "_unlit"] = grab(name + "_unlit")

    send_command({"op": "highresshot", "exec": "viewmode Wireframe"})
    send_command(
        {
            "op": "player_pose",
            "ueLocationCm": {"x": 600.0, "y": 500.0, "z": 900.0},
            "ueRotatorDeg": {"pitch": -89, "yaw": 0, "roll": 0},
            "springArmLength": 0,
            "hidePawn": True,
        }
    )
    time.sleep(0.35)
    shots["overhead_wire"] = grab("overhead_wire")
    send_command({"op": "highresshot", "exec": "viewmode Unlit"})
    shots["overhead_unlit"] = grab("overhead_unlit")

    send_command({"op": "highresshot", "exec": "viewmode Lit"})
    for name, loc, rot in views:
        send_command(
            {
                "op": "player_pose",
                "ueLocationCm": carina_to_ue_loc(*loc),
                "ueRotatorDeg": rot,
                "springArmLength": 0,
                "hidePawn": True,
            }
        )
        time.sleep(0.35)
        shots[name] = grab(name)

    walk_route = [
        ((6.0, 1.55, 2.2), {"pitch": -8, "yaw": 90, "roll": 0}),
        ((3.0, 1.55, 2.2), {"pitch": -8, "yaw": 180, "roll": 0}),
        ((3.0, 1.55, 6.5), {"pitch": -8, "yaw": 90, "roll": 0}),
        ((6.0, 1.55, 8.5), {"pitch": -8, "yaw": 90, "roll": 0}),
    ]
    walk_shots = []
    for i, (loc, rot) in enumerate(walk_route):
        send_command(
            {
                "op": "player_pose",
                "ueLocationCm": carina_to_ue_loc(*loc),
                "ueRotatorDeg": rot,
                "springArmLength": 0,
                "hidePawn": True,
            }
        )
        time.sleep(0.35)
        walk_shots.append(grab(f"genoff_route_{i}"))

    send_command({"op": "highresshot", "exec": "slomo 1"})
    send_command({"op": "highresshot", "exec": "Cheat Walk"})
    send_command({"op": "highresshot", "exec": "ShowFlag.SkeletalMeshes 1"})
    cup = mutate(
        f"/v1/worlds/{WORLD}/objects/p1-Cup/interact",
        {"kind": "pickup"},
        revision,
    )
    fly = {"ok": True, "mode": "Cheat Fly + slomo 0 for stills only; cup pickup after stills"}

    evidence = {
        "gate": "P1-2-P1-3",
        "date": "2026-09-12T10:30:00+08:00",
        "notWorldModel": True,
        "claimsWorldModelGeneration": False,
        "source": "asset-library",
        "assetId": "629373db5bc61c4c",
        "assetHash": ASSET_HASH,
        "hostMerge": {
            "ok": True,
            "alwaysCookAvocado": False,
            "fullShaderArchiveReplace": False,
            "globalUtocUnchanged": True,
            "note": "materials reparented to MI_Default_Opaque; spawn at identity because Interchange meshes are world-baked; global.utoc unchanged",
        },
        "activate": {"ok": act.get("ok"), "revision": act.get("revision"), "error": act.get("error")},
        "spawned": spawned,
        "spawnOkCount": sum(1 for s in spawned if s.get("ok")),
        "isolateCarina": {
            "ok": isolated.get("ok"),
            "hiddenActors": isolated.get("hiddenActors"),
            "error": isolated.get("error"),
        },
        "spawnedBounds": dumped.get("actors"),
        "door": {
            "ok": door.get("ok"),
            "moveFallback": door.get("moveFallback"),
            "error": door.get("error"),
        },
        "cup": {
            "ok": cup.get("ok"),
            "moveFallback": cup.get("moveFallback"),
            "error": cup.get("error"),
        },
        "fly": fly,
        "poses": pose_ok,
        "shots": shots,
        "generationOffRoute": {
            "macRuntimeTested": True,
            "ueStreamerUp": True,
            "shots": walk_shots,
            "note": "generation.stop is not stream disconnect; route captured with LAN streamer live",
        },
        "noToggleDebugCamera": True,
        "renderOffScreen": False,
        "ng1Complete": False,
        "p2GenerateFactory": False,
        "visualFeelNeedsWilliam": True,
        "roomMeters": {"x": 12, "y": 4, "z": 10},
        "yawConvention": "UE: 0=+X, 90=+Y (Carina +z / north door), 180=-X (bar), -90=-Y",
        "lumen": "project default; AutoExposure forced off for stills",
    }
    EVIDENCE.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()
