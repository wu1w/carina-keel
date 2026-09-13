import { defineCommand } from "citty";
import { loadConfig } from "../../config.js";
import { t } from "../../i18n/index.js";
import { attachCommand } from "./attach.js";
import { exportCommand } from "./export.js";
import { goCommand } from "./go.js";
import { queryCommand } from "./query.js";
import { relateCommand } from "./relate.js";
import { sayCommand } from "./say.js";
import { spawnCommand } from "./spawn.js";

const lang = loadConfig().lang;

/**
 * zh: 旧八工具里仍要世界包的命令。产品入口是 chat / new，不在根帮助里冒充。
 * en: Leftover pack tools. Product path is chat / new; they must not look like the root CLI.
 */
export const legacyCommand = defineCommand({
  meta: {
    name: "legacy",
    description: t("cli.legacy", lang),
  },
  subCommands: {
    spawn: spawnCommand,
    go: goCommand,
    say: sayCommand,
    query: queryCommand,
    relate: relateCommand,
    attach: attachCommand,
    export: exportCommand,
  },
});
