import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { CarinaConfig } from "../config.js";
import { loadConfig } from "../config.js";
import { CarinaError } from "../errors.js";
import { t, type MessageKey } from "../i18n/index.js";
import { formatUserError } from "../i18n/user-error.js";
import { readMarkdown } from "../pack/index.js";
import { type ToolName, toolInputSchema } from "../schema/index.js";
import {
  normalizeSessionList,
  tryCreateApplication,
  type Application,
} from "../server/bind-application.js";
import { createUlid } from "../world/ids.js";
import { graphSummary } from "./graph-summary.js";
import { createToolContext, executeTool } from "./tool-context.js";

const MCP_DESCRIPTION_KEY = {
  look: "mcp.look",
  go: "mcp.go",
  say: "mcp.say",
  remember: "mcp.remember",
  spawn: "mcp.spawn",
  relate: "mcp.relate",
  attach: "mcp.attach",
  export: "mcp.export",
} as const satisfies Record<ToolName, MessageKey>;

/**
 * zh: 以 stdio 启动 MCP。工具走 executeTool；资源只读包内文件。
 * en: Start MCP over stdio. Tools go through executeTool; resources are pack-local and read-only.
 */
export async function startMcpServer(
  config: CarinaConfig = loadConfig(),
): Promise<void> {
  if (config.pack === undefined || config.pack === "") {
    throw new CarinaError("CONFIG", "error.config");
  }
  const ctx = await createToolContext(config.pack, config.lang);
  const mcp = new McpServer({
    name: "carina",
    version: "0.1.0",
  });
  registerWorldTools(mcp, ctx, config.lang);
  registerPackResources(mcp, ctx, config.lang);
  await registerRuleWriteTools(mcp, config);
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}

/**
 * zh: 注册八个世界工具。描述已含中英。
 * en: Register the eight world tools. Descriptions already include zh and en.
 */
function registerWorldTools(
  mcp: McpServer,
  ctx: Awaited<ReturnType<typeof createToolContext>>,
  lang: CarinaConfig["lang"],
): void {
  registerOne(mcp, ctx, lang, "look", toolInputSchema.look);
  registerOne(mcp, ctx, lang, "go", toolInputSchema.go);
  registerOne(mcp, ctx, lang, "say", toolInputSchema.say);
  registerOne(mcp, ctx, lang, "remember", toolInputSchema.remember);
  registerOne(mcp, ctx, lang, "spawn", toolInputSchema.spawn);
  registerOne(mcp, ctx, lang, "relate", toolInputSchema.relate);
  registerOne(mcp, ctx, lang, "attach", toolInputSchema.attach);
  registerOne(mcp, ctx, lang, "export", toolInputSchema.export);
}

/**
 * zh: 注册一个世界工具；参数表与工具名对齐。
 * en: Register one world tool with a schema that matches the name.
 */
function registerOne<K extends ToolName>(
  mcp: McpServer,
  ctx: Awaited<ReturnType<typeof createToolContext>>,
  lang: CarinaConfig["lang"],
  name: K,
  schema: (typeof toolInputSchema)[K],
): void {
  /**
   * zh: SDK 对 Zod 4 object schema 的回调泛型收不窄，这里按 CallToolResult 手写。
   * en: The SDK does not narrow Zod 4 object-schema callbacks; write CallToolResult by hand.
   */
  const handler = async (
    args: Record<string, unknown>,
  ): Promise<CallToolResult> => {
    try {
      const result = await executeTool(name, args, ctx);
      const payload =
        result.data === undefined
          ? result.summary
          : `${result.summary}\n${JSON.stringify(result.data)}`;
      return {
        content: [{ type: "text", text: payload }],
        isError: !result.ok,
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: formatUserError(err, lang) }],
        isError: true,
      };
    }
  };
  mcp.registerTool(
    name,
    {
      description: t(MCP_DESCRIPTION_KEY[name], lang),
      inputSchema: schema,
    },
    handler as never,
  );
}

/**
 * zh: 暴露 WORLD.md、MEMORY.md 与图谱摘要。无 host exec。
 * en: Expose WORLD.md, MEMORY.md, and a graph summary. No host exec.
 */
function registerPackResources(
  mcp: McpServer,
  ctx: Awaited<ReturnType<typeof createToolContext>>,
  lang: CarinaConfig["lang"],
): void {
  mcp.registerResource(
    "world-md",
    "carina://WORLD.md",
    {
      description: t("mcp.resourceWorld", lang),
      mimeType: "text/markdown",
    },
    async (uri) => {
      const text = await readMarkdown(ctx.packHandle, "WORLD.md");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text,
          },
        ],
      };
    },
  );
  mcp.registerResource(
    "memory-md",
    "carina://MEMORY.md",
    {
      description: t("mcp.resourceMemory", lang),
      mimeType: "text/markdown",
    },
    async (uri) => {
      const text = await readMarkdown(ctx.packHandle, "MEMORY.md");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text,
          },
        ],
      };
    },
  );
  mcp.registerResource(
    "graph-summary",
    "carina://graph.json",
    {
      description: t("mcp.resourceGraph", lang),
      mimeType: "application/json",
    },
    async (uri) => {
      const text = graphSummary(ctx.packHandle.graph, ctx.packHandle.session);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text,
          },
        ],
      };
    },
  );
}

const ruleWriteInput = z.object({
  body: z.string().optional(),
  append: z.string().optional(),
});

/**
 * zh: 经 application rules.update 写 WORLD.md / MEMORY.md。旧只读资源仍可用。
 * en: Write WORLD.md / MEMORY.md via application rules.update. Old read resources stay.
 */
async function registerRuleWriteTools(
  mcp: McpServer,
  config: CarinaConfig,
): Promise<void> {
  const application = await tryCreateApplication(config);
  if (application === undefined) {
    return;
  }
  registerOneWrite(mcp, application, config.lang, "update_world_md", "WORLD.md");
  registerOneWrite(mcp, application, config.lang, "update_memory_md", "MEMORY.md");
}

/**
 * zh: 注册一个规则文档写工具。
 * en: Register one rule-document write tool.
 */
function registerOneWrite(
  mcp: McpServer,
  application: Application,
  lang: CarinaConfig["lang"],
  name: "update_world_md" | "update_memory_md",
  documentId: "WORLD.md" | "MEMORY.md",
): void {
  const description =
    documentId === "WORLD.md"
      ? t("mcp.resourceWorld", lang)
      : t("mcp.resourceMemory", lang);
  const handler = async (
    args: Record<string, unknown>,
  ): Promise<CallToolResult> => {
    try {
      const parsed = ruleWriteInput.parse(args);
      const listed = normalizeSessionList(await application.listSessions());
      const worldId = listed.activeWorldId ?? listed.worlds[0]?.worldId;
      if (worldId === undefined) {
        throw new CarinaError("WORLD_NOT_ACTIVE", "error.worldNotActive");
      }
      const arguments_: Record<string, unknown> = {
        scope: "world",
        documentId,
      };
      if (parsed.body !== undefined) {
        arguments_["body"] = parsed.body;
      }
      if (parsed.append !== undefined) {
        arguments_["append"] = parsed.append;
      }
      if (parsed.body === undefined && parsed.append === undefined) {
        throw new CarinaError("CONFIG", "error.badRequest");
      }
      const result = await application.dispatchCommand({
        commandId: createUlid(),
        worldId,
        intentKind: "rules.update",
        arguments: arguments_,
        origin: "mcp",
        mode: "author",
        requestedBy: "mcp",
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: !result.accepted,
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: formatUserError(err, lang) }],
        isError: true,
      };
    }
  };
  mcp.registerTool(
    name,
    {
      description,
      inputSchema: ruleWriteInput,
    },
    handler as never,
  );
}
