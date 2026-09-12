"""Classify imported PBR texture filenames. Stdlib only. Not world-model."""
from __future__ import annotations


def opaque_mic_factors(name: str) -> tuple[float, float]:
    n = name.lower()
    if "metal" in n:
        return 1.0, 0.28
    if "glass" in n or "trans" in n:
        return 0.0, 0.08
    if "brick" in n:
        return 0.0, 0.72
    return 0.0, 0.6


def classify_texture_stem(stem: str) -> str:
    n = stem.lower()
    if "normal" in n:
        return "normal"
    if "metalness" in n or "metallic" in n:
        return "metallic"
    if "rough" in n:
        return "roughness"
    if "color" in n or "albedo" in n or "basecolor" in n or "base_color" in n:
        return "baseColor"
    return "other"


def texture_roles_from_paths(paths: list[str]) -> dict[str, str]:
    roles: dict[str, str] = {}
    for path in paths:
        stem = path.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
        stem = stem.rsplit(".", 1)[0]
        role = classify_texture_stem(stem)
        if role != "other" and role not in roles:
            roles[role] = path
    return roles
