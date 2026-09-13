import { defineCommand } from "citty";
import { loadConfig } from "../../config.js";
import { t } from "../../i18n/index.js";
import { startMcpServer } from "../../mcp/index.js";
import { resolveConfig } from "../resolve-config.js";
import { runSafely } from "../run-safely.js";

const lang = loadConfig().lang;

/**
 * zh: 以 stdio 启动 MCP。
 * en: Start MCP over stdio.
 */
export const mcpCommand = defineCommand({
  meta: {
    name: "mcp",
    description: t("cli.mcp", lang),
  },
  args: {
    pack: {
      type: "positional",
      description: t("cli.packArg", lang),
      required: false,
    },
  },
  async run({ args }) {
    await runSafely(lang, async () => {
      const config = resolveConfig(args.pack);
      await startMcpServer(config);
    });
  },
});
