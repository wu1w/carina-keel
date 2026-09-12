import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTurnStream } from "./normalize-turn.js";

/**
 * zh: 把字符串、可迭代与 { text } / still 收成壳事件。
 * en: Collapse strings, iterables, { text }, and stills into shell events.
 */
test("normalizeTurnStream accepts strings, text objects, and stills", async () => {
  const fromString: unknown[] = [];
  for await (const chunk of normalizeTurnStream("hi")) {
    fromString.push(chunk);
  }
  assert.deepEqual(fromString, [{ type: "text", text: "hi" }]);

  async function* gen() {
    yield "a";
    yield { text: "b" };
    yield { type: "status", tool: "look" };
    yield { type: "still", mime: "image/jpeg", base64: "AA" };
    yield {
      type: "clip",
      mime: "image/jpeg",
      fps: 8,
      frames: ["AA", "BB"],
    };
  }
  const fromGen: unknown[] = [];
  for await (const chunk of normalizeTurnStream(gen())) {
    fromGen.push(chunk);
  }
  assert.deepEqual(fromGen, [
    { type: "text", text: "a" },
    { type: "text", text: "b" },
    { type: "status", tool: "look" },
    { type: "still", mime: "image/jpeg", base64: "AA" },
    {
      type: "clip",
      mime: "image/jpeg",
      fps: 8,
      frames: ["AA", "BB"],
    },
  ]);
});
