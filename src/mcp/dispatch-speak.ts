import type {
  CommandResult,
} from "../schema/index.js";
import {
  normalizeSessionList,
  type Application,
} from "../server/bind-application.js";

/**
 * zh: MCP speak 走 WorldCommand 门面，不走八工具。
 * en: MCP speak uses the WorldCommand facade, not the eight tools.
 */
export async function dispatchSpeak(
  application: Application,
  text: string,
): Promise<{ results: CommandResult[]; isError: boolean }> {
  const listed = normalizeSessionList(await application.listSessions());
  const worldId = listed.activeWorldId ?? listed.worlds[0]?.worldId;
  const raw = await application.interpretAndDispatch(
    text,
    "mcp",
    worldId,
    "mcp",
  );
  const results = Array.isArray(raw) ? raw : [raw];
  return {
    results,
    isError: results.some((row) => !row.accepted),
  };
}
