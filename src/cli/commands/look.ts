import { defineCommand } from "citty";
import { loadConfig } from "../../config.js";
import { t } from "../../i18n/index.js";
import { requirePackPath, resolveConfig } from "../resolve-config.js";
import { printStatus, runSafely } from "../run-safely.js";
import { createToolContext, executeTool } from "../tool-session.js";

const lang = loadConfig().lang;

/**
 * zh: 查看当前地点。直连 tools，不经 daemon。
 * en: Look at the current place. Calls tools directly, no daemon.
 */
export const lookCommand = defineCommand({
  meta: {
    name: "look",
    description: t("cli.look", lang),
  },
  args: {
    pack: {
      type: "positional",
      description: t("cli.packArg", lang),
      required: false,
    },
    style: {
      type: "string",
      description: t("cli.styleArg", lang),
    },
    fresh: {
      type: "boolean",
      description: t("cli.freshArg", lang),
      default: false,
    },
  },
  async run({ args }) {
    await runSafely(lang, async () => {
      const config = resolveConfig(args.pack);
      let packDir: string;
      try {
        packDir = requirePackPath(config);
      } catch {
        printStatus("cli.needPack", lang);
        process.exitCode = 1;
        return;
      }
      const ctx = await createToolContext(packDir, config.lang);
      const input: { style?: string; fresh?: boolean } = {};
      if (args.style !== undefined && args.style !== "") {
        input.style = args.style;
      }
      if (args.fresh === true) {
        input.fresh = true;
      }
      const result = await executeTool("look", input, ctx);
      console.log(result.summary);
      if (result.data !== undefined) {
        console.log(JSON.stringify(result.data, null, 2));
      }
    });
  },
});
