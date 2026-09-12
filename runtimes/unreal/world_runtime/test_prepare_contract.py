"""WorldRuntime prepare contract. Stdlib only. Not world-model generation."""
from __future__ import annotations
import unittest

from prepare_contract import PrepareContractError, validate_prepare_request


GOOD_HASH = "8dd45448bbac70a031ab5281e2455604cd1beb7bbed10beac54ff287201f6697"
GOOD_ID = GOOD_HASH[:16]


class PrepareContractTests(unittest.TestCase):
    def test_accepts_asset_id_and_full_hash(self) -> None:
        asset_id, asset_hash = validate_prepare_request(
            {
                "assetId": GOOD_ID,
                "assetHash": GOOD_HASH,
                "commandId": "cmd-1",
                "expectedRevision": "f2-sp-bb2",
                "revision": "p0-tavern-1",
            },
        )
        self.assertEqual(asset_id, GOOD_ID)
        self.assertEqual(asset_hash, GOOD_HASH)

    def test_rejects_glb_path_and_url(self) -> None:
        base = {"assetId": GOOD_ID, "assetHash": GOOD_HASH}
        for key, value in (
            ("glbPath", r"C:\secret\tavern.glb"),
            ("glbUrl", "https://example.invalid/tavern.glb"),
            ("path", "/tmp/tavern.glb"),
            ("url", "http://127.0.0.1/tavern.glb"),
        ):
            with self.subTest(key=key):
                with self.assertRaises(PrepareContractError) as ctx:
                    validate_prepare_request({**base, key: value})
                self.assertIn("not accepted", str(ctx.exception))

    def test_rejects_short_or_mismatched_hash(self) -> None:
        with self.assertRaises(PrepareContractError):
            validate_prepare_request({"assetId": GOOD_ID, "assetHash": "abc"})
        with self.assertRaises(PrepareContractError):
            validate_prepare_request(
                {
                    "assetId": "aaaaaaaaaaaaaaaa",
                    "assetHash": GOOD_HASH,
                },
            )

    def test_does_not_claim_world_model_generation(self) -> None:
        body = {"assetId": GOOD_ID, "assetHash": GOOD_HASH}
        validate_prepare_request(body)
        self.assertNotIn("world-model", GOOD_ID)
        self.assertEqual(body.get("source"), None)


if __name__ == "__main__":
    unittest.main()
