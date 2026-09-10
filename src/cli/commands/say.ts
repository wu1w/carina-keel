import { defineCommand } from "citty";
import { loadConfig } from "../../config.js";
import { t } from "../../i18n/index.js";
import { requirePackPath, resolveConfig } from "../resolve-config.js";
import { printStatus, runSafely } from "../run-safely.js";
import { createToolContext, executeTool } from "../tool-session.js";

const lang = loadConfig().lang;

/**
 * zh: 对视野内人物说话。直连 tools，不经 daemon。
 * en: Speak to an entity in view. Calls tools directly, no daemon.
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
        "say",
        { entityId: args.entityId, text: args.text },
        ctx,
      );
      console.log(result.summary);
      if (result.data !== undefined) {
        console.log(JSON.stringify(result.data, null, 2));
      }
    });
  },
});
