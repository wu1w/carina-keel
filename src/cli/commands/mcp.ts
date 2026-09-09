import { defineCommand } from "citty";
import { loadConfig } from "../../config.js";
import { t } from "../../i18n/index.js";
import { startMcpServer } from "../../mcp/index.js";
import { requirePackPath, resolveConfig } from "../resolve-config.js";
import { printStatus, runSafely } from "../run-safely.js";

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
      try {
        requirePackPath(config);
      } catch {
        printStatus("cli.needPack", lang);
        process.exitCode = 1;
        return;
      }
      await startMcpServer(config);
    });
  },
});
