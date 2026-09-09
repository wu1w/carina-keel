import assert from "node:assert/strict";
import test from "node:test";
import type { ChronicleEvent } from "../schema/index.js";
import {
  asSubgraph,
  formatChatTurns,
  formatChronicle,
  formatPresence,
} from "./format-context.js";

/**
 * zh: 无地点时现场切片说明尚未 go。
 * en: Presence with no place explains that go has not happened.
 */
test("formatPresence describes a missing place", () => {
  const text = formatPresence(null, undefined, { nodes: [], edges: [] });
  assert.match(text, /No current place/);
  assert.match(text, /当前没有地点/);
});

/**
 * zh: 编年切片不含 utterance；对话切片只含 utterance。
 * en: Chronicle omits utterances; chat slice keeps only utterances.
 */
test("formatChronicle skips utterances and formatChatTurns keeps them", () => {
  const events: ChronicleEvent[] = [
    {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      occurredAt: "2026-09-08T10:00:00.000Z",
      kind: "spawn",
      payload: { name: "vase" },
      relatedNodeIds: [],
    },
    {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
      occurredAt: "2026-09-09T10:00:00.000Z",
      kind: "utterance",
      payload: { role: "user", text: "I am Wei" },
      relatedNodeIds: [],
    },
    {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAX",
      occurredAt: "2026-09-09T10:00:01.000Z",
      kind: "utterance",
      payload: { role: "assistant", text: "Welcome, Wei." },
      relatedNodeIds: [],
    },
  ];
  const chronicle = formatChronicle(events);
  assert.match(chronicle, /spawn/);
  assert.doesNotMatch(chronicle, /I am Wei/);
  const chat = formatChatTurns(events, 16);
  assert.match(chat, /user: I am Wei/);
  assert.match(chat, /assistant: Welcome, Wei/);
  const capped = formatChatTurns(events, 1);
  assert.equal(capped, "assistant: Welcome, Wei.");
});

/**
 * zh: hopNeighborhood 的节点数组被收成子图。
 * en: hopNeighborhood node arrays are normalized into a subgraph.
 */
test("asSubgraph reads nodes and edges", () => {
  const subgraph = asSubgraph({
    version: 0,
    nodes: [
      {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAY",
        type: "Place",
        props: { name: "Tavern" },
        createdAt: "2026-09-09T00:00:00.000Z",
      },
    ],
    edges: [],
  });
  assert.equal(subgraph.nodes.length, 1);
  assert.equal(subgraph.nodes[0]?.type, "Place");
});
