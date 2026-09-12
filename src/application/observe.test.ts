import assert from "node:assert/strict";
import test from "node:test";
import {
  idleObservationView,
  observationView,
  sceneTitle,
} from "./observe.js";

test("idleObservationView keeps the scene baseline and does not rebake", () => {
  const baseline =
    "first-person view inside a wooden lakeside tavern at dusk";
  const view = idleObservationView({
    worldId: "01WORLD",
    name: "酒馆",
    prompt: "黄昏湖边酒馆",
    baselineStyle: baseline,
  });
  assert.equal(view.style, baseline);
  assert.equal(view.fresh, undefined);
  assert.match(String(view.camera), /breeze|rippling|breathing/i);
  assert.equal(view.entities.length, 0);
});

test("observationView scene title skips demo names", () => {
  const view = observationView({
    worldId: "01WORLD",
    name: "carina-demo",
    prompt: "黄昏湖边酒馆",
    style: "first-person tavern",
    fresh: true,
  });
  assert.equal(view.placeName, "黄昏湖边酒馆");
  assert.equal(sceneTitle("carina-demo", "黄昏湖边酒馆"), "黄昏湖边酒馆");
});
