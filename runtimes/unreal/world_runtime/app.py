
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
from .ipc_ue import send_command, ue_bridge_available
from .prepare_contract import PrepareContractError, validate_prepare_request
from .pipeline_install import install_asset
from .pipeline_prepare import prepare_asset
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
    return {"ok": True, "live": bool(config.LIVE), "port": config.PORT}


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
        result_inner = prepare_asset(asset_id, asset_hash)
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
            "collision": True,
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
