
"""UE-02 WorldRuntime HTTP on 127.0.0.1:18794 — review-1 contract.

NOT LIVE for CLI until smoke-proven (config.LIVE / /v1/status).
"""
from __future__ import annotations
import json
import math
import traceback
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from . import config
from .asset_registry import (
    FORBIDDEN_PATH_KEYS,
    load_registry,
    register_upload,
)
from .carina_light import lit_interior_execs
from .play_enter import isolate_then_enter, look_play, carina_yaw_rad_to_ue_deg
from .host_streamer import start_streamer, stop_streamer
from .ipc_ue import send_command, ue_bridge_available
from .prepare_contract import PrepareContractError, validate_prepare_request
from .pipeline_install import install_asset, uninstall_asset
from .pipeline_prepare import prepare_asset
from .spawn_collision import wants_collision
from .transforms import carina_to_ue, validate_wire_transform
from .world_store import STORE, WorldError

config.ensure_dirs()

app = FastAPI(title="CARINA WorldRuntime UE-02", version="0.1.0")


def _err(status: int, message: str, **extra: Any) -> JSONResponse:
    body = {"ok": False, "error": message, **extra}
    return JSONResponse(body, status_code=status)


@app.get("/v1/status")
def status() -> dict[str, Any]:
    return {
        "service": "carina-world-runtime",
        "baseUrl": f"http://{config.HOST}:{config.PORT}/v1/",
        "live": bool(config.LIVE),
        "cliBindAllowed": bool(config.LIVE),
        "ueBridge": ue_bridge_available(),
        "sidecar18793": "separate",
        "contract": "review-1",
        "rotationWire": "XYZ Euler radians",
        "revisionModel": "opaque string + expectedRevision + commandId idempotency",
        "prepareInput": "assetId + full assetHash (upload registry only)",
        "uploadInput": "POST /v1/assets/upload glbBase64; not world-model generation",
    }


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "live": bool(config.LIVE), "port": config.PORT, "hostRemount": True}


def _replay_world(world_id: str) -> dict[str, Any]:
    """The host does not persist spawned actors across a restart: re-activate and re-spawn every
    object this world already had, from the WorldRuntime store. Does not touch paks or revision."""
    world = STORE.load(world_id)
    reg = load_registry()
    replayed: list[str] = []
    failed: list[dict[str, Any]] = []
    for obj in list(world.get("objects") or []):
        object_id = obj.get("objectId")
        asset_hash = obj.get("assetHash")
        entry = (reg.get("byHash") or {}).get(asset_hash) or (world.get("activatedAssets") or {}).get(asset_hash) or {}
        soft = entry.get("softObjectPath")
        if not isinstance(object_id, str) or not isinstance(asset_hash, str) or not soft:
            failed.append({"objectId": object_id, "error": "no softObjectPath"})
            continue
        try:
            wire_tf = validate_wire_transform(obj.get("transform"))
            ue_tf = carina_to_ue(wire_tf)
        except Exception as e:  # keep replaying the rest
            failed.append({"objectId": object_id, "error": f"transform: {e}"})
            continue
        try:
            act = send_command({"op": "activate", "assetHash": asset_hash, "softObjectPath": soft})
            if not act.get("ok"):
                failed.append({"objectId": object_id, "error": f"activate: {act.get('error')}"})
                continue
            ipc = send_command({
                "op": "spawn",
                "objectId": object_id,
                "assetHash": asset_hash,
                "softObjectPath": soft,
                "ueLocationCm": ue_tf["ueLocationCm"],
                "ueRotationQuat": ue_tf["ueRotationQuat"],
                "ueRotatorDeg": ue_tf["ueRotatorDeg"],
                "ueScale": ue_tf["ueScale"],
                "collision": wants_collision(object_id),
            })
        except Exception as e:  # IPC decode/IO trouble must not abort the whole replay
            failed.append({"objectId": object_id, "error": f"ipc: {e}"})
            continue
        if not ipc.get("ok"):
            failed.append({"objectId": object_id, "error": f"spawn: {ipc.get('error')}"})
            continue
        obj["ueActorId"] = ipc.get("ueActorId")
        obj["respawnMs"] = ipc.get("ms")
        replayed.append(object_id)
    if replayed:
        STORE.save(world)
    return {"worldId": world_id, "replayed": replayed, "failed": failed}


ACTIVE_WORLD_FILE = config.STATE_DIR / "active_world.json"


def _set_active_world(world_id: str) -> None:
    """The host has one level; the world whose objects were spawned last is what the viewport shows."""
    try:
        config.ensure_dirs()
        ACTIVE_WORLD_FILE.write_text(json.dumps({"worldId": world_id}), encoding="utf-8")
    except OSError:
        pass


def _replay_targets() -> list[str]:
    """Replay only the viewport's world: the last world that spawned, or (when it has no objects
    left) the most recently modified world that still has objects. Never every world at once —
    they would all land in the same level."""
    active: str | None = None
    try:
        active = str(json.loads(ACTIVE_WORLD_FILE.read_text(encoding="utf-8")).get("worldId") or "") or None
    except Exception:
        active = None
    if active and STORE.load(active).get("objects"):
        return [active]
    newest: tuple[float, str] | None = None
    try:
        for p in config.WORLDS_DIR.glob("*.json"):
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                continue
            if data.get("objects"):
                mtime = p.stat().st_mtime
                if newest is None or mtime > newest[0]:
                    newest = (mtime, str(data.get("worldId") or p.stem))
    except OSError:
        pass
    return [newest[1]] if newest else []


@app.post("/v1/host/streamer/{action}")
async def host_streamer(action: str, request: Request) -> JSONResponse:
    """Remount hook: stop the packaged streamer before installing new side containers, start it
    after so the host mounts them (one restart per publish). `start` then replays every world's
    spawned objects because the host forgets them on restart. Never touches paks."""
    body: dict[str, Any] = {}
    try:
        raw = await request.body()
        if raw:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                body = parsed
    except Exception:
        body = {}
    if action == "stop":
        result = stop_streamer()
    elif action == "start":
        result = start_streamer(wait_for_bridge=True)
        if result.get("ok") and body.get("replay", True) is not False:
            ids = body.get("replayWorldIds")
            if not isinstance(ids, list):
                ids = _replay_targets()
            replay: list[dict[str, Any]] = []
            for w in ids:
                try:
                    replay.append(_replay_world(str(w)))
                except Exception as e:
                    traceback.print_exc()
                    replay.append({"worldId": str(w), "replayed": [], "failed": [{"error": str(e)}]})
            result["replay"] = replay
            try:
                lit = isolate_then_enter(send_command, execs=lit_interior_execs())
                result["isolate"] = lit["isolate"]
                result["litInteriorExecs"] = lit["litInteriorExecs"]
                result["viewmodeLit"] = lit["viewmodeLit"]
                result["playEnter"] = lit.get("playEnter")
                result["p1Pass"] = False
                result["claimsGeneratedLighting"] = False
                result["claimsWorldModelGeneration"] = False
                result["interiorLitVerified"] = False
            except Exception as e:
                result["isolate"] = result.get("isolate") or {"ok": False, "error": str(e)}
                result["p1Pass"] = False
                result["claimsGeneratedLighting"] = False
                result["claimsWorldModelGeneration"] = False
                result["interiorLitVerified"] = False
                result["viewmodeLit"] = False
    else:
        return _err(404, f"unknown streamer action {action!r}; use stop|start")
    return JSONResponse(result, status_code=200 if result.get("ok") else 503)


@app.post("/v1/host/isolate")
async def host_isolate() -> JSONResponse:
    """Hide the default Third Person map and exec Lit visibility cvars.

    Does not remount, cook, or touch paks. Not a P1 pass. Not generated lighting.
    """
    if not ue_bridge_available():
        return _err(501, "isolate requires host WorldRuntime IPC")
    try:
        lit = isolate_then_enter(send_command, execs=lit_interior_execs())
    except Exception as e:
        traceback.print_exc()
        return _err(500, f"isolate failed: {e}")
    isolate = lit.get("isolate") if isinstance(lit.get("isolate"), dict) else {}
    ok = True if not isinstance(isolate, dict) else isolate.get("ok", True) is not False
    return JSONResponse(
        {
            "ok": bool(ok),
            "isolate": lit.get("isolate"),
            "litInteriorExecs": lit["litInteriorExecs"],
            "viewmodeLit": lit["viewmodeLit"],
            "playEnter": lit.get("playEnter"),
            "p1Pass": False,
            "claimsGeneratedLighting": False,
            "claimsWorldModelGeneration": False,
            "interiorLitVerified": False,
        },
        status_code=200 if ok else 501,
    )


@app.post("/v1/host/spawned")
async def host_spawned() -> JSONResponse:
    """Dump possessed pawn + spawned actors. Does not pose, isolate, or remount."""
    if not ue_bridge_available():
        return _err(501, "spawned dump requires host WorldRuntime IPC")
    try:
        dumped = send_command({"op": "dump_spawned"})
    except Exception as e:
        traceback.print_exc()
        return _err(500, f"dump_spawned failed: {e}")
    if not isinstance(dumped, dict):
        return _err(500, "dump_spawned returned a non-object")
    return JSONResponse(dumped, status_code=200 if dumped.get("ok") is not False else 501)


@app.post("/v1/host/look")
async def host_look(request: Request) -> JSONResponse:
    """Rotate the possessed pawn in place. No teleport. Not a P1 pass."""
    if not ue_bridge_available():
        return _err(501, "look requires host WorldRuntime IPC")
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    if "ueYawDeg" in body:
        yaw_ue = float(body["ueYawDeg"])
    elif "yawRad" in body:
        yaw_ue = carina_yaw_rad_to_ue_deg(float(body["yawRad"]))
    else:
        return _err(400, "ueYawDeg or yawRad required")
    try:
        looked = look_play(send_command, yaw_ue_deg=yaw_ue)
    except Exception as e:
        traceback.print_exc()
        return _err(500, f"look failed: {e}")
    looked["p1Pass"] = False
    looked["claimsGeneratedLighting"] = False
    looked["claimsWorldModelGeneration"] = False
    return JSONResponse(looked, status_code=200 if looked.get("ok") else 501)


@app.post("/v1/assets/upload")
async def assets_upload(request: Request) -> JSONResponse:
    """Accept GLB bytes into the upload registry. Does not cook or spawn."""
    try:
        body = await request.json()
    except Exception:
        return _err(400, "json body required")
    if not isinstance(body, dict):
        return _err(400, "json object required")
    for key in FORBIDDEN_PATH_KEYS:
        if key in body:
            return _err(400, "glbPath/glbUrl/path/url not accepted; use glbBase64")
    raw_b64 = body.get("glbBase64")
    filename = body.get("originalFilename")
    source_label = body.get("sourceLabel")
    if not isinstance(raw_b64, str) or not raw_b64:
        return _err(400, "glbBase64 required")
    try:
        import base64

        data = base64.b64decode(raw_b64, validate=True)
    except Exception:
        return _err(400, "glbBase64 must be valid base64")
    try:
        result = register_upload(
            data=data,
            original_filename=str(filename or ""),
            source_label=str(source_label or ""),
            claims_world_model_generation=bool(body.get("claimsWorldModelGeneration")),
            baked_world_space=bool(body.get("bakedWorldSpace")),
        )
    except ValueError as e:
        return _err(400, str(e))
    except Exception as e:
        traceback.print_exc()
        return _err(500, f"upload failed: {e}")
    return JSONResponse(result)


@app.get("/v1/assets/{asset_id}")
def assets_get(asset_id: str) -> JSONResponse:
    meta_p = config.UPLOADED_ASSETS_DIR / asset_id / "meta.json"
    if not meta_p.is_file():
        return _err(404, f"assetId {asset_id} not in upload registry")
    try:
        meta = json.loads(meta_p.read_text(encoding="utf-8"))
    except Exception as e:
        return _err(500, f"meta unreadable: {e}")
    return JSONResponse(
        {
            "ok": True,
            "assetId": asset_id,
            "assetHash": meta.get("contentHash"),
            "originalFilename": meta.get("originalFilename"),
            "sourceLabel": meta.get("sourceLabel"),
            "claimsWorldModelGeneration": bool(meta.get("claimsWorldModelGeneration")),
            "bakedWorldSpace": bool(meta.get("bakedWorldSpace")),
            "byteLength": meta.get("byteLength"),
            "notWorldModel": bool(meta.get("notWorldModel", True)),
        }
    )


@app.get("/v1/worlds/{world_id}")
def get_world(world_id: str) -> dict[str, Any]:
    w = STORE.load(world_id)
    return {
        "worldId": world_id,
        "appliedRevision": w.get("appliedRevision", "0"),
        "objects": w.get("objects", []),
        "installedAssets": list((w.get("installedAssets") or {}).keys()),
        "activatedAssets": list((w.get("activatedAssets") or {}).keys()),
        "live": bool(config.LIVE),
    }


@app.post("/v1/worlds/{world_id}/assets/prepare")
async def assets_prepare(world_id: str, request: Request) -> JSONResponse:
    body = await request.json()
    try:
        prior, command_id, expected, revision = STORE.begin_mutate(world_id, body)
        if prior is not None:
            return JSONResponse(prior)
        try:
            asset_id, asset_hash = validate_prepare_request(body)
        except PrepareContractError as e:
            return _err(400, str(e))
        # Fail keeps old scene: prepare does not mutate applied objects; still revision gate
        world = STORE.load(world_id)
        result_inner = prepare_asset(asset_id, asset_hash, force=body.get("force") is True)
        world.setdefault("preparedAssets", {})[asset_hash] = {
            "assetId": asset_id,
            "assetHash": asset_hash,
            "softObjectPath": result_inner.get("softObjectPath"),
            "label": result_inner.get("label"),
            "timingsMs": result_inner.get("timingsMs"),
        }
        out = {
            "ok": True,
            "worldId": world_id,
            "assetId": asset_id,
            "assetHash": asset_hash,
            "commandId": command_id,
            "revision": revision,
            "cookMs": result_inner.get("cookMs"),
            "packageIds": result_inner.get("packageIds", []),
            "shaderMergeOk": result_inner.get("shaderMergeOk", False),
            "softObjectPath": result_inner.get("softObjectPath"),
            "timingsMs": result_inner.get("timingsMs"),
            "cached": result_inner.get("cached", False),
            "meshes": result_inner.get("meshes", []),
            "label": result_inner.get("label"),
        }
        return JSONResponse(STORE.commit_success(world, command_id, revision, out))
    except WorldError as e:
        return _err(e.status, str(e), worldId=world_id)
    except FileNotFoundError as e:
        return _err(404, str(e), worldId=world_id)
    except Exception as e:
        traceback.print_exc()
        return _err(500, f"prepare failed (scene unchanged): {e}", worldId=world_id)


@app.post("/v1/worlds/{world_id}/assets/install")
async def assets_install(world_id: str, request: Request) -> JSONResponse:
    body = await request.json()
    try:
        prior, command_id, expected, revision = STORE.begin_mutate(world_id, body)
        if prior is not None:
            return JSONResponse(prior)
        asset_hash = body.get("assetHash")
        if not isinstance(asset_hash, str):
            return _err(400, "assetHash required")
        world = STORE.load(world_id)
        result_inner = install_asset(asset_hash)
        world.setdefault("installedAssets", {})[asset_hash] = result_inner
        out = {
            "ok": True,
            "worldId": world_id,
            "assetHash": asset_hash,
            "commandId": command_id,
            "revision": revision,
            "mountedPackages": result_inner.get("mountedPackages"),
            "mountOrder": result_inner.get("mountOrder"),
            "installMs": result_inner.get("installMs"),
            "softObjectPath": result_inner.get("softObjectPath"),
        }
        return JSONResponse(STORE.commit_success(world, command_id, revision, out))
    except WorldError as e:
        return _err(e.status, str(e), worldId=world_id)
    except Exception as e:
        traceback.print_exc()
        return _err(500, f"install failed (scene unchanged): {e}", worldId=world_id)


@app.post("/v1/worlds/{world_id}/assets/uninstall")
async def assets_uninstall(world_id: str, request: Request) -> JSONResponse:
    """Remove a MERGE side container copied this publish. Never host/global.utoc."""
    body = await request.json()
    try:
        prior, command_id, expected, revision = STORE.begin_mutate(world_id, body)
        if prior is not None:
            return JSONResponse(prior)
        asset_hash = body.get("assetHash")
        if not isinstance(asset_hash, str):
            return _err(400, "assetHash required")
        world = STORE.load(world_id)
        result_inner = uninstall_asset(asset_hash)
        installed = world.setdefault("installedAssets", {})
        installed.pop(asset_hash, None)
        activated = world.setdefault("activatedAssets", {})
        activated.pop(asset_hash, None)
        out = {
            "ok": True,
            "worldId": world_id,
            "assetHash": asset_hash,
            "commandId": command_id,
            "revision": revision,
            "removed": result_inner.get("removed"),
            "missing": result_inner.get("missing"),
            "containerName": result_inner.get("containerName"),
            "note": result_inner.get("note"),
        }
        return JSONResponse(STORE.commit_success(world, command_id, revision, out))
    except WorldError as e:
        return _err(e.status, str(e), worldId=world_id)
    except FileNotFoundError as e:
        return _err(404, str(e), worldId=world_id)
    except Exception as e:
        traceback.print_exc()
        return _err(500, f"uninstall failed (host paks unchanged): {e}", worldId=world_id)


@app.post("/v1/worlds/{world_id}/assets/activate")
async def assets_activate(world_id: str, request: Request) -> JSONResponse:
    body = await request.json()
    try:
        prior, command_id, expected, revision = STORE.begin_mutate(world_id, body)
        if prior is not None:
            return JSONResponse(prior)
        hashes = body.get("assetHash") or body.get("assetHashes") or body.get("hashes")
        if isinstance(hashes, str):
            hashes = [hashes]
        if not isinstance(hashes, list) or not hashes:
            return _err(400, "assetHash or assetHashes[] required")
        if not ue_bridge_available():
            return _err(
                501,
                "activate requires packaged host WorldRuntime IPC (rebuild once); bridge not responding",
                worldId=world_id,
                stillNotLive=True,
            )
        world = STORE.load(world_id)
        reg = load_registry()
        activated = []
        t_spawn = []
        for h in hashes:
            entry = (reg.get("byHash") or {}).get(h) or (world.get("installedAssets") or {}).get(h)
            if not entry:
                return _err(404, f"assetHash not installed/prepared: {h}", worldId=world_id)
            soft = entry.get("softObjectPath")
            ipc = send_command({"op": "activate", "assetHash": h, "softObjectPath": soft})
            if not ipc.get("ok"):
                return _err(501, f"UE activate failed: {ipc.get('error')}", worldId=world_id, ipc=ipc)
            world.setdefault("activatedAssets", {})[h] = {"assetHash": h, "softObjectPath": soft, "ipc": ipc}
            activated.append(h)
            if "ms" in ipc:
                t_spawn.append(ipc["ms"])
        out = {
            "ok": True,
            "worldId": world_id,
            "assetHashes": activated,
            "commandId": command_id,
            "revision": revision,
            "activateMs": t_spawn,
        }
        return JSONResponse(STORE.commit_success(world, command_id, revision, out))
    except WorldError as e:
        return _err(e.status, str(e), worldId=world_id)
    except Exception as e:
        traceback.print_exc()
        return _err(500, f"activate failed (scene unchanged): {e}", worldId=world_id)


@app.post("/v1/worlds/{world_id}/objects")
async def objects_create(world_id: str, request: Request) -> JSONResponse:
    body = await request.json()
    try:
        prior, command_id, expected, revision = STORE.begin_mutate(world_id, body)
        if prior is not None:
            return JSONResponse(prior)
        object_id = body.get("objectId")
        asset_hash = body.get("assetHash")
        if not isinstance(object_id, str) or not isinstance(asset_hash, str):
            return _err(400, "objectId and assetHash required")
        wire_tf = validate_wire_transform(body.get("transform"))
        ue_tf = carina_to_ue(wire_tf)
        if not ue_bridge_available():
            return _err(
                501,
                "spawn requires host WorldRuntime IPC; rebuild once for SoftObjectPath spawn+collision",
                worldId=world_id,
                objectId=object_id,
                assetHash=asset_hash,
                stillNotLive=True,
            )
        world = STORE.load(world_id)
        reg = load_registry()
        entry = (reg.get("byHash") or {}).get(asset_hash) or (world.get("activatedAssets") or {}).get(asset_hash)
        mesh_name = body.get("meshName")
        soft = body.get("softObjectPath")
        if not isinstance(soft, str) or not soft:
            soft = None
        if not soft and isinstance(mesh_name, str) and entry:
            for mesh in entry.get("meshes") or []:
                if mesh.get("name") == mesh_name:
                    soft = mesh.get("softObjectPath")
                    break
        if not soft:
            soft = (entry or {}).get("softObjectPath")
        if not soft:
            return _err(404, "assetHash not prepared/activated", worldId=world_id, assetHash=asset_hash)
        ipc = send_command({
            "op": "spawn",
            "objectId": object_id,
            "assetHash": asset_hash,
            "softObjectPath": soft,
            "ueLocationCm": ue_tf["ueLocationCm"],
            "ueRotationQuat": ue_tf["ueRotationQuat"],
            "ueRotatorDeg": ue_tf["ueRotatorDeg"],
            "ueScale": ue_tf["ueScale"],
            "collision": wants_collision(object_id, body.get("collision") if isinstance(body.get("collision"), bool) else None),
        })
        if not ipc.get("ok"):
            return _err(501, f"UE spawn failed: {ipc.get('error')}", worldId=world_id, ipc=ipc)
        objs = [o for o in world.get("objects", []) if o.get("objectId") != object_id]
        objs.append({
            "objectId": object_id,
            "assetHash": asset_hash,
            "transform": wire_tf,
            "ueActorId": ipc.get("ueActorId"),
            "spawnMs": ipc.get("ms"),
        })
        world["objects"] = objs
        _set_active_world(world_id)
        out = {
            "ok": True,
            "worldId": world_id,
            "objectId": object_id,
            "assetHash": asset_hash,
            "commandId": command_id,
            "revision": revision,
            "ueActorId": ipc.get("ueActorId"),
            "spawnMs": ipc.get("ms"),
            "transform": wire_tf,
        }
        return JSONResponse(STORE.commit_success(world, command_id, revision, out))
    except WorldError as e:
        return _err(e.status, str(e), worldId=world_id)
    except ValueError as e:
        return _err(400, str(e), worldId=world_id)
    except Exception as e:
        traceback.print_exc()
        return _err(500, f"spawn failed (scene unchanged): {e}", worldId=world_id)


@app.patch("/v1/worlds/{world_id}/objects/{object_id}")
async def objects_patch(world_id: str, object_id: str, request: Request) -> JSONResponse:
    body = await request.json()
    try:
        prior, command_id, expected, revision = STORE.begin_mutate(world_id, body)
        if prior is not None:
            return JSONResponse(prior)
        if not ue_bridge_available():
            return _err(501, "move requires host WorldRuntime IPC", worldId=world_id, objectId=object_id)
        world = STORE.load(world_id)
        found = next((o for o in world.get("objects", []) if o.get("objectId") == object_id), None)
        if not found:
            return _err(404, "objectId not found", worldId=world_id, objectId=object_id)
        wire_tf = validate_wire_transform(body["transform"]) if body.get("transform") else found["transform"]
        ue_tf = carina_to_ue(wire_tf)
        ipc = send_command({
            "op": "move",
            "objectId": object_id,
            "ueLocationCm": ue_tf["ueLocationCm"],
            "ueRotationQuat": ue_tf["ueRotationQuat"],
            "ueRotatorDeg": ue_tf["ueRotatorDeg"],
            "ueScale": ue_tf["ueScale"],
        })
        if not ipc.get("ok"):
            return _err(501, f"UE move failed: {ipc.get('error')}", worldId=world_id, ipc=ipc)
        found["transform"] = wire_tf
        out = {
            "ok": True,
            "worldId": world_id,
            "objectId": object_id,
            "assetHash": found.get("assetHash"),
            "commandId": command_id,
            "revision": revision,
            "transform": wire_tf,
            "moveMs": ipc.get("ms"),
        }
        return JSONResponse(STORE.commit_success(world, command_id, revision, out))
    except WorldError as e:
        return _err(e.status, str(e), worldId=world_id)
    except ValueError as e:
        return _err(400, str(e), worldId=world_id)
    except Exception as e:
        traceback.print_exc()
        return _err(500, f"move failed (scene unchanged): {e}", worldId=world_id)


@app.post("/v1/worlds/{world_id}/objects/{object_id}/interact")
async def objects_interact(world_id: str, object_id: str, request: Request) -> JSONResponse:
    body = await request.json()
    try:
        prior, command_id, expected, revision = STORE.begin_mutate(world_id, body)
        if prior is not None:
            return JSONResponse(prior)
        kind = body.get("kind")
        if not isinstance(kind, str) or kind not in {"open", "close", "pickup", "drop", "use"}:
            return _err(400, "kind must be open|close|pickup|drop|use")
        if not ue_bridge_available():
            return _err(501, "interact requires host WorldRuntime IPC", worldId=world_id, objectId=object_id)
        world = STORE.load(world_id)
        found = next((o for o in world.get("objects", []) if o.get("objectId") == object_id), None)
        if not found:
            return _err(404, "objectId not found", worldId=world_id, objectId=object_id)
        ipc = send_command({"op": "interact", "objectId": object_id, "kind": kind})
        used_move_fallback = False
        if not ipc.get("ok") and "unknown op" in str(ipc.get("error", "")).lower():
            used_move_fallback = True
            raw = found.get("transform") or {}
            wire = validate_wire_transform(
                raw if isinstance(raw, dict) and "position" in raw else {
                    "position": {"x": 0.0, "y": 0.0, "z": 0.0},
                    "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
                    "scale": {"x": 1.0, "y": 1.0, "z": 1.0},
                }
            )
            if kind in {"open", "use"}:
                wire["rotation"]["y"] = float(wire["rotation"]["y"]) + math.pi / 2
            elif kind == "close":
                wire["rotation"]["y"] = float(wire["rotation"]["y"]) - math.pi / 2
            elif kind == "pickup":
                wire["position"]["y"] = 1.05
            elif kind == "drop":
                wire["position"]["y"] = 0.0
            ue_tf = carina_to_ue(wire)
            ipc = send_command({
                "op": "move",
                "objectId": object_id,
                "ueLocationCm": ue_tf["ueLocationCm"],
                "ueRotationQuat": ue_tf["ueRotationQuat"],
                "ueRotatorDeg": ue_tf["ueRotatorDeg"],
                "ueScale": ue_tf["ueScale"],
            })
            found["transform"] = wire
        if not ipc.get("ok"):
            return _err(501, f"UE interact failed: {ipc.get('error')}", worldId=world_id, ipc=ipc)
        found["interactKind"] = kind
        out = {
            "ok": True,
            "worldId": world_id,
            "objectId": object_id,
            "kind": kind,
            "commandId": command_id,
            "revision": revision,
            "interactMs": ipc.get("ms"),
            "notWorldModel": True,
            "moveFallback": used_move_fallback,
        }
        return JSONResponse(STORE.commit_success(world, command_id, revision, out))
    except WorldError as e:
        return _err(e.status, str(e), worldId=world_id)
    except Exception as e:
        traceback.print_exc()
        return _err(500, f"interact failed (scene unchanged): {e}", worldId=world_id)


@app.delete("/v1/worlds/{world_id}/objects/{object_id}")
async def objects_delete(world_id: str, object_id: str, request: Request) -> JSONResponse:
    body = await request.json()
    try:
        prior, command_id, expected, revision = STORE.begin_mutate(world_id, body)
        if prior is not None:
            return JSONResponse(prior)
        if not ue_bridge_available():
            return _err(501, "remove requires host WorldRuntime IPC", worldId=world_id, objectId=object_id)
        world = STORE.load(world_id)
        found = next((o for o in world.get("objects", []) if o.get("objectId") == object_id), None)
        if not found:
            return _err(404, "objectId not found", worldId=world_id, objectId=object_id)
        ipc = send_command({"op": "destroy", "objectId": object_id})
        if not ipc.get("ok"):
            return _err(501, f"UE destroy failed: {ipc.get('error')}", worldId=world_id, ipc=ipc)
        world["objects"] = [o for o in world.get("objects", []) if o.get("objectId") != object_id]
        out = {
            "ok": True,
            "worldId": world_id,
            "objectId": object_id,
            "assetHash": found.get("assetHash"),
            "commandId": command_id,
            "revision": revision,
            "destroyMs": ipc.get("ms"),
        }
        return JSONResponse(STORE.commit_success(world, command_id, revision, out))
    except WorldError as e:
        return _err(e.status, str(e), worldId=world_id)
    except Exception as e:
        traceback.print_exc()
        return _err(500, f"delete failed (scene unchanged): {e}", worldId=world_id)
