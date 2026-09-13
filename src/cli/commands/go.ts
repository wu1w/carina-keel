import { defineCommand } from "citty";
import { loadConfig } from "../../config.js";
import { t } from "../../i18n/index.js";
import { runSafely } from "../run-safely.js";
import { createToolContext, executeTool } from "../tool-session.js";
import { runWithLegacyPack } from "../legacy-pack.js";

const lang = loadConfig().lang;

/**
 * zh: 前往一个地点。遗留图谱工具，需要世界包。
 * en: Move the player to a place. Legacy graph tool; needs a pack.
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
      await runWithLegacyPack(args.pack, async (packDir, config) => {
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
    });
  },
});
