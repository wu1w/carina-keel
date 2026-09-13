import { defineCommand } from "citty";
import { loadConfig } from "../../config.js";
import { t } from "../../i18n/index.js";
import { createPack } from "../../pack/index.js";
import { createUlid } from "../../world/ids.js";
import {
  closeApplication,
  tryCreateApplication,
} from "../../server/bind-application.js";
import { printStatus, runSafely } from "../run-safely.js";
import { looksLikePackPath, resolveConfig } from "../resolve-config.js";

const lang = loadConfig().lang;

/**
 * zh: 默认建世界 session。路径像世界包时才走旧 createPack。
 * en: Create a world session by default. A pack-like path still uses createPack.
 */
export const newCommand = defineCommand({
  meta: {
    name: "new",
    description: t("cli.new", lang),
  },
  args: {
    pack: {
      type: "positional",
      description: t("cli.packArg", lang),
      required: false,
    },
    name: {
      type: "string",
      description: t("cli.nameArg", lang),
    },
  },
  async run({ args }) {
    await runSafely(lang, async () => {
      const packArg = args.pack;
      if (typeof packArg === "string" && looksLikePackPath(packArg)) {
        const config = resolveConfig(packArg);
        const packDir = config.pack;
        if (packDir === undefined || packDir === "") {
          printStatus("cli.needPack", lang);
          process.exitCode = 1;
          return;
        }
        await createPack(packDir, config.lang);
        printStatus("cli.created", lang, packDir);
        return;
      }
      const name =
        (typeof args.name === "string" && args.name.length > 0
          ? args.name
          : undefined) ??
        (typeof packArg === "string" && packArg.length > 0 ? packArg : "酒馆");
      const config = resolveConfig(undefined);
      const application = await tryCreateApplication(config);
      if (application === undefined) {
        printStatus("cli.needPack", lang);
        process.exitCode = 1;
        return;
      }
      try {
        const result = await application.dispatchCommand({
          commandId: createUlid(),
          intentKind: "session.create",
          arguments: { name },
          origin: "cli",
          mode: "author",
          requestedBy: "cli",
        });
        if (!result.accepted) {
          process.exitCode = 1;
          console.error(result.messageKey ?? "error.commandRejected");
          return;
        }
        printStatus("cli.createdSession", lang);
        if (result.worldId !== undefined) {
          console.log(result.worldId);
        }
      } finally {
        await closeApplication(application);
      }
    });
  },
});
