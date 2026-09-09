import assert from "node:assert/strict";
import test from "node:test";
import type { GraphFile, SessionFile } from "../schema/index.js";
import { graphSummary } from "./graph-summary.js";

/**
 * zh: 图谱摘要不含完整节点 props。
 * en: Graph summary omits full node props.
 */
test("graphSummary is a compact read-only view", () => {
  const graph: GraphFile = {
    version: 0,
    nodes: [
      {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        type: "Place",
        props: { name: "Inn", secret: "should-not-dump-as-geometry" },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    edges: [],
  };
  const session: SessionFile = {
    placeId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    lastTurnAt: null,
    modelId: null,
  };
  const text = graphSummary(graph, session);
  const parsed: unknown = JSON.parse(text);
  assert.equal(typeof parsed, "object");
  const record = parsed as {
    nodeCount: number;
    places: Array<{ id: string }>;
    placeId: string | null;
  };
  assert.equal(record.nodeCount, 1);
  assert.equal(record.places[0]?.id, "01ARZ3NDEKTSV4RRFFQ69G5FAV");
  assert.equal(record.placeId, "01ARZ3NDEKTSV4RRFFQ69G5FAV");
  assert.equal(text.includes("should-not-dump-as-geometry"), false);
});
