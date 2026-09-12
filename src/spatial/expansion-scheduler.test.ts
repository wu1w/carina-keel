import assert from "node:assert/strict";
import test from "node:test";
import { decideExpansion, ExpansionTracker } from "./expansion-scheduler.js";

/**
 * zh: 已有花园再靠近是缓存命中，不再生成。
 * en: Approaching an existing garden is a cache hit, not another generate.
 */
test("decideExpansion cache-hits an existing adjacent region", () => {
  const hit = decideExpansion({
    hasAdjacent: true,
    needed: true,
    force: false,
    autoStopped: false,
    inFlight: false,
    generateCount: 1,
    maxAutoGenerates: 2,
  });
  assert.equal(hit.action, "skip");
  assert.equal(hit.stage, "committed");
  assert.equal(hit.cacheHit, true);
});

/**
 * zh: 停止生成挡住自动扩展，强制命令仍可生成。
 * en: Stop blocks auto expand; a forced command may still generate.
 */
test("decideExpansion stop blocks auto but not force", () => {
  const auto = decideExpansion({
    hasAdjacent: false,
    needed: true,
    force: false,
    autoStopped: true,
    inFlight: false,
    generateCount: 0,
    maxAutoGenerates: 2,
  });
  assert.equal(auto.action, "skip");
  assert.equal(auto.stage, "blocked-stopped");
  const forced = decideExpansion({
    hasAdjacent: false,
    needed: true,
    force: true,
    autoStopped: true,
    inFlight: false,
    generateCount: 0,
    maxAutoGenerates: 2,
  });
  assert.equal(forced.action, "generate");
});

/**
 * zh: 超过自动次数后不再后台接区。
 * en: Auto expand stops after the auto-generate budget.
 */
test("decideExpansion respects auto generate budget", () => {
  const blocked = decideExpansion({
    hasAdjacent: false,
    needed: true,
    force: false,
    autoStopped: false,
    inFlight: false,
    generateCount: 2,
    maxAutoGenerates: 2,
  });
  assert.equal(blocked.action, "skip");
  assert.equal(blocked.stage, "blocked-budget");
});

/**
 * zh: 调度日志不得宣称世界模型生成。
 * en: The scheduler log must not claim world-model generation.
 */
test("ExpansionTracker snapshot never claims world-model generation", () => {
  const tracker = new ExpansionTracker();
  tracker.countGenerate("w1");
  const log = tracker.snapshot({
    worldId: "w1",
    hasAdjacent: true,
    inFlight: false,
  });
  assert.equal(log.claimsWorldModelGeneration, false);
  assert.equal(log.stage, "committed");
  assert.equal(log.readyReserve, 1);
  assert.equal(log.generateCount, 1);
  assert.match(log.notes, /not world-model/i);
});
