import {
  edgeRecordSchema,
  nodeRecordSchema,
  type ChronicleEvent,
  type EdgeRecord,
  type NodeRecord,
} from "../schema/index.js";
import { UTTERANCE_KIND } from "./constants.js";

/**
 * zh: 邻域子图（hopNeighborhood 的最小形状）。
 * en: Neighborhood subgraph (minimal hopNeighborhood shape).
 */
export type NeighborhoodSubgraph = {
  nodes: NodeRecord[];
  edges: EdgeRecord[];
};

/**
 * zh: 把 hopNeighborhood 的返回值收成 nodes/edges。
 * en: Normalize hopNeighborhood output into nodes/edges.
 */
export function asSubgraph(value: unknown): NeighborhoodSubgraph {
  if (!isRecord(value)) {
    return { nodes: [], edges: [] };
  }
  const nodes: NodeRecord[] = [];
  const nodesRaw = value["nodes"];
  if (Array.isArray(nodesRaw)) {
    for (const item of nodesRaw) {
      const parsed = nodeRecordSchema.safeParse(item);
      if (parsed.success) {
        nodes.push(parsed.data);
      }
    }
  }
  const edges: EdgeRecord[] = [];
  const edgesRaw = value["edges"];
  if (Array.isArray(edgesRaw)) {
    for (const item of edgesRaw) {
      const parsed = edgeRecordSchema.safeParse(item);
      if (parsed.success) {
        edges.push(parsed.data);
      }
    }
  }
  return { nodes, edges };
}

/**
 * zh: 普通对象守卫。
 * en: Guard for a plain object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * zh: 格式化当前地点与 N 跳子图。
 * en: Format current place plus the N-hop subgraph.
 */
export function formatPresence(
  placeId: string | null,
  placeNode: NodeRecord | undefined,
  neighborhood: NeighborhoodSubgraph,
): string {
  if (placeId === null) {
    return [
      "zh: 当前没有地点（尚未 go）。",
      "en: No current place (have not gone anywhere yet).",
    ].join("\n");
  }
  const lines = [
    `placeId: ${placeId}`,
    `place: ${JSON.stringify(placeNode ?? { id: placeId }, null, 2)}`,
    `neighborhood: ${JSON.stringify(neighborhood, null, 2)}`,
  ];
  return lines.join("\n");
}

/**
 * zh: 格式化今昨编年（不含对话 utterance）。
 * en: Format today+yesterday chronicle (excluding chat utterances).
 */
export function formatChronicle(events: ChronicleEvent[]): string {
  const worldEvents = events.filter((event) => event.kind !== UTTERANCE_KIND);
  if (worldEvents.length === 0) {
    return "";
  }
  const lines: string[] = [];
  for (const chronicleEvent of worldEvents) {
    lines.push(JSON.stringify(chronicleEvent));
  }
  return lines.join("\n");
}

/**
 * zh: 从编年里抽出最近对话，有条数上限。
 * en: Pull recent chat turns from the chronicle, capped by count.
 */
export function formatChatTurns(
  events: ChronicleEvent[],
  maxTurns: number,
): string {
  if (maxTurns <= 0) {
    return "";
  }
  const utterances = events.filter((event) => event.kind === UTTERANCE_KIND);
  const start = Math.max(0, utterances.length - maxTurns);
  const recent = utterances.slice(start);
  if (recent.length === 0) {
    return "";
  }
  const lines: string[] = [];
  for (const chronicleEvent of recent) {
    lines.push(formatUtterance(chronicleEvent));
  }
  return lines.join("\n");
}

/**
 * zh: 把一条 utterance 编年格式化成对话行。
 * en: Format one utterance chronicle event as a chat line.
 */
export function formatUtterance(chronicleEvent: ChronicleEvent): string {
  const roleRaw = chronicleEvent.payload["role"];
  const textRaw = chronicleEvent.payload["text"];
  const role = typeof roleRaw === "string" ? roleRaw : "unknown";
  const text = typeof textRaw === "string" ? textRaw : "";
  return `${role}: ${text}`;
}

/**
 * zh: 给非空正文加上中英标题。
 * en: Wrap non-empty body with a bilingual heading.
 */
export function formatSection(title: string, body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return "";
  }
  return `## ${title}\n\n${trimmed}`;
}
