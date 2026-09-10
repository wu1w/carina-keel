import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createPack,
  exportZip,
  importZip,
  openPack,
  readMarkdown,
} from "../pack/index.js";
import { NodeType } from "../schema/index.js";
import { WorldStore } from "../world/index.js";
import { graphSummary } from "./graph-summary.js";
import { createToolContext, executeTool } from "./tool-context.js";

/**
 * zh: 故事 D — MCP 路径改世界后 export，迁移后状态一致。
 * en: Story D — MCP-path writes survive export and reopen on another pack dir.
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

test("story D MCP-path writes survive export and importZip", async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), "carina-story-d-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const packDir = join(rootDir, "tavern.carina");
  await createPack(packDir, "en");

  const ctx = await createToolContext(packDir, "en");
  const placeId = spawnedId(
    await executeTool("spawn", { type: NodeType.Place, name: "Tavern" }, ctx),
  );
  await executeTool("go", { placeId }, ctx);
  const keeperId = spawnedId(
    await executeTool(
      "spawn",
      { type: NodeType.Entity, name: "Innkeeper", placeId },
      ctx,
    ),
  );
  const said = await executeTool(
    "say",
    { entityId: keeperId, text: "My name is William." },
    ctx,
  );
  assert.equal(said.ok, true);
  await executeTool(
    "remember",
    {
      fact: "The player is named William.",
      relatedNodeIds: [keeperId],
    },
    ctx,
  );

  const summary = graphSummary(ctx.packHandle.graph, ctx.packHandle.session);
  assert.equal(summary.includes("Tavern"), true);
  assert.equal(ctx.packHandle.session.placeId, placeId);

  const zipPath = join(rootDir, "tavern.carina.zip");
  await exportZip(ctx.packHandle, zipPath);
  const migratedDir = join(rootDir, "migrated.carina");
  await importZip(zipPath, migratedDir);

  const migrated = await openPack(migratedDir);
  const store = new WorldStore(migrated);
  assert.equal(migrated.session.placeId, placeId);
  assert.equal(store.query({ id: keeperId })[0]?.props["name"], "Innkeeper");
  const memory = await readMarkdown(migrated, "MEMORY.md");
  assert.equal(memory.includes("The player is named William."), true);
  const migratedSummary = graphSummary(migrated.graph, migrated.session);
  assert.equal(migratedSummary.includes("Tavern"), true);
  assert.equal(migratedSummary.includes(placeId), true);
});
