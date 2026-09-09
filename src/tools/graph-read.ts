import { CarinaError } from "../errors.js";
import { NodeType, type NodeRecord } from "../schema/index.js";
import type { PackHandle } from "../pack/index.js";
import type { WorldStore } from "../world/index.js";

/**
 * zh: 读节点 props.name。
 * en: Read props.name from a node.
 */
export function readNodeName(node: NodeRecord): string | undefined {
  const value = node.props["name"];
  return typeof value === "string" ? value : undefined;
}

/**
 * zh: 按 id 取节点，没有则 NOT_FOUND。
 * en: Load a node by id, or throw NOT_FOUND.
 */
export function requireNode(store: WorldStore, id: string): NodeRecord {
  const matches = store.query({ id });
  const node = matches[0];
  if (node === undefined) {
    throw new CarinaError("NOT_FOUND", "error.notFound");
  }
  return node;
}

/**
 * zh: 取 Place 节点。
 * en: Load a Place node.
 */
export function requirePlace(store: WorldStore, placeId: string): NodeRecord {
  const node = requireNode(store, placeId);
  if (node.type !== NodeType.Place) {
    throw new CarinaError("NOT_FOUND", "error.notFound");
  }
  return node;
}

/**
 * zh: 当前 session 必须已有地点。
 * en: The session must already have a place.
 */
export function requirePresence(packHandle: PackHandle): string {
  const placeId = packHandle.session.placeId;
  if (placeId === null) {
    throw new CarinaError("SESSION_INVALID", "error.sessionInvalid");
  }
  return placeId;
}
