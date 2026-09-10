import { defineCommand } from "citty";
import { loadConfig } from "../../config.js";
import { t } from "../../i18n/index.js";
import { requirePackPath, resolveConfig } from "../resolve-config.js";
import { printStatus, runSafely } from "../run-safely.js";
import { createToolContext, executeTool } from "../tool-session.js";

const lang = loadConfig().lang;

/**
 * zh: 把包内文件绑到节点。直连 tools，不经 daemon。
 * en: Attach a pack file to a node. Calls tools directly, no daemon.
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
  },
});
