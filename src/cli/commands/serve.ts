import { defineCommand } from "citty";
import { loadConfig } from "../../config.js";
import { t } from "../../i18n/index.js";
import { startHttpServer } from "../../server/index.js";
import { waitForStopSignal } from "../daemon.js";
import { requirePackPath, resolveConfig } from "../resolve-config.js";
import { printStatus, runSafely } from "../run-safely.js";

const lang = loadConfig().lang;

/**
 * zh: 启动本机 HTTP daemon。
 * en: Start the local HTTP daemon.
 */
export const serveCommand = defineCommand({
  meta: {
    name: "serve",
    description: t("cli.serve", lang),
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
      const { close } = await startHttpServer(config);
      await waitForStopSignal(close);
    });
  },
});
