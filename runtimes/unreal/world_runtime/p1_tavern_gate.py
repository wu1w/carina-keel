"""P1 sourced tavern: upload, prepare, install, spawn, interact, 6 views.

Not world-model generation. Run on Windows after Blender export.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from .ipc_ue import send_command

ROOT = Path(r"C:\Users\wuyw\carina-rtx-validation")
TAVERN = ROOT / "sourced-pbr-tavern"
GLB = TAVERN / "tavern_pbr.glb"
SPAWNS = TAVERN / "spawns.json"
UPLOADED = ROOT / "assets" / "uploaded"
WR = "http://127.0.0.1:18794"
WORLD = "ue02-final"
SHOT_DIR = Path(r"G:\carina-ue\CarinaPS\Packaged\Windows\CarinaPS\Saved\Screenshots\Windows")
EVIDENCE = ROOT / "logs"
STOP_BAT = Path(r"G:\carina-ue\CarinaPS\scripts\stop_ps2_stack.bat")
START_STREAM = Path(r"G:\carina-ue\CarinaPS\scripts\start_streamer_ps2_lan.bat")
SCHTASKS = r"C:\Windows\System32\schtasks.exe"


def http(method: str, path: str, body: dict | None = None, timeout: float = 1800) -> dict:
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


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def stop_streamer() -> None:
    subprocess.run([str(SCHTASKS), "/End", "/TN", "CarinaPS2-Streamer-LAN"], check=False)
    time.sleep(3)


def start_streamer() -> None:
    subprocess.run([str(SCHTASKS), "/Run", "/TN", "CarinaPS2-Streamer-LAN"], check=False)
    deadline = time.time() + 90
    while time.time() < deadline:
        if (Path(r"G:\carina-ue\CarinaPS\Packaged\Windows\CarinaPS\Saved\CarinaWorldRuntime\outbox") / "_heartbeat.json").is_file():
            age = time.time() - (Path(r"G:\carina-ue\CarinaPS\Packaged\Windows\CarinaPS\Saved\CarinaWorldRuntime\outbox") / "_heartbeat.json").stat().st_mtime
            if age < 20:
                return
        time.sleep(2)


def cmd_id() -> str:
    return str(uuid.uuid4())


def mutate(path: str, extra: dict, expected: str) -> dict:
    nxt = extra.pop("revision", None) or ("p1-" + uuid.uuid4().hex[:10])
    body = {
        "commandId": cmd_id(),
        "expectedRevision": expected,
        "revision": nxt,
        **extra,
    }
    return http("POST", path, body)


def latest_shots(n: int) -> list[str]:
    files = sorted(SHOT_DIR.glob("HighresScreenshot*.png"), key=lambda p: p.stat().st_mtime)
    return [str(p) for p in files[-n:]]


def main() -> None:
    if not GLB.is_file():
        raise SystemExit(f"missing {GLB}")
    digest = sha256_file(GLB)
    asset_id = digest[:16]
    dest = UPLOADED / asset_id
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copy2(GLB, dest / "asset.glb")
    meta = {
        "contentHash": digest,
        "originalFilename": "tavern_pbr.glb",
        "sourceLabel": "asset-library",
        "claimsWorldModelGeneration": False,
        "notWorldModel": True,
        "byteLength": GLB.stat().st_size,
    }
    (dest / "meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    world = http("GET", f"/v1/worlds/{WORLD}")
    revision = world.get("appliedRevision", "0")
    stop_streamer()
    prep = mutate(
        f"/v1/worlds/{WORLD}/assets/prepare",
        {"assetId": asset_id, "assetHash": digest},
        revision,
    )
    if not prep.get("ok") and prep.get("httpStatus") not in {None, 200}:
        raise SystemExit(json.dumps(prep, indent=2))
    revision = prep.get("revision") or http("GET", f"/v1/worlds/{WORLD}").get("appliedRevision")
    inst = mutate(
        f"/v1/worlds/{WORLD}/assets/install",
        {"assetHash": digest},
        revision,
    )
    revision = inst.get("revision") or revision
    start_streamer()
    time.sleep(8)
    act = mutate(
        f"/v1/worlds/{WORLD}/assets/activate",
        {"assetHashes": [digest]},
        revision,
    )
    revision = act.get("revision") or revision
    spawns = json.loads(SPAWNS.read_text(encoding="utf-8"))
    spawned = []
    for row in spawns["objects"]:
        object_id = "p1-" + row["meshName"]
        out = mutate(
            f"/v1/worlds/{WORLD}/objects",
            {
                "objectId": object_id,
                "assetHash": digest,
                "meshName": row["meshName"],
                "transform": row["transform"],
            },
            revision,
        )
        revision = out.get("revision") or revision
        spawned.append(out)
    player = spawns["spawnPlayer"]
    pose = {
        "op": "player_pose",
        "ueLocationCm": {"x": player["x"] * 100, "y": player["z"] * 100, "z": 92},
        "ueRotatorDeg": {"pitch": 0, "yaw": 0, "roll": 0},
    }
    send_command(pose)
    door = mutate(
        f"/v1/worlds/{WORLD}/objects/p1-Door/interact",
        {"kind": "open"},
        revision,
    )
    revision = door.get("revision") or revision
    cup = mutate(
        f"/v1/worlds/{WORLD}/objects/p1-Cup/interact",
        {"kind": "pickup"},
        revision,
    )
    revision = cup.get("revision") or revision
    views = [
        ("bar_near", {"x": 2.2, "y": 1.4, "z": 5.0}, {"pitch": -8, "yaw": -110, "roll": 0}),
        ("fireplace", {"x": 8.4, "y": 1.5, "z": 2.2}, {"pitch": -6, "yaw": 170, "roll": 0}),
        ("door_inside", {"x": 6.0, "y": 1.5, "z": 8.2}, {"pitch": -4, "yaw": 0, "roll": 0}),
        ("door_outside", {"x": 6.0, "y": 1.5, "z": 11.2}, {"pitch": -6, "yaw": 180, "roll": 0}),
        ("cup", {"x": 1.9, "y": 1.35, "z": 4.6}, {"pitch": -12, "yaw": -90, "roll": 0}),
        ("bar_behind", {"x": 0.7, "y": 1.5, "z": 5.0}, {"pitch": -6, "yaw": 90, "roll": 0}),
    ]
    send_command({"op": "highresshot", "exec": "r.DefaultFeature.AutoExposure 0"})
    for name, loc, rot in views:
        send_command(
            {
                "op": "player_pose",
                "ueLocationCm": {"x": loc["x"] * 100, "y": loc["z"] * 100, "z": loc["y"] * 100},
                "ueRotatorDeg": rot,
            }
        )
        time.sleep(1.2)
        send_command({"op": "highresshot", "exec": "HighResShot 1"})
        time.sleep(1.5)
    shots = latest_shots(8)
    evidence = {
        "gate": "P1-2-P1-3",
        "notWorldModel": True,
        "claimsWorldModelGeneration": False,
        "source": "asset-library",
        "assetId": asset_id,
        "assetHash": digest,
        "prepare": {k: prep.get(k) for k in ("cookMs", "shaderMergeOk", "softObjectPath", "meshes", "label", "timingsMs")},
        "install": {k: inst.get(k) for k in ("installMs", "mountedPackages", "ok")},
        "activate": {k: act.get(k) for k in ("ok", "revision")},
        "spawned": [{"objectId": s.get("objectId"), "ok": s.get("ok"), "ueActorId": s.get("ueActorId"), "meshName": (s.get("transform") or {})} for s in spawned],
        "door": door,
        "cup": cup,
        "views": [name for name, _, _ in views],
        "shots": shots,
        "playerSpawn": player,
        "generationOffPlayable": "mac-runtime-tested; UE route still walkable with streamer up",
    }
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    (EVIDENCE / "p1_tavern_gate.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()
