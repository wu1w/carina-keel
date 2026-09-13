import { CarinaError } from "../errors.js";
import { readMarkdown } from "../pack/index.js";
import { compileWorldRules } from "../spatial/compile-world-rules.js";
import { lockedObjectNames } from "../spatial/locked-objects.js";
import {
  TOOL_NAMES,
  toolInputSchema,
  type ToolName,
  type ToolResult,
} from "../schema/index.js";
import type { ToolContext } from "./context.js";
import { runAttach } from "./run-attach.js";
import { runExport } from "./run-export.js";
import { runGo } from "./run-go.js";
import { runLook } from "./run-look.js";
import { runRelate } from "./run-relate.js";
import { runRemember } from "./run-remember.js";
import { runSay } from "./run-say.js";
import { runSpawn } from "./run-spawn.js";

/**
 * zh: 校验工具名，解析输入，分发到对应 runX。
 * en: Validate the tool name, parse input, and dispatch to the matching runX.
 */
export async function executeTool(
  name: ToolName,
  input: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!isToolName(name)) {
    throw new CarinaError("UNKNOWN_TOOL", "error.unknownTool");
  }
  await assertLegacyWorldRules(name, input, ctx);
  switch (name) {
    case "look":
      return runLook(parseInput("look", input), ctx);
    case "go":
      return runGo(parseInput("go", input), ctx);
    case "say":
      return runSay(parseInput("say", input), ctx);
    case "remember":
      return runRemember(parseInput("remember", input), ctx);
    case "spawn":
      return runSpawn(parseInput("spawn", input), ctx);
    case "relate":
      return runRelate(parseInput("relate", input), ctx);
    case "attach":
      return runAttach(parseInput("attach", input), ctx);
    case "export":
      return runExport(parseInput("export", input), ctx);
    default:
      throw new CarinaError("UNKNOWN_TOOL", "error.unknownTool");
  }
}

/**
 * zh: legacy 八工具也走 WORLD.md 已抽出条款，不能当后门。
 * en: The leftover eight tools also honor compiled WORLD.md clauses.
 */
async function assertLegacyWorldRules(
  name: ToolName,
  input: unknown,
  ctx: ToolContext,
): Promise<void> {
  let body = "";
  try {
    body = await readMarkdown(ctx.packHandle, "WORLD.md");
  } catch {
    return;
  }
  const rules = compileWorldRules(body, "legacy", "legacy");
  const kinds = new Set(rules.clauses.map((clause) => clause.kind));
  if (name === "go" && kinds.has("no_teleport")) {
    throw new CarinaError("COMMAND_REJECTED", "error.noTeleport");
  }
  if (name === "spawn" && kinds.has("generation_forbid")) {
    throw new CarinaError("COMMAND_REJECTED", "error.commandRejected");
  }
  if ((name === "relate" || name === "attach") && kinds.has("lock_object")) {
    const names = lockedObjectNames(rules);
    const blob = JSON.stringify(input).toLowerCase();
    if (names.some((item) => blob.includes(item.toLowerCase()))) {
      throw new CarinaError("COMMAND_REJECTED", "error.lockObject");
    }
    const ids = collectLegacyNodeIds(input);
    for (const id of ids) {
      const node = ctx.packHandle.graph.nodes.find((item) => item.id === id);
      const nodeName =
        typeof node?.props["name"] === "string" ? node.props["name"] : "";
      if (
        names.some((item) => nodeName.toLowerCase().includes(item.toLowerCase()))
      ) {
        throw new CarinaError("COMMAND_REJECTED", "error.lockObject");
      }
    }
  }
}

function collectLegacyNodeIds(input: unknown): string[] {
  if (input === null || typeof input !== "object") {
    return [];
  }
  const record = input as Record<string, unknown>;
  const keys = ["fromId", "toId", "nodeId", "placeId", "parentId"];
  const ids: string[] = [];
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      ids.push(value);
    }
  }
  return ids;
}

function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * zh: 用 schema 的 Zod 表解析工具输入。
 * en: Parse tool input with the schema Zod map.
 */
function parseInput<K extends ToolName>(
  name: K,
  input: unknown,
): (typeof toolInputSchema)[K]["_output"] {
  const parsed = toolInputSchema[name].safeParse(input);
  if (!parsed.success) {
    throw new CarinaError("TOOL_INPUT", "error.toolInput", parsed.error);
  }
  return parsed.data;
}
