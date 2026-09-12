"""Carina wire transform (Y-up meters, XYZ Euler radians) -> UE internal.

Wire NEVER carries quaternions. Internal UE quaternion is named ueRotationQuat only.
"""
from __future__ import annotations
import math
from typing import Any


def _v3(d: dict[str, Any] | None, default: float = 0.0) -> dict[str, float]:
    d = d or {}
    return {
        "x": float(d.get("x", default)),
        "y": float(d.get("y", default)),
        "z": float(d.get("z", default)),
    }


def identity_wire_transform() -> dict[str, Any]:
    """Spawn at origin. Use when Interchange meshes already contain world-space verts."""
    return {
        "position": {"x": 0.0, "y": 0.0, "z": 0.0},
        "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
        "scale": {"x": 1.0, "y": 1.0, "z": 1.0},
    }


def validate_wire_transform(t: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(t, dict):
        raise ValueError("transform must be object")
    rot = t.get("rotation")
    if isinstance(rot, dict) and ("w" in rot):
        raise ValueError("transform.rotation must be XYZ Euler radians {x,y,z}; quaternion not allowed on wire")
    pos = _v3(t.get("position"), 0.0)
    rotation = _v3(t.get("rotation"), 0.0)
    scale = _v3(t.get("scale"), 1.0)
    return {"position": pos, "rotation": rotation, "scale": scale}


def _euler_xyz_rad_to_quat(rx: float, ry: float, rz: float) -> tuple[float, float, float, float]:
    """Intrinsic XYZ Euler radians -> quaternion (x,y,z,w) in Carina/RH space."""
    cx, sx = math.cos(rx * 0.5), math.sin(rx * 0.5)
    cy, sy = math.cos(ry * 0.5), math.sin(ry * 0.5)
    cz, sz = math.cos(rz * 0.5), math.sin(rz * 0.5)
    # q = qx * qy * qz
    x = sx * cy * cz + cx * sy * sz
    y = cx * sy * cz - sx * cy * sz
    z = cx * cy * sz + sx * sy * cz
    w = cx * cy * cz - sx * sy * sz
    return (x, y, z, w)


def carina_to_ue(transform: dict[str, Any]) -> dict[str, Any]:
    """Centralized boundary converter.

    Position: meters Y-up RH -> centimeters Z-up UE.
      UE.X =  Carina.X * 100
      UE.Y =  Carina.Z * 100
      UE.Z =  Carina.Y * 100
    Rotation: Carina XYZ Euler rad -> basis-changed ueRotationQuat -> UE rotator degrees.
    Scale: axis-permuted to match position basis (X,Z,Y).
    """
    t = validate_wire_transform(transform)
    p, r, s = t["position"], t["rotation"], t["scale"]
    ue_pos = {"x": p["x"] * 100.0, "y": p["z"] * 100.0, "z": p["y"] * 100.0}
    ue_scale = {"x": s["x"], "y": s["z"], "z": s["y"]}
    qx, qy, qz, qw = _euler_xyz_rad_to_quat(r["x"], r["y"], r["z"])
    # Basis change RH Y-up -> LH Z-up approx: remap quat axes (x,y,z,w)_c -> (x,z,y,w) then conjugate Y for LH
    # Practical importer mapping used by many glTF->UE paths:
    #   ueRotationQuat = (qx, qz, qy, -qw) after axis remap — validate with asymmetric mesh later.
    ue_rotation_quat = {"x": qx, "y": qz, "z": qy, "w": -qw}
    # Convert quat to UE rotator (pitch=Y, yaw=Z, roll=X) degrees for IPC consumers
    x, y, z, w = ue_rotation_quat["x"], ue_rotation_quat["y"], ue_rotation_quat["z"], ue_rotation_quat["w"]
    # roll (x), pitch (y), yaw (z)
    sinr_cosp = 2 * (w * x + y * z)
    cosr_cosp = 1 - 2 * (x * x + y * y)
    roll = math.atan2(sinr_cosp, cosr_cosp)
    sinp = 2 * (w * y - z * x)
    sinp = max(-1.0, min(1.0, sinp))
    pitch = math.asin(sinp)
    siny_cosp = 2 * (w * z + x * y)
    cosy_cosp = 1 - 2 * (y * y + z * z)
    yaw = math.atan2(siny_cosp, cosy_cosp)
    ue_rotator_deg = {
        "pitch": math.degrees(pitch),
        "yaw": math.degrees(yaw),
        "roll": math.degrees(roll),
    }
    return {
        "ueLocationCm": ue_pos,
        "ueRotationQuat": ue_rotation_quat,
        "ueRotatorDeg": ue_rotator_deg,
        "ueScale": ue_scale,
        "wireTransform": t,
    }
