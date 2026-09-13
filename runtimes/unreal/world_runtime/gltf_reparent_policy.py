"""Decide which imported glTF material parents must move onto host Opaque.

Unreal is not imported here so tests can run on Mac. Not world-model.
"""
from __future__ import annotations

# Interchange Unlit / emissive / double-sided DS skip Lit; fill light then does nothing.
_REPARENT_NEEDLES = ("opaque_ds", "transmission", "unlit", "emissive")


def parent_needs_reparent(parent_name: str) -> bool:
    """True when the MIC parent will cook black or ignore dynamic lights in Lit."""
    n = parent_name.lower()
    if "mi_default_opaque" in n and "ds" not in n:
        return False
    return any(needle in n for needle in _REPARENT_NEEDLES)
