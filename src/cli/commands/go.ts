import { defineCommand } from "citty";
import { loadConfig } from "../../config.js";
import { t } from "../../i18n/index.js";
import { requirePackPath, resolveConfig } from "../resolve-config.js";
import { printStatus, runSafely } from "../run-safely.js";
import { createToolContext, executeTool } from "../tool-session.js";

const lang = loadConfig().lang;

/**
 * zh: 前往一个地点。直连 tools，不经 daemon。
 * en: Move the player to a place. Calls tools directly, no daemon.
 */
export const goCommand = defineCommand({
  meta: {
    name: "go",
    description: t("cli.go", lang),
  },
  args: {
    pack: {
      type: "positional",
      description: t("cli.packArg", lang),
      required: false,
    },
    placeId: {
      type: "string",
      description: t("cli.placeArg", lang),
      required: true,
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
      const result = await executeTool(
        "go",
        { placeId: args.placeId },
        ctx,
      );
      console.log(result.summary);
      if (result.data !== undefined) {
        console.log(JSON.stringify(result.data, null, 2));
      }
    });
  },
});
