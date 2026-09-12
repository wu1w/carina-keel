import assert from "node:assert/strict";
import test from "node:test";
import { compileWorldRules } from "../spatial/compile-world-rules.js";
import {
  buildConnectedTavern,
  buildPrimitiveTavern,
} from "../spatial/primitive-tavern.js";
import { createRuntime } from "./create-runtime.js";

function tavernRuntime(worldId: string, connected = false) {
  const revision = "rev1";
  const tavern = connected
    ? buildConnectedTavern(worldId, revision)
    : buildPrimitiveTavern(worldId, revision);
  const runtime = createRuntime({
    worldId,
    revision,
    regions: tavern.regions,
    objects: tavern.objects,
    worldRules: compileWorldRules("", revision, "h"),
    controlEpoch: 0,
  });
  return { tavern, runtime };
}

/**
 * zh: 走进西墙被挡住；贴墙时可沿墙滑动。
 * en: Walking into the west wall is blocked; motion along the wall still slides.
 */
test("west wall blocks inward motion and allows a slide along it", () => {
  const { runtime } = tavernRuntime("rt-wall");
  const southLane = runtime.executePlayerAction({
    kind: "move",
    position: { x: 4, y: 0, z: 0.8 },
  });
  assert.equal(southLane.ok, true);
  const intoWall = runtime.executePlayerAction({
    kind: "move",
    position: { x: -1, y: 0, z: 0.8 },
  });
  assert.equal(intoWall.ok, false);
  assert.equal(intoWall.reason, "blocked");
  assert.ok(intoWall.snapshot.player.position.x > 0.35);
  assert.ok(intoWall.snapshot.player.position.x < 1);

  const slid = runtime.executePlayerAction({
    kind: "move",
    position: { x: -1, y: 0, z: 4 },
  });
  assert.equal(slid.ok, false);
  assert.equal(slid.reason, "blocked");
  assert.ok(slid.snapshot.player.position.x > 0.35);
  assert.ok(slid.snapshot.player.position.z > 3.5);
});

/**
 * zh: 关门挡门洞；开门可通过；距离外开门失败。
 * en: A closed door blocks; an open door passes; open from too far fails.
 */
test("closed door blocks, open door passes, and open from too far fails", () => {
  const { tavern, runtime } = tavernRuntime("rt-door-range", true);
  const door = tavern.objects.find((object) => object.name === "门");
  assert.ok(door !== undefined);

  const blocked = runtime.executePlayerAction({
    kind: "move",
    position: { x: 4, y: 0, z: 8 },
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "blocked");
  assert.ok(blocked.snapshot.player.position.z < 6);

  const south = runtime.executePlayerAction({
    kind: "move",
    position: { x: 4, y: 0, z: 0.4 },
  });
  assert.equal(south.ok, true);
  const tooFar = runtime.executePlayerAction({
    kind: "open",
    targetId: door.sceneObjectId,
  });
  assert.equal(tooFar.ok, false);
  assert.equal(tooFar.reason, "too_far");

  const approach = runtime.executePlayerAction({
    kind: "move",
    position: { x: 4, y: 0, z: 4.2 },
  });
  assert.equal(approach.ok, true);
  const opened = runtime.executePlayerAction({
    kind: "open",
    targetId: door.sceneObjectId,
  });
  assert.equal(opened.ok, true);
  const through = runtime.executePlayerAction({
    kind: "move",
    position: { x: 4, y: 0, z: 8 },
  });
  assert.equal(through.ok, true);
  assert.ok(through.snapshot.player.position.z > 6.5);
});

/**
 * zh: 杯子捡起离开桌面；放下无幽灵副本；暂停时仍可捡。
 * en: Pickup leaves the table; drop leaves one cup; pause still allows pickup.
 */
test("cup pickup leaves the table, drop has no ghost copy, pause still picks up", () => {
  const { tavern, runtime } = tavernRuntime("rt-cup-ghost");
  const cup = tavern.objects.find((object) => object.name === "杯子");
  assert.ok(cup !== undefined);
  const tablePos = { ...cup.transform.position };

  runtime.pause();
  const pickup = runtime.executePlayerAction({
    kind: "pickup",
    targetId: cup.sceneObjectId,
  });
  assert.equal(pickup.ok, true);
  assert.equal(runtime.getRunState(), "paused");
  const cupsHeld = pickup.snapshot.objects.filter(
    (object) => object.sceneObjectId === cup.sceneObjectId,
  );
  assert.equal(cupsHeld.length, 1);
  assert.ok(
    Math.hypot(cupsHeld[0]!.position.x - tablePos.x, cupsHeld[0]!.position.z - tablePos.z) >
      0.05,
  );

  const dropped = runtime.executePlayerAction({
    kind: "drop",
    targetId: cup.sceneObjectId,
  });
  assert.equal(dropped.ok, true);
  const cups = dropped.snapshot.objects.filter(
    (object) => object.sceneObjectId === cup.sceneObjectId,
  );
  assert.equal(cups.length, 1);
  assert.equal(dropped.snapshot.player.holdingObjectIds.length, 0);
  assert.ok(cups[0]!.position.y < 0.2);
});
