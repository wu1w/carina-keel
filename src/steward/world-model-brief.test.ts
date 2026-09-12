import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyShot,
  heuristicWorldModelBrief,
  isViewUtterance,
  scenePrompt,
} from "./world-model-brief.js";

test("classifyShot splits camera framing from scene edits", () => {
  assert.equal(classifyShot("看向吧台"), "camera");
  assert.equal(classifyShot("往左转"), "camera");
  assert.equal(classifyShot("靠近那盏灯"), "camera");
  assert.equal(classifyShot("换成黄昏湖边酒馆"), "scene");
  assert.equal(classifyShot("世界，湖边，夕阳，酒馆"), "scene");
  assert.equal(classifyShot("看一眼黄昏湖边酒馆"), "scene");
  assert.equal(classifyShot("看一眼"), "camera");
});

test("isViewUtterance ignores pause and questions", () => {
  assert.equal(isViewUtterance("看向吧台"), true);
  assert.equal(isViewUtterance("世界，湖边，夕阳，酒馆"), true);
  assert.equal(isViewUtterance("暂停世界"), false);
  assert.equal(isViewUtterance("这个世界有魔法吗"), false);
  assert.equal(isViewUtterance("走进花园"), false);
  assert.equal(isViewUtterance("走到吧台"), false);
  assert.equal(isViewUtterance("在门外生成花园"), false);
});

test("heuristic camera keeps last style and does not rebake", () => {
  const brief = heuristicWorldModelBrief({
    text: "看向吧台",
    worldName: "酒馆",
    lang: "zh",
    last: {
      style: "first-person view inside a wooden tavern",
      prompt: "酒馆",
      shotKind: "scene",
    },
  });
  assert.equal(brief.shotKind, "camera");
  assert.equal(brief.fresh, false);
  assert.match(brief.style, /Same place/);
  assert.match(brief.camera, /bar/i);
  assert.match(brief.reply, /吧台|镜头/);
});

test("heuristic scene strips look verbs and names the place", () => {
  const brief = heuristicWorldModelBrief({
    text: "看一眼黄昏湖边酒馆",
    worldName: "carina-demo",
    lang: "zh",
  });
  assert.equal(brief.shotKind, "scene");
  assert.equal(brief.fresh, true);
  assert.equal(scenePrompt("看一眼黄昏湖边酒馆", "carina-demo"), "黄昏湖边酒馆");
  assert.match(brief.style, /lakeside tavern/i);
  assert.match(brief.reply, /黄昏湖边酒馆/);
});
