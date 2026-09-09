import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineCommand, runMain } from "citty";
import { loadConfig } from "../config.js";
import { t } from "../i18n/index.js";
import { chatCommand } from "./commands/chat.js";
import { exportCommand } from "./commands/export.js";
import { mcpCommand } from "./commands/mcp.js";
import { newCommand } from "./commands/new.js";
import { queryCommand } from "./commands/query.js";
import { relateCommand } from "./commands/relate.js";
import { serveCommand } from "./commands/serve.js";
import { spawnCommand } from "./commands/spawn.js";

const lang = loadConfig().lang;

/**
 * zh: 龙骨 CLI 根命令。
 * en: Carina CLI root command.
 */
export const main = defineCommand({
  meta: {
    name: "carina",
    version: "0.1.0",
    description: t("cli.help", lang),
  },
  subCommands: {
    new: newCommand,
    serve: serveCommand,
    chat: chatCommand,
    query: queryCommand,
    spawn: spawnCommand,
    relate: relateCommand,
    export: exportCommand,
    mcp: mcpCommand,
  },
});

/**
 * zh: 当前文件是否作为入口执行。
 * en: Whether this file is the process entry.
 */
function isCliEntry(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    return fileURLToPath(import.meta.url) === resolve(entry);
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  await runMain(main);
}
