import assert from "node:assert/strict";
import test from "node:test";
import { decodeSseTextData, parseSseBlock } from "./http-chat.js";

/**
 * zh: SSE 块解析与 JSON 解码。
 * en: SSE block parsing and JSON decoding.
 */
test("parseSseBlock reads event and JSON data", () => {
  const parsed = parseSseBlock('event: text\ndata: "hello"');
  assert.equal(parsed.event, "text");
  assert.equal(decodeSseTextData(parsed.data), "hello");
});
