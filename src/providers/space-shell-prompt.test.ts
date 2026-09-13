import assert from "node:assert/strict";
import { test } from "node:test";
import { composeSpaceShellPrompt } from "./space-shell-prompt.js";

const NG1 = "新建一个雨夜湖边酒馆，暖色壁炉、旧木吧台，能走到吧台后面";

test("NG-1 Chinese prompt becomes an English first-person tavern interior prompt", () => {
  const composed = composeSpaceShellPrompt({ prompt: NG1 });
  assert.match(composed.visual, /^interior of a old tavern, first-person eye-level view standing inside the room/);
  assert.match(composed.visual, /lakeside/);
  assert.match(composed.visual, /rainy night/);
  assert.match(composed.visual, /stone fireplace/);
  assert.match(composed.visual, /bar counter with space to walk behind it/);
  assert.match(composed.visual, /warm lighting/);
  assert.doesNotMatch(composed.visual, /[\u4e00-\u9fff]/, "no CJK reaches the LoRA");
  assert.equal(composed.sceneDescription, NG1);
  assert.ok(composed.hits.includes("old tavern"));
  // "雨夜" already says night; no duplicate "night" token.
  assert.equal(composed.visual.match(/\bnight\b/g)?.length, 1);
});

test("unknown venue falls back to a generic interior and keeps ASCII words", () => {
  const composed = composeSpaceShellPrompt({ prompt: "一个 steampunk 风格的 observatory" });
  assert.match(composed.visual, /^interior of a room, first-person eye-level view standing inside/);
  assert.match(composed.visual, /steampunk/);
  assert.match(composed.visual, /observatory/);
  assert.equal(composed.hits.length, 0);
});

test("scene spec region and object names contribute lexicon hits", () => {
  const composed = composeSpaceShellPrompt({
    prompt: "开一间小店",
    sceneSpec: {
      schemaVersion: 1,
      prompt: "开一间小店",
      name: "小店",
      bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 8, y: 3, z: 8 } },
      coordinateFrame: { units: "meters", handedness: "right", up: "y", scaleStatus: "estimated" },
      regions: [{ regionId: "interior", name: "舱内", kind: "interior" }],
      objects: [{ objectId: "shelf", name: "书架", role: "feature", route: "generate" }],
      source: "heuristic-plan",
    },
  });
  assert.match(composed.visual, /spaceship cabin/);
  assert.match(composed.visual, /bookshelves/);
});
