import type { TurnEvent } from "../steward/turn-event.js";

/**
 * zh: 是否为异步可迭代对象。
 * en: Whether a value is async-iterable.
 */
function isAsyncIterable(value: object): value is AsyncIterable<unknown> {
  return Symbol.asyncIterator in value;
}

/**
 * zh: 从管家一轮结果里取出文本、状态与静帧。
 * en: Pull text, status, and stills out of a steward turn result.
 */
export async function* normalizeTurnStream(
  result: unknown,
): AsyncIterable<TurnEvent> {
  if (result === undefined || result === null) {
    return;
  }
  if (typeof result === "string") {
    if (result !== "") {
      yield { type: "text", text: result };
    }
    return;
  }
  if (typeof result !== "object") {
    return;
  }
  if (isAsyncIterable(result)) {
    for await (const chunk of result) {
      yield* normalizeChunk(chunk);
    }
    return;
  }
  if (result instanceof ReadableStream) {
    yield* readableStreamToText(result);
    return;
  }
  if ("textStream" in result) {
    yield* normalizeTurnStream((result as { textStream: unknown }).textStream);
    return;
  }
  yield* normalizeChunk(result);
}

/**
 * zh: 把单个块收成壳事件。
 * en: Collapse one chunk into shell events.
 */
async function* normalizeChunk(chunk: unknown): AsyncIterable<TurnEvent> {
  if (typeof chunk === "string") {
    if (chunk !== "") {
      yield { type: "text", text: chunk };
    }
    return;
  }
  if (chunk === undefined || chunk === null || typeof chunk !== "object") {
    return;
  }
  const record = chunk as { type?: unknown; text?: unknown; tool?: unknown };
  if (record.type === "clip") {
    yield chunk as TurnEvent;
    return;
  }
  if (record.type === "still") {
    const still = chunk as TurnEvent;
    yield still;
    return;
  }
  if (record.type === "status" && typeof record.tool === "string") {
    yield { type: "status", tool: record.tool };
    return;
  }
  if (record.type === "text" && typeof record.text === "string") {
    if (record.text !== "") {
      yield { type: "text", text: record.text };
    }
    return;
  }
  if (typeof record.text === "string" && record.text !== "") {
    yield { type: "text", text: record.text };
  }
}

/**
 * zh: 把字节流读成文本。
 * en: Read a byte stream as text.
 */
async function* readableStreamToText(
  stream: ReadableStream<unknown>,
): AsyncIterable<TurnEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (typeof value === "string") {
        if (value !== "") {
          yield { type: "text", text: value };
        }
        continue;
      }
      if (value instanceof Uint8Array) {
        const text = decoder.decode(value, { stream: true });
        if (text !== "") {
          yield { type: "text", text: text };
        }
      }
    }
    const tail = decoder.decode();
    if (tail !== "") {
      yield { type: "text", text: tail };
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * zh: 一轮对话：输入一句，产出文本与画面事件。
 * en: One chat turn: a message in, text and still events out.
 */
export type RunTurnFn = (
  message: string,
) =>
  | AsyncIterable<TurnEvent | string>
  | Promise<AsyncIterable<TurnEvent | string> | unknown>
  | unknown
  | Promise<unknown>;
