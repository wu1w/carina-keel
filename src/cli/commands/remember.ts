import { defineCommand } from "citty";
import { loadConfig } from "../../config.js";
import { t } from "../../i18n/index.js";
import { requirePackPath, resolveConfig } from "../resolve-config.js";
import { printStatus, runSafely } from "../run-safely.js";
import { createToolContext, executeTool } from "../tool-session.js";

const lang = loadConfig().lang;

/**
 * zh: 把逗号分隔的节点 id 收成列表。
 * en: Split a comma-separated node id string into a list.
 */
function parseRelatedIds(raw: string | undefined): string[] | undefined {
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  const ids = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return ids.length > 0 ? ids : undefined;
}

/**
 * zh: 把耐久事实写入 MEMORY.md。直连 tools，不经 daemon。
 * en: Promote a durable fact into MEMORY.md. Calls tools directly, no daemon.
 */
export const rememberCommand = defineCommand({
  meta: {
    name: "remember",
    description: t("cli.remember", lang),
  },
  args: {
    pack: {
      type: "positional",
      description: t("cli.packArg", lang),
      required: false,
    },
    fact: {
      type: "string",
      description: t("cli.factArg", lang),
      required: true,
    },
    related: {
      type: "string",
      description: t("cli.relatedArg", lang),
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
      const relatedNodeIds = parseRelatedIds(args.related);
      const input: { fact: string; relatedNodeIds?: string[] } = {
        fact: args.fact,
      };
      if (relatedNodeIds !== undefined) {
        input.relatedNodeIds = relatedNodeIds;
      }
      const result = await executeTool("remember", input, ctx);
      console.log(result.summary);
      if (result.data !== undefined) {
        console.log(JSON.stringify(result.data, null, 2));
      }
    });
  },
});
