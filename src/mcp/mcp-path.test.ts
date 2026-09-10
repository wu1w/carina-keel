import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPack, readMarkdown } from "../pack/index.js";
import { NodeType } from "../schema/index.js";
import { graphSummary } from "./graph-summary.js";
import { createToolContext, executeTool } from "./tool-context.js";

/**
 * zh: MCP 与 CLI 共用 executeTool；写入可被只读资源读回。
 * en: MCP shares executeTool with CLI; writes are visible to read-only resources.
 */
test("mcp tool path writes survive reopen and resource reads", async (t) => {
  const scratchDir = await mkdtemp(join(tmpdir(), "carina-mcp-"));
  t.after(async () => {
    await rm(scratchDir, { recursive: true, force: true });
  });
  const packDir = join(scratchDir, "tavern.carina");
  await createPack(packDir, "en");
  const ctx = await createToolContext(packDir, "en");

  const spawned = await executeTool(
    "spawn",
    { type: NodeType.Place, name: "Tavern" },
    ctx,
  );
  const place = (spawned.data as { node: { id: string } }).node;
  await executeTool("go", { placeId: place.id }, ctx);
  await executeTool(
    "remember",
    { fact: "The vase is still broken.", relatedNodeIds: [place.id] },
    ctx,
  );

  const worldMd = await readMarkdown(ctx.packHandle, "WORLD.md");
  assert.match(worldMd, /source of truth/);
  const memoryMd = await readMarkdown(ctx.packHandle, "MEMORY.md");
  assert.match(memoryMd, /vase is still broken/);

  const summaryText = graphSummary(ctx.packHandle.graph, ctx.packHandle.session);
  const summary = JSON.parse(summaryText) as {
    places: Array<{ id: string; name: unknown }>;
    placeId: string | null;
  };
  assert.equal(summary.placeId, place.id);
  assert.equal(
    summary.places.some((item) => item.id === place.id),
    true,
  );

  const reopened = await createToolContext(packDir, "en");
  assert.equal(reopened.packHandle.session.placeId, place.id);
  const memoryAgain = await readFile(join(packDir, "MEMORY.md"), "utf8");
  assert.match(memoryAgain, /vase is still broken/);
  assert.equal(
    reopened.store.query({ type: NodeType.Claim }).some((node) => {
      return node.props["fact"] === "The vase is still broken.";
    }),
    true,
  );
});
