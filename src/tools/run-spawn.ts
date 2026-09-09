import type {
  EdgeRecord,
  NodeRecord,
  SpawnInput,
  ToolResult,
} from "../schema/index.js";
import { EdgeType, NodeType } from "../schema/index.js";
import { t } from "../i18n/index.js";
import type { MutatePatch } from "../world/index.js";
import type { ToolContext } from "./context.js";
import { requirePlace } from "./graph-read.js";
import { newRecordId, utcNow } from "./stamp.js";

/**
 * zh: 创建 Place / Entity / Object 节点，并记一条编年。
 * en: Create a Place / Entity / Object node and append a chronicle event.
 */
export async function runSpawn(
  input: SpawnInput,
  ctx: ToolContext,
): Promise<ToolResult> {
  const createdAt = utcNow();
  const node: NodeRecord = {
    id: newRecordId(),
    type: input.type,
    props: {
      ...(input.props ?? {}),
      name: input.name,
    },
    createdAt,
  };
  const placeId = resolvePlaceId(input, ctx);
  const edges: EdgeRecord[] = [];
  if (placeId !== undefined) {
    requirePlace(ctx.store, placeId);
    edges.push({
      id: newRecordId(),
      type: EdgeType.In,
      fromId: node.id,
      toId: placeId,
      props: {},
      createdAt,
    });
  } else if (input.type === NodeType.Place) {
    const worldNode = ctx.store.query({ type: NodeType.World })[0];
    if (worldNode !== undefined) {
      edges.push({
        id: newRecordId(),
        type: EdgeType.In,
        fromId: node.id,
        toId: worldNode.id,
        props: {},
        createdAt,
      });
    }
  }
  const patch: MutatePatch =
    edges.length > 0
      ? { addNodes: [node], addEdges: edges }
      : { addNodes: [node] };
  await ctx.store.mutate(patch);
  const relatedNodeIds = [node.id, ...edges.map((edge) => edge.toId)];
  const chronicleEvent = await ctx.store.appendEvent({
    kind: "spawn",
    payload: {
      nodeId: node.id,
      type: input.type,
      name: input.name,
    },
    relatedNodeIds,
  });
  return {
    ok: true,
    summary: t("tool.spawn.ok", ctx.lang),
    data: { node, eventId: chronicleEvent.id },
  };
}

/**
 * zh: Entity / Object 默认落在当前地点；显式 placeId 优先。
 * en: Entity / Object default to the current place; an explicit placeId wins.
 */
function resolvePlaceId(
  input: SpawnInput,
  ctx: ToolContext,
): string | undefined {
  if (input.placeId !== undefined) {
    return input.placeId;
  }
  if (input.type === NodeType.Place) {
    return undefined;
  }
  const currentPlaceId = ctx.packHandle.session.placeId;
  return currentPlaceId === null ? undefined : currentPlaceId;
}
