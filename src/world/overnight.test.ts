import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPack, exportZip, openPack } from "../pack/index.js";
import { MockRenderer } from "../render/index.js";
import { NodeType } from "../schema/index.js";
import { executeTool, type ToolContext } from "../tools/index.js";
import { WorldStore } from "./index.js";

/**
 * zh: 故事 A — 过夜：杀进程再打开，人还在酒馆、名字与碎花瓶仍在。
 * en: Story A — overnight: after reopen, presence, name, and broken vase remain.
 */

/**
 * zh: 从 spawn 结果取出节点 id。
 * en: Read the spawned node id from a tool result.
 */
function spawnedId(result: { data?: unknown }): string {
  const data = result.data;
  assert.ok(data !== null && typeof data === "object");
  const node = (data as { node?: { id?: unknown } }).node;
  assert.ok(node !== null && typeof node === "object");
  assert.equal(typeof node.id, "string");
  return node.id;
}

/**
 * zh: 用真实包与八工具搭一座过夜酒馆。
 * en: Build an overnight tavern with a real pack and the eight tools.
 */
async function seedTavern(packDir: string): Promise<{
  placeId: string;
  keeperId: string;
  vaseId: string;
}> {
  const packHandle = await openPack(packDir);
  const store = new WorldStore(packHandle);
  const ctx: ToolContext = {
    store,
    renderer: new MockRenderer(),
    exportZip,
    packHandle,
    lang: "zh",
  };
  const placeResult = await executeTool(
    "spawn",
    { type: NodeType.Place, name: "Tavern" },
    ctx,
  );
  const placeId = spawnedId(placeResult);
  await executeTool("go", { placeId }, ctx);
  const keeperResult = await executeTool(
    "spawn",
    { type: NodeType.Entity, name: "Innkeeper", placeId },
    ctx,
  );
  const keeperId = spawnedId(keeperResult);
  await executeTool(
    "say",
    { entityId: keeperId, text: "My name is William." },
    ctx,
  );
  const vaseResult = await executeTool(
    "spawn",
    { type: NodeType.Object, name: "Vase", placeId },
    ctx,
  );
  const vaseId = spawnedId(vaseResult);
  await executeTool(
    "remember",
    {
      fact: "The player is named William.",
      relatedNodeIds: [keeperId],
    },
    ctx,
  );
  await executeTool(
    "remember",
    {
      fact: "The vase is broken.",
      relatedNodeIds: [vaseId],
    },
    ctx,
  );
  return { placeId, keeperId, vaseId };
}

test("story A overnight: presence, name, and broken vase survive reopen", async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), "carina-story-a-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const packDir = join(rootDir, "tavern.carina");
  await createPack(packDir, "zh");
  const seeded = await seedTavern(packDir);

  const reopened = await openPack(packDir);
  const store = new WorldStore(reopened);
  assert.equal(reopened.session.placeId, seeded.placeId);

  const places = store.query({ type: NodeType.Place, name: "Tavern" });
  assert.equal(places.length, 1);
  assert.equal(places[0]?.id, seeded.placeId);

  const keepers = store.query({ type: NodeType.Entity, name: "Innkeeper" });
  assert.equal(keepers.length, 1);
  assert.equal(keepers[0]?.id, seeded.keeperId);

  const vases = store.query({ type: NodeType.Object, name: "Vase" });
  assert.equal(vases.length, 1);
  assert.equal(vases[0]?.id, seeded.vaseId);

  const memory = await readFile(join(packDir, "MEMORY.md"), "utf8");
  assert.equal(memory.includes("The player is named William."), true);
  assert.equal(memory.includes("The vase is broken."), true);

  const claims = store.query({ type: NodeType.Claim });
  assert.equal(
    claims.some((node) => node.props["fact"] === "The player is named William."),
    true,
  );
  assert.equal(
    claims.some((node) => node.props["fact"] === "The vase is broken."),
    true,
  );
});
