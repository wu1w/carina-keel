import { defineCommand } from "citty";
import { loadConfig } from "../../config.js";
import { t } from "../../i18n/index.js";
import { NodeType } from "../../schema/index.js";
import type { QueryFilter } from "../../world/index.js";
import { runWithLegacyPack } from "../legacy-pack.js";
import { printStatus, runSafely } from "../run-safely.js";
import { createToolContext } from "../tool-session.js";

const lang = loadConfig().lang;

/**
 * zh: 把 CLI 字符串收成节点类型。
 * en: Narrow a CLI string to a node type.
 */
function parseNodeType(value: string): NodeType | undefined {
  for (const candidate of Object.values(NodeType)) {
    if (candidate === value) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * zh: 查询图谱。遗留图谱工具，需要世界包。
 * en: Query the graph. Legacy graph tool; needs a pack.
 */
export const queryCommand = defineCommand({
  meta: {
    name: "query",
    description: t("cli.query", lang),
  },
  args: {
    pack: {
      type: "positional",
      description: t("cli.packArg", lang),
      required: false,
    },
    id: {
      type: "string",
      description: t("cli.idArg", lang),
    },
    type: {
      type: "string",
      description: t("cli.typeArg", lang),
    },
    name: {
      type: "string",
      description: t("cli.nameArg", lang),
    },
  },
  async run({ args }) {
    await runSafely(lang, async () => {
      await runWithLegacyPack(args.pack, async (packDir, config) => {
        const ctx = await createToolContext(packDir, config.lang);
        const filter: QueryFilter = {};
        if (args.id !== undefined) {
          filter.id = args.id;
        }
        if (args.type !== undefined) {
          const nodeType = parseNodeType(args.type);
          if (nodeType === undefined) {
            printStatus("cli.queryNone", lang);
            return;
          }
          filter.type = nodeType;
        }
        if (args.name !== undefined) {
          filter.name = args.name;
        }
        const list = ctx.store.query(filter);
        if (list.length === 0) {
          printStatus("cli.queryNone", lang);
          return;
        }
        console.log(JSON.stringify(list, null, 2));
      });
    });
  },
});
