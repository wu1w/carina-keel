"""glTF MIC reparent policy. Stdlib only. Not world-model."""
from __future__ import annotations
import unittest

from gltf_reparent_policy import parent_needs_reparent


class ReparentPolicyTests(unittest.TestCase):
    def test_opaque_ds_and_unlit_need_reparent(self) -> None:
        self.assertTrue(parent_needs_reparent("MI_Default_Opaque_DS"))
        self.assertTrue(parent_needs_reparent("MI_gltf_Unlit"))
        self.assertTrue(parent_needs_reparent("M_Unlit_Emissive"))
        self.assertTrue(parent_needs_reparent("MI_Transmission"))

    def test_already_opaque_stays(self) -> None:
        self.assertFalse(parent_needs_reparent("MI_Default_Opaque"))
        self.assertFalse(parent_needs_reparent(""))
        self.assertFalse(parent_needs_reparent("M_SomeLitParent"))


if __name__ == "__main__":
    unittest.main()
