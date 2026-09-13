import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { unzipSync } from "fflate";
import { CarinaError } from "../errors.js";
import { exportZip, writeMarkdown, type PackHandle } from "../pack/index.js";
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
    exportZip,
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
    assert.equal(
      (looked.data as { placeName?: string }).placeName,
      "Tavern",
    );
    assert.equal(typeof data.media, "string");
    assert.match(String(data.media), /Tavern/);
    assert.equal(packHandle.graph.nodes.length, nodeCount);
    assert.equal(packHandle.graph.edges.length, edgeCount);
  } finally {
    await removeHarness(packDir);
  }
});

test("look passes place name, intent, and fresh to the renderer", async () => {
  const { ctx, packDir } = await createHarness();
  try {
    const spawned = await executeTool(
      "spawn",
      { type: NodeType.Place, name: "湖边酒馆" },
      ctx,
    );
    const place = spawnedNode(spawned);
    await executeTool("go", { placeId: place.id }, ctx);
    let seen: {
      placeName?: string;
      intent?: string;
      fresh?: boolean;
    } = {};
    ctx.userIntent = "看向吧台";
    ctx.renderer = {
      render(view) {
        seen = view;
        return { media: "ok" };
      },
    };
    await executeTool("look", { style: "oak bar, warm lamps", fresh: true }, ctx);
    assert.equal(seen.placeName, "湖边酒馆");
    assert.equal(seen.intent, "看向吧台");
    assert.equal(seen.fresh, true);
  } finally {
    await removeHarness(packDir);
  }
});

test("look still is not written into the graph", async () => {
  const { ctx, packHandle, packDir } = await createHarness();
  try {
    const spawned = await executeTool(
      "spawn",
      { type: NodeType.Place, name: "Tavern" },
      ctx,
    );
    const place = spawnedNode(spawned);
    await executeTool("go", { placeId: place.id }, ctx);
    ctx.renderer = {
      render() {
        return {
          media: `place ${place.id}`,
          still: { mime: "image/jpeg", base64: "AAAA", width: 8, height: 8 },
        };
      },
    };
    const nodeCount = packHandle.graph.nodes.length;
    const looked = await executeTool("look", {}, ctx);
    const data = looked.data as {
      still?: { mime: string; base64: string; width?: number };
    };
    assert.equal(looked.ok, true);
    assert.equal(data.still?.mime, "image/jpeg");
    assert.equal(data.still?.base64, "AAAA");
    assert.equal(packHandle.graph.nodes.length, nodeCount);
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

test("say chronicles speech to an entity in view", async () => {
  const { ctx, packHandle, packDir } = await createHarness();
  try {
    const place = spawnedNode(
      await executeTool("spawn", { type: NodeType.Place, name: "Tavern" }, ctx),
    );
    await executeTool("go", { placeId: place.id }, ctx);
    const keeper = spawnedNode(
      await executeTool(
        "spawn",
        { type: NodeType.Entity, name: "Innkeeper", placeId: place.id },
        ctx,
      ),
    );
    const spoken = await executeTool(
      "say",
      { entityId: keeper.id, text: "I am Alex." },
      ctx,
    );
    assert.equal(spoken.ok, true);
    const data = spoken.data as { entityId?: string; eventId?: string };
    assert.equal(data.entityId, keeper.id);
    assert.equal(typeof data.eventId, "string");
    assert.ok(
      packHandle.graph.nodes.some(
        (node) =>
          node.type === NodeType.Event &&
          node.props["kind"] === "say" &&
          node.id === data.eventId,
      ),
    );
  } finally {
    await removeHarness(packDir);
  }
});

test("say rejects an object and an entity out of view", async () => {
  const { ctx, packDir } = await createHarness();
  try {
    const tavern = spawnedNode(
      await executeTool("spawn", { type: NodeType.Place, name: "Tavern" }, ctx),
    );
    const cellar = spawnedNode(
      await executeTool("spawn", { type: NodeType.Place, name: "Cellar" }, ctx),
    );
    await executeTool("go", { placeId: tavern.id }, ctx);
    const vase = spawnedNode(
      await executeTool(
        "spawn",
        { type: NodeType.Object, name: "Vase", placeId: tavern.id },
        ctx,
      ),
    );
    const mouse = spawnedNode(
      await executeTool(
        "spawn",
        { type: NodeType.Entity, name: "Mouse", placeId: cellar.id },
        ctx,
      ),
    );
    await assert.rejects(
      () => executeTool("say", { entityId: vase.id, text: "hello" }, ctx),
      (error: unknown) =>
        error instanceof CarinaError && error.code === "NOT_FOUND",
    );
    await assert.rejects(
      () => executeTool("say", { entityId: mouse.id, text: "hello" }, ctx),
      (error: unknown) =>
        error instanceof CarinaError && error.code === "NOT_FOUND",
    );
  } finally {
    await removeHarness(packDir);
  }
});

test("remember writes MEMORY.md and a Claim node", async () => {
  const { ctx, packHandle, packDir } = await createHarness();
  try {
    const place = spawnedNode(
      await executeTool("spawn", { type: NodeType.Place, name: "Tavern" }, ctx),
    );
    const remembered = await executeTool(
      "remember",
      {
        fact: "The player's name is Alex.",
        relatedNodeIds: [place.id],
      },
      ctx,
    );
    assert.equal(remembered.ok, true);
    const data = remembered.data as { fact?: string; claimId?: string };
    assert.equal(data.fact, "The player's name is Alex.");
    assert.equal(typeof data.claimId, "string");
    const claim = packHandle.graph.nodes.find((node) => node.id === data.claimId);
    assert.ok(claim !== undefined);
    assert.equal(claim.type, NodeType.Claim);
    assert.equal(claim.props["fact"], "The player's name is Alex.");
    const memoryText = await readFile(join(packDir, "MEMORY.md"), "utf8");
    assert.match(memoryText, /The player's name is Alex\./);
  } finally {
    await removeHarness(packDir);
  }
});

test("attach copies a pack file, writes sidecar, and binds an Asset", async () => {
  const { ctx, packHandle, packDir } = await createHarness();
  try {
    const place = spawnedNode(
      await executeTool("spawn", { type: NodeType.Place, name: "Tavern" }, ctx),
    );
    await writeFile(join(packDir, "note.txt"), "broken vase\n", "utf8");
    const attached = await executeTool(
      "attach",
      { nodeId: place.id, posixPath: "note.txt", kind: "note" },
      ctx,
    );
    assert.equal(attached.ok, true);
    const data = attached.data as {
      asset?: NodeRecord;
      posixPath?: string;
      eventId?: string;
    };
    assert.equal(data.posixPath, "assets/note.txt");
    assert.ok(data.asset !== undefined);
    assert.equal(data.asset.type, NodeType.Asset);
    assert.equal(data.asset.props["posixPath"], "assets/note.txt");
    assert.equal(data.asset.props["boundNodeId"], place.id);
    assert.ok(
      packHandle.graph.edges.some(
        (edge) =>
          edge.type === EdgeType.DepictedAs &&
          edge.fromId === place.id &&
          edge.toId === data.asset?.id,
      ),
    );
    const copied = await readFile(join(packDir, "assets", "note.txt"), "utf8");
    assert.equal(copied, "broken vase\n");
    const sidecarText = await readFile(
      join(packDir, "assets", "note.txt.json"),
      "utf8",
    );
    const sidecar = JSON.parse(sidecarText) as {
      nodeId: string;
      posixPath: string;
      kind: string;
    };
    assert.equal(sidecar.nodeId, place.id);
    assert.equal(sidecar.posixPath, "assets/note.txt");
    assert.equal(sidecar.kind, "note");
  } finally {
    await removeHarness(packDir);
  }
});

test("legacy go spawn relate honor WORLD.md clauses", async () => {
  const { ctx, packDir } = await createHarness();
  try {
    const place = spawnedNode(
      await executeTool("spawn", { type: NodeType.Place, name: "Tavern" }, ctx),
    );
    const bar = spawnedNode(
      await executeTool(
        "spawn",
        { type: NodeType.Entity, name: "吧台", placeId: place.id },
        ctx,
      ),
    );
    await writeMarkdown(ctx.packHandle, "WORLD.md", "禁止瞬移。\n");
    await assert.rejects(
      () => executeTool("go", { placeId: place.id }, ctx),
      (error: unknown) =>
        error instanceof CarinaError &&
        error.code === "COMMAND_REJECTED" &&
        error.messageKey === "error.noTeleport",
    );
    await writeMarkdown(ctx.packHandle, "WORLD.md", "禁止生成。\n");
    await assert.rejects(
      () =>
        executeTool(
          "spawn",
          { type: NodeType.Entity, name: "Innkeeper", placeId: place.id },
          ctx,
        ),
      (error: unknown) =>
        error instanceof CarinaError && error.code === "COMMAND_REJECTED",
    );
    await writeMarkdown(ctx.packHandle, "WORLD.md", "锁定吧台。\n");
    await assert.rejects(
      () =>
        executeTool(
          "relate",
          { fromId: bar.id, toId: place.id, type: EdgeType.Knows },
          ctx,
        ),
      (error: unknown) =>
        error instanceof CarinaError &&
        error.code === "COMMAND_REJECTED" &&
        error.messageKey === "error.lockObject",
    );
  } finally {
    await removeHarness(packDir);
  }
});

test("export writes a zip that contains graph.json", async () => {
  const { ctx, packHandle, packDir } = await createHarness();
  try {
    await packHandle.save();
    const destPath = join(packDir, "demo.carina.zip");
    const exported = await executeTool("export", { destPath }, ctx);
    assert.equal(exported.ok, true);
    const data = exported.data as { destPath?: string };
    assert.equal(data.destPath, destPath);
    const zipBytes = await readFile(destPath);
    assert.ok(zipBytes.byteLength > 0);
    const unzipped = unzipSync(zipBytes);
    assert.ok(Object.hasOwn(unzipped, "graph.json"));
    assert.ok(Object.hasOwn(unzipped, "session.json"));
  } finally {
    await removeHarness(packDir);
  }
});

