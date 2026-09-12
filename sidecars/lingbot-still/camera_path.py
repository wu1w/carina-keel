"""Numeric OpenCV camera conditioning for one short exploration segment."""
import math
import numpy as np

DELTAS = {
    'forward': (0, .55, 0), 'back': (0, -.55, 0),
    'left': (0, 0, -.32), 'right': (0, 0, .32),
    'strafeLeft': (-.55, 0, 0), 'strafeRight': (.55, 0, 0),
}


def write_camera_path(directory, direction, fov_y, frame_num=13):
    if direction not in DELTAS or not .3 <= fov_y <= 1.8:
        raise ValueError('invalid camera request')
    dx, dz, yaw = DELTAS[direction]
    poses = np.repeat(np.eye(4, dtype=np.float32)[None], frame_num, axis=0)
    for i, t in enumerate(np.linspace(0, 1, frame_num)):
        angle = yaw * t
        c, s = math.cos(angle), math.sin(angle)
        poses[i, :3, :3] = [[c, 0, s], [0, 1, 0], [-s, 0, c]]
        poses[i, :3, 3] = [dx*t, 0, dz*t]
    focal = 240 / math.tan(fov_y/2)
    intrinsics = np.repeat(np.array([[focal, focal, 416, 240]], dtype=np.float32), frame_num, axis=0)
    np.save(str(directory / 'poses.npy'), poses)
    np.save(str(directory / 'intrinsics.npy'), intrinsics)
    return dict(x=dx, z=dz, yaw=yaw)
