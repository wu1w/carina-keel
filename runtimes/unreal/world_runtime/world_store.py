"""In-memory + disk world state with opaque revision strings and commandId idempotency."""
from __future__ import annotations
import json
import threading
from pathlib import Path
from typing import Any

from . import config


class WorldError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


class WorldStore:
    def __init__(self) -> None:
        config.ensure_dirs()
        self._lock = threading.RLock()

    def _world_path(self, world_id: str) -> Path:
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in world_id)[:128]
        return config.WORLDS_DIR / f"{safe}.json"

    def _cmd_path(self, world_id: str, command_id: str) -> Path:
        safe_w = "".join(c if c.isalnum() or c in "-_" else "_" for c in world_id)[:64]
        safe_c = "".join(c if c.isalnum() or c in "-_" else "_" for c in command_id)[:96]
        d = config.COMMANDS_DIR / safe_w
        d.mkdir(parents=True, exist_ok=True)
        return d / f"{safe_c}.json"

    def load(self, world_id: str) -> dict[str, Any]:
        with self._lock:
            p = self._world_path(world_id)
            if not p.is_file():
                return {
                    "worldId": world_id,
                    "appliedRevision": "0",
                    "objects": [],
                    "installedAssets": {},
                    "activatedAssets": {},
                    "preparedAssets": {},
                }
            data = json.loads(p.read_text(encoding="utf-8"))
            data["worldId"] = world_id  # echo path id
            return data

    def save(self, world: dict[str, Any]) -> None:
        with self._lock:
            p = self._world_path(world["worldId"])
            tmp = p.with_suffix(".tmp")
            tmp.write_text(json.dumps(world, indent=2) + "\n", encoding="utf-8")
            tmp.replace(p)

    def get_idempotent(self, world_id: str, command_id: str) -> dict[str, Any] | None:
        p = self._cmd_path(world_id, command_id)
        if p.is_file():
            return json.loads(p.read_text(encoding="utf-8"))
        return None

    def put_idempotent(self, world_id: str, command_id: str, result: dict[str, Any]) -> None:
        p = self._cmd_path(world_id, command_id)
        p.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")

    def begin_mutate(self, world_id: str, body: dict[str, Any]) -> tuple[dict[str, Any], str, str, str]:
        """Validate commandId / expectedRevision / revision. Does NOT advance appliedRevision."""
        command_id = body.get("commandId")
        expected = body.get("expectedRevision")
        revision = body.get("revision")
        if not isinstance(command_id, str) or not command_id:
            raise WorldError("commandId (string) required", 400)
        if not isinstance(expected, str) or expected == "":
            raise WorldError("expectedRevision (opaque string) required", 400)
        if not isinstance(revision, str) or revision == "":
            raise WorldError("revision (opaque string) required", 400)
        prior = self.get_idempotent(world_id, command_id)
        if prior is not None:
            return prior, command_id, expected, revision  # caller must short-circuit
        world = self.load(world_id)
        if world.get("appliedRevision") != expected:
            raise WorldError(
                f"expectedRevision mismatch: got {expected!r} applied={world.get('appliedRevision')!r}",
                409,
            )
        return None, command_id, expected, revision  # type: ignore

    def commit_success(self, world: dict[str, Any], command_id: str, revision: str, result: dict[str, Any]) -> dict[str, Any]:
        """Advance appliedRevision only on success; store idempotent result."""
        world["appliedRevision"] = revision
        self.save(world)
        result = dict(result)
        result["appliedRevision"] = revision
        result["worldId"] = world["worldId"]
        self.put_idempotent(world["worldId"], command_id, result)
        return result


STORE = WorldStore()
