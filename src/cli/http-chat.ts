import { CarinaError, type CarinaErrorCode } from "../errors.js";

const ERROR_CODES: ReadonlySet<CarinaErrorCode> = new Set([
  "PACK_NOT_FOUND",
  "PACK_INVALID",
  "SANDBOX",
  "UNKNOWN_TOOL",
  "TOOL_INPUT",
  "GRAPH_INVALID",
  "SESSION_INVALID",
  "NOT_FOUND",
  "UNAUTHORIZED",
  "CONFIG",
  "EXPORT_FAILED",
  "INTERNAL",
]);

/**
 * zh: 解析一段 SSE。
 * en: Parse one SSE block.
 */
export function parseSseBlock(block: string): { event: string; data: string } {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).replace(/^\s/, ""));
    }
  }
  return { event, data: dataLines.join("\n") };
}

/**
 * zh: 解码 SSE data（JSON 字符串或原文）。
 * en: Decode SSE data (JSON string or raw text).
 */
export function decodeSseTextData(data: string): string {
  if (data === "") {
    return "";
  }
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed === "string") {
      return parsed;
    }
  } catch {
    // zh: 非 JSON 则原样返回。 en: Fall back to the raw payload.
  }
  return data;
}

/**
 * zh: 从 Response 读取 SSE 文本事件。
 * en: Read SSE text events from a Response.
 */
export async function* readSseText(res: Response): AsyncIterable<string> {
  const body = res.body;
  if (body === null) {
    return;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let separator = buffer.indexOf("\n\n");
      while (separator !== -1) {
        const raw = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const parsed = parseSseBlock(raw.replace(/\r/g, ""));
        if (parsed.event === "error") {
          throw errorFromSse(parsed.data);
        }
        if (parsed.event === "done") {
          return;
        }
        if (parsed.event === "text" || parsed.event === "message") {
          const text = decodeSseTextData(parsed.data);
          if (text !== "") {
            yield text;
          }
        }
        separator = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * zh: 把 SSE error 事件变成 CarinaError。
 * en: Turn an SSE error event into a CarinaError.
 */
function errorFromSse(data: string): CarinaError {
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as { code?: unknown; message?: unknown };
      if (typeof record.code === "string") {
        return new CarinaError(
          asErrorCode(record.code),
          guessMessageKey(record.code),
        );
      }
    }
  } catch {
    // zh: 解析失败走内部错误。 en: Fall back to an internal error.
  }
  return new CarinaError("INTERNAL", "error.internal");
}

/**
 * zh: 把未知字符串收成错误码。
 * en: Narrow an unknown string to an error code.
 */
function asErrorCode(code: string): CarinaErrorCode {
  if (ERROR_CODES.has(code as CarinaErrorCode)) {
    return code as CarinaErrorCode;
  }
  return "INTERNAL";
}

/**
 * zh: 用错误码猜词表 key。
 * en: Map an error code to a catalog key.
 */
function guessMessageKey(code: string): string {
  const map: Record<string, string> = {
    PACK_NOT_FOUND: "error.packNotFound",
    PACK_INVALID: "error.packInvalid",
    SANDBOX: "error.sandbox",
    UNKNOWN_TOOL: "error.unknownTool",
    TOOL_INPUT: "error.toolInput",
    GRAPH_INVALID: "error.graphInvalid",
    SESSION_INVALID: "error.sessionInvalid",
    NOT_FOUND: "error.notFound",
    UNAUTHORIZED: "error.unauthorized",
    CONFIG: "error.config",
    EXPORT_FAILED: "error.exportFailed",
    INTERNAL: "error.internal",
  };
  return map[code] ?? "error.internal";
}

/**
 * zh: POST /v1/chat 并流出文本。只走 HTTP，不调 runTurn。
 * en: POST /v1/chat and stream text. HTTP only; never call runTurn.
 */
export async function* postChat(
  baseUrl: string,
  token: string,
  message: string,
): AsyncIterable<string> {
  const endpoint = new URL("/v1/chat", baseUrl).href;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message }),
  });
  if (res.status === 401) {
    throw new CarinaError("UNAUTHORIZED", "error.unauthorized");
  }
  if (!res.ok) {
    throw new CarinaError("INTERNAL", "error.internal");
  }
  yield* readSseText(res);
}
