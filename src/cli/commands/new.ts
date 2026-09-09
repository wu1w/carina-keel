import { defineCommand } from "citty";
import { loadConfig } from "../../config.js";
import { t } from "../../i18n/index.js";
import { createPack } from "../../pack/index.js";
import { printStatus, runSafely } from "../run-safely.js";
import { resolveConfig } from "../resolve-config.js";

const lang = loadConfig().lang;

/**
 * zh: 创建世界包。直连 pack，不经 daemon。
 * en: Create a world pack. Calls pack directly, no daemon.
 */
export const newCommand = defineCommand({
  meta: {
    name: "new",
    description: t("cli.new", lang),
  },
  args: {
    pack: {
      type: "positional",
      description: t("cli.packArg", lang),
      required: true,
    },
  },
  async run({ args }) {
    await runSafely(lang, async () => {
      const config = resolveConfig(args.pack);
      const packDir = config.pack;
      if (packDir === undefined || packDir === "") {
        printStatus("cli.needPack", lang);
        process.exitCode = 1;
        return;
      }
      await createPack(packDir, config.lang);
      printStatus("cli.created", lang, packDir);
    });
  },
});
