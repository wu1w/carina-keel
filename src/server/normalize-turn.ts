/**
 * zh: 是否为异步可迭代对象。
 * en: Whether a value is async-iterable.
 */
function isAsyncIterable(value: object): value is AsyncIterable<unknown> {
  return Symbol.asyncIterator in value;
}

/**
 * zh: 从管家一轮结果里取出文本块。
 * en: Pull text chunks out of a steward turn result.
 */
export async function* normalizeTurnStream(
  result: unknown,
): AsyncIterable<string> {
  if (result === undefined || result === null) {
    return;
  }
  if (typeof result === "string") {
    yield result;
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
  if (
    "text" in result &&
    typeof (result as { text: unknown }).text === "string"
  ) {
    yield (result as { text: string }).text;
  }
}

/**
 * zh: 把单个块收成字符串。
 * en: Collapse one chunk into a string.
 */
async function* normalizeChunk(chunk: unknown): AsyncIterable<string> {
  if (typeof chunk === "string") {
    if (chunk !== "") {
      yield chunk;
    }
    return;
  }
  if (chunk === undefined || chunk === null || typeof chunk !== "object") {
    return;
  }
  if (
    "text" in chunk &&
    typeof (chunk as { text: unknown }).text === "string"
  ) {
    const text = (chunk as { text: string }).text;
    if (text !== "") {
      yield text;
    }
  }
}

/**
 * zh: 把字节流读成文本。
 * en: Read a byte stream as text.
 */
async function* readableStreamToText(
  stream: ReadableStream<unknown>,
): AsyncIterable<string> {
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
          yield value;
        }
        continue;
      }
      if (value instanceof Uint8Array) {
        const text = decoder.decode(value, { stream: true });
        if (text !== "") {
          yield text;
        }
      }
    }
    const tail = decoder.decode();
    if (tail !== "") {
      yield tail;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * zh: 一轮对话：输入一句，产出文本流。
 * en: One chat turn: a message in, a text stream out.
 */
export type RunTurnFn = (
  message: string,
) =>
  | AsyncIterable<string>
  | Promise<AsyncIterable<string> | unknown>
  | unknown
  | Promise<unknown>;
