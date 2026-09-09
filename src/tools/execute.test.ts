import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CarinaError } from "../errors.js";
import type { PackHandle } from "../pack/index.js";
import { MockRenderer } from "../render/index.js";
import {
  EdgeType,
  NodeType,
  type GraphFile,
  type NodeRecord,
  type ToolName,
} from "../schema/index.js";
import { WorldStore } from "../world/index.js";
import type { ToolContext } from "./context.js";
import { executeTool } from "./index.js";
import { newRecordId, utcNow } from "./stamp.js";

/**
 * zh: 用真实 WorldStore 和临时包目录搭测试台。
 * en: Build a test harness with a real WorldStore and a temp pack directory.
 */
async function createHarness(): Promise<{
  ctx: ToolContext;
  store: WorldStore;
  packHandle: PackHandle;
  packDir: string;
}> {
  const packDir = await mkdtemp(join(tmpdir(), "carina-tools-"));
  await mkdir(join(packDir, "events"), { recursive: true });
  await mkdir(join(packDir, "assets"), { recursive: true });
  const worldNode: NodeRecord = {
    id: newRecordId(),
    type: NodeType.World,
    props: { name: "Demo" },
    createdAt: utcNow(),
  };
  const graph: GraphFile = { version: 0, nodes: [worldNode], edges: [] };
  const packHandle: PackHandle = {
    packDir,
    graph,
    session: { placeId: null, lastTurnAt: null, modelId: null },
    async save() {
      await writeFile(
        join(packDir, "graph.json"),
        `${JSON.stringify(packHandle.graph, null, 2)}\n`,
        "utf8",
      );
      await writeFile(
        join(packDir, "session.json"),
        `${JSON.stringify(packHandle.session, null, 2)}\n`,
        "utf8",
      );
    },
  };
  const store = new WorldStore(packHandle);
  const ctx: ToolContext = {
    store,
    renderer: new MockRenderer(),
    exportZip: async () => {
      return;
    },
    packHandle,
    lang: "zh",
  };
  return { ctx, store, packHandle, packDir };
}

/**
 * zh: 删掉临时包。
 * en: Remove the temp pack.
 */
async function removeHarness(packDir: string): Promise<void> {
  await rm(packDir, { recursive: true, force: true });
}

/**
 * zh: 从 spawn 结果取出节点。
 * en: Read the spawned node from a tool result.
 */
function spawnedNode(result: { data?: unknown }): NodeRecord {
  const data = result.data;
  assert.ok(data !== null && typeof data === "object");
  const node = (data as { node?: unknown }).node;
  assert.ok(node !== null && typeof node === "object");
  return node as NodeRecord;
}

test("spawn creates a Place node and chronicle event", async () => {
  const { ctx, packHandle, packDir } = await createHarness();
  try {
    const result = await executeTool(
      "spawn",
      { type: NodeType.Place, name: "Tavern" },
      ctx,
    );
    assert.equal(result.ok, true);
    const node = spawnedNode(result);
    assert.equal(node.type, NodeType.Place);
    assert.equal(node.props["name"], "Tavern");
    assert.ok(packHandle.graph.nodes.some((item) => item.id === node.id));
    assert.ok(
      packHandle.graph.nodes.some(
        (item) =>
          item.type === NodeType.Event && item.props["kind"] === "spawn",
      ),
    );
    const worldEdge = packHandle.graph.edges.find(
      (edge) => edge.fromId === node.id && edge.type === EdgeType.In,
    );
    assert.ok(worldEdge !== undefined);
  } finally {
    await removeHarness(packDir);
  }
});

test("go sets presence on the spawned place", async () => {
  const { ctx, packHandle, packDir } = await createHarness();
  try {
    const spawned = await executeTool(
      "spawn",
      { type: NodeType.Place, name: "Tavern" },
      ctx,
    );
    const place = spawnedNode(spawned);
    const result = await executeTool("go", { placeId: place.id }, ctx);
    assert.equal(result.ok, true);
    assert.equal(packHandle.session.placeId, place.id);
  } finally {
    await removeHarness(packDir);
  }
});

test("go rejects a missing place", async () => {
  const { ctx, packDir } = await createHarness();
  try {
    await assert.rejects(
      () => executeTool("go", { placeId: "01MISSINGPLACE000000000000" }, ctx),
      (error: unknown) =>
        error instanceof CarinaError && error.code === "NOT_FOUND",
    );
  } finally {
    await removeHarness(packDir);
  }
});

test("relate adds and retracts an edge", async () => {
  const { ctx, packHandle, packDir } = await createHarness();
  try {
    const placeResult = await executeTool(
      "spawn",
      { type: NodeType.Place, name: "Tavern" },
      ctx,
    );
    const place = spawnedNode(placeResult);
    await executeTool("go", { placeId: place.id }, ctx);
    const keeperResult = await executeTool(
      "spawn",
      { type: NodeType.Entity, name: "Innkeeper", placeId: place.id },
      ctx,
    );
    const keeper = spawnedNode(keeperResult);
    const related = await executeTool(
      "relate",
      {
        fromId: keeper.id,
        toId: place.id,
        type: EdgeType.Knows,
      },
      ctx,
    );
    assert.equal(related.ok, true);
    assert.ok(
      packHandle.graph.edges.some(
        (edge) =>
          edge.fromId === keeper.id &&
          edge.toId === place.id &&
          edge.type === EdgeType.Knows,
      ),
    );
    const retracted = await executeTool(
      "relate",
      {
        fromId: keeper.id,
        toId: place.id,
        type: EdgeType.Knows,
        retract: true,
      },
      ctx,
    );
    assert.equal(retracted.ok, true);
    assert.equal(
      packHandle.graph.edges.some(
        (edge) =>
          edge.fromId === keeper.id &&
          edge.toId === place.id &&
          edge.type === EdgeType.Knows,
      ),
      false,
    );
  } finally {
    await removeHarness(packDir);
  }
});

test("unknown tool and bad input throw CarinaError", async () => {
  const { ctx, packDir } = await createHarness();
  try {
    await assert.rejects(
      () => executeTool("nope" as ToolName, {}, ctx),
      (error: unknown) =>
        error instanceof CarinaError && error.code === "UNKNOWN_TOOL",
    );
    await assert.rejects(
      () => executeTool("spawn", { type: NodeType.Place }, ctx),
      (error: unknown) =>
        error instanceof CarinaError && error.code === "TOOL_INPUT",
    );
  } finally {
    await removeHarness(packDir);
  }
});

test("look does not write graph geometry", async () => {
  const { ctx, packHandle, packDir } = await createHarness();
  try {
    const spawned = await executeTool(
      "spawn",
      { type: NodeType.Place, name: "Tavern" },
      ctx,
    );
    const place = spawnedNode(spawned);
    await executeTool("go", { placeId: place.id }, ctx);
    const nodeCount = packHandle.graph.nodes.length;
    const edgeCount = packHandle.graph.edges.length;
    const looked = await executeTool("look", {}, ctx);
    assert.equal(looked.ok, true);
    const data = looked.data as { media?: string; placeId?: string };
    assert.equal(data.placeId, place.id);
    assert.equal(typeof data.media, "string");
    assert.match(String(data.media), new RegExp(place.id));
    assert.equal(packHandle.graph.nodes.length, nodeCount);
    assert.equal(packHandle.graph.edges.length, edgeCount);
  } finally {
    await removeHarness(packDir);
  }
});

test("attach rejects a path that escapes the pack", async () => {
  const { ctx, packHandle, packDir } = await createHarness();
  try {
    const worldNode = packHandle.graph.nodes.find(
      (node) => node.type === NodeType.World,
    );
    assert.ok(worldNode !== undefined);
    await assert.rejects(
      () =>
        executeTool(
          "attach",
          { nodeId: worldNode.id, posixPath: "../secret.txt" },
          ctx,
        ),
      (error: unknown) =>
        error instanceof CarinaError && error.code === "SANDBOX",
    );
  } finally {
    await removeHarness(packDir);
  }
});
