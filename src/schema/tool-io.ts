import { z } from "zod";
import { EdgeType } from "./edge-types.js";
import { NodeType } from "./node-types.js";

/**
 * zh: 八个工具名。
 * en: The eight tool names.
 */
export const TOOL_NAMES = [
  "look",
  "go",
  "say",
  "remember",
  "spawn",
  "relate",
  "attach",
  "export",
] as const;

/**
 * zh: 工具名联合。
 * en: Tool name union.
 */
export type ToolName = (typeof TOOL_NAMES)[number];

const nodeKindSchema = z.enum([
  NodeType.Place,
  NodeType.Entity,
  NodeType.Object,
]);

/**
 * zh: 各工具输入的 Zod 表。
 * en: Zod map of tool inputs.
 */
export const toolInputSchema = {
  look: z.object({
    style: z.string().optional(),
  }),
  go: z.object({
    placeId: z.string().min(1),
  }),
  say: z.object({
    entityId: z.string().min(1),
    text: z.string().min(1),
  }),
  remember: z.object({
    fact: z.string().min(1),
    relatedNodeIds: z.array(z.string()).optional(),
  }),
  spawn: z.object({
    type: nodeKindSchema,
    name: z.string().min(1),
    props: z.record(z.string(), z.unknown()).optional(),
    placeId: z.string().optional(),
  }),
  relate: z.object({
    fromId: z.string().min(1),
    toId: z.string().min(1),
    type: z.enum([
      EdgeType.In,
      EdgeType.Contains,
      EdgeType.Knows,
      EdgeType.Owns,
      EdgeType.Caused,
      EdgeType.DepictedAs,
      EdgeType.DerivedFrom,
    ]),
    retract: z.boolean().optional(),
  }),
  attach: z.object({
    nodeId: z.string().min(1),
    posixPath: z.string().min(1),
    kind: z.string().optional(),
  }),
  export: z.object({
    destPath: z.string().min(1),
  }),
} as const;

/**
 * zh: look 输入。
 * en: look input.
 */
export type LookInput = z.infer<(typeof toolInputSchema)["look"]>;
/**
 * zh: go 输入。
 * en: go input.
 */
export type GoInput = z.infer<(typeof toolInputSchema)["go"]>;
/**
 * zh: say 输入。
 * en: say input.
 */
export type SayInput = z.infer<(typeof toolInputSchema)["say"]>;
/**
 * zh: remember 输入。
 * en: remember input.
 */
export type RememberInput = z.infer<(typeof toolInputSchema)["remember"]>;
/**
 * zh: spawn 输入。
 * en: spawn input.
 */
export type SpawnInput = z.infer<(typeof toolInputSchema)["spawn"]>;
/**
 * zh: relate 输入。
 * en: relate input.
 */
export type RelateInput = z.infer<(typeof toolInputSchema)["relate"]>;
/**
 * zh: attach 输入。
 * en: attach input.
 */
export type AttachInput = z.infer<(typeof toolInputSchema)["attach"]>;
/**
 * zh: export 输入。
 * en: export input.
 */
export type ExportInput = z.infer<(typeof toolInputSchema)["export"]>;

/**
 * zh: 工具统一输出。
 * en: Shared tool output.
 */
export const toolResultSchema = z.object({
  ok: z.boolean(),
  summary: z.string(),
  data: z.unknown().optional(),
});

/**
 * zh: 工具输出类型。
 * en: Tool result type.
 */
export type ToolResult = z.infer<typeof toolResultSchema>;
