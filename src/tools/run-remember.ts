import type { RememberInput, ToolResult } from "../schema/index.js";
import { t } from "../i18n/index.js";
import type { ToolContext } from "./context.js";

/**
 * zh: 把耐久事实交给 store.remember，写入 MEMORY.md 与/或 Claim。
 * en: Hand a durable fact to store.remember for MEMORY.md and/or a Claim.
 */
export async function runRemember(
  input: RememberInput,
  ctx: ToolContext,
): Promise<ToolResult> {
  const result =
    input.relatedNodeIds !== undefined
      ? await ctx.store.remember(input.fact, {
          relatedNodeIds: [...input.relatedNodeIds],
        })
      : await ctx.store.remember(input.fact);
  return {
    ok: true,
    summary: t("tool.remember.ok", ctx.lang),
    data: {
      fact: input.fact,
      ...(result.claimNode !== undefined
        ? { claimId: result.claimNode.id }
        : {}),
    },
  };
}
