import assert from "node:assert/strict";
import test from "node:test";
import { interpretFast } from "./interpret-fast.js";

/**
 * zh: 暂停世界不走 LLM。
 * en: Pause-world is recognized without an LLM.
 */
test("interpretFast recognizes pause and create world", () => {
  const pause = interpretFast({
    text: "暂停世界",
    worldId: "01WORLD",
    origin: "natural_language",
    requestedBy: "user",
  });
  assert.ok(pause !== undefined);
  assert.equal(pause[0]?.intentKind, "world.pause");

  const created = interpretFast({
    text: "新建一个黄昏湖边酒馆",
    origin: "natural_language",
    requestedBy: "user",
  });
  assert.ok(created !== undefined);
  assert.equal(created[0]?.intentKind, "session.create");
  assert.equal(created[0]?.arguments["name"], "黄昏湖边酒馆");
});

/**
 * zh: 固化落盘不走 LLM。
 * en: Freeze-to-disk is recognized without an LLM.
 */
test("interpretFast recognizes freeze as spatial.freeze", () => {
  const freeze = interpretFast({
    text: "固化这间屋子",
    worldId: "01WORLD",
    origin: "natural_language",
    requestedBy: "user",
  });
  assert.ok(freeze !== undefined);
  assert.equal(freeze[0]?.intentKind, "spatial.freeze");
});

/**
 * zh: 拿起/放下杯子不走 LLM。
 * en: Pick up / drop the cup is recognized without an LLM.
 */
test("interpretFast recognizes pickup and drop", () => {
  const pickup = interpretFast({
    text: "拿起杯子",
    worldId: "01WORLD",
    origin: "natural_language",
    requestedBy: "user",
  });
  assert.ok(pickup !== undefined);
  assert.equal(pickup[0]?.intentKind, "player.act");
  assert.equal(pickup[0]?.arguments["action"], "pickup");
  assert.equal(pickup[0]?.arguments["name"], "杯子");

  const dropped = interpretFast({
    text: "放下杯子",
    worldId: "01WORLD",
    origin: "natural_language",
    requestedBy: "user",
  });
  assert.ok(dropped !== undefined);
  assert.equal(dropped[0]?.intentKind, "player.act");
  assert.equal(dropped[0]?.arguments["action"], "drop");
});

/**
 * zh: 门外生成花园是扩展，不是看一眼视频。
 * en: Extending a garden is generation.extend, not an observation look.
 */
test("interpretFast recognizes garden extend and does not treat walk-in as look", () => {
  const extended = interpretFast({
    text: "在门外生成花园",
    worldId: "01WORLD",
    origin: "natural_language",
    requestedBy: "user",
  });
  assert.ok(extended !== undefined);
  assert.equal(extended[0]?.intentKind, "generation.extend");

  const walkIn = interpretFast({
    text: "走进花园",
    worldId: "01WORLD",
    origin: "natural_language",
    requestedBy: "user",
  });
  assert.ok(walkIn !== undefined);
  assert.equal(walkIn[0]?.intentKind, "generation.extend");
  assert.equal(walkIn[1]?.intentKind, "player.act");
  assert.equal(walkIn[1]?.arguments["action"], "open");
});

/**
 * zh: 看一眼走观测，不提交网格。
 * en: Look is observation-only, not a mesh commit.
 */
test("interpretFast recognizes look as observeOnly generation", () => {
  const look = interpretFast({
    text: "看一眼",
    worldId: "01WORLD",
    origin: "natural_language",
    requestedBy: "user",
  });
  assert.ok(look !== undefined);
  assert.equal(look[0]?.intentKind, "generation.start");
  assert.equal(look[0]?.arguments["observeOnly"], true);
  assert.equal(look[0]?.arguments["shotKind"], "camera");
  assert.equal(look[0]?.arguments["fresh"], false);

  const generate = interpretFast({
    text: "生成一个黄昏湖边酒馆",
    worldId: "01WORLD",
    origin: "natural_language",
    requestedBy: "user",
  });
  assert.ok(generate !== undefined);
  assert.equal(generate[0]?.intentKind, "generation.start");
  assert.equal(generate[0]?.arguments["observeOnly"], true);
  assert.equal(generate[0]?.arguments["shotKind"], "scene");
  assert.equal(generate[0]?.arguments["fresh"], true);
});

/**
 * zh: 看向画面里的东西是调镜头；换成地点是改场景。
 * en: Facing something in frame is camera; swapping the place is scene.
 */
test("interpretFast classifies camera vs scene utterances", () => {
  const camera = interpretFast({
    text: "看向吧台",
    worldId: "01WORLD",
    origin: "natural_language",
    requestedBy: "user",
  });
  assert.ok(camera !== undefined);
  assert.equal(camera[0]?.intentKind, "generation.start");
  assert.equal(camera[0]?.arguments["shotKind"], "camera");
  assert.equal(camera[0]?.arguments["fresh"], false);

  const scene = interpretFast({
    text: "世界，湖边，夕阳，酒馆",
    worldId: "01WORLD",
    origin: "natural_language",
    requestedBy: "user",
  });
  assert.ok(scene !== undefined);
  assert.equal(scene[0]?.intentKind, "generation.start");
  assert.equal(scene[0]?.arguments["shotKind"], "scene");
});

/**
 * zh: 无 apiKey 把吧台左移编成 spatial.calibrate，米制 −X。
 * en: Without an apiKey, moving the bar left compiles to spatial.calibrate with metric −X.
 */
test("interpretFast recognizes tavern bar calibrate as spatial.calibrate", () => {
  const moved = interpretFast({
    text: "把吧台往左移一米",
    worldId: "01WORLD",
    origin: "natural_language",
    requestedBy: "user",
  });
  assert.ok(moved !== undefined);
  assert.equal(moved[0]?.intentKind, "spatial.calibrate");
  assert.equal(moved[0]?.arguments["objectId"], "bar-front");
  assert.deepEqual(moved[0]?.arguments["delta"], { x: -1, y: 0, z: 0 });

  const compact = interpretFast({
    text: "吧台左移 1 米",
    worldId: "01WORLD",
    origin: "natural_language",
    requestedBy: "user",
  });
  assert.ok(compact !== undefined);
  assert.equal(compact[0]?.intentKind, "spatial.calibrate");
  assert.equal(compact[0]?.arguments["objectId"], "bar-front");
  assert.deepEqual(compact[0]?.arguments["delta"], { x: -1, y: 0, z: 0 });

  const barOnly = interpretFast({
    text: "把吧台往左移一米",
    worldId: "01WORLD",
    origin: "natural_language",
    requestedBy: "user",
    planObjectIds: ["bar", "table"],
  });
  assert.ok(barOnly !== undefined);
  assert.equal(barOnly[0]?.arguments["objectId"], "bar");
});

/**
 * zh: 看向吧台仍是镜头，不是校准。
 * en: Looking at the bar is still a camera shot, not calibrate.
 */
test("interpretFast does not treat look-at-bar as calibrate", () => {
  const camera = interpretFast({
    text: "看向吧台",
    worldId: "01WORLD",
    origin: "natural_language",
    requestedBy: "user",
  });
  assert.ok(camera !== undefined);
  assert.equal(camera[0]?.intentKind, "generation.start");
  assert.equal(camera[0]?.arguments["shotKind"], "camera");
});

/**
 * zh: 可走网格上「走到吧台」是导航，不是镜头。
 * en: On a walkable mesh, 走到吧台 compiles to navigate, not a camera shot.
 */
test("interpretFast compiles walk-to-bar as player.navigate", () => {
  const walked = interpretFast({
    text: "走到吧台",
    worldId: "01WORLD",
    origin: "natural_language",
    requestedBy: "user",
    canNavigate: true,
  });
  assert.ok(walked !== undefined);
  assert.equal(walked[0]?.intentKind, "player.navigate");
  assert.equal(walked[0]?.arguments["name"], "吧台");

  const door = interpretFast({
    text: "走到门口",
    worldId: "01WORLD",
    origin: "natural_language",
    requestedBy: "user",
    canNavigate: true,
  });
  assert.ok(door !== undefined);
  assert.equal(door[0]?.intentKind, "player.navigate");
  assert.equal(door[0]?.arguments["name"], "门");
});

/**
 * zh: 没有可走网格时，走到不抢成导航。
 * en: Without a walkable mesh, walk-to does not steal navigate.
 */
test("interpretFast does not navigate without a walkable mesh", () => {
  const walked = interpretFast({
    text: "走到吧台",
    worldId: "01WORLD",
    origin: "natural_language",
    requestedBy: "user",
  });
  assert.equal(walked, undefined);
});

/**
 * zh: 恢复检查点与导出不走 LLM。
 * en: Restore checkpoint and export are recognized without an LLM.
 */
test("interpretFast recognizes restore and export", () => {
  const restored = interpretFast({
    text: "恢复检查点",
    worldId: "01WORLD",
    origin: "natural_language",
    requestedBy: "user",
  });
  assert.ok(restored !== undefined);
  assert.equal(restored[0]?.intentKind, "world.restore");

  const exported = interpretFast({
    text: "导出这间屋子",
    worldId: "01WORLD",
    origin: "natural_language",
    requestedBy: "user",
  });
  assert.ok(exported !== undefined);
  assert.equal(exported[0]?.intentKind, "export.create");
});

/**
 * zh: 桌子/椅子局部移动不走 LLM，也不改成吧台。
 * en: Local table/chair moves are recognized without an LLM and do not retarget the bar.
 */
test("interpretFast recognizes furniture calibrate besides the bar", () => {
  const table = interpretFast({
    text: "把桌子往左移一米",
    worldId: "01WORLD",
    origin: "natural_language",
    requestedBy: "user",
    planObjectIds: ["bar-front", "table", "chair", "cup", "door"],
  });
  assert.ok(table !== undefined);
  assert.equal(table[0]?.intentKind, "spatial.calibrate");
  assert.equal(table[0]?.arguments["objectId"], "table");
  assert.deepEqual(table[0]?.arguments["delta"], { x: -1, y: 0, z: 0 });

  const chair = interpretFast({
    text: "把椅子往右移半米",
    worldId: "01WORLD",
    origin: "natural_language",
    requestedBy: "user",
    planObjectIds: ["bar-front", "table", "chair"],
  });
  assert.ok(chair !== undefined);
  assert.equal(chair[0]?.arguments["objectId"], "chair");
  assert.deepEqual(chair[0]?.arguments["delta"], { x: 0.5, y: 0, z: 0 });
});

/**
 * zh: 把桌子换成深色木头是目录材质，不是世界模型。
 * en: Changing the table to dark wood is a catalog material, not a world model.
 */
test("interpretFast recognizes catalog material swap on one object", () => {
  const swapped = interpretFast({
    text: "把桌子换成深色木头",
    worldId: "01WORLD",
    origin: "natural_language",
    requestedBy: "user",
    planObjectIds: ["bar-front", "table"],
  });
  assert.ok(swapped !== undefined);
  assert.equal(swapped[0]?.intentKind, "spatial.calibrate");
  assert.equal(swapped[0]?.arguments["objectId"], "table");
  assert.equal(swapped[0]?.arguments["catalogId"], "oak-table-dark");
  assert.equal(swapped[0]?.arguments["delta"], undefined);
});

/**
 * zh: 撤销与切换世界不走 LLM。
 * en: Undo and switch-world are recognized without an LLM.
 */
test("interpretFast recognizes undo and switch world", () => {
  const undo = interpretFast({
    text: "撤销",
    worldId: "01WORLD",
    origin: "natural_language",
    requestedBy: "user",
  });
  assert.ok(undo !== undefined);
  assert.equal(undo[0]?.intentKind, "world.restore");

  const switched = interpretFast({
    text: "切换到空间站",
    origin: "natural_language",
    requestedBy: "user",
  });
  assert.ok(switched !== undefined);
  assert.equal(switched[0]?.intentKind, "session.switch");
  assert.equal(switched[0]?.arguments["name"], "空间站");
  assert.equal(switched[0]?.worldId, undefined);
});

/**
 * zh: 门外增加露台是扩展；木头旧一些是桌子目录材质。
 * en: Adding a terrace is extend; older wood is the table catalog material.
 */
test("interpretFast recognizes terrace extend and aged wood material", () => {
  const terrace = interpretFast({
    text: "门外增加露台",
    worldId: "01WORLD",
    origin: "natural_language",
    requestedBy: "user",
  });
  assert.ok(terrace !== undefined);
  assert.equal(terrace[0]?.intentKind, "generation.extend");

  const wood = interpretFast({
    text: "木头旧一些",
    worldId: "01WORLD",
    origin: "natural_language",
    requestedBy: "user",
    planObjectIds: ["table"],
  });
  assert.ok(wood !== undefined);
  assert.equal(wood[0]?.intentKind, "spatial.calibrate");
  assert.equal(wood[0]?.arguments["objectId"], "table");
  assert.equal(wood[0]?.arguments["catalogId"], "oak-table-dark");
});

/**
 * zh: 打开世界规则仍是改规则，不是切换世界。
 * en: Opening world rules is still a rule patch, not a world switch.
 */
test("interpretFast does not treat world-rules append as session.switch", () => {
  const rules = interpretFast({
    text: "打开世界规则，写上禁止瞬移",
    worldId: "01WORLD",
    origin: "natural_language",
    requestedBy: "user",
  });
  assert.ok(rules !== undefined);
  assert.equal(rules[0]?.intentKind, "rules.update");
  assert.notEqual(rules[0]?.intentKind, "session.switch");
});
