import assert from "node:assert/strict";
import test from "node:test";
import { NodeType } from "../schema/index.js";
import { mapToolToCommand } from "./map-to-command.js";

const meta = {
  worldId: "01WORLD",
  origin: "cli" as const,
  requestedBy: "cli",
};

/**
 * zh: look 是观测，spawn Place 是建 session，都不是世界模型生成。
 * en: look is observation; spawn Place is session.create. Neither is world-model generation.
 */
test("mapToolToCommand does not map look or spawn Place to mesh generation", () => {
  const look = mapToolToCommand("look", { fresh: true }, meta);
  assert.equal(look.intentKind, "generation.start");
  assert.equal(look.arguments["observeOnly"], true);

  const place = mapToolToCommand(
    "spawn",
    { type: NodeType.Place, name: "酒馆" },
    meta,
  );
  assert.equal(place.intentKind, "session.create");
  assert.equal(place.arguments["name"], "酒馆");

  const entity = mapToolToCommand(
    "spawn",
    { type: NodeType.Entity, name: "老板" },
    meta,
  );
  assert.equal(entity.intentKind, "chat.utterance");
  assert.equal(entity.arguments["leftover"], true);

  const remembered = mapToolToCommand(
    "remember",
    { fact: "客人叫威廉" },
    meta,
  );
  assert.equal(remembered.intentKind, "rules.update");
  assert.equal(remembered.arguments["documentId"], "MEMORY.md");
});
