import { defineCommand } from "citty";
import { loadConfig } from "../../config.js";
import { t } from "../../i18n/index.js";
import { runSafely } from "../run-safely.js";
import { createToolContext, executeTool } from "../tool-session.js";
import { runWithLegacyPack } from "../legacy-pack.js";

const lang = loadConfig().lang;

/**
 * zh: 对视野内人物说话。遗留图谱工具，需要世界包。
 * en: Speak to an entity in view. Legacy graph tool; needs a pack.
 */
export const sayCommand = defineCommand({
  meta: {
    name: "say",
    description: t("cli.say", lang),
  },
  args: {
    pack: {
      type: "positional",
      description: t("cli.packArg", lang),
      required: false,
    },
    entityId: {
      type: "string",
      description: t("cli.entityArg", lang),
      required: true,
    },
    text: {
      type: "string",
      description: t("cli.textArg", lang),
      required: true,
    },
  },
  async run({ args }) {
    await runSafely(lang, async () => {
      await runWithLegacyPack(args.pack, async (packDir, config) => {
        const ctx = await createToolContext(packDir, config.lang);
        const result = await executeTool(
          "say",
          { entityId: args.entityId, text: args.text },
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
