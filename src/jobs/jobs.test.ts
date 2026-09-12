import assert from "node:assert/strict";
import test from "node:test";
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
