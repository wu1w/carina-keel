import type { CarinaConfig } from "../config.js";
import { loadConfig } from "../config.js";
import { isMessageKey } from "../i18n/index.js";
import { printStatus } from "./run-safely.js";
import {
  closeApplication,
  normalizeSessionList,
  tryCreateApplication,
} from "../server/bind-application.js";

const lang = loadConfig().lang;

/**
 * zh: CLI 自然语言走 application WorldCommand，与 HTTP / MCP speak 同一套。
 * en: CLI natural language uses the application WorldCommand facade, same as HTTP / MCP speak.
 */
export async function dispatchSpeakCli(
  config: CarinaConfig,
  text: string,
): Promise<void> {
  const application = await tryCreateApplication(config);
  if (application === undefined) {
    printStatus("cli.leftoverUseChat", lang);
    process.exitCode = 1;
    return;
  }
  try {
    const listed = normalizeSessionList(await application.listSessions());
    const worldId = listed.activeWorldId ?? listed.worlds[0]?.worldId;
    const raw = await application.interpretAndDispatch(
      text,
      "cli",
      worldId,
      "cli",
    );
    const results = Array.isArray(raw) ? raw : [raw];
    for (const result of results) {
      if (!result.accepted) {
        process.exitCode = 1;
        const key = result.messageKey;
        if (typeof key === "string" && isMessageKey(key)) {
          printStatus(key, lang);
        } else {
          console.error(key ?? "error.commandRejected");
        }
        return;
      }
      const spoken = result.payload?.["text"];
      if (typeof spoken === "string" && spoken.length > 0) {
        console.log(spoken);
        continue;
      }
      console.log(
        JSON.stringify(
          {
            accepted: true,
            worldId: result.worldId,
            revision: result.revision,
            payload: result.payload,
          },
          null,
          2,
        ),
      );
    }
  } finally {
    await closeApplication(application);
  }
}
