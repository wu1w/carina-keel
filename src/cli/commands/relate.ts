import { defineCommand } from "citty";
import { loadConfig } from "../../config.js";
import { t } from "../../i18n/index.js";
import { EdgeType } from "../../schema/index.js";
import { runSafely } from "../run-safely.js";
import { createToolContext, executeTool } from "../tool-session.js";
import { runWithLegacyPack } from "../legacy-pack.js";

const lang = loadConfig().lang;

const EDGE_OPTIONS = [
  EdgeType.In,
  EdgeType.Contains,
  EdgeType.Knows,
  EdgeType.Owns,
  EdgeType.Caused,
  EdgeType.DepictedAs,
  EdgeType.DerivedFrom,
] as const;

/**
 * zh: 添加或撤销边。遗留图谱工具，需要世界包。
 * en: Add or retract an edge. Legacy graph tool; needs a pack.
 */
export const relateCommand = defineCommand({
  meta: {
    name: "relate",
    description: t("cli.relate", lang),
  },
  args: {
    pack: {
      type: "positional",
      description: t("cli.packArg", lang),
      required: false,
    },
    from: {
      type: "string",
      description: t("cli.fromArg", lang),
      required: true,
    },
    to: {
      type: "string",
      description: t("cli.toArg", lang),
      required: true,
    },
    type: {
      type: "enum",
      description: t("cli.edgeTypeArg", lang),
      options: [...EDGE_OPTIONS],
      required: true,
    },
    retract: {
      type: "boolean",
      description: t("cli.retractArg", lang),
    },
  },
  async run({ args }) {
    await runSafely(lang, async () => {
      await runWithLegacyPack(args.pack, async (packDir, config) => {
        const ctx = await createToolContext(packDir, config.lang);
        const input: {
          fromId: string;
          toId: string;
          type: (typeof EDGE_OPTIONS)[number];
          retract?: boolean;
        } = {
          fromId: args.from,
          toId: args.to,
          type: args.type,
        };
        if (args.retract === true) {
          input.retract = true;
        }
        const result = await executeTool("relate", input, ctx);
        console.log(result.summary);
        if (result.data !== undefined) {
          console.log(JSON.stringify(result.data, null, 2));
        }
      });
    });
  },
});
