import { createOpenAI } from "@ai-sdk/openai";
import { stepCountIs, streamText, tool } from "ai";
import { loadConfig, type CarinaConfig, type CarinaLang } from "../config.js";
import { CarinaError } from "../errors.js";
import { t, type MessageKey } from "../i18n/index.js";
import { zh } from "../i18n/zh.js";
import { exportZip, type PackHandle } from "../pack/index.js";
import { MockRenderer } from "../render/index.js";
import {
  toolInputSchema,
  type ToolName,
  type ToolResult,
} from "../schema/index.js";
import { executeTool, type ToolContext } from "../tools/index.js";
import type { WorldStore } from "../world/index.js";
import {
  assembleContext,
  type AssembleContextOptions,
} from "./assemble-context.js";
import { DEFAULT_MAX_TOOL_STEPS, UTTERANCE_KIND } from "./constants.js";

/**
 * zh: 一轮管家对话所需的世界、工具与模型配置。
 * en: World, tools, and model config for one steward turn.
 */
export type RunTurnContext = {
  /**
   * zh: 世界库（写编年、读邻域）。
   * en: World store (chronicle writes, neighborhood reads).
   */
  store: WorldStore;
  /**
   * zh: 当前世界包。
   * en: The open world pack.
   */
  pack?: PackHandle;
  /**
   * zh: pack 的别名（server 会传 packHandle）。
   * en: Alias for pack (server passes packHandle).
   */
  packHandle?: PackHandle;
  /**
   * zh: 八工具执行上下文；缺省则用 mock 渲染器组装。
   * en: Context for executeTool; defaults to a mock renderer.
   */
  toolContext?: ToolContext;
  /**
   * zh: 进程配置；缺省则 loadConfig()。
   * en: Process config; defaults to loadConfig().
   */
  config?: CarinaConfig;
  abortSignal?: AbortSignal;
  fetch?: typeof fetch;
  /**
   * zh: 覆盖默认上下文预算。
   * en: Override default context-assembly budgets.
   */
  assemble?: AssembleContextOptions;
};

/**
 * zh: 跑一轮管家对话：组装上下文、流式工具循环、把发言写入编年。产出文本增量（可供 SSE 使用）。
 * en: Run one steward turn: assemble context, stream a tool loop, persist utterances to the chronicle. Yields text deltas (usable for SSE).
 */
export async function* runTurn(
  message: string,
  ctx: RunTurnContext,
): AsyncIterable<string> {
  const config = ctx.config ?? loadConfig();
  const lang = config.lang;
  const apiKey = config.apiKey;
  if (apiKey === undefined || apiKey.length === 0) {
    throw new CarinaError("CONFIG", "error.config");
  }

  const pack = resolvePack(ctx);
  const toolContext = resolveToolContext(ctx, pack, lang);

  const system = await assembleContext(
    ctx.store,
    pack,
    ctx.assemble ?? {},
  );

  await persistUtterance(ctx.store, "user", message);

  const worldTools = createStewardTools(toolContext, lang);

  const openaiSettings: {
    apiKey: string;
    baseURL: string;
    name: string;
    fetch?: typeof fetch;
  } = {
    apiKey,
    baseURL: config.modelBaseUrl,
    name: "carina",
  };
  if (ctx.fetch !== undefined) {
    openaiSettings.fetch = ctx.fetch;
  }

  const openai = createOpenAI(openaiSettings);
  let streamError: unknown;
  const streamOptions: {
    abortSignal?: AbortSignal;
  } = {};
  if (ctx.abortSignal !== undefined) {
    streamOptions.abortSignal = ctx.abortSignal;
  }

  const result = streamText({
    // zh: 兼容端点走 Chat Completions，不走 Responses。 en: OpenAI-compatible endpoints use Chat Completions, not Responses.
    model: openai.chat(config.model),
    system,
    prompt: message,
    tools: worldTools,
    stopWhen: stepCountIs(DEFAULT_MAX_TOOL_STEPS),
    ...streamOptions,
    onError: ({ error }) => {
      streamError = error;
    },
  });

  let fullText = "";
  for await (const delta of result.textStream) {
    fullText += delta;
    yield delta;
  }

  if (streamError !== undefined) {
    throw new CarinaError("INTERNAL", "error.internal", streamError);
  }

  if (fullText.length > 0) {
    await persistUtterance(ctx.store, "assistant", fullText);
  }

  pack.session.lastTurnAt = new Date().toISOString();
  pack.session.modelId = config.model;
  await pack.save();
}

/**
 * zh: 从 ctx.pack / packHandle / toolContext 取出包句柄。
 * en: Resolve the pack handle from pack, packHandle, or toolContext.
 */
function resolvePack(ctx: RunTurnContext): PackHandle {
  if (ctx.pack !== undefined) {
    return ctx.pack;
  }
  if (ctx.packHandle !== undefined) {
    return ctx.packHandle;
  }
  if (ctx.toolContext !== undefined) {
    return ctx.toolContext.packHandle;
  }
  throw new CarinaError("PACK_NOT_FOUND", "error.packNotFound");
}

/**
 * zh: 缺省用 mock 渲染器组装 ToolContext。
 * en: Build a ToolContext with the mock renderer when one was not provided.
 */
function resolveToolContext(
  ctx: RunTurnContext,
  pack: PackHandle,
  lang: CarinaLang,
): ToolContext {
  if (ctx.toolContext !== undefined) {
    return ctx.toolContext;
  }
  return {
    store: ctx.store,
    renderer: new MockRenderer(),
    exportZip,
    packHandle: pack,
    lang,
  };
}

/**
 * zh: 把用户或管家发言追加为 kind=utterance 的编年事件（不投影 Event 节点）。
 * en: Append a user or steward line as a kind=utterance chronicle event (no Event node).
 */
async function persistUtterance(
  store: WorldStore,
  role: "user" | "assistant",
  text: string,
): Promise<void> {
  await store.appendEvent({
    kind: UTTERANCE_KIND,
    payload: { role, text },
    relatedNodeIds: [],
    projectNode: false,
  });
}

/**
 * zh: 把八个世界工具交给模型；执行走 executeTool。
 * en: Expose the eight world tools to the model; execution goes through executeTool.
 */
function createStewardTools(toolContext: ToolContext, lang: CarinaLang) {
  return {
    look: tool({
      description: t("mcp.look", lang),
      inputSchema: toolInputSchema.look,
      execute: async (input) => executeNamed("look", input, toolContext, lang),
    }),
    go: tool({
      description: t("mcp.go", lang),
      inputSchema: toolInputSchema.go,
      execute: async (input) => executeNamed("go", input, toolContext, lang),
    }),
    say: tool({
      description: t("mcp.say", lang),
      inputSchema: toolInputSchema.say,
      execute: async (input) => executeNamed("say", input, toolContext, lang),
    }),
    remember: tool({
      description: t("mcp.remember", lang),
      inputSchema: toolInputSchema.remember,
      execute: async (input) =>
        executeNamed("remember", input, toolContext, lang),
    }),
    spawn: tool({
      description: t("mcp.spawn", lang),
      inputSchema: toolInputSchema.spawn,
      execute: async (input) => executeNamed("spawn", input, toolContext, lang),
    }),
    relate: tool({
      description: t("mcp.relate", lang),
      inputSchema: toolInputSchema.relate,
      execute: async (input) =>
        executeNamed("relate", input, toolContext, lang),
    }),
    attach: tool({
      description: t("mcp.attach", lang),
      inputSchema: toolInputSchema.attach,
      execute: async (input) =>
        executeNamed("attach", input, toolContext, lang),
    }),
    export: tool({
      description: t("mcp.export", lang),
      inputSchema: toolInputSchema.export,
      execute: async (input) =>
        executeNamed("export", input, toolContext, lang),
    }),
  };
}

/**
 * zh: 调用 executeTool，把可展示错误变成工具结果。
 * en: Call executeTool and turn displayable errors into a tool result.
 */
async function executeNamed(
  name: ToolName,
  input: unknown,
  toolContext: ToolContext,
  lang: CarinaLang,
): Promise<ToolResult> {
  try {
    return await executeTool(name, input, toolContext);
  } catch (error) {
    if (error instanceof CarinaError) {
      return {
        ok: false,
        summary: translateMessageKey(error.messageKey, lang),
      };
    }
    return { ok: false, summary: t("error.internal", lang) };
  }
}

/**
 * zh: 用词表翻译错误 key；未知 key 走内部错误。
 * en: Translate an error key from the catalog; unknown keys use the internal error.
 */
function translateMessageKey(key: string, lang: CarinaLang): string {
  if (isMessageKey(key)) {
    return t(key, lang);
  }
  return t("error.internal", lang);
}

/**
 * zh: 词表里是否有这个 key。
 * en: Whether the key exists in the message catalog.
 */
function isMessageKey(key: string): key is MessageKey {
  return Object.hasOwn(zh, key);
}
