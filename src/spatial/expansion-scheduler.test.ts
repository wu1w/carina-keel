import assert from "node:assert/strict";
import test from "node:test";
import { buildConnectedTavern, buildPrimitiveTavern } from "./primitive-tavern.js";
import {
  decideExpansion,
  evaluateExpansionHit,
  ExpansionTracker,
} from "./expansion-scheduler.js";

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


/**
 * zh: 已接花园时走近接缝只标 ready，不再入队。这是调度器数据，不是 P4 故事通过。
 * en: Approaching a seam with a garden already attached marks ready and does not enqueue. Scheduler data, not a P4 story pass.
 */
test("boundary-near marks expansion ready without claiming a P4 pass", () => {
  const tavern = buildConnectedTavern("w-ready", "rev1");
  const snapshot = { regions: tavern.regions, objects: tavern.objects };
  const far = evaluateExpansionHit({
    snapshot,
    player: { x: 4, y: 0, z: 2 },
  });
  assert.equal(far.hasAdjacent, true);
  assert.equal(far.nearBoundary, false);
  assert.equal(far.wouldEnqueue, false);
  assert.equal(far.wouldMarkReady, false);
  assert.equal(far.stage, "committed");
  assert.equal(far.readyReserve, 1);

  const near = evaluateExpansionHit({
    snapshot,
    player: { x: 4, y: 0, z: 4.2 },
  });
  assert.equal(near.nearBoundary, true);
  assert.equal(near.wouldEnqueue, false);
  assert.equal(near.wouldMarkReady, true);
  assert.equal(near.stage, "ready");
  assert.equal(near.readyReserve, 1);
  assert.equal(near.decision.cacheHit || near.cacheHit, true);

  const tracker = new ExpansionTracker();
  tracker.countApproach("w-ready");
  tracker.countCacheHit("w-ready");
  const log = tracker.snapshot({
    worldId: "w-ready",
    hasAdjacent: true,
    inFlight: false,
    nearBoundary: true,
  });
  assert.equal(log.stage, "ready");
  assert.equal(log.readyReserve, 1);
  assert.equal(log.claimsWorldModelGeneration, false);
  assert.match(log.notes, /not world-model/i);
});

/**
 * zh: 还没有邻区时走近门口会入队 planned，不是 ready，也不是世界模型生成。
 * en: Approaching a door with no neighbor enqueues planned, not ready, and not world-model generation.
 */
test("boundary-near without a garden would enqueue planned, not ready", () => {
  const tavern = buildPrimitiveTavern("w-plan", "rev1");
  const hit = evaluateExpansionHit({
    snapshot: { regions: tavern.regions, objects: tavern.objects },
    player: { x: 4, y: 0, z: 4.2 },
  });
  assert.equal(hit.hasAdjacent, false);
  assert.equal(hit.nearBoundary, true);
  assert.equal(hit.wouldEnqueue, true);
  assert.equal(hit.wouldMarkReady, false);
  assert.equal(hit.stage, "planned");
  assert.equal(hit.readyReserve, 0);
});
