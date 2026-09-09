import { CarinaError } from "../errors.js";
import {
  edgeRecordSchema,
  graphFileSchema,
  NodeType,
  nodeRecordSchema,
  type EdgeRecord,
  type GraphFile,
  type NodeRecord,
} from "../schema/index.js";

/**
 * zh: presence 与上下文默认跳数。
 * en: Default hop count for presence context.
 */
export const DEFAULT_HOP_COUNT = 2;

/**
 * zh: 增删节点与边的补丁。供 spawn / relate 使用。
 * en: Patch to add or remove nodes and edges. Used by spawn / relate.
 */
export type MutatePatch = {
  addNodes?: readonly NodeRecord[] | undefined;
  addEdges?: readonly EdgeRecord[] | undefined;
  removeNodeIds?: readonly string[] | undefined;
  removeEdgeIds?: readonly string[] | undefined;
};

/**
 * zh: 校验 graph.json：Zod 形状、id 唯一、边端点存在。
 * en: Validate graph.json: Zod shape, unique ids, edge endpoints exist.
 */
export function assertGraph(graph: GraphFile): void {
  const parsed = graphFileSchema.safeParse(graph);
  if (!parsed.success) {
    throw new CarinaError("GRAPH_INVALID", "error.graphInvalid", parsed.error);
  }
  const nodeIds = new Set<string>();
  for (const node of parsed.data.nodes) {
    if (nodeIds.has(node.id)) {
      throw new CarinaError("GRAPH_INVALID", "error.graphInvalid");
    }
    nodeIds.add(node.id);
  }
  const edgeIds = new Set<string>();
  for (const edge of parsed.data.edges) {
    if (edgeIds.has(edge.id)) {
      throw new CarinaError("GRAPH_INVALID", "error.graphInvalid");
    }
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.fromId) || !nodeIds.has(edge.toId)) {
      throw new CarinaError("GRAPH_INVALID", "error.graphInvalid");
    }
  }
}

/**
 * zh: 把 source 写回 handle 持有的 graph 对象，避免 save 闭包丢掉引用。
 * en: Copy source onto the handle's graph object so save closures keep working.
 */
export function assignGraph(target: GraphFile, source: GraphFile): void {
  target.version = source.version;
  target.nodes = source.nodes;
  target.edges = source.edges;
}

/**
 * zh: 应用增删补丁，返回新图；原图不被就地改坏。
 * en: Apply an add/remove patch and return a new graph; the original is not mutated in place on failure.
 */
export function applyMutate(graph: GraphFile, patch: MutatePatch): GraphFile {
  const nodes = graph.nodes.slice();
  const edges = graph.edges.slice();
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edgeIds = new Set(edges.map((edge) => edge.id));

  const addNodes = patch.addNodes ?? [];
  for (const node of addNodes) {
    const parsed = nodeRecordSchema.safeParse(node);
    if (!parsed.success) {
      throw new CarinaError(
        "GRAPH_INVALID",
        "error.graphInvalid",
        parsed.error,
      );
    }
    if (nodeIds.has(parsed.data.id)) {
      throw new CarinaError("GRAPH_INVALID", "error.graphInvalid");
    }
    nodes.push(parsed.data);
    nodeIds.add(parsed.data.id);
  }

  const addEdges = patch.addEdges ?? [];
  for (const edge of addEdges) {
    const parsed = edgeRecordSchema.safeParse(edge);
    if (!parsed.success) {
      throw new CarinaError(
        "GRAPH_INVALID",
        "error.graphInvalid",
        parsed.error,
      );
    }
    if (edgeIds.has(parsed.data.id)) {
      throw new CarinaError("GRAPH_INVALID", "error.graphInvalid");
    }
    if (!nodeIds.has(parsed.data.fromId) || !nodeIds.has(parsed.data.toId)) {
      throw new CarinaError("GRAPH_INVALID", "error.graphInvalid");
    }
    edges.push(parsed.data);
    edgeIds.add(parsed.data.id);
  }

  const removeEdgeIds = patch.removeEdgeIds ?? [];
  for (const edgeId of removeEdgeIds) {
    if (!edgeIds.has(edgeId)) {
      throw new CarinaError("NOT_FOUND", "error.notFound");
    }
  }
  const removeEdgeIdSet = new Set(removeEdgeIds);
  const edgesAfterRemove = edges.filter(
    (edge) => !removeEdgeIdSet.has(edge.id),
  );

  const removeNodeIds = patch.removeNodeIds ?? [];
  for (const nodeId of removeNodeIds) {
    if (!nodeIds.has(nodeId)) {
      throw new CarinaError("NOT_FOUND", "error.notFound");
    }
  }
  const removeNodeIdSet = new Set(removeNodeIds);
  const nextNodes = nodes.filter((node) => !removeNodeIdSet.has(node.id));
  const nextEdges = edgesAfterRemove.filter(
    (edge) =>
      !removeNodeIdSet.has(edge.fromId) && !removeNodeIdSet.has(edge.toId),
  );

  const next: GraphFile = {
    version: 0,
    nodes: nextNodes,
    edges: nextEdges,
  };
  assertGraph(next);
  return next;
}

/**
 * zh: 从地点出发的 N 跳无向子图。地点必须存在且类型为 Place。
 * en: Undirected N-hop subgraph from a place. The place must exist and be type Place.
 */
export function hopNeighborhood(
  graph: GraphFile,
  placeId: string,
  hopCount: number | undefined = DEFAULT_HOP_COUNT,
): GraphFile {
  const resolvedHopCount = hopCount ?? DEFAULT_HOP_COUNT;
  if (!Number.isInteger(resolvedHopCount) || resolvedHopCount < 0) {
    throw new CarinaError("GRAPH_INVALID", "error.graphInvalid");
  }
  const origin = graph.nodes.find((node) => node.id === placeId);
  if (origin === undefined || origin.type !== NodeType.Place) {
    throw new CarinaError("NOT_FOUND", "error.notFound");
  }

  const included = new Set<string>([placeId]);
  let frontier = [placeId];
  for (let hop = 0; hop < resolvedHopCount; hop += 1) {
    const nextFrontier: string[] = [];
    for (const nodeId of frontier) {
      for (const edge of graph.edges) {
        let neighborId: string | undefined;
        if (edge.fromId === nodeId) {
          neighborId = edge.toId;
        } else if (edge.toId === nodeId) {
          neighborId = edge.fromId;
        }
        if (neighborId === undefined || included.has(neighborId)) {
          continue;
        }
        included.add(neighborId);
        nextFrontier.push(neighborId);
      }
    }
    frontier = nextFrontier;
  }

  const nodes = graph.nodes
    .filter((node) => included.has(node.id))
    .map((node) => ({ ...node, props: { ...node.props } }));
  const edges = graph.edges
    .filter((edge) => included.has(edge.fromId) && included.has(edge.toId))
    .map((edge) => ({ ...edge, props: { ...edge.props } }));
  return { version: 0, nodes, edges };
}
