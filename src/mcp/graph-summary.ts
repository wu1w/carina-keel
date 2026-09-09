import type { GraphFile, SessionFile } from "../schema/index.js";

/**
 * zh: 图谱只读摘要，不含完整节点属性。
 * en: Read-only graph summary without full node props.
 */
export function graphSummary(graph: GraphFile, session: SessionFile): string {
  const nodeTypes: Record<string, number> = {};
  for (const node of graph.nodes) {
    const count = nodeTypes[node.type];
    nodeTypes[node.type] = (count === undefined ? 0 : count) + 1;
  }
  const places: Array<{ id: string; name: unknown }> = [];
  for (const node of graph.nodes) {
    if (node.type === "Place") {
      places.push({ id: node.id, name: node.props["name"] });
    }
  }
  return JSON.stringify(
    {
      version: graph.version,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      nodeTypes,
      places,
      placeId: session.placeId,
    },
    null,
    2,
  );
}
