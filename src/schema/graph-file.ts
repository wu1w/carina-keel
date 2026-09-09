import { z } from "zod";
import { EdgeType } from "./edge-types.js";
import { NodeType } from "./node-types.js";

const nodeTypeSchema = z.enum([
  NodeType.World,
  NodeType.Place,
  NodeType.Entity,
  NodeType.Object,
  NodeType.Event,
  NodeType.Asset,
  NodeType.Claim,
]);

const edgeTypeSchema = z.enum([
  EdgeType.In,
  EdgeType.Contains,
  EdgeType.Knows,
  EdgeType.Owns,
  EdgeType.Caused,
  EdgeType.DepictedAs,
  EdgeType.DerivedFrom,
]);

/**
 * zh: 节点记录。磁盘 type 为 Object 时，TS 类型名为 ObjectNode。
 * en: Node record. Disk type Object is typed as ObjectNode in TypeScript.
 */
export const nodeRecordSchema = z.object({
  id: z.string().min(1),
  type: nodeTypeSchema,
  props: z.record(z.string(), z.unknown()),
  createdAt: z.string().min(1),
});

/**
 * zh: 节点记录类型。
 * en: Node record type.
 */
export type NodeRecord = z.infer<typeof nodeRecordSchema>;

/**
 * zh: World 节点。
 * en: World node.
 */
export type WorldNode = NodeRecord & { type: typeof NodeType.World };

/**
 * zh: Place 节点。
 * en: Place node.
 */
export type PlaceNode = NodeRecord & { type: typeof NodeType.Place };

/**
 * zh: Entity 节点。
 * en: Entity node.
 */
export type EntityNode = NodeRecord & { type: typeof NodeType.Entity };

/**
 * zh: Object 节点（物品）。禁止把类型命名为 Object。
 * en: Object node (a thing). Never name the type Object.
 */
export type ObjectNode = NodeRecord & { type: typeof NodeType.Object };

/**
 * zh: Event 图节点（与编年 jsonl 不同）。
 * en: Event graph node (distinct from chronicle jsonl).
 */
export type EventNode = NodeRecord & { type: typeof NodeType.Event };

/**
 * zh: Asset 节点。
 * en: Asset node.
 */
export type AssetNode = NodeRecord & { type: typeof NodeType.Asset };

/**
 * zh: Claim 节点。
 * en: Claim node.
 */
export type ClaimNode = NodeRecord & { type: typeof NodeType.Claim };

/**
 * zh: 边记录。
 * en: Edge record.
 */
export const edgeRecordSchema = z.object({
  id: z.string().min(1),
  type: edgeTypeSchema,
  fromId: z.string().min(1),
  toId: z.string().min(1),
  props: z.record(z.string(), z.unknown()),
  createdAt: z.string().min(1),
});

/**
 * zh: 边记录类型。
 * en: Edge record type.
 */
export type EdgeRecord = z.infer<typeof edgeRecordSchema>;

/**
 * zh: graph.json 根对象。
 * en: Root object of graph.json.
 */
export const graphFileSchema = z.object({
  version: z.literal(0),
  nodes: z.array(nodeRecordSchema),
  edges: z.array(edgeRecordSchema),
});

/**
 * zh: graph.json 类型。
 * en: graph.json type.
 */
export type GraphFile = z.infer<typeof graphFileSchema>;

/**
 * zh: session.json。
 * en: session.json.
 */
export const sessionFileSchema = z.object({
  placeId: z.string().nullable(),
  lastTurnAt: z.string().nullable(),
  modelId: z.string().nullable(),
});

/**
 * zh: 会话文件类型。
 * en: Session file type.
 */
export type SessionFile = z.infer<typeof sessionFileSchema>;

/**
 * zh: 资产 sidecar（与二进制同名的 .json）。
 * en: Asset sidecar JSON next to a binary.
 */
export const assetSidecarSchema = z.object({
  nodeId: z.string().min(1),
  kind: z.string().min(1),
  posixPath: z.string().min(1),
  license: z.string().optional(),
  model: z.string().optional(),
  prompt: z.string().optional(),
  createdAt: z.string().min(1),
});

/**
 * zh: 资产 sidecar 类型。
 * en: Asset sidecar type.
 */
export type AssetSidecar = z.infer<typeof assetSidecarSchema>;
