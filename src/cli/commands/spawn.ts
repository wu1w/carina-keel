import { defineCommand } from "citty";
import { loadConfig } from "../../config.js";
import { t } from "../../i18n/index.js";
import { requirePackPath, resolveConfig } from "../resolve-config.js";
import { printStatus, runSafely } from "../run-safely.js";
import { createToolContext, executeTool } from "../tool-session.js";

const lang = loadConfig().lang;

/**
 * zh: 生成地点、人物或物品。直连 tools。
 * en: Spawn a place, entity, or object. Calls tools directly.
 */
export const spawnCommand = defineCommand({
  meta: {
    name: "spawn",
    description: t("cli.spawn", lang),
  },
  args: {
    pack: {
      type: "string",
      description: t("cli.packArg", lang),
      alias: "p",
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
    });
  },
});
