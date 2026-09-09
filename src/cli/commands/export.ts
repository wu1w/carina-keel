import { resolve } from "node:path";
import { defineCommand } from "citty";
import { loadConfig } from "../../config.js";
import { t } from "../../i18n/index.js";
import { requirePackPath, resolveConfig } from "../resolve-config.js";
import { printStatus, runSafely } from "../run-safely.js";
import { createToolContext, executeTool } from "../tool-session.js";

const lang = loadConfig().lang;

/**
 * zh: 导出世界包。直连 tools / pack。
 * en: Export a world pack. Calls tools / pack directly.
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
        "export",
        { destPath: resolve(args.dest) },
        ctx,
      );
      console.log(result.summary);
    });
  },
});
