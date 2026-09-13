import { defineCommand } from "citty";
import { loadConfig } from "../../config.js";
import { t } from "../../i18n/index.js";
import { runSafely } from "../run-safely.js";
import { createToolContext, executeTool } from "../tool-session.js";
import { runWithLegacyPack } from "../legacy-pack.js";

const lang = loadConfig().lang;

/**
 * zh: 生成地点、人物或物品。遗留图谱工具，需要世界包。
 * en: Spawn a place, entity, or object. Legacy graph tool; needs a pack.
 */
export const spawnCommand = defineCommand({
  meta: {
    name: "spawn",
    description: t("cli.spawn", lang),
  },
  args: {
    pack: {
      type: "positional",
      description: t("cli.packArg", lang),
      required: false,
    },
    type: {
      type: "enum",
      description: t("cli.typeArg", lang),
      options: ["Place", "Entity", "Object"],
      required: true,
    },
    name: {
      type: "string",
      description: t("cli.nameArg", lang),
      required: true,
    },
    placeId: {
      type: "string",
      description: t("cli.placeArg", lang),
    },
  },
  async run({ args }) {
    await runSafely(lang, async () => {
      await runWithLegacyPack(args.pack, async (packDir, config) => {
        const ctx = await createToolContext(packDir, config.lang);
        const input: {
          type: "Place" | "Entity" | "Object";
          name: string;
          placeId?: string;
        } = {
          type: args.type,
          name: args.name,
        };
        if (args.placeId !== undefined) {
          input.placeId = args.placeId;
        }
        const result = await executeTool("spawn", input, ctx);
        console.log(result.summary);
        if (result.data !== undefined) {
          console.log(JSON.stringify(result.data, null, 2));
        }
      });
    });
  },
});
