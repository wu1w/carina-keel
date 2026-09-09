import { CarinaError } from "../errors.js";
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
 * zh: 运行时工具名守卫。
 * en: Runtime guard for tool names.
 */
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
