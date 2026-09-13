import { defineCommand } from "citty";
import { loadConfig } from "../../config.js";
import { t } from "../../i18n/index.js";
import { runSafely } from "../run-safely.js";
import { createToolContext, executeTool } from "../tool-session.js";
import { runWithLegacyPack } from "../legacy-pack.js";

const lang = loadConfig().lang;

/**
 * zh: 把包内文件绑到节点。遗留图谱工具，需要世界包。
 * en: Attach a pack file to a node. Legacy graph tool; needs a pack.
 */
export const attachCommand = defineCommand({
  meta: {
    name: "attach",
    description: t("cli.attach", lang),
  },
  args: {
    pack: {
      type: "positional",
      description: t("cli.packArg", lang),
      required: false,
    },
    nodeId: {
      type: "string",
      description: t("cli.idArg", lang),
      required: true,
    },
    posixPath: {
      type: "string",
      description: t("cli.posixArg", lang),
      required: true,
    },
    kind: {
      type: "string",
      description: t("cli.kindArg", lang),
    },
  },
  async run({ args }) {
    await runSafely(lang, async () => {
      await runWithLegacyPack(args.pack, async (packDir, config) => {
        const ctx = await createToolContext(packDir, config.lang);
        const input: {
          nodeId: string;
          posixPath: string;
          kind?: string;
        } = {
          nodeId: args.nodeId,
          posixPath: args.posixPath,
        };
        if (args.kind !== undefined && args.kind !== "") {
          input.kind = args.kind;
        }
        const result = await executeTool("attach", input, ctx);
        console.log(result.summary);
        if (result.data !== undefined) {
          console.log(JSON.stringify(result.data, null, 2));
        }
      });
    });
  },
});
