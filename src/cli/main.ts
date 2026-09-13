import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineCommand, runMain } from "citty";
import { loadConfig } from "../config.js";
import { t } from "../i18n/index.js";
import { chatCommand } from "./commands/chat.js";
import { legacyCommand } from "./commands/legacy.js";
import { lookCommand } from "./commands/look.js";
import { mcpCommand } from "./commands/mcp.js";
import { newCommand } from "./commands/new.js";
import { rememberCommand } from "./commands/remember.js";
import { serveCommand } from "./commands/serve.js";
import { sessionsCommand } from "./commands/sessions.js";

const lang = loadConfig().lang;

/**
 * zh: 龙骨 CLI 根命令。产品入口是 new / serve / chat；图谱工具在 legacy 下。
 * en: Carina CLI root. Product path is new / serve / chat; graph tools live under legacy.
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
    sessions: sessionsCommand,
    chat: chatCommand,
    look: lookCommand,
    remember: rememberCommand,
    mcp: mcpCommand,
    legacy: legacyCommand,
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
