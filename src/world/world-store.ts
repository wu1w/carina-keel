import { CarinaError } from "../errors.js";
import type { PackHandle } from "../pack/index.js";
import {
  NodeType,
  type ChronicleEvent,
  type ClaimNode,
  type GraphFile,
  type NodeRecord,
  type SessionFile,
} from "../schema/index.js";
import {
  parseChronicleEvent,
  projectChronicle,
  readChronicle,
  writeChronicleLine,
  type AppendEventInput,
} from "./events.js";
import {
  applyMutate,
  assignGraph,
  assertGraph,
  DEFAULT_HOP_COUNT,
  hopNeighborhood as collectHopNeighborhood,
  type MutatePatch,
} from "./graph.js";
import { createUlid, nowIsoUtc } from "./ids.js";
import {
  appendMemoryFact,
  createClaimNode,
  type RememberOptions,
  type RememberResult,
} from "./memory.js";
import { queryNodes, type QueryFilter } from "./query.js";
import { applyPresence, assertSession } from "./session.js";

export { DEFAULT_HOP_COUNT };
export type { AppendEventInput, MutatePatch, QueryFilter };
export type { PackHandle } from "../pack/index.js";
export type { RememberOptions, RememberResult };

/**
 * zh: 运行中的世界。包装 `../pack/index.js` 的包句柄；图是工作副本，编年 jsonl 只追加，冲突以日志重放为准。
 * en: The live world. Wraps a pack handle from `../pack/index.js`; graph.json is the working graph, events/*.jsonl is append-only, and the log wins on replay.
 */
export class WorldStore {
  readonly packHandle: PackHandle;

  /**
   * zh: 用已打开的世界包构造存储。
   * en: Construct a store from an opened world pack.
   */
  constructor(packHandle: PackHandle) {
    assertGraph(packHandle.graph);
    assertSession(packHandle.session);
    this.packHandle = packHandle;
  }

  /**
   * zh: 当前工作图。
   * en: Current working graph.
   */
  get graph(): GraphFile {
    return this.packHandle.graph;
  }

  /**
   * zh: 当前会话（地点与上一轮）。
   * en: Current session (place and last turn).
   */
  get session(): SessionFile {
    return this.packHandle.session;
  }

  /**
   * zh: 按 id / 类型 / props.name 查找节点。
   * en: Find nodes by id, type, or props.name.
   */
  query(filter: QueryFilter = {}): NodeRecord[] {
    return queryNodes(this.packHandle.graph, filter);
  }

  /**
   * zh: 增删节点与边并保存 graph.json。供 spawn / relate 使用。
   * en: Add or remove nodes and edges, then save graph.json. Used by spawn / relate.
   */
  async mutate(patch: MutatePatch): Promise<GraphFile> {
    const next = applyMutate(this.packHandle.graph, patch);
    assignGraph(this.packHandle.graph, next);
    await this.packHandle.save();
    return this.packHandle.graph;
  }

  /**
   * zh: 追加编年到 events/YYYY-MM-DD.jsonl；默认同时投影 Event 节点。
   * en: Append to events/YYYY-MM-DD.jsonl; by default also project an Event node.
   */
  async appendEvent(input: AppendEventInput): Promise<ChronicleEvent> {
    const occurredAt = input.occurredAt ?? nowIsoUtc();
    const chronicleEvent = parseChronicleEvent({
      id: input.id ?? createUlid(),
      occurredAt,
      kind: input.kind,
      payload: input.payload ?? {},
      relatedNodeIds: input.relatedNodeIds ?? [],
      ...(input.actorId !== undefined ? { actorId: input.actorId } : {}),
    });
    await writeChronicleLine(this.packHandle.packDir, chronicleEvent);
    const projectNode = input.projectNode ?? true;
    if (projectNode) {
      const next = projectChronicle(this.packHandle.graph, [chronicleEvent]);
      assignGraph(this.packHandle.graph, next);
      assertGraph(this.packHandle.graph);
      await this.packHandle.save();
    }
    return chronicleEvent;
  }

  /**
   * zh: 重放编年：图上同 id 的 Event 以日志为准。
   * en: Replay the chronicle: Event nodes with the same id follow the log.
   */
  async replayChronicle(): Promise<GraphFile> {
    const chronicleEvents = await readChronicle(this.packHandle.packDir);
    const next = projectChronicle(this.packHandle.graph, chronicleEvents);
    assertGraph(next);
    assignGraph(this.packHandle.graph, next);
    await this.packHandle.save();
    return this.packHandle.graph;
  }

  /**
   * zh: 设置玩家所在 Place，写入 session 并记一条编年。
   * en: Set the player's Place, write session, and chronicle the move.
   */
  async setPresence(placeId: string): Promise<SessionFile> {
    const place = this.packHandle.graph.nodes.find(
      (node) => node.id === placeId,
    );
    if (place === undefined || place.type !== NodeType.Place) {
      throw new CarinaError("NOT_FOUND", "error.notFound");
    }
    const occurredAt = nowIsoUtc();
    applyPresence(this.packHandle.session, placeId, occurredAt);
    await this.appendEvent({
      kind: "presence",
      occurredAt,
      payload: { placeId },
      relatedNodeIds: [placeId],
    });
    return this.packHandle.session;
  }

  /**
   * zh: 把耐久事实写入 MEMORY.md 与/或 Claim 节点，并记编年。
   * en: Promote a durable fact to MEMORY.md and/or a Claim node, and chronicle it.
   */
  async remember(
    fact: string,
    relatedNodeIds?: readonly string[],
  ): Promise<RememberResult>;
  async remember(
    fact: string,
    options?: RememberOptions,
  ): Promise<RememberResult>;
  async remember(
    fact: string,
    relatedNodeIdsOrOptions?: readonly string[] | RememberOptions,
  ): Promise<RememberResult> {
    const trimmed = fact.trim();
    if (trimmed.length === 0) {
      throw new CarinaError("GRAPH_INVALID", "error.graphInvalid");
    }
    const parsed = parseRememberArg(relatedNodeIdsOrOptions);
    const occurredAt = nowIsoUtc();
    let claimNode: ClaimNode | undefined;
    if (parsed.createClaim) {
      claimNode = createClaimNode(
        createUlid(),
        trimmed,
        parsed.relatedNodeIds,
        occurredAt,
      );
      await this.mutate({ addNodes: [claimNode] });
    }
    if (parsed.writeMemory) {
      await appendMemoryFact(this.packHandle, trimmed, occurredAt);
    }
    const eventRelated =
      claimNode === undefined
        ? [...parsed.relatedNodeIds]
        : [...parsed.relatedNodeIds, claimNode.id];
    await this.appendEvent({
      kind: "remember",
      occurredAt,
      payload: { fact: trimmed },
      relatedNodeIds: eventRelated,
    });
    return { claimNode };
  }

  /**
   * zh: 从地点出发的 N 跳子图，默认 2 跳。
   * en: N-hop subgraph from a place; default 2 hops.
   */
  hopNeighborhood(placeId: string, hopCount?: number): GraphFile {
    return collectHopNeighborhood(
      this.packHandle.graph,
      placeId,
      hopCount ?? DEFAULT_HOP_COUNT,
    );
  }
}

/**
 * zh: remember 第二参可以是相关节点 id 列表，或选项对象。
 * en: remember's second argument may be related node ids or an options object.
 */
function parseRememberArg(
  relatedNodeIdsOrOptions: readonly string[] | RememberOptions | undefined,
): {
  relatedNodeIds: readonly string[];
  writeMemory: boolean;
  createClaim: boolean;
} {
  if (relatedNodeIdsOrOptions === undefined) {
    return { relatedNodeIds: [], writeMemory: true, createClaim: true };
  }
  if (isRelatedNodeIdList(relatedNodeIdsOrOptions)) {
    return {
      relatedNodeIds: relatedNodeIdsOrOptions,
      writeMemory: true,
      createClaim: true,
    };
  }
  return {
    relatedNodeIds: relatedNodeIdsOrOptions.relatedNodeIds ?? [],
    writeMemory: relatedNodeIdsOrOptions.writeMemory ?? true,
    createClaim: relatedNodeIdsOrOptions.createClaim ?? true,
  };
}

/**
 * zh: 第二参是节点 id 列表而非选项对象。
 * en: Second argument is a node id list, not an options object.
 */
function isRelatedNodeIdList(
  value: readonly string[] | RememberOptions,
): value is readonly string[] {
  return Array.isArray(value);
}
