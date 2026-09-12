import assert from "node:assert/strict";
import test from "node:test";
import { observationView, sceneTitle } from "../application/observe.js";
import type { CarinaConfig } from "../config.js";
import {
  parseStewardTurn,
  type InterpretCommandInput,
} from "./interpret-command.js";

function input(text: string): InterpretCommandInput {
  const config: CarinaConfig = {
    apiKey: "local",
    model: "grok-4.6",
    modelBaseUrl: "http://127.0.0.1:18645/v1",
    token: "dev-token",
    port: 18790,
    pack: undefined,
    lang: "zh",
    dataDir: "/tmp/carina-test",
  };
  return {
    text,
    origin: "natural_language",
    requestedBy: "user",
    worldId: "01WORLD",
    config,
  };
}

test("parseStewardTurn reads camera translation", () => {
  const turn = parseStewardTurn(
    JSON.stringify({
      reply: "好，按「看向吧台」调镜头。",
      commands: [
        {
          intentKind: "generation.start",
          arguments: {
            observeOnly: true,
            shotKind: "camera",
            fresh: false,
            prompt: "看向吧台",
            style:
              "same wooden tavern, first-person, turn to face the oak bar",
            camera: "turn to face the oak bar",
          },
        },
      ],
    }),
    input("看向吧台"),
  );
  assert.equal(turn.commands[0]?.intentKind, "generation.start");
  assert.equal(turn.commands[0]?.arguments["shotKind"], "camera");
  assert.equal(turn.commands[0]?.arguments["fresh"], false);
  assert.equal(turn.commands[0]?.arguments["observeOnly"], true);
  assert.equal(turn.reply, "好，按「看向吧台」调镜头。");
  assert.equal(turn.commands[0]?.arguments["reply"], "好，按「看向吧台」调镜头。");
});

test("parseStewardTurn reads scene translation", () => {
  const turn = parseStewardTurn(
    JSON.stringify({
      reply: "按「黄昏湖边酒馆」改场景。",
      commands: [
        {
          intentKind: "generation.start",
          arguments: {
            shotKind: "scene",
            prompt: "黄昏湖边酒馆",
            style:
              "first-person view inside a wooden lakeside tavern at dusk",
          },
        },
      ],
    }),
    input("世界，湖边，夕阳，酒馆"),
  );
  assert.equal(turn.commands[0]?.arguments["shotKind"], "scene");
  assert.equal(turn.commands[0]?.arguments["observeOnly"], true);
  assert.match(String(turn.commands[0]?.arguments["style"]), /lakeside tavern/);
});

test("observationView sends steward style, not mesh names", () => {
  const view = observationView({
    worldId: "01WORLD",
    name: "carina-demo",
    prompt: "黄昏湖边酒馆",
    style:
      "first-person view inside a wooden lakeside tavern at dusk",
    camera: "eye-level first-person",
    fresh: true,
  });
  assert.equal(view.entities.length, 0);
  assert.equal(view.placeName, "黄昏湖边酒馆");
  assert.equal(view.style, "first-person view inside a wooden lakeside tavern at dusk");
  assert.equal(view.camera, "eye-level first-person");
  assert.equal(view.fresh, true);
  assert.equal(sceneTitle("carina-demo", "黄昏湖边酒馆"), "黄昏湖边酒馆");
});
