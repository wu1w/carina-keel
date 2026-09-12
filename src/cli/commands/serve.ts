import { defineCommand } from "citty";
import { loadConfig } from "../../config.js";
import { t } from "../../i18n/index.js";
import { startHttpServer } from "../../server/index.js";
import { waitForStopSignal } from "../daemon.js";
import { resolveConfig } from "../resolve-config.js";
import { runSafely } from "../run-safely.js";

const lang = loadConfig().lang;

/**
 * zh: 启动本机 HTTP daemon。世界包可选。
 * en: Start the local HTTP daemon. Pack path is optional.
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
      const { close } = await startHttpServer(config);
      await waitForStopSignal(close);
    });
  },
});
