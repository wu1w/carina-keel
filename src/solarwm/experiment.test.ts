import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runSolarWmExperiment } from "./experiment.js";

/**
 * zh: 未设根目录时 SolarWM 阻塞，且不得把视频写成网格或世界模型。
 * en: Unset root blocks SolarWM and must not label video as a mesh or world model.
 */
test("runSolarWmExperiment stays blocked without a root and never produces a mesh", () => {
  const row = runSolarWmExperiment({});
  assert.equal(row.claimsWorldModelGeneration, false);
  assert.equal(row.producesMesh, false);
  assert.equal(row.dryRunIsNotEvidence, true);
  assert.equal(row.status, "blocked-no-runtime");
});

/**
 * zh: 源码目录存在也只记 video-not-asset，dry-run 不是三维证据。
 * en: A source tree still records video-not-asset; dry-run is not 3D evidence.
 */
test("runSolarWmExperiment treats a present tree as video-not-asset", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "carina-solarwm-"));
  try {
    const row = runSolarWmExperiment({ root: dir });
    assert.equal(row.claimsWorldModelGeneration, false);
    assert.equal(row.producesMesh, false);
    assert.equal(row.dryRunIsNotEvidence, true);
    assert.equal(row.status, "video-not-asset");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * zh: 路径不存在仍 blocked，不能当成已接入推理。
 * en: A missing path stays blocked and is not a live inference hookup.
 */
test("runSolarWmExperiment blocks a missing root path", () => {
  const row = runSolarWmExperiment({
    root: path.join(tmpdir(), "carina-solarwm-missing"),
  });
  assert.equal(row.status, "blocked-no-runtime");
  assert.equal(row.producesMesh, false);
});
