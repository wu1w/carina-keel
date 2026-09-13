"""Interior visibility cvars for WorldRuntime.

Control-plane only. Isolate/shoot callers exec these via IPC op `highresshot`.
They raise viewport visibility; they do not spawn lights, bake GI, or generate
lighting. Not a P1 pass. Not world-model.
"""
from __future__ import annotations

from collections.abc import Callable
from typing import Any

# UE 5.8 names only. There is no `r.SkylightIntensity`; the engine cvar is
# `r.SkylightIntensityMultiplier`. Values stay modest (existing P1 stills used 4–8).
_LIT_INTERIOR_EXECS: tuple[str, ...] = (
    "viewmode Lit",
    "r.AmbientOcclusionLevels 1",
    "r.SkylightIntensityMultiplier 2",
    "r.TonemapperGamma 2.2",
    "r.EyeAdaptationQuality 2",
    "r.DefaultFeature.AutoExposure 1",
    "ShowFlag.Tonemapper 1",
)


def lit_interior_execs() -> list[str]:
    """UE 5.8 console commands that raise interior visibility.

    - viewmode Lit — leave Unlit/Wireframe
    - r.AmbientOcclusionLevels 1 — one SSAO mip (0 disables; 3 is heavier)
    - r.SkylightIntensityMultiplier 2 — modest skylight (UE 5.8 name)
    - r.TonemapperGamma 2.2 — display gamma
    - r.EyeAdaptationQuality 2 — default auto-exposure quality
    - r.DefaultFeature.AutoExposure 1 — let EyeAdaptation run
    - ShowFlag.Tonemapper 1 — keep the tonemapper on

    Callers exec each string via the host IPC `highresshot` op. This module
    does not talk to Unreal; `isolate_then_lit` only invokes the injected
    `send_command` callback.
    """
    return list(_LIT_INTERIOR_EXECS)


def apply_lit_interior(
    send_command: Callable[[dict[str, Any]], Any],
    execs: list[str] | None = None,
) -> dict[str, Any]:
    """Exec visibility cvars via the existing `highresshot` IPC op.

    Not a P1 pass. Does not spawn lights or claim generated lighting.
    """
    cmds = list(execs) if execs is not None else lit_interior_execs()
    replies: list[Any] = []
    for cmd in cmds:
        replies.append(send_command({"op": "highresshot", "exec": cmd}))
    return {
        "litInteriorExecs": cmds,
        "viewmodeLit": any(c.strip().lower() == "viewmode lit" for c in cmds),
        "p1Pass": False,
        "claimsGeneratedLighting": False,
        "claimsWorldModelGeneration": False,
        "interiorLitVerified": False,
        "litInteriorReplies": replies,
    }


def isolate_then_lit(
    send_command: Callable[[dict[str, Any]], Any],
    *,
    hidden: bool = True,
    execs: list[str] | None = None,
) -> dict[str, Any]:
    """`isolate_carina`, then exec Lit visibility cvars.

    Order is the contract: isolate first, then each `highresshot` exec.
    Fill-light isolate is unchanged; these cvars are not generated lighting.
    """
    cmds = list(execs) if execs is not None else lit_interior_execs()
    isolate = send_command({"op": "isolate_carina", "hidden": hidden})
    lit = apply_lit_interior(send_command, cmds)
    return {
        "isolate": isolate,
        "litInteriorExecs": lit["litInteriorExecs"],
        "viewmodeLit": lit["viewmodeLit"],
        "p1Pass": False,
        "claimsGeneratedLighting": False,
        "claimsWorldModelGeneration": False,
        "interiorLitVerified": False,
        "litInteriorReplies": lit["litInteriorReplies"],
    }


def lit_interior_evidence() -> dict[str, Any]:
    """JSON helper for probes. Visibility cvars only; never a generation claim."""
    return {
        "notWorldModel": True,
        "claimsWorldModelGeneration": False,
        "claimsGeneratedLighting": False,
        "p1Pass": False,
        "interiorLitVerified": False,
        "liveUe": False,
        "scp": False,
        "kind": "visibility-cvars",
        "engine": "UE5.8",
        "wiredAfterIsolate": True,
        "execs": lit_interior_execs(),
        "note": (
            "Control-plane visibility cvars. isolate/shoot paths exec these via "
            "IPC highresshot after isolate_carina. Not generated lighting. Not "
            "world-model lighting. Not a P1 pass. This dump did not run live UE."
        ),
    }


if __name__ == "__main__":
    import json

    print(json.dumps(lit_interior_evidence(), indent=2))
