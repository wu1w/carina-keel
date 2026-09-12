import tempfile
import unittest
from pathlib import Path
import numpy as np
from camera_path import write_camera_path

class CameraPathTest(unittest.TestCase):
    def test_forward_and_right(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            write_camera_path(p, 'forward', 1.05)
            poses = np.load(p/'poses.npy')
            self.assertEqual(poses.shape, (13,4,4))
            np.testing.assert_allclose(poses[0], np.eye(4))
            self.assertAlmostEqual(float(poses[-1,2,3]), .55, places=5)
            k = np.load(p/'intrinsics.npy')
            self.assertEqual(k.shape, (13,4))
            self.assertAlmostEqual(float(k[0,0]), 240/np.tan(1.05/2), places=4)
            write_camera_path(p, 'right', 1.05)
            poses = np.load(p/'poses.npy')
            self.assertGreater(poses[-1,0,2], 0)
            np.testing.assert_allclose(poses[-1,:3,:3].T@poses[-1,:3,:3], np.eye(3), atol=1e-6)
            with self.assertRaises(ValueError): write_camera_path(p, 'invalid', 1.05)

if __name__ == '__main__': unittest.main()
