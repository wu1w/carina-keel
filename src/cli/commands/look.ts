import { defineCommand } from "citty";
import { loadConfig } from "../../config.js";
import { t } from "../../i18n/index.js";
import { printStatus, runSafely } from "../run-safely.js";
import { looksLikePackPath, requirePackPath, resolveConfig } from "../resolve-config.js";
import { createToolContext, executeTool } from "../tool-session.js";
import { dispatchSpeakCli } from "../dispatch-speak.js";

const lang = loadConfig().lang;

/**
 * zh: 查看当前地点。有世界包走旧 look；否则走管家「看一眼」。
 * en: Look at the current place. A pack still uses legacy look; otherwise steward 看一眼.
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
      const packArg = typeof args.pack === "string" ? args.pack : undefined;
      const config = resolveConfig(
        packArg !== undefined && looksLikePackPath(packArg) ? packArg : undefined,
      );
      if (config.pack !== undefined && config.pack !== "") {
        let packDir: string;
        try {
          packDir = requirePackPath(config);
        } catch {
          printStatus("cli.leftoverUseChat", lang);
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
        return;
      }
      const style =
        args.style !== undefined && args.style !== ""
          ? args.style
          : packArg !== undefined && packArg !== ""
            ? packArg
            : undefined;
      const text =
        style !== undefined ? `看一眼，${style}` : "看一眼";
      await dispatchSpeakCli(config, text);
    });
  },
});
