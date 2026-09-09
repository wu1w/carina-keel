import type { GoInput, ToolResult } from "../schema/index.js";
import { t } from "../i18n/index.js";
import type { ToolContext } from "./context.js";
import { requirePlace } from "./graph-read.js";

/**
 * zh: 把玩家移到一个 Place；presence 与编年由 store.setPresence 写入。
 * en: Move the player to a Place; presence and chronicle are written by store.setPresence.
 */
export async function runGo(
  input: GoInput,
  ctx: ToolContext,
): Promise<ToolResult> {
  requirePlace(ctx.store, input.placeId);
  await ctx.store.setPresence(input.placeId);
  return {
    ok: true,
    summary: t("tool.go.ok", ctx.lang),
    data: { placeId: input.placeId },
  };
}
