import assert from "node:assert/strict";
import test from "node:test";
import {
  EdgeType,
  NodeType,
  TOOL_NAMES,
  chronicleEventSchema,
  edgeRecordSchema,
  graphFileSchema,
  nodeRecordSchema,
  renderResultSchema,
  renderViewSchema,
  sessionFileSchema,
  toolInputSchema,
  toolResultSchema,
} from "./index.js";

const FROZEN_NODE_TYPES = [
  "World",
  "Place",
  "Entity",
  "Object",
  "Event",
  "Asset",
  "Claim",
] as const;

const FROZEN_EDGE_TYPES = [
  "in",
  "contains",
  "knows",
  "owns",
  "caused",
  "depicted_as",
  "derived_from",
] as const;

const FROZEN_TOOL_NAMES = [
  "look",
  "go",
  "say",
  "remember",
  "spawn",
  "relate",
  "attach",
  "export",
] as const;

/**
 * zh: 一期本体锁死：七种节点。
 * en: Phase-1 ontology lock: seven node types.
 */
test("NodeType is locked to the seven PRD node kinds", () => {
  const values = Object.values(NodeType);
  assert.deepEqual(values, [...FROZEN_NODE_TYPES]);
  assert.equal(values.length, 7);
});

/**
 * zh: 一期本体锁死：七种边。
 * en: Phase-1 ontology lock: seven edge types.
 */
test("EdgeType is locked to the seven PRD edge kinds", () => {
  const values = Object.values(EdgeType);
  assert.deepEqual(values, [...FROZEN_EDGE_TYPES]);
  assert.equal(values.length, 7);
});

/**
 * zh: 一期工具名单锁死为八个小写名。
 * en: Phase-1 tool names are locked to eight lowercase verbs.
 */
test("TOOL_NAMES is locked to the eight world tools", () => {
  assert.deepEqual([...TOOL_NAMES], [...FROZEN_TOOL_NAMES]);
  assert.equal(TOOL_NAMES.length, 8);
  assert.deepEqual(Object.keys(toolInputSchema), [...FROZEN_TOOL_NAMES]);
});

test("graphFileSchema accepts version 0 and rejects unknown node types", () => {
  const valid = graphFileSchema.safeParse({
    version: 0,
    nodes: [
      {
        id: "01NODE00000000000000000001",
        type: "Place",
        props: { name: "Tavern" },
        createdAt: "2026-09-09T00:00:00.000Z",
      },
    ],
    edges: [],
  });
  assert.equal(valid.success, true);
  const invalid = graphFileSchema.safeParse({
    version: 0,
    nodes: [
      {
        id: "01NODE00000000000000000001",
        type: "Portal",
        props: {},
        createdAt: "2026-09-09T00:00:00.000Z",
      },
    ],
    edges: [],
  });
  assert.equal(invalid.success, false);
});

test("edgeRecordSchema accepts depicted_as and rejects unknown edge types", () => {
  const valid = edgeRecordSchema.safeParse({
    id: "01EDGE00000000000000000001",
    type: "depicted_as",
    fromId: "a",
    toId: "b",
    props: {},
    createdAt: "2026-09-09T00:00:00.000Z",
  });
  assert.equal(valid.success, true);
  const invalid = edgeRecordSchema.safeParse({
    id: "01EDGE00000000000000000001",
    type: "likes",
    fromId: "a",
    toId: "b",
    props: {},
    createdAt: "2026-09-09T00:00:00.000Z",
  });
  assert.equal(invalid.success, false);
});

test("sessionFileSchema allows null presence fields", () => {
  const parsed = sessionFileSchema.safeParse({
    placeId: null,
    lastTurnAt: null,
    modelId: null,
  });
  assert.equal(parsed.success, true);
});

test("chronicleEventSchema requires id, occurredAt, kind, payload, relatedNodeIds", () => {
  const parsed = chronicleEventSchema.safeParse({
    id: "01EVENT0000000000000000001",
    occurredAt: "2026-09-09T00:00:00.000Z",
    kind: "spawn",
    payload: {},
    relatedNodeIds: [],
  });
  assert.equal(parsed.success, true);
  const missing = chronicleEventSchema.safeParse({
    id: "01EVENT0000000000000000001",
  });
  assert.equal(missing.success, false);
});

test("tool input schemas accept the frozen shapes and reject extras that matter", () => {
  assert.equal(toolInputSchema.spawn.safeParse({ type: "World", name: "X" }).success, false);
  assert.equal(
    toolInputSchema.spawn.safeParse({ type: "Place", name: "Tavern" }).success,
    true,
  );
  assert.equal(toolInputSchema.go.safeParse({ placeId: "p1" }).success, true);
  assert.equal(toolInputSchema.go.safeParse({}).success, false);
});

test("render and tool result schemas accept phase-1 text media", () => {
  const view = renderViewSchema.safeParse({
    placeId: "p1",
    entities: [],
  });
  assert.equal(view.success, true);
  const result = renderResultSchema.safeParse({ media: "plain text" });
  assert.equal(result.success, true);
  const tool = toolResultSchema.safeParse({ ok: true, summary: "ok" });
  assert.equal(tool.success, true);
  const node = nodeRecordSchema.safeParse({
    id: "01NODE00000000000000000001",
    type: "Claim",
    props: { fact: "x" },
    createdAt: "2026-09-09T00:00:00.000Z",
  });
  assert.equal(node.success, true);
});
