import { CarinaError } from "../errors.js";
import type { EdgeRecord, RelateInput, ToolResult } from "../schema/index.js";
import { t } from "../i18n/index.js";
import type { ToolContext } from "./context.js";
import { requireNode } from "./graph-read.js";
import { newRecordId, utcNow } from "./stamp.js";

/**
 * zh: 增加或撤销一条边，并记编年。
 * en: Add or retract an edge and chronicle the change.
 */
export async function runRelate(
  input: RelateInput,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (input.retract === true) {
    return retractEdge(input, ctx);
  }
  return addEdge(input, ctx);
}

/**
 * zh: 在 from 与 to 之间加边；已有相同边则原样返回。
 * en: Add an edge from → to; return the existing one when it already matches.
 */
async function addEdge(
  input: RelateInput,
  ctx: ToolContext,
): Promise<ToolResult> {
  requireNode(ctx.store, input.fromId);
  requireNode(ctx.store, input.toId);
  const existing = ctx.packHandle.graph.edges.find(
    (edge) =>
      edge.fromId === input.fromId &&
      edge.toId === input.toId &&
      edge.type === input.type,
  );
  if (existing !== undefined) {
    return {
      ok: true,
      summary: t("tool.relate.ok", ctx.lang),
      data: { edge: existing },
    };
  }
  const edge: EdgeRecord = {
    id: newRecordId(),
    type: input.type,
    fromId: input.fromId,
    toId: input.toId,
    props: {},
    createdAt: utcNow(),
  };
  await ctx.store.mutate({ addEdges: [edge] });
  const chronicleEvent = await ctx.store.appendEvent({
    kind: "relate",
    payload: {
      fromId: input.fromId,
      toId: input.toId,
      type: input.type,
      retract: false,
      edgeId: edge.id,
    },
    relatedNodeIds: [input.fromId, input.toId, edge.id],
  });
  return {
    ok: true,
    summary: t("tool.relate.ok", ctx.lang),
    data: { edge, eventId: chronicleEvent.id },
  };
}

/**
 * zh: 撤销匹配 from / to / type 的边。
 * en: Retract edges matching from / to / type.
 */
async function retractEdge(
  input: RelateInput,
  ctx: ToolContext,
): Promise<ToolResult> {
  const matching = ctx.packHandle.graph.edges.filter(
    (edge) =>
      edge.fromId === input.fromId &&
      edge.toId === input.toId &&
      edge.type === input.type,
  );
  if (matching.length === 0) {
    throw new CarinaError("NOT_FOUND", "error.notFound");
  }
  const removeEdgeIds = matching.map((edge) => edge.id);
  await ctx.store.mutate({ removeEdgeIds });
  const chronicleEvent = await ctx.store.appendEvent({
    kind: "relate",
    payload: {
      fromId: input.fromId,
      toId: input.toId,
      type: input.type,
      retract: true,
      edgeIds: removeEdgeIds,
    },
    relatedNodeIds: [input.fromId, input.toId, ...removeEdgeIds],
  });
  return {
    ok: true,
    summary: t("tool.relate.retracted", ctx.lang),
    data: { retractedEdgeIds: removeEdgeIds, eventId: chronicleEvent.id },
  };
}
