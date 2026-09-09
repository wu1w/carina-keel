import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTurnStream } from "./normalize-turn.js";

/**
 * zh: 把字符串、可迭代与 { text } 收成文本流。
 * en: Collapse strings, iterables, and { text } into a text stream.
 */
test("normalizeTurnStream accepts strings and async iterables", async () => {
  const fromString: string[] = [];
  for await (const chunk of normalizeTurnStream("hi")) {
    fromString.push(chunk);
  }
  assert.deepEqual(fromString, ["hi"]);

  async function* gen() {
    yield "a";
    yield { text: "b" };
  }
  const fromGen: string[] = [];
  for await (const chunk of normalizeTurnStream(gen())) {
    fromGen.push(chunk);
  }
  assert.deepEqual(fromGen, ["a", "b"]);
});
