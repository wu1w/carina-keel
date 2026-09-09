import type { MessageKey } from "./zh.js";

/**
 * zh: 英文词表。key 必须与 zh.ts 完全一致。
 * en: English copy. Keys must match zh.ts exactly.
 */
export const en: Record<MessageKey, string> = {
  "cli.help": "Carina: an agent layer for generative worlds.",
  "cli.new": "Create a world pack",
  "cli.serve": "Start the local daemon",
  "cli.chat": "Chat with the steward",
  "cli.query": "Query the graph",
  "cli.spawn": "Spawn a place, entity, or object",
  "cli.relate": "Add or retract an edge",
  "cli.export": "Export a world pack",
  "cli.mcp": "Start MCP over stdio",
  "cli.packArg": "World pack path",
  "cli.destArg": "Export destination path",
  "cli.listening": "daemon listening",
  "cli.chatFallback": "If TTY is unavailable, open this URL in a browser",
  "chat.title": "Carina steward",
  "chat.placeholder": "Speak to the world…",
  "chat.send": "Send",
  "mcp.look": "查看当前地点。Look at the current place.",
  "mcp.go": "前往一个地点。Move the player to a place.",
  "mcp.say": "对视野内人物说话。Speak to an entity in view.",
  "mcp.remember": "把事实写入长期记忆。Promote a durable fact.",
  "mcp.spawn": "创建地点、人物或物品。Spawn a place, entity, or object.",
  "mcp.relate": "添加或撤销关系。Add or retract an edge.",
  "mcp.attach": "把文件绑到节点。Attach a file to a node.",
  "mcp.export": "导出可迁移的世界包。Export a portable world pack.",
  "error.packNotFound": "World pack not found.",
  "error.packInvalid": "World pack is invalid or unsupported.",
  "error.sandbox": "Path is outside the world pack.",
  "error.unknownTool": "Unknown tool.",
  "error.toolInput": "Invalid tool input.",
  "error.graphInvalid": "Graph could not be parsed.",
  "error.sessionInvalid": "Session file is invalid.",
  "error.notFound": "Node or place does not exist.",
  "error.unauthorized": "Unauthorized.",
  "error.config": "Invalid configuration.",
  "error.exportFailed": "Export failed.",
  "error.internal": "Internal error.",
};
