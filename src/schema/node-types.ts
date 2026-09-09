/**
 * zh: 节点类型字面量。磁盘 JSON 使用这些字符串。
 * en: Node type literals. On-disk JSON uses these strings.
 */
export const NodeType = {
  World: "World",
  Place: "Place",
  Entity: "Entity",
  Object: "Object",
  Event: "Event",
  Asset: "Asset",
  Claim: "Claim",
} as const;

/**
 * zh: 节点类型联合。
 * en: Union of node types.
 */
export type NodeType = (typeof NodeType)[keyof typeof NodeType];
