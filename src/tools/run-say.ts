import { CarinaError } from "../errors.js";
import type { SayInput, ToolResult } from "../schema/index.js";
import { NodeType } from "../schema/index.js";
import { t } from "../i18n/index.js";
import { DEFAULT_HOP_COUNT } from "../world/index.js";
import type { ToolContext } from "./context.js";
import { requireNode, requirePresence } from "./graph-read.js";

/**
 * zh: 对视野内 Entity 说话，写入编年；不自动晋升 Claim（请用 remember）。
 * en: Speak to an Entity in view and chronicle it; does not auto-promote a Claim (use remember).
 */
export async function runSay(
  input: SayInput,
  ctx: ToolContext,
): Promise<ToolResult> {
  const placeId = requirePresence(ctx.packHandle);
  const entity = requireNode(ctx.store, input.entityId);
  if (entity.type !== NodeType.Entity) {
    throw new CarinaError("NOT_FOUND", "error.notFound");
  }
  const neighborhood = ctx.store.hopNeighborhood(placeId, DEFAULT_HOP_COUNT);
  const inView = neighborhood.nodes.some((node) => node.id === input.entityId);
  if (!inView) {
    throw new CarinaError("NOT_FOUND", "error.notFound");
  }
  const chronicleEvent = await ctx.store.appendEvent({
    kind: "say",
    payload: { entityId: input.entityId, text: input.text },
    relatedNodeIds: [input.entityId, placeId],
  });
  return {
    ok: true,
    summary: t("tool.say.ok", ctx.lang),
    data: { entityId: input.entityId, eventId: chronicleEvent.id },
  };
}
