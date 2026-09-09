import type { GraphFile, NodeRecord } from "../schema/index.js";

/**
 * zh: 按 id / 类型 / props.name 查找节点。
 * en: Find nodes by id, type, or props.name.
 */
export type QueryFilter = {
  id?: string | undefined;
  type?: string | undefined;
  name?: string | undefined;
};

/**
 * zh: 在工作图上查询节点。未给的条件不参与过滤。
 * en: Query nodes on the working graph. Omitted fields are not applied.
 */
export function queryNodes(
  graph: GraphFile,
  filter: QueryFilter,
): NodeRecord[] {
  return graph.nodes.filter((node) => matchesFilter(node, filter));
}

function matchesFilter(node: NodeRecord, filter: QueryFilter): boolean {
  if (filter.id !== undefined && node.id !== filter.id) {
    return false;
  }
  if (filter.type !== undefined && node.type !== filter.type) {
    return false;
  }
  if (filter.name !== undefined) {
    const name = node.props["name"];
    if (typeof name !== "string") {
      return false;
    }
    if (!name.toLowerCase().includes(filter.name.toLowerCase())) {
      return false;
    }
  }
  return true;
}
