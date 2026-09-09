import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import { CarinaError } from "../errors.js";
import { resolvePosix } from "../pack/index.js";
import {
  chronicleEventSchema,
  NodeType,
  type ChronicleEvent,
  type EventNode,
  type GraphFile,
} from "../schema/index.js";
import { isEnoent } from "./ids.js";

/**
 * zh: 追加编年事件的输入。可带完整 ChronicleEvent 字段；可投影为图上 Event 节点。
 * en: Input for appending a chronicle event. May include a full ChronicleEvent; may project an Event node.
 */
export type AppendEventInput = {
  id?: string | undefined;
  kind: string;
  payload?: Record<string, unknown> | undefined;
  relatedNodeIds?: readonly string[] | undefined;
  actorId?: string | undefined;
  occurredAt?: string | undefined;
  projectNode?: boolean | undefined;
};

/**
 * zh: 从 occurredAt 得到 UTC 日期文件名（events/YYYY-MM-DD.jsonl）。
 * en: UTC date file name from occurredAt (events/YYYY-MM-DD.jsonl).
 */
export function chronicleFileName(occurredAt: string): string {
  const parsed = new Date(occurredAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new CarinaError("GRAPH_INVALID", "error.graphInvalid");
  }
  return `${parsed.toISOString().slice(0, 10)}.jsonl`;
}

/**
 * zh: 编年事件投影为 Event 节点。id 与日志行相同。
 * en: Project a chronicle event to an Event node. Id matches the log line.
 */
export function chronicleToEventNode(
  chronicleEvent: ChronicleEvent,
): EventNode {
  const props: Record<string, unknown> = {
    kind: chronicleEvent.kind,
    occurredAt: chronicleEvent.occurredAt,
    payload: chronicleEvent.payload,
    relatedNodeIds: chronicleEvent.relatedNodeIds,
  };
  if (chronicleEvent.actorId !== undefined) {
    props["actorId"] = chronicleEvent.actorId;
  }
  return {
    id: chronicleEvent.id,
    type: NodeType.Event,
    props,
    createdAt: chronicleEvent.occurredAt,
  };
}

/**
 * zh: 用编年重建 Event 节点；同一 id 冲突时日志为准。
 * en: Rebuild Event nodes from the chronicle; the log wins on the same id.
 */
export function projectChronicle(
  graph: GraphFile,
  chronicleEvents: ChronicleEvent[],
): GraphFile {
  const logIds = new Set(
    chronicleEvents.map((chronicleEvent) => chronicleEvent.id),
  );
  const keptNodes = graph.nodes.filter(
    (node) => node.type !== NodeType.Event || !logIds.has(node.id),
  );
  const projected = chronicleEvents.map(chronicleToEventNode);
  return {
    version: 0,
    nodes: [...keptNodes, ...projected],
    edges: graph.edges.slice(),
  };
}

/**
 * zh: 把一行编年追加到 events/YYYY-MM-DD.jsonl（只追加）。
 * en: Append one chronicle line to events/YYYY-MM-DD.jsonl (append-only).
 */
export async function writeChronicleLine(
  packDir: string,
  chronicleEvent: ChronicleEvent,
): Promise<void> {
  const eventsDir = resolvePosix(packDir, "events");
  await mkdir(eventsDir, { recursive: true });
  const fileName = chronicleFileName(chronicleEvent.occurredAt);
  const filePath = resolvePosix(packDir, `events/${fileName}`);
  await appendFile(filePath, `${JSON.stringify(chronicleEvent)}\n`, "utf8");
}

/**
 * zh: 读取包内全部 jsonl 编年，按文件名再按 occurredAt / id 排序。
 * en: Read all jsonl chronicle lines in the pack, sorted by file name then occurredAt / id.
 */
export async function readChronicle(
  packDir: string,
): Promise<ChronicleEvent[]> {
  const eventsDir = resolvePosix(packDir, "events");
  let fileNames: string[];
  try {
    fileNames = await readdir(eventsDir);
  } catch (error) {
    if (isEnoent(error)) {
      return [];
    }
    throw error;
  }
  const jsonlNames = fileNames
    .filter((fileName) => fileName.endsWith(".jsonl"))
    .sort();
  const chronicleEvents: ChronicleEvent[] = [];
  for (const fileName of jsonlNames) {
    const filePath = resolvePosix(packDir, `events/${fileName}`);
    const text = await readFile(filePath, "utf8");
    const lines = text.split("\n");
    for (const line of lines) {
      if (line.trim().length === 0) {
        continue;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch (cause) {
        throw new CarinaError("GRAPH_INVALID", "error.graphInvalid", cause);
      }
      const parsed = chronicleEventSchema.safeParse(raw);
      if (!parsed.success) {
        throw new CarinaError(
          "GRAPH_INVALID",
          "error.graphInvalid",
          parsed.error,
        );
      }
      chronicleEvents.push(parsed.data);
    }
  }
  chronicleEvents.sort((left, right) => {
    if (left.occurredAt !== right.occurredAt) {
      return left.occurredAt < right.occurredAt ? -1 : 1;
    }
    return left.id < right.id ? -1 : 1;
  });
  return chronicleEvents;
}

/**
 * zh: 用 Zod 构造一条编年事件。
 * en: Build a chronicle event with Zod.
 */
export function parseChronicleEvent(input: {
  id: string;
  occurredAt: string;
  kind: string;
  payload: Record<string, unknown>;
  relatedNodeIds: readonly string[];
  actorId?: string | undefined;
}): ChronicleEvent {
  const parsed = chronicleEventSchema.safeParse({
    id: input.id,
    occurredAt: input.occurredAt,
    kind: input.kind,
    payload: input.payload,
    relatedNodeIds: [...input.relatedNodeIds],
    ...(input.actorId !== undefined ? { actorId: input.actorId } : {}),
  });
  if (!parsed.success) {
    throw new CarinaError("GRAPH_INVALID", "error.graphInvalid", parsed.error);
  }
  return parsed.data;
}
