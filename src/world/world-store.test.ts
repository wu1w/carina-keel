import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CarinaError } from "../errors.js";
import { createPack, openPack } from "../pack/index.js";
import {
  EdgeType,
  NodeType,
  type GraphFile,
  type NodeRecord,
} from "../schema/index.js";
import { createUlid } from "./ids.js";
import { DEFAULT_HOP_COUNT, WorldStore, type PackHandle } from "./index.js";

const FIXED_TIME = "2026-09-09T12:00:00.000Z";

function makeNode(
  type: NodeRecord["type"],
  name: string,
  id = createUlid(),
): NodeRecord {
  return {
    id,
    type,
    props: { name },
    createdAt: FIXED_TIME,
  };
}

async function createTempStore(graph?: GraphFile): Promise<{
  packDir: string;
  packHandle: PackHandle;
  store: WorldStore;
}> {
  const packDir = await mkdtemp(join(tmpdir(), "carina-world-"));
  const packHandle: PackHandle = {
    packDir,
    graph: graph ?? { version: 0, nodes: [], edges: [] },
    session: { placeId: null, lastTurnAt: null, modelId: null },
    async save() {
      await mkdir(join(packDir, "events"), { recursive: true });
      await writeFile(
        join(packDir, "graph.json"),
        `${JSON.stringify(packHandle.graph)}\n`,
        "utf8",
      );
      await writeFile(
        join(packDir, "session.json"),
        `${JSON.stringify(packHandle.session)}\n`,
        "utf8",
      );
    },
  };
  const store = new WorldStore(packHandle);
  return { packDir, packHandle, store };
}

async function removeTemp(packDir: string): Promise<void> {
  await rm(packDir, { recursive: true, force: true });
}

function tavernFixture(): {
  graph: GraphFile;
  tavernId: string;
  barkeeperId: string;
  vaseId: string;
  cellarId: string;
  mouseId: string;
} {
  const tavern = makeNode(NodeType.Place, "Tavern");
  const barkeeper = makeNode(NodeType.Entity, "Mira");
  const vase = makeNode(NodeType.Object, "Vase");
  const cellar = makeNode(NodeType.Place, "Cellar");
  const mouse = makeNode(NodeType.Entity, "Mouse");
  const graph: GraphFile = {
    version: 0,
    nodes: [tavern, barkeeper, vase, cellar, mouse],
    edges: [
      {
        id: createUlid(),
        type: EdgeType.In,
        fromId: barkeeper.id,
        toId: tavern.id,
        props: {},
        createdAt: FIXED_TIME,
      },
      {
        id: createUlid(),
        type: EdgeType.In,
        fromId: vase.id,
        toId: tavern.id,
        props: {},
        createdAt: FIXED_TIME,
      },
      {
        id: createUlid(),
        type: EdgeType.Contains,
        fromId: tavern.id,
        toId: cellar.id,
        props: {},
        createdAt: FIXED_TIME,
      },
      {
        id: createUlid(),
        type: EdgeType.In,
        fromId: mouse.id,
        toId: cellar.id,
        props: {},
        createdAt: FIXED_TIME,
      },
    ],
  };
  return {
    graph,
    tavernId: tavern.id,
    barkeeperId: barkeeper.id,
    vaseId: vase.id,
    cellarId: cellar.id,
    mouseId: mouse.id,
  };
}

test("query finds nodes by id, type, and name in props", async () => {
  const fixture = tavernFixture();
  const { packDir, store } = await createTempStore(fixture.graph);
  try {
    const byId = store.query({ id: fixture.barkeeperId });
    assert.equal(byId.length, 1);
    assert.equal(byId[0]?.id, fixture.barkeeperId);

    const places = store.query({ type: NodeType.Place });
    assert.equal(places.length, 2);

    const byName = store.query({ name: "mira" });
    assert.equal(byName.length, 1);
    assert.equal(byName[0]?.id, fixture.barkeeperId);
  } finally {
    await removeTemp(packDir);
  }
});

test("mutate adds and removes nodes and edges for spawn/relate", async () => {
  const { packDir, store } = await createTempStore();
  try {
    const place = makeNode(NodeType.Place, "Hall");
    const entity = makeNode(NodeType.Entity, "Guest");
    const edgeId = createUlid();
    await store.mutate({
      addNodes: [place, entity],
      addEdges: [
        {
          id: edgeId,
          type: EdgeType.In,
          fromId: entity.id,
          toId: place.id,
          props: {},
          createdAt: FIXED_TIME,
        },
      ],
    });
    assert.equal(store.query({ id: place.id }).length, 1);
    assert.equal(store.graph.edges.length, 1);

    await store.mutate({ removeEdgeIds: [edgeId] });
    assert.equal(store.graph.edges.length, 0);

    await store.mutate({ removeNodeIds: [entity.id] });
    assert.equal(store.query({ id: entity.id }).length, 0);

    const graphText = await readFile(join(packDir, "graph.json"), "utf8");
    const saved = JSON.parse(graphText) as GraphFile;
    assert.equal(
      saved.nodes.some((node) => node.id === place.id),
      true,
    );
    assert.equal(
      saved.nodes.some((node) => node.id === entity.id),
      false,
    );
  } finally {
    await removeTemp(packDir);
  }
});

test("hopNeighborhood returns the N-hop subgraph", async () => {
  const fixture = tavernFixture();
  const { packDir, store } = await createTempStore(fixture.graph);
  try {
    const zero = store.hopNeighborhood(fixture.tavernId, 0);
    assert.deepEqual(
      zero.nodes.map((node) => node.id),
      [fixture.tavernId],
    );
    assert.equal(zero.edges.length, 0);

    const one = store.hopNeighborhood(fixture.tavernId, 1);
    const oneIds = new Set(one.nodes.map((node) => node.id));
    assert.equal(oneIds.has(fixture.tavernId), true);
    assert.equal(oneIds.has(fixture.barkeeperId), true);
    assert.equal(oneIds.has(fixture.vaseId), true);
    assert.equal(oneIds.has(fixture.cellarId), true);
    assert.equal(oneIds.has(fixture.mouseId), false);

    const two = store.hopNeighborhood(fixture.tavernId);
    const twoIds = new Set(two.nodes.map((node) => node.id));
    assert.equal(DEFAULT_HOP_COUNT, 2);
    assert.equal(twoIds.has(fixture.mouseId), true);
    assert.equal(two.nodes.length, 5);
    assert.throws(
      () => store.hopNeighborhood(fixture.barkeeperId),
      (error: unknown) => {
        assert.ok(error instanceof CarinaError);
        assert.equal(error.code, "NOT_FOUND");
        return true;
      },
    );
  } finally {
    await removeTemp(packDir);
  }
});

test("appendEvent writes jsonl and may add Event nodes", async () => {
  const fixture = tavernFixture();
  const { packDir, store } = await createTempStore(fixture.graph);
  try {
    const chronicleEvent = await store.appendEvent({
      kind: "spawn",
      occurredAt: FIXED_TIME,
      payload: { name: "Vase" },
      relatedNodeIds: [fixture.vaseId],
    });
    const jsonl = await readFile(
      join(packDir, "events", "2026-09-09.jsonl"),
      "utf8",
    );
    assert.equal(jsonl.includes(chronicleEvent.id), true);
    const eventNodes = store.query({ type: NodeType.Event });
    assert.equal(eventNodes.length, 1);
    assert.equal(eventNodes[0]?.id, chronicleEvent.id);

    await store.appendEvent({
      kind: "note",
      occurredAt: FIXED_TIME,
      payload: { silent: true },
      projectNode: false,
    });
    assert.equal(store.query({ type: NodeType.Event }).length, 1);
    const jsonlAfter = await readFile(
      join(packDir, "events", "2026-09-09.jsonl"),
      "utf8",
    );
    assert.equal(jsonlAfter.trim().split("\n").length, 2);
  } finally {
    await removeTemp(packDir);
  }
});

test("setPresence writes session.placeId and a chronicle line", async () => {
  const fixture = tavernFixture();
  const { packDir, store } = await createTempStore(fixture.graph);
  try {
    await store.setPresence(fixture.tavernId);
    assert.equal(store.session.placeId, fixture.tavernId);
    assert.equal(typeof store.session.lastTurnAt, "string");
    const sessionText = await readFile(join(packDir, "session.json"), "utf8");
    const session = JSON.parse(sessionText) as { placeId: string };
    assert.equal(session.placeId, fixture.tavernId);
    const eventNodes = store.query({ type: NodeType.Event });
    assert.equal(
      eventNodes.some((node) => node.props["kind"] === "presence"),
      true,
    );
  } finally {
    await removeTemp(packDir);
  }
});

test("remember appends MEMORY.md and a Claim node", async () => {
  const fixture = tavernFixture();
  const { packDir, store } = await createTempStore(fixture.graph);
  try {
    const result = await store.remember("The vase is broken.", [
      fixture.vaseId,
    ]);
    assert.equal(result.claimNode?.type, NodeType.Claim);
    const memory = await readFile(join(packDir, "MEMORY.md"), "utf8");
    assert.equal(memory.includes("The vase is broken."), true);
    const claims = store.query({ type: NodeType.Claim });
    assert.equal(claims.length, 1);
    assert.equal(claims[0]?.props["fact"], "The vase is broken.");
  } finally {
    await removeTemp(packDir);
  }
});

test("NOT_FOUND when place or node is missing", async () => {
  const { packDir, store } = await createTempStore();
  try {
    await assert.rejects(
      () => store.setPresence("01missingplaceid0000000000"),
      (error: unknown) => {
        assert.ok(error instanceof CarinaError);
        assert.equal(error.code, "NOT_FOUND");
        return true;
      },
    );
    assert.throws(
      () => store.hopNeighborhood("01missingplaceid0000000000"),
      (error: unknown) => {
        assert.ok(error instanceof CarinaError);
        assert.equal(error.code, "NOT_FOUND");
        return true;
      },
    );
    await assert.rejects(
      () => store.mutate({ removeNodeIds: ["01missingnodeid00000000000"] }),
      (error: unknown) => {
        assert.ok(error instanceof CarinaError);
        assert.equal(error.code, "NOT_FOUND");
        return true;
      },
    );
  } finally {
    await removeTemp(packDir);
  }
});

test("GRAPH_INVALID on dangling edges at construct or mutate", async () => {
  const packDir = await mkdtemp(join(tmpdir(), "carina-world-"));
  try {
    assert.throws(
      () =>
        new WorldStore({
          packDir,
          graph: {
            version: 0,
            nodes: [],
            edges: [
              {
                id: createUlid(),
                type: EdgeType.In,
                fromId: createUlid(),
                toId: createUlid(),
                props: {},
                createdAt: FIXED_TIME,
              },
            ],
          },
          session: { placeId: null, lastTurnAt: null, modelId: null },
          async save() {
            return;
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof CarinaError);
        assert.equal(error.code, "GRAPH_INVALID");
        return true;
      },
    );
  } finally {
    await removeTemp(packDir);
  }
});

test("GRAPH_INVALID when an edge points at a missing node", async () => {
  const { packDir, store } = await createTempStore();
  try {
    await assert.rejects(
      () =>
        store.mutate({
          addEdges: [
            {
              id: createUlid(),
              type: EdgeType.In,
              fromId: createUlid(),
              toId: createUlid(),
              props: {},
              createdAt: FIXED_TIME,
            },
          ],
        }),
      (error: unknown) => {
        assert.ok(error instanceof CarinaError);
        assert.equal(error.code, "GRAPH_INVALID");
        return true;
      },
    );
  } finally {
    await removeTemp(packDir);
  }
});

test("replayChronicle lets the log win over Event nodes", async () => {
  const fixture = tavernFixture();
  const { packDir, store } = await createTempStore(fixture.graph);
  try {
    const chronicleEvent = await store.appendEvent({
      kind: "say",
      occurredAt: FIXED_TIME,
      payload: { text: "hello" },
      relatedNodeIds: [fixture.barkeeperId],
    });
    const eventNode = store.query({ id: chronicleEvent.id })[0];
    assert.ok(eventNode);
    eventNode.props["kind"] = "tampered";
    await store.replayChronicle();
    const restored = store.query({ id: chronicleEvent.id })[0];
    assert.equal(restored?.props["kind"], "say");
  } finally {
    await removeTemp(packDir);
  }
});

test("appendEvent keeps a caller-supplied chronicle id", async () => {
  const fixture = tavernFixture();
  const { packDir, store } = await createTempStore(fixture.graph);
  try {
    const suppliedId = createUlid();
    const chronicleEvent = await store.appendEvent({
      id: suppliedId,
      kind: "utterance",
      occurredAt: FIXED_TIME,
      payload: { role: "user", text: "hello" },
      relatedNodeIds: [],
    });
    assert.equal(chronicleEvent.id, suppliedId);
    assert.equal(store.query({ id: suppliedId }).length, 1);
  } finally {
    await removeTemp(packDir);
  }
});

test("createPack then WorldStore persists presence and memory", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "carina-world-"));
  const packDir = join(rootDir, "tavern.carina");
  try {
    await createPack(packDir, "en");
    const packHandle = await openPack(packDir);
    const store = new WorldStore(packHandle);
    const hall = makeNode(NodeType.Place, "Hall");
    await store.mutate({ addNodes: [hall] });
    await store.setPresence(hall.id);
    await store.remember("The guest is called William.", [hall.id]);
    const reopened = await openPack(packDir);
    const storeAgain = new WorldStore(reopened);
    assert.equal(storeAgain.session.placeId, hall.id);
    const memory = await readFile(join(packDir, "MEMORY.md"), "utf8");
    assert.equal(memory.includes("The guest is called William."), true);
    const claims = storeAgain.query({ type: NodeType.Claim });
    assert.equal(claims.length, 1);
  } finally {
    await removeTemp(rootDir);
  }
});
