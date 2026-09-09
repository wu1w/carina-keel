import { CarinaError } from "../errors.js";
import type { ExportInput, ToolResult } from "../schema/index.js";
import { t } from "../i18n/index.js";
import type { ToolContext } from "./context.js";

/**
 * zh: 调用 pack.exportZip 写出可迁移的 zip。
 * en: Call pack.exportZip to write a portable zip.
 */
export async function runExport(
  input: ExportInput,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    await ctx.exportZip(ctx.packHandle, input.destPath);
  } catch (cause) {
    if (cause instanceof CarinaError) {
      throw cause;
    }
    throw new CarinaError("EXPORT_FAILED", "error.exportFailed", cause);
  }
  return {
    ok: true,
    summary: t("tool.export.ok", ctx.lang),
    data: { destPath: input.destPath },
  };
}
