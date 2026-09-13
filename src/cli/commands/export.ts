import { resolve } from "node:path";
import { defineCommand } from "citty";
import { loadConfig } from "../../config.js";
import { t } from "../../i18n/index.js";
import { runWithLegacyPack } from "../legacy-pack.js";
import { runSafely } from "../run-safely.js";
import { createToolContext, executeTool } from "../tool-session.js";

const lang = loadConfig().lang;

/**
 * zh: 导出世界包。遗留图谱导出；产品路径是 chat 里说「导出这间屋子」。
 * en: Export a world pack. Legacy graph export; the product path is saying 导出这间屋子 in chat.
 */
export const exportCommand = defineCommand({
  meta: {
    name: "export",
    description: t("cli.export", lang),
  },
  args: {
    pack: {
      type: "positional",
      description: t("cli.packArg", lang),
      required: false,
    },
    dest: {
      type: "positional",
      description: t("cli.destArg", lang),
      required: true,
    },
  },
  async run({ args }) {
    await runSafely(lang, async () => {
      await runWithLegacyPack(args.pack, async (packDir, config) => {
        const ctx = await createToolContext(packDir, config.lang);
        const result = await executeTool(
          "export",
          { destPath: resolve(args.dest) },
          ctx,
        );
        console.log(result.summary);
      });
    });
  },
});
