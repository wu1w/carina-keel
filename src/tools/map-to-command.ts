import type {
  AttachInput,
  ExportInput,
  GoInput,
  LookInput,
  RelateInput,
  RememberInput,
  SayInput,
  SpawnInput,
  ToolName,
  WorldCommand,
} from "../schema/index.js";
import { createUlid } from "../world/ids.js";

/**
 * zh: 把旧八工具调用映射成 WorldCommand。不执行、不写盘。
 * en: Map a legacy eight-tool call to a WorldCommand. Does not execute or write.
 */
export function mapToolToCommand(
  toolName: ToolName,
  input: unknown,
  meta: {
    worldId: string;
    origin: WorldCommand["origin"];
    requestedBy: string;
  },
): WorldCommand {
  switch (toolName) {
    case "go":
      return command("player.navigate", "player", input as GoInput, meta);
    case "say":
      return command(
        "player.act",
        "player",
        { action: "say", ...(input as SayInput) },
        meta,
      );
    case "look":
      return command(
        "player.act",
        "player",
        { action: "look", ...(input as LookInput) },
        meta,
      );
    case "spawn":
      return command("generation.start", "author", input as SpawnInput, meta);
    case "remember":
      return command(
        "rules.update",
        "author",
        {
          scope: "world",
          documentId: "MEMORY.md",
          append: (input as RememberInput).fact,
        },
        meta,
      );
    case "export":
      return command("export.create", "author", input as ExportInput, meta);
    case "relate":
      return command(
        "player.act",
        "author",
        { action: "relate", ...(input as RelateInput) },
        meta,
      );
    case "attach":
      return command(
        "player.act",
        "author",
        { action: "attach", ...(input as AttachInput) },
        meta,
      );
    default:
      return command("chat.utterance", "author", { toolName }, meta);
  }
}

function command(
  intentKind: WorldCommand["intentKind"],
  mode: WorldCommand["mode"],
  args: Record<string, unknown>,
  meta: {
    worldId: string;
    origin: WorldCommand["origin"];
    requestedBy: string;
  },
): WorldCommand {
  return {
    commandId: createUlid(),
    worldId: meta.worldId,
    intentKind,
    arguments: args,
    origin: meta.origin,
    mode,
    requestedBy: meta.requestedBy,
  };
}
