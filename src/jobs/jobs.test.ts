import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createJobQueue } from "./queue.js";

/**
 * zh: 暂停后仿真任务过期；编辑任务在 readSet 仍匹配时可提交。
 * en: Simulation jobs go stale after pause; edit jobs still apply when the readSet matches.
 */
test("simulation jobs go stale after pause while edit jobs may still apply", () => {
  const queue = createJobQueue();
  const readSet = {
    regionRevisions: { interior: "rev1" },
    objectVersions: { table: "v1" },
  };
  const sim = queue.enqueue({
    worldId: "w1",
    purpose: "simulation",
    baseRevision: "rev1",
    readSet,
    controlEpoch: 0,
  });
  const edit = queue.enqueue({
    worldId: "w1",
    purpose: "edit",
    kind: "generation",
    baseRevision: "rev1",
    readSet,
    controlEpoch: 0,
  });
  const exportJob = queue.enqueue({
    worldId: "w1",
    purpose: "export",
    kind: "export",
    baseRevision: "rev1",
    readSet,
    controlEpoch: 0,
  });
  assert.equal(sim.status, "succeeded");
  const ctxNow = { controlEpoch: 0, headRevision: "rev1", readSet };
  assert.equal(queue.isResultApplicable(sim, ctxNow), true);
  assert.equal(queue.isResultApplicable(edit, ctxNow), true);

  const afterPause = { controlEpoch: 1, headRevision: "rev1", readSet };
  assert.equal(queue.isResultApplicable(sim, afterPause), false);
  assert.equal(queue.isResultApplicable(edit, afterPause), true);
  assert.equal(queue.isResultApplicable(exportJob, afterPause), true);

  queue.reconcile({ controlEpoch: 1 });
  assert.equal(queue.observe(sim.jobId)?.status, "stale");
  assert.equal(queue.observe(edit.jobId)?.status, "succeeded");
});

/**
 * zh: 取消排队中的任务；已成功结果只能停止提交。
 * en: Cancel a queued job; a succeeded result can only stop commit.
 */
test("cancel queued jobs and stop-commit succeeded jobs", () => {
  const queue = createJobQueue();
  const readSet = { regionRevisions: {}, objectVersions: {} };
  const queued = queue.enqueue({
    worldId: "w1",
    purpose: "edit",
    baseRevision: "rev1",
    readSet,
    controlEpoch: 0,
    autoComplete: false,
  });
  assert.equal(queued.status, "queued");
  const cancelled = queue.cancel(queued.jobId);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cancelCapability, "stop_compute");

  const done = queue.enqueue({
    worldId: "w1",
    purpose: "export",
    kind: "export",
    baseRevision: "rev1",
    readSet,
    controlEpoch: 0,
  });
  const stopCommit = queue.cancel(done.jobId);
  assert.equal(stopCommit.status, "succeeded");
  assert.equal(stopCommit.cancelCapability, "stop_commit");
});

/**
 * zh: mark 写回队列；落盘后新队列能读到已成功任务，运行中任务不得再提交。
 * en: mark writes through; a new queue reloads successes and must not commit in-flight jobs.
 */
test("persisted jobs reload; in-flight jobs fail and are not applicable", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-jobs-"));
  const persistPath = path.join(dataDir, "jobs.json");
  const readSet = { regionRevisions: { interior: "rev1" }, objectVersions: {} };
  try {
    const live = createJobQueue({ persistPath });
    const queued = live.enqueue({
      worldId: "w1",
      purpose: "edit",
      baseRevision: "rev1",
      readSet,
      controlEpoch: 0,
      autoComplete: false,
    });
    assert.equal(queued.status, "queued");
    const marked = live.mark(queued.jobId, "succeeded", { progress: 1 });
    assert.equal(marked?.status, "succeeded");
    assert.equal(live.observe(queued.jobId)?.status, "succeeded");

    const stillRunning = live.enqueue({
      worldId: "w1",
      purpose: "edit",
      baseRevision: "rev1",
      readSet,
      controlEpoch: 0,
      autoComplete: false,
    });
    live.mark(stillRunning.jobId, "running");

    const reloaded = createJobQueue({ persistPath });
    assert.equal(reloaded.observe(queued.jobId)?.status, "succeeded");
    const interrupted = reloaded.observe(stillRunning.jobId);
    assert.equal(interrupted?.status, "failed");
    assert.equal(interrupted?.errorKey, "error.jobInterrupted");
    assert.equal(
      reloaded.isResultApplicable(interrupted!, {
        controlEpoch: 0,
        headRevision: "rev1",
        readSet,
      }),
      false,
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
