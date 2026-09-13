"""Which spawned objects keep UE collision.

Space shells are a single-viewpoint visual overlay. Their mesh fills the room
and must not block walking; SceneSpec scaffold boxes keep the floor/walls.
"""


def wants_collision(object_id: str, override: bool | None = None) -> bool:
    if override is not None:
        return override
    return "space-shell" not in (object_id or "")
